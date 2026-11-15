begin;

-- A request UUID is unique across every mutation type in one portfolio, not
-- merely inside one ledger table. The canonical payload makes safe retries
-- distinguishable from accidental request-id reuse.
create table if not exists private.portfolio_request_keys (
    portfolio_id uuid not null references public.portfolios(id) on delete cascade,
    client_request_id uuid not null,
    action text not null,
    payload jsonb not null,
    resource_id uuid,
    created_at timestamp with time zone not null default now(),
    primary key (portfolio_id, client_request_id),
    constraint portfolio_request_keys_action_check check (
        action in (
            'record_transaction',
            'record_cash_flow',
            'reverse_transaction',
            'reverse_cash_flow'
        )
    )
);

revoke all on table private.portfolio_request_keys
    from public, anon, authenticated;

-- Existing rows remain replayable after introducing the shared registry.
insert into private.portfolio_request_keys (
    portfolio_id, client_request_id, action, payload, resource_id, created_at
)
select
    t.portfolio_id,
    t.client_request_id,
    'record_transaction',
    jsonb_build_object(
        'instrument_id', t.instrument_id,
        'transaction_type', t.transaction_type,
        'quantity', t.quantity,
        'unit_price', t.unit_price,
        'currency', t.transaction_currency,
        'transaction_at', t.transaction_at,
        'notes', t.notes
    ),
    t.id,
    t.created_at
from public.portfolio_transactions as t
on conflict (portfolio_id, client_request_id) do nothing;

insert into private.portfolio_request_keys (
    portfolio_id, client_request_id, action, payload, resource_id, created_at
)
select
    t.portfolio_id,
    t.reversal_client_request_id,
    'reverse_transaction',
    jsonb_build_object('transaction_id', t.id, 'reason', t.reversal_reason),
    t.id,
    coalesce(t.reversed_at, t.updated_at)
from public.portfolio_transactions as t
where t.reversal_client_request_id is not null
on conflict (portfolio_id, client_request_id) do nothing;

insert into private.portfolio_request_keys (
    portfolio_id, client_request_id, action, payload, resource_id, created_at
)
select
    c.portfolio_id,
    c.reversal_client_request_id,
    'reverse_cash_flow',
    jsonb_build_object('cash_flow_id', c.id, 'reason', c.reversal_reason),
    c.id,
    coalesce(c.reversed_at, c.updated_at)
from public.portfolio_cash_flows as c
where c.reversal_client_request_id is not null
on conflict (portfolio_id, client_request_id) do nothing;

insert into private.portfolio_request_keys (
    portfolio_id, client_request_id, action, payload, resource_id, created_at
)
select
    c.portfolio_id,
    c.client_request_id,
    'record_cash_flow',
    jsonb_build_object(
        'flow_type', c.flow_type,
        'amount', c.amount,
        'currency', c.currency,
        'flow_at', c.flow_at,
        'notes', c.notes
    ),
    c.id,
    c.created_at
from public.portfolio_cash_flows as c
on conflict (portfolio_id, client_request_id) do nothing;

create or replace function private.claim_portfolio_request(
    p_portfolio_id uuid,
    p_client_request_id uuid,
    p_action text,
    p_payload jsonb
)
returns table (was_replayed boolean, resource_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_existing private.portfolio_request_keys%rowtype;
begin
    select k.* into v_existing
    from private.portfolio_request_keys as k
    where k.portfolio_id = p_portfolio_id
      and k.client_request_id = p_client_request_id
    for update;

    if found then
        if v_existing.action is distinct from p_action
           or v_existing.payload is distinct from p_payload then
            raise exception using
                errcode = 'P0001',
                message = 'portfolio_idempotency_conflict';
        end if;
        return query select true, v_existing.resource_id;
        return;
    end if;

    insert into private.portfolio_request_keys (
        portfolio_id, client_request_id, action, payload
    ) values (
        p_portfolio_id, p_client_request_id, p_action, p_payload
    );

    return query select false, null::uuid;
end;
$$;

create or replace function private.complete_portfolio_request(
    p_portfolio_id uuid,
    p_client_request_id uuid,
    p_resource_id uuid
)
returns void
language sql
security definer
set search_path = pg_catalog, public, private
as $$
    update private.portfolio_request_keys
    set resource_id = p_resource_id
    where portfolio_id = p_portfolio_id
      and client_request_id = p_client_request_id;
$$;

-- Cash is a derived ledger balance. Trades intentionally participate in cash:
-- BUY decreases cash and SELL increases it. Fees and dividends are out of scope.
create or replace function private.get_portfolio_cash_balance(
    p_portfolio_id uuid,
    p_currency text
)
returns numeric
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
    with ledger as (
        select
            case c.flow_type
                when 'DEPOSIT' then c.amount
                else -c.amount
            end as amount
        from public.portfolio_cash_flows as c
        where c.portfolio_id = p_portfolio_id
          and c.currency = p_currency
          and c.is_reversed = false

        union all

        select
            case t.transaction_type
                when 'BUY' then -(t.quantity * t.unit_price)
                else t.quantity * t.unit_price
            end as amount
        from public.portfolio_transactions as t
        where t.portfolio_id = p_portfolio_id
          and t.transaction_currency = p_currency
          and t.is_reversed = false
    )
    select coalesce(sum(amount), 0::numeric) from ledger;
$$;

-- Replace the transaction RPC so request ids are shared safely with cash and
-- reversal operations. BUY is allowed to create negative cash: this supports
-- importing an existing portfolio whose historical deposits are unknown.
create or replace function public.record_portfolio_transaction(
    p_portfolio_id uuid,
    p_instrument_id uuid,
    p_transaction_type text,
    p_quantity numeric,
    p_unit_price numeric,
    p_transaction_currency text,
    p_transaction_at timestamp with time zone,
    p_client_request_id uuid,
    p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_user_id uuid := auth.uid();
    v_transaction_type text := upper(btrim(coalesce(p_transaction_type, '')));
    v_currency text := upper(btrim(coalesce(p_transaction_currency, '')));
    v_notes text := nullif(btrim(p_notes), '');
    v_payload jsonb;
    v_claim record;
    v_instrument record;
    v_transaction_id uuid;
    v_current_quantity numeric;
    v_remaining_cost_basis numeric;
    v_realized_pnl numeric;
begin
    if v_user_id is null then
        raise exception using errcode = 'P0001', message = 'portfolio_authentication_required';
    end if;
    if p_client_request_id is null then
        raise exception using errcode = 'P0001', message = 'portfolio_client_request_id_required';
    end if;
    if v_transaction_type not in ('BUY', 'SELL') then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_transaction_type';
    end if;
    if p_quantity is null or p_quantity <= 0
       or p_quantity in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_quantity';
    end if;
    if p_unit_price is null or p_unit_price <= 0
       or p_unit_price in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_unit_price';
    end if;
    if v_currency not in ('TRY', 'USD') then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_currency';
    end if;
    if p_transaction_at is null then
        raise exception using errcode = 'P0001', message = 'portfolio_transaction_at_required';
    end if;
    if p_transaction_at > now() + interval '5 minutes' then
        raise exception using errcode = 'P0001', message = 'portfolio_future_transaction_not_allowed';
    end if;

    perform 1 from public.portfolios as p
    where p.id = p_portfolio_id and p.user_id = v_user_id and p.archived_at is null
    for update;
    if not found then
        raise exception using errcode = 'P0001', message = 'portfolio_not_found_or_forbidden';
    end if;

    v_payload := jsonb_build_object(
        'instrument_id', p_instrument_id,
        'transaction_type', v_transaction_type,
        'quantity', p_quantity,
        'unit_price', p_unit_price,
        'currency', v_currency,
        'transaction_at', p_transaction_at,
        'notes', v_notes
    );
    select * into v_claim from private.claim_portfolio_request(
        p_portfolio_id, p_client_request_id, 'record_transaction', v_payload
    );

    if v_claim.was_replayed then
        if v_claim.resource_id is null then
            raise exception using errcode = 'P0001', message = 'portfolio_idempotency_incomplete';
        end if;
        select s.current_quantity, s.remaining_cost_basis, s.realized_pnl
        into v_current_quantity, v_remaining_cost_basis, v_realized_pnl
        from private.get_portfolio_position_summary(p_portfolio_id, p_instrument_id) as s;
        return jsonb_build_object(
            'transaction_id', v_claim.resource_id, 'was_replayed', true,
            'current_quantity', v_current_quantity::text,
            'remaining_cost_basis', v_remaining_cost_basis::text,
            'realized_pnl', v_realized_pnl::text
        );
    end if;

    select i.id, i.currency, i.is_active into v_instrument
    from public.instruments as i where i.id = p_instrument_id;
    if not found then
        raise exception using errcode = 'P0001', message = 'portfolio_instrument_not_found';
    end if;
    if v_transaction_type = 'BUY' and v_instrument.is_active = false then
        raise exception using errcode = 'P0001', message = 'portfolio_instrument_inactive';
    end if;
    if v_instrument.currency <> v_currency then
        raise exception using errcode = 'P0001', message = 'portfolio_instrument_currency_mismatch';
    end if;

    insert into public.portfolio_transactions (
        portfolio_id, instrument_id, transaction_type, quantity, unit_price,
        transaction_currency, transaction_at, notes, client_request_id
    ) values (
        p_portfolio_id, p_instrument_id, v_transaction_type, p_quantity,
        p_unit_price, v_currency, p_transaction_at, v_notes, p_client_request_id
    ) returning id into v_transaction_id;

    perform private.complete_portfolio_request(
        p_portfolio_id, p_client_request_id, v_transaction_id
    );

    insert into public.portfolio_instruments (portfolio_id, instrument_id, is_visible)
    values (p_portfolio_id, p_instrument_id, true)
    on conflict (portfolio_id, instrument_id) do update set is_visible = true;

    select f.current_quantity, f.remaining_cost_basis, f.realized_pnl
    into v_current_quantity, v_remaining_cost_basis, v_realized_pnl
    from private.rebuild_portfolio_fifo(p_portfolio_id, p_instrument_id) as f;

    return jsonb_build_object(
        'transaction_id', v_transaction_id, 'was_replayed', false,
        'current_quantity', v_current_quantity::text,
        'remaining_cost_basis', v_remaining_cost_basis::text,
        'realized_pnl', v_realized_pnl::text
    );
end;
$$;

create or replace function public.record_cash_flow(
    p_portfolio_id uuid,
    p_flow_type text,
    p_amount numeric,
    p_currency text,
    p_flow_at timestamp with time zone,
    p_client_request_id uuid,
    p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_user_id uuid := auth.uid();
    v_flow_type text := upper(btrim(coalesce(p_flow_type, '')));
    v_currency text := upper(btrim(coalesce(p_currency, '')));
    v_notes text := nullif(btrim(p_notes), '');
    v_payload jsonb;
    v_claim record;
    v_cash_flow_id uuid;
    v_balance numeric;
begin
    if v_user_id is null then
        raise exception using errcode = 'P0001', message = 'portfolio_authentication_required';
    end if;
    if p_client_request_id is null then
        raise exception using errcode = 'P0001', message = 'portfolio_client_request_id_required';
    end if;
    if v_flow_type not in ('DEPOSIT', 'WITHDRAWAL') then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_cash_flow_type';
    end if;
    if p_amount is null or p_amount <= 0
       or p_amount in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_cash_amount';
    end if;
    if v_currency not in ('TRY', 'USD') then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_currency';
    end if;
    if p_flow_at is null then
        raise exception using errcode = 'P0001', message = 'portfolio_cash_flow_at_required';
    end if;
    if p_flow_at > now() + interval '5 minutes' then
        raise exception using errcode = 'P0001', message = 'portfolio_future_cash_flow_not_allowed';
    end if;

    perform 1 from public.portfolios as p
    where p.id = p_portfolio_id and p.user_id = v_user_id and p.archived_at is null
    for update;
    if not found then
        raise exception using errcode = 'P0001', message = 'portfolio_not_found_or_forbidden';
    end if;

    v_payload := jsonb_build_object(
        'flow_type', v_flow_type, 'amount', p_amount, 'currency', v_currency,
        'flow_at', p_flow_at, 'notes', v_notes
    );
    select * into v_claim from private.claim_portfolio_request(
        p_portfolio_id, p_client_request_id, 'record_cash_flow', v_payload
    );

    if v_claim.was_replayed then
        if v_claim.resource_id is null then
            raise exception using errcode = 'P0001', message = 'portfolio_idempotency_incomplete';
        end if;
        v_balance := private.get_portfolio_cash_balance(p_portfolio_id, v_currency);
        return jsonb_build_object(
            'cash_flow_id', v_claim.resource_id, 'was_replayed', true,
            'cash_balance', v_balance::text, 'currency', v_currency
        );
    end if;

    v_balance := private.get_portfolio_cash_balance(p_portfolio_id, v_currency);
    if v_flow_type = 'WITHDRAWAL' and v_balance < p_amount then
        raise exception using errcode = 'P0001', message = 'portfolio_insufficient_cash';
    end if;

    insert into public.portfolio_cash_flows (
        portfolio_id, flow_type, amount, currency, flow_at, notes, client_request_id
    ) values (
        p_portfolio_id, v_flow_type, p_amount, v_currency, p_flow_at,
        v_notes, p_client_request_id
    ) returning id into v_cash_flow_id;

    perform private.complete_portfolio_request(
        p_portfolio_id, p_client_request_id, v_cash_flow_id
    );
    v_balance := private.get_portfolio_cash_balance(p_portfolio_id, v_currency);

    return jsonb_build_object(
        'cash_flow_id', v_cash_flow_id, 'was_replayed', false,
        'cash_balance', v_balance::text, 'currency', v_currency
    );
end;
$$;

create or replace function public.reverse_portfolio_transaction(
    p_transaction_id uuid,
    p_client_request_id uuid,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_user_id uuid := auth.uid();
    v_reason text := nullif(btrim(p_reason), '');
    v_tx public.portfolio_transactions%rowtype;
    v_payload jsonb;
    v_claim record;
    v_current_quantity numeric;
    v_remaining_cost_basis numeric;
    v_realized_pnl numeric;
begin
    if v_user_id is null then
        raise exception using errcode = 'P0001', message = 'portfolio_authentication_required';
    end if;
    if p_client_request_id is null then
        raise exception using errcode = 'P0001', message = 'portfolio_client_request_id_required';
    end if;
    if v_reason is null or length(v_reason) > 1000 then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_reversal_reason';
    end if;

    select t.* into v_tx
    from public.portfolio_transactions as t
    join public.portfolios as p on p.id = t.portfolio_id
    where t.id = p_transaction_id and p.user_id = v_user_id and p.archived_at is null
    for update of p, t;
    if not found then
        raise exception using errcode = 'P0001', message = 'portfolio_transaction_not_found_or_forbidden';
    end if;

    v_payload := jsonb_build_object('transaction_id', p_transaction_id, 'reason', v_reason);
    select * into v_claim from private.claim_portfolio_request(
        v_tx.portfolio_id, p_client_request_id, 'reverse_transaction', v_payload
    );

    if v_claim.was_replayed then
        select s.current_quantity, s.remaining_cost_basis, s.realized_pnl
        into v_current_quantity, v_remaining_cost_basis, v_realized_pnl
        from private.get_portfolio_position_summary(v_tx.portfolio_id, v_tx.instrument_id) as s;
        return jsonb_build_object(
            'transaction_id', p_transaction_id, 'was_replayed', true,
            'current_quantity', v_current_quantity::text,
            'remaining_cost_basis', v_remaining_cost_basis::text,
            'realized_pnl', v_realized_pnl::text
        );
    end if;

    if v_tx.is_reversed then
        raise exception using errcode = 'P0001', message = 'portfolio_transaction_already_reversed';
    end if;

    update public.portfolio_transactions
    set is_reversed = true,
        reversed_at = now(),
        reversal_reason = v_reason,
        reversal_client_request_id = p_client_request_id
    where id = p_transaction_id;

    perform private.complete_portfolio_request(
        v_tx.portfolio_id, p_client_request_id, p_transaction_id
    );

    select f.current_quantity, f.remaining_cost_basis, f.realized_pnl
    into v_current_quantity, v_remaining_cost_basis, v_realized_pnl
    from private.rebuild_portfolio_fifo(v_tx.portfolio_id, v_tx.instrument_id) as f;

    return jsonb_build_object(
        'transaction_id', p_transaction_id, 'was_replayed', false,
        'current_quantity', v_current_quantity::text,
        'remaining_cost_basis', v_remaining_cost_basis::text,
        'realized_pnl', v_realized_pnl::text
    );
end;
$$;

create or replace function public.reverse_cash_flow(
    p_cash_flow_id uuid,
    p_client_request_id uuid,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_user_id uuid := auth.uid();
    v_reason text := nullif(btrim(p_reason), '');
    v_flow public.portfolio_cash_flows%rowtype;
    v_payload jsonb;
    v_claim record;
    v_balance numeric;
begin
    if v_user_id is null then
        raise exception using errcode = 'P0001', message = 'portfolio_authentication_required';
    end if;
    if p_client_request_id is null then
        raise exception using errcode = 'P0001', message = 'portfolio_client_request_id_required';
    end if;
    if v_reason is null or length(v_reason) > 1000 then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_reversal_reason';
    end if;

    select c.* into v_flow
    from public.portfolio_cash_flows as c
    join public.portfolios as p on p.id = c.portfolio_id
    where c.id = p_cash_flow_id and p.user_id = v_user_id and p.archived_at is null
    for update of p, c;
    if not found then
        raise exception using errcode = 'P0001', message = 'portfolio_cash_flow_not_found_or_forbidden';
    end if;

    v_payload := jsonb_build_object('cash_flow_id', p_cash_flow_id, 'reason', v_reason);
    select * into v_claim from private.claim_portfolio_request(
        v_flow.portfolio_id, p_client_request_id, 'reverse_cash_flow', v_payload
    );

    if v_claim.was_replayed then
        v_balance := private.get_portfolio_cash_balance(v_flow.portfolio_id, v_flow.currency);
        return jsonb_build_object(
            'cash_flow_id', p_cash_flow_id, 'was_replayed', true,
            'cash_balance', v_balance::text, 'currency', v_flow.currency
        );
    end if;

    if v_flow.is_reversed then
        raise exception using errcode = 'P0001', message = 'portfolio_cash_flow_already_reversed';
    end if;

    -- Reversing a deposit must not manufacture an invalid withdrawal-like
    -- balance. Negative balances caused by imported BUY transactions remain
    -- allowed, but the reversal cannot lower the current balance below zero.
    v_balance := private.get_portfolio_cash_balance(v_flow.portfolio_id, v_flow.currency);
    if v_flow.flow_type = 'DEPOSIT' and v_balance - v_flow.amount < 0 then
        raise exception using errcode = 'P0001', message = 'portfolio_insufficient_cash';
    end if;

    update public.portfolio_cash_flows
    set is_reversed = true,
        reversed_at = now(),
        reversal_reason = v_reason,
        reversal_client_request_id = p_client_request_id
    where id = p_cash_flow_id;

    perform private.complete_portfolio_request(
        v_flow.portfolio_id, p_client_request_id, p_cash_flow_id
    );
    v_balance := private.get_portfolio_cash_balance(v_flow.portfolio_id, v_flow.currency);

    return jsonb_build_object(
        'cash_flow_id', p_cash_flow_id, 'was_replayed', false,
        'cash_balance', v_balance::text, 'currency', v_flow.currency
    );
end;
$$;

revoke all on function private.claim_portfolio_request(uuid, uuid, text, jsonb)
    from public, anon, authenticated;
revoke all on function private.complete_portfolio_request(uuid, uuid, uuid)
    from public, anon, authenticated;
revoke all on function private.get_portfolio_cash_balance(uuid, text)
    from public, anon, authenticated;

revoke all on function public.record_cash_flow(
    uuid, text, numeric, text, timestamp with time zone, uuid, text
) from public, anon;
grant execute on function public.record_cash_flow(
    uuid, text, numeric, text, timestamp with time zone, uuid, text
) to authenticated;

revoke all on function public.reverse_portfolio_transaction(uuid, uuid, text)
    from public, anon;
grant execute on function public.reverse_portfolio_transaction(uuid, uuid, text)
    to authenticated;

revoke all on function public.reverse_cash_flow(uuid, uuid, text)
    from public, anon;
grant execute on function public.reverse_cash_flow(uuid, uuid, text)
    to authenticated;

commit;
