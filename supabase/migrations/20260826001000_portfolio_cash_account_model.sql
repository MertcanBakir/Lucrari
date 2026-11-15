begin;

-- ============================================================================
-- 1. PORTFOLIO CASH ACCOUNTS TABLE
-- ============================================================================

create table if not exists public.portfolio_cash_accounts (
    portfolio_id uuid not null references public.portfolios(id) on delete cascade,
    currency text not null check (currency in ('TRY', 'USD')),
    opening_balance numeric not null default 0 check (
        opening_balance >= 0
        and opening_balance <> 'NaN'::numeric
        and opening_balance <> 'Infinity'::numeric
        and opening_balance <> '-Infinity'::numeric
    ),
    initialized_at timestamp with time zone not null default now(),
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    primary key (portfolio_id, currency)
);

alter table public.portfolio_cash_accounts enable row level security;

-- RLS: Authenticated users can read their own portfolio cash accounts
drop policy if exists "Users can read own portfolio cash accounts" on public.portfolio_cash_accounts;
create policy "Users can read own portfolio cash accounts"
    on public.portfolio_cash_accounts
    for select to authenticated
    using (
        exists (
            select 1 from public.portfolios p
            where p.id = portfolio_cash_accounts.portfolio_id
              and p.user_id = auth.uid()
        )
    );

-- Only the RPC layer may mutate balances. SECURITY DEFINER functions keep
-- these writes server-side while authenticated clients retain read access.
revoke all on table public.portfolio_cash_accounts from public, anon, authenticated;
grant select on table public.portfolio_cash_accounts to authenticated;

-- ============================================================================
-- 2. EXPAND REQUEST KEYS ACTION CHECK FOR CASH INITIALIZATION
-- ============================================================================

alter table private.portfolio_request_keys
    drop constraint if exists portfolio_request_keys_action_check;

alter table private.portfolio_request_keys
    add constraint portfolio_request_keys_action_check check (
        action in (
            'record_transaction',
            'record_cash_flow',
            'reverse_transaction',
            'reverse_cash_flow',
            'initialize_cash_accounts'
        )
    );

-- ============================================================================
-- 3. AUTOMATIC INITIALIZATION TRIGGER FOR NEW PORTFOLIOS
-- ============================================================================

create or replace function private.initialize_new_portfolio_cash_accounts()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
    insert into public.portfolio_cash_accounts (
        portfolio_id,
        currency,
        opening_balance,
        initialized_at,
        created_at,
        updated_at
    )
    values
        (new.id, 'TRY', 0, now(), now(), now()),
        (new.id, 'USD', 0, now(), now(), now())
    on conflict (portfolio_id, currency) do nothing;
    return new;
end;
$$;

drop trigger if exists on_portfolio_created_cash_accounts on public.portfolios;
create trigger on_portfolio_created_cash_accounts
    after insert on public.portfolios
    for each row
    execute function private.initialize_new_portfolio_cash_accounts();

-- ============================================================================
-- 4. REVISED CASH BALANCE CALCULATION ENGINE
-- ============================================================================

-- Derives current cash from opening_balance plus post-initialization flows and trades.
-- Returns NULL if the cash account has not yet been initialized.
create or replace function private.get_portfolio_cash_balance(
    p_portfolio_id uuid,
    p_currency text
)
returns numeric
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_account public.portfolio_cash_accounts%rowtype;
    v_net_flow numeric := 0;
    v_balance numeric;
begin
    select * into v_account
    from public.portfolio_cash_accounts
    where portfolio_id = p_portfolio_id
      and currency = p_currency;

    if not found then
        return null;
    end if;

    select coalesce(sum(l.amount), 0::numeric) into v_net_flow
    from (
        select
            case c.flow_type
                when 'DEPOSIT' then c.amount
                else -c.amount
            end as amount
        from public.portfolio_cash_flows as c
        where c.portfolio_id = p_portfolio_id
          and c.currency = p_currency
          and c.is_reversed = false
          and c.created_at >= v_account.initialized_at

        union all

        select
            case t.transaction_type
                when 'BUY' then -(t.quantity * t.unit_price)
                else (t.quantity * t.unit_price)
            end as amount
        from public.portfolio_transactions as t
        where t.portfolio_id = p_portfolio_id
          and t.transaction_currency = p_currency
          and t.is_reversed = false
          and t.created_at >= v_account.initialized_at
    ) as l;

    v_balance := v_account.opening_balance + v_net_flow;
    if v_balance < 0 then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_cash_invariant_violation';
    end if;

    return v_balance;
end;
$$;

-- ============================================================================
-- 5. INITIALIZE PORTFOLIO CASH ACCOUNTS RPC
-- ============================================================================

create or replace function public.initialize_portfolio_cash_accounts(
    p_portfolio_id uuid,
    p_try_opening_balance numeric,
    p_usd_opening_balance numeric,
    p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_user_id uuid := auth.uid();
    v_portfolio record;
    v_payload jsonb;
    v_claim record;
    v_init_at timestamp with time zone := now();
    v_try_bal numeric;
    v_usd_bal numeric;
begin
    if v_user_id is null then
        raise exception using errcode = 'P0001', message = 'portfolio_authentication_required';
    end if;

    if p_client_request_id is null then
        raise exception using errcode = 'P0001', message = 'portfolio_client_request_id_required';
    end if;

    if p_try_opening_balance is null or p_try_opening_balance < 0
       or p_try_opening_balance in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_try_opening_balance';
    end if;

    if p_usd_opening_balance is null or p_usd_opening_balance < 0
       or p_usd_opening_balance in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_usd_opening_balance';
    end if;

    -- Lock portfolio row
    select * into v_portfolio
    from public.portfolios as p
    where p.id = p_portfolio_id and p.user_id = v_user_id and p.archived_at is null
    for update;

    if not found then
        raise exception using errcode = 'P0001', message = 'portfolio_not_found_or_forbidden';
    end if;

    v_payload := jsonb_build_object(
        'try_opening_balance', p_try_opening_balance,
        'usd_opening_balance', p_usd_opening_balance
    );

    select * into v_claim from private.claim_portfolio_request(
        p_portfolio_id, p_client_request_id, 'initialize_cash_accounts', v_payload
    );

    if v_claim.was_replayed then
        return public.get_portfolio_cash_state(p_portfolio_id) || jsonb_build_object('was_replayed', true);
    end if;

    -- Check if cash accounts already exist for this portfolio
    if exists (
        select 1 from public.portfolio_cash_accounts
        where portfolio_id = p_portfolio_id
    ) then
        raise exception using errcode = 'P0001', message = 'portfolio_cash_account_already_initialized';
    end if;

    -- Insert TRY and USD cash accounts atomically
    insert into public.portfolio_cash_accounts (
        portfolio_id,
        currency,
        opening_balance,
        initialized_at,
        created_at,
        updated_at
    )
    values
        (p_portfolio_id, 'TRY', p_try_opening_balance, v_init_at, v_init_at, v_init_at),
        (p_portfolio_id, 'USD', p_usd_opening_balance, v_init_at, v_init_at, v_init_at);

    perform private.complete_portfolio_request(
        p_portfolio_id, p_client_request_id, p_portfolio_id
    );

    v_try_bal := private.get_portfolio_cash_balance(p_portfolio_id, 'TRY');
    v_usd_bal := private.get_portfolio_cash_balance(p_portfolio_id, 'USD');

    return jsonb_build_object(
        'portfolio_id', p_portfolio_id,
        'is_initialized', true,
        'balances', jsonb_build_array(
            jsonb_build_object(
                'currency', 'TRY',
                'opening_balance', p_try_opening_balance,
                'current_balance', v_try_bal,
                'initialized_at', v_init_at
            ),
            jsonb_build_object(
                'currency', 'USD',
                'opening_balance', p_usd_opening_balance,
                'current_balance', v_usd_bal,
                'initialized_at', v_init_at
            )
        ),
        'was_replayed', false
    );
end;
$$;

-- ============================================================================
-- 6. GET PORTFOLIO CASH STATE & BALANCES RPCS
-- ============================================================================

create or replace function public.get_portfolio_cash_state(p_portfolio_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_user_id uuid := auth.uid();
    v_try_account public.portfolio_cash_accounts%rowtype;
    v_usd_account public.portfolio_cash_accounts%rowtype;
    v_try_balance numeric;
    v_usd_balance numeric;
    v_is_initialized boolean := false;
begin
    if v_user_id is null then
        raise exception using errcode = 'P0001', message = 'portfolio_authentication_required';
    end if;

    if not exists (
        select 1 from public.portfolios p
        where p.id = p_portfolio_id
          and p.user_id = v_user_id
          and p.archived_at is null
    ) then
        raise exception using errcode = 'P0001', message = 'portfolio_not_found_or_forbidden';
    end if;

    select * into v_try_account
    from public.portfolio_cash_accounts
    where portfolio_id = p_portfolio_id and currency = 'TRY';

    select * into v_usd_account
    from public.portfolio_cash_accounts
    where portfolio_id = p_portfolio_id and currency = 'USD';

    if v_try_account.portfolio_id is not null and v_usd_account.portfolio_id is not null then
        v_is_initialized := true;
        v_try_balance := private.get_portfolio_cash_balance(p_portfolio_id, 'TRY');
        v_usd_balance := private.get_portfolio_cash_balance(p_portfolio_id, 'USD');
    end if;

    return jsonb_build_object(
        'portfolio_id', p_portfolio_id,
        'is_initialized', v_is_initialized,
        'balances', jsonb_build_array(
            jsonb_build_object(
                'currency', 'TRY',
                'opening_balance', case when v_is_initialized then v_try_account.opening_balance else null end,
                'current_balance', case when v_is_initialized then v_try_balance else null end,
                'initialized_at', case when v_is_initialized then v_try_account.initialized_at else null end
            ),
            jsonb_build_object(
                'currency', 'USD',
                'opening_balance', case when v_is_initialized then v_usd_account.opening_balance else null end,
                'current_balance', case when v_is_initialized then v_usd_balance else null end,
                'initialized_at', case when v_is_initialized then v_usd_account.initialized_at else null end
            )
        )
    );
end;
$$;

create or replace function public.get_portfolio_cash_balances(p_portfolio_id uuid)
returns table (currency text, balance numeric)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
    if auth.uid() is null then
        raise exception using errcode = 'P0001', message = 'portfolio_authentication_required';
    end if;
    if not exists (
        select 1 from public.portfolios p
        where p.id = p_portfolio_id
          and p.user_id = auth.uid()
          and p.archived_at is null
    ) then
        raise exception using errcode = 'P0001', message = 'portfolio_not_found_or_forbidden';
    end if;

    return query
    select c.currency, private.get_portfolio_cash_balance(p_portfolio_id, c.currency)
    from (values ('TRY'::text), ('USD'::text)) as c(currency)
    order by c.currency;
end;
$$;

-- ============================================================================
-- 7. ATOMIC CASH CHECKS IN RECORD_PORTFOLIO_TRANSACTION
-- ============================================================================

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
    v_trade_total numeric;
    v_available_cash numeric;
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

    -- Lock portfolio row to prevent concurrent overspending
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
        v_available_cash := private.get_portfolio_cash_balance(p_portfolio_id, v_currency);
        return jsonb_build_object(
            'transaction_id', v_claim.resource_id, 'was_replayed', true,
            'current_quantity', v_current_quantity::text,
            'remaining_cost_basis', v_remaining_cost_basis::text,
            'realized_pnl', v_realized_pnl::text,
            'available_cash', v_available_cash::text
        );
    end if;

    -- Claim idempotency before checking mutable business state. A retry of an
    -- already committed request must replay even if the cash balance changed.
    v_available_cash := private.get_portfolio_cash_balance(p_portfolio_id, v_currency);
    if v_available_cash is null then
        raise exception using errcode = 'P0001', message = 'portfolio_cash_account_not_initialized';
    end if;

    v_trade_total := p_quantity * p_unit_price;
    if v_transaction_type = 'BUY' and v_available_cash < v_trade_total then
        raise exception using errcode = 'P0001', message = 'portfolio_insufficient_cash';
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

    v_available_cash := private.get_portfolio_cash_balance(p_portfolio_id, v_currency);

    return jsonb_build_object(
        'transaction_id', v_transaction_id, 'was_replayed', false,
        'current_quantity', v_current_quantity::text,
        'remaining_cost_basis', v_remaining_cost_basis::text,
        'realized_pnl', v_realized_pnl::text,
        'available_cash', v_available_cash::text
    );
end;
$$;

-- ============================================================================
-- 8. ATOMIC CASH CHECKS IN RECORD_CASH_FLOW
-- ============================================================================

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

    -- Lock portfolio row
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

    -- As with trades, an idempotent replay is independent of today's balance.
    v_balance := private.get_portfolio_cash_balance(p_portfolio_id, v_currency);
    if v_balance is null then
        raise exception using errcode = 'P0001', message = 'portfolio_cash_account_not_initialized';
    end if;

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

-- ============================================================================
-- 9. REVERSAL CHECKS PREVENTING NEGATIVE CASH BALANCE
-- ============================================================================

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
    v_current_cash numeric;
    v_reversal_cost numeric;
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

    -- If reversing a SELL, it will debit cash (deduct proceeds).
    -- Ensure available cash is sufficient so balance does not drop below 0.
    if v_tx.transaction_type = 'SELL' and exists (
        select 1
        from public.portfolio_cash_accounts a
        where a.portfolio_id = v_tx.portfolio_id
          and a.currency = v_tx.transaction_currency
          and v_tx.created_at >= a.initialized_at
    ) then
        v_current_cash := private.get_portfolio_cash_balance(v_tx.portfolio_id, v_tx.transaction_currency);
        v_reversal_cost := v_tx.quantity * v_tx.unit_price;
        if v_current_cash is not null and v_current_cash < v_reversal_cost then
            raise exception using errcode = 'P0001', message = 'portfolio_insufficient_cash_for_reversal';
        end if;
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

    -- If reversing a DEPOSIT, it will debit cash.
    -- Ensure available cash is sufficient so balance does not drop below 0.
    if v_flow.flow_type = 'DEPOSIT' and exists (
        select 1
        from public.portfolio_cash_accounts a
        where a.portfolio_id = v_flow.portfolio_id
          and a.currency = v_flow.currency
          and v_flow.created_at >= a.initialized_at
    ) then
        v_balance := private.get_portfolio_cash_balance(v_flow.portfolio_id, v_flow.currency);
        if v_balance is not null and v_balance < v_flow.amount then
            raise exception using errcode = 'P0001', message = 'portfolio_insufficient_cash_for_reversal';
        end if;
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

-- ============================================================================
-- 10. RESET_MY_INVESTMENTS RESETS CASH ACCOUNTS TO ZERO
-- ============================================================================

create or replace function public.reset_my_investments(
    p_client_request_id uuid,
    p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_user_id uuid := auth.uid();
    v_confirmation constant text := 'RESET_ALL_INVESTMENTS';
    v_existing private.investment_reset_requests%rowtype;
    v_result jsonb;
    v_reset_at timestamp with time zone := now();
    v_portfolio_count bigint := 0;
    v_transaction_count bigint := 0;
    v_cash_flow_count bigint := 0;
    v_fifo_match_count bigint := 0;
    v_instrument_count bigint := 0;
    v_snapshot_count bigint := 0;
    v_snapshot_position_count bigint := 0;
    v_request_key_count bigint := 0;
begin
    if v_user_id is null then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_authentication_required';
    end if;

    if p_client_request_id is null then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_client_request_id_required';
    end if;

    if btrim(coalesce(p_confirmation, '')) <> v_confirmation then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_reset_confirmation_required';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_user_id::text, 0)
    );

    select r.*
    into v_existing
    from private.investment_reset_requests as r
    where r.user_id = v_user_id
      and r.client_request_id = p_client_request_id
    for update;

    if found then
        if v_existing.confirmation is distinct from v_confirmation then
            raise exception using
                errcode = 'P0001',
                message = 'portfolio_idempotency_conflict';
        end if;

        if v_existing.result is null or v_existing.completed_at is null then
            raise exception using
                errcode = 'P0001',
                message = 'portfolio_idempotency_incomplete';
        end if;

        return v_existing.result || jsonb_build_object('was_replayed', true);
    end if;

    insert into private.investment_reset_requests (
        user_id, client_request_id, confirmation, result, created_at, completed_at
    ) values (
        v_user_id, p_client_request_id, v_confirmation, null, v_reset_at, null
    );

    perform 1 from public.portfolios as p
    where p.user_id = v_user_id and p.archived_at is null
    for update;

    select count(*) into v_portfolio_count
    from public.portfolios as p
    where p.user_id = v_user_id and p.archived_at is null;

    -- Delete FIFO matches
    with deleted as (
        delete from public.portfolio_fifo_matches as m
        where m.portfolio_id in (
            select p.id from public.portfolios as p where p.user_id = v_user_id
        )
        returning 1
    )
    select count(*) into v_fifo_match_count from deleted;

    -- Delete transactions
    with deleted as (
        delete from public.portfolio_transactions as t
        where t.portfolio_id in (
            select p.id from public.portfolios as p where p.user_id = v_user_id
        )
        returning 1
    )
    select count(*) into v_transaction_count from deleted;

    -- Delete cash flows
    with deleted as (
        delete from public.portfolio_cash_flows as c
        where c.portfolio_id in (
            select p.id from public.portfolios as p where p.user_id = v_user_id
        )
        returning 1
    )
    select count(*) into v_cash_flow_count from deleted;

    -- Delete snapshot positions
    with deleted as (
        delete from public.portfolio_snapshot_positions as sp
        where sp.snapshot_id in (
            select s.id from public.portfolio_snapshots as s
            join public.portfolios as p on p.id = s.portfolio_id
            where p.user_id = v_user_id
        )
        returning 1
    )
    select count(*) into v_snapshot_position_count from deleted;

    -- Delete snapshots
    with deleted as (
        delete from public.portfolio_snapshots as s
        where s.portfolio_id in (
            select p.id from public.portfolios as p where p.user_id = v_user_id
        )
        returning 1
    )
    select count(*) into v_snapshot_count from deleted;

    -- Delete portfolio instruments
    with deleted as (
        delete from public.portfolio_instruments as pi
        where pi.portfolio_id in (
            select p.id from public.portfolios as p where p.user_id = v_user_id
        )
        returning 1
    )
    select count(*) into v_instrument_count from deleted;

    -- Delete portfolio request keys
    with deleted as (
        delete from private.portfolio_request_keys as k
        where k.portfolio_id in (
            select p.id from public.portfolios as p where p.user_id = v_user_id
        )
        returning 1
    )
    select count(*) into v_request_key_count from deleted;

    -- Reset or initialize cash accounts to 0 opening balance
    insert into public.portfolio_cash_accounts (
        portfolio_id, currency, opening_balance, initialized_at, created_at, updated_at
    )
    select p.id, c.currency, 0, v_reset_at, v_reset_at, v_reset_at
    from public.portfolios as p
    cross join (values ('TRY'::text), ('USD'::text)) as c(currency)
    where p.user_id = v_user_id and p.archived_at is null
    on conflict (portfolio_id, currency)
    do update set
        opening_balance = 0,
        initialized_at = v_reset_at,
        updated_at = v_reset_at;

    v_result := jsonb_build_object(
        'reset_at', v_reset_at,
        'portfolio_count', v_portfolio_count,
        'deleted_transaction_count', v_transaction_count,
        'deleted_cash_flow_count', v_cash_flow_count,
        'deleted_fifo_match_count', v_fifo_match_count,
        'deleted_instrument_count', v_instrument_count,
        'deleted_snapshot_count', v_snapshot_count,
        'deleted_snapshot_position_count', v_snapshot_position_count,
        'deleted_request_key_count', v_request_key_count,
        'was_replayed', false
    );

    update private.investment_reset_requests
    set result = v_result,
        completed_at = now()
    where user_id = v_user_id
      and client_request_id = p_client_request_id;

    return v_result;
end;
$$;

-- ============================================================================
-- 11. GRANT PERMISSIONS TO AUTHENTICATED USERS
-- ============================================================================

revoke all on function private.initialize_new_portfolio_cash_accounts()
    from public, anon, authenticated;
revoke all on function private.get_portfolio_cash_balance(uuid, text)
    from public, anon, authenticated;

revoke all on function public.initialize_portfolio_cash_accounts(uuid, numeric, numeric, uuid)
    from public, anon, authenticated;
revoke all on function public.get_portfolio_cash_state(uuid)
    from public, anon, authenticated;
revoke all on function public.get_portfolio_cash_balances(uuid)
    from public, anon, authenticated;
revoke all on function public.record_portfolio_transaction(uuid, uuid, text, numeric, numeric, text, timestamp with time zone, uuid, text)
    from public, anon, authenticated;
revoke all on function public.record_cash_flow(uuid, text, numeric, text, timestamp with time zone, uuid, text)
    from public, anon, authenticated;
revoke all on function public.reverse_portfolio_transaction(uuid, uuid, text)
    from public, anon, authenticated;
revoke all on function public.reverse_cash_flow(uuid, uuid, text)
    from public, anon, authenticated;
revoke all on function public.reset_my_investments(uuid, text)
    from public, anon, authenticated;

grant execute on function public.initialize_portfolio_cash_accounts(uuid, numeric, numeric, uuid) to authenticated;
grant execute on function public.get_portfolio_cash_state(uuid) to authenticated;
grant execute on function public.get_portfolio_cash_balances(uuid) to authenticated;
grant execute on function public.record_portfolio_transaction(uuid, uuid, text, numeric, numeric, text, timestamp with time zone, uuid, text) to authenticated;
grant execute on function public.record_cash_flow(uuid, text, numeric, text, timestamp with time zone, uuid, text) to authenticated;
grant execute on function public.reverse_portfolio_transaction(uuid, uuid, text) to authenticated;
grant execute on function public.reverse_cash_flow(uuid, uuid, text) to authenticated;
grant execute on function public.reset_my_investments(uuid, text) to authenticated;

commit;
