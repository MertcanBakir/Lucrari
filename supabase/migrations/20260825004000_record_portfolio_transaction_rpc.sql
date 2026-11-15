begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Current position is derived from the immutable transaction ledger and its
-- FIFO matches. It is intentionally not stored in another mutable table.
create or replace function private.get_portfolio_position_summary(
    p_portfolio_id uuid,
    p_instrument_id uuid
)
returns table (
    current_quantity numeric,
    remaining_cost_basis numeric,
    realized_pnl numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
    with active_transactions as (
        select t.id, t.transaction_type, t.quantity, t.unit_price
        from public.portfolio_transactions as t
        where t.portfolio_id = p_portfolio_id
          and t.instrument_id = p_instrument_id
          and t.is_reversed = false
    ),
    transaction_totals as (
        select
            coalesce(
                sum(
                    case
                        when transaction_type = 'BUY' then quantity
                        else -quantity
                    end
                ),
                0::numeric
            ) as current_quantity,
            coalesce(
                sum(
                    case
                        when transaction_type = 'BUY' then quantity * unit_price
                        else 0::numeric
                    end
                ),
                0::numeric
            ) as total_buy_cost
        from active_transactions
    ),
    fifo_totals as (
        select
            coalesce(sum(f.cost_basis), 0::numeric) as matched_cost,
            coalesce(sum(f.realized_pnl), 0::numeric) as realized_pnl
        from public.portfolio_fifo_matches as f
        where f.portfolio_id = p_portfolio_id
          and f.instrument_id = p_instrument_id
    )
    select
        t.current_quantity,
        t.total_buy_cost - f.matched_cost,
        f.realized_pnl
    from transaction_totals as t
    cross join fifo_totals as f;
$$;

-- Rebuild the complete FIFO chain for one portfolio/instrument. Rebuilding is
-- deliberate: it keeps backdated inserts and future reversals deterministic.
create or replace function private.rebuild_portfolio_fifo(
    p_portfolio_id uuid,
    p_instrument_id uuid
)
returns table (
    current_quantity numeric,
    remaining_cost_basis numeric,
    realized_pnl numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_sell record;
    v_buy record;
    v_remaining_sell numeric;
    v_matched_quantity numeric;
begin
    delete from public.portfolio_fifo_matches as f
    where f.portfolio_id = p_portfolio_id
      and f.instrument_id = p_instrument_id;

    for v_sell in
        select t.id, t.quantity, t.unit_price, t.transaction_currency,
               t.transaction_at, t.created_at
        from public.portfolio_transactions as t
        where t.portfolio_id = p_portfolio_id
          and t.instrument_id = p_instrument_id
          and t.transaction_type = 'SELL'
          and t.is_reversed = false
        order by t.transaction_at, t.created_at, t.id
    loop
        v_remaining_sell := v_sell.quantity;

        for v_buy in
            select
                t.id,
                t.unit_price,
                t.transaction_currency,
                t.quantity - coalesce(sum(f.matched_quantity), 0::numeric)
                    as available_quantity
            from public.portfolio_transactions as t
            left join public.portfolio_fifo_matches as f
              on f.buy_transaction_id = t.id
            where t.portfolio_id = p_portfolio_id
              and t.instrument_id = p_instrument_id
              and t.transaction_type = 'BUY'
              and t.is_reversed = false
              and row(t.transaction_at, t.created_at, t.id)
                  < row(v_sell.transaction_at, v_sell.created_at, v_sell.id)
            group by t.id, t.unit_price, t.transaction_currency,
                     t.quantity, t.transaction_at, t.created_at
            having t.quantity - coalesce(sum(f.matched_quantity), 0::numeric) > 0
            order by t.transaction_at, t.created_at, t.id
        loop
            if v_buy.transaction_currency <> v_sell.transaction_currency then
                raise exception using
                    errcode = 'P0001',
                    message = 'portfolio_transaction_currency_mismatch';
            end if;

            v_matched_quantity := least(
                v_remaining_sell,
                v_buy.available_quantity
            );

            insert into public.portfolio_fifo_matches (
                portfolio_id,
                instrument_id,
                buy_transaction_id,
                sell_transaction_id,
                matched_quantity,
                buy_unit_price,
                sell_unit_price,
                cost_basis,
                proceeds,
                realized_pnl,
                currency
            ) values (
                p_portfolio_id,
                p_instrument_id,
                v_buy.id,
                v_sell.id,
                v_matched_quantity,
                v_buy.unit_price,
                v_sell.unit_price,
                v_matched_quantity * v_buy.unit_price,
                v_matched_quantity * v_sell.unit_price,
                v_matched_quantity * (v_sell.unit_price - v_buy.unit_price),
                v_sell.transaction_currency
            );

            v_remaining_sell := v_remaining_sell - v_matched_quantity;
            exit when v_remaining_sell = 0;
        end loop;

        if v_remaining_sell > 0 then
            raise exception using
                errcode = 'P0001',
                message = 'portfolio_insufficient_position';
        end if;
    end loop;

    return query
    select s.current_quantity, s.remaining_cost_basis, s.realized_pnl
    from private.get_portfolio_position_summary(
        p_portfolio_id,
        p_instrument_id
    ) as s;
end;
$$;

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
    v_user_id uuid;
    v_transaction_type text;
    v_currency text;
    v_notes text;
    v_instrument record;
    v_existing public.portfolio_transactions%rowtype;
    v_transaction_id uuid;
    v_current_quantity numeric;
    v_remaining_cost_basis numeric;
    v_realized_pnl numeric;
begin
    v_user_id := auth.uid();
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

    v_transaction_type := upper(btrim(coalesce(p_transaction_type, '')));
    if v_transaction_type not in ('BUY', 'SELL') then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_invalid_transaction_type';
    end if;

    if p_quantity is null
       or p_quantity <= 0
       or p_quantity = 'NaN'::numeric
       or p_quantity = 'Infinity'::numeric
       or p_quantity = '-Infinity'::numeric then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_invalid_quantity';
    end if;

    if p_unit_price is null
       or p_unit_price <= 0
       or p_unit_price = 'NaN'::numeric
       or p_unit_price = 'Infinity'::numeric
       or p_unit_price = '-Infinity'::numeric then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_invalid_unit_price';
    end if;

    v_currency := upper(btrim(coalesce(p_transaction_currency, '')));
    if v_currency not in ('TRY', 'USD') then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_invalid_currency';
    end if;

    if p_transaction_at is null then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_transaction_at_required';
    end if;

    if p_transaction_at > now() + interval '5 minutes' then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_future_transaction_not_allowed';
    end if;

    v_notes := nullif(btrim(p_notes), '');

    -- One lock per portfolio serializes concurrent writes and prevents two
    -- simultaneous SELL requests from both observing the same position.
    perform 1
    from public.portfolios as p
    where p.id = p_portfolio_id
      and p.user_id = v_user_id
      and p.archived_at is null
    for update;

    if not found then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_not_found_or_forbidden';
    end if;

    select t.*
    into v_existing
    from public.portfolio_transactions as t
    where t.portfolio_id = p_portfolio_id
      and t.client_request_id = p_client_request_id;

    if found then
        if v_existing.instrument_id is distinct from p_instrument_id
           or v_existing.transaction_type is distinct from v_transaction_type
           or v_existing.quantity is distinct from p_quantity
           or v_existing.unit_price is distinct from p_unit_price
           or v_existing.transaction_currency is distinct from v_currency
           or v_existing.transaction_at is distinct from p_transaction_at
           or v_existing.notes is distinct from v_notes then
            raise exception using
                errcode = 'P0001',
                message = 'portfolio_idempotency_conflict';
        end if;

        select s.current_quantity, s.remaining_cost_basis, s.realized_pnl
        into v_current_quantity, v_remaining_cost_basis, v_realized_pnl
        from private.get_portfolio_position_summary(
            p_portfolio_id,
            p_instrument_id
        ) as s;

        return jsonb_build_object(
            'transaction_id', v_existing.id,
            'was_replayed', true,
            'current_quantity', v_current_quantity::text,
            'remaining_cost_basis', v_remaining_cost_basis::text,
            'realized_pnl', v_realized_pnl::text
        );
    end if;

    select i.id, i.currency, i.is_active
    into v_instrument
    from public.instruments as i
    where i.id = p_instrument_id;

    if not found then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_instrument_not_found';
    end if;

    if v_transaction_type = 'BUY' and v_instrument.is_active = false then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_instrument_inactive';
    end if;

    if v_instrument.currency <> v_currency then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_instrument_currency_mismatch';
    end if;

    insert into public.portfolio_transactions (
        portfolio_id,
        instrument_id,
        transaction_type,
        quantity,
        unit_price,
        transaction_currency,
        transaction_at,
        notes,
        client_request_id
    ) values (
        p_portfolio_id,
        p_instrument_id,
        v_transaction_type,
        p_quantity,
        p_unit_price,
        v_currency,
        p_transaction_at,
        v_notes,
        p_client_request_id
    )
    returning id into v_transaction_id;

    insert into public.portfolio_instruments (
        portfolio_id,
        instrument_id,
        is_visible
    ) values (
        p_portfolio_id,
        p_instrument_id,
        true
    )
    on conflict (portfolio_id, instrument_id) do update
    set is_visible = true;

    select f.current_quantity, f.remaining_cost_basis, f.realized_pnl
    into v_current_quantity, v_remaining_cost_basis, v_realized_pnl
    from private.rebuild_portfolio_fifo(
        p_portfolio_id,
        p_instrument_id
    ) as f;

    return jsonb_build_object(
        'transaction_id', v_transaction_id,
        'was_replayed', false,
        'current_quantity', v_current_quantity::text,
        'remaining_cost_basis', v_remaining_cost_basis::text,
        'realized_pnl', v_realized_pnl::text
    );
end;
$$;

comment on function public.record_portfolio_transaction(
    uuid, uuid, text, numeric, numeric, text,
    timestamp with time zone, uuid, text
) is 'Atomically records an owned portfolio BUY/SELL and rebuilds FIFO matches.';

revoke all on function private.get_portfolio_position_summary(uuid, uuid)
    from public, anon, authenticated;
revoke all on function private.rebuild_portfolio_fifo(uuid, uuid)
    from public, anon, authenticated;
revoke all on function public.record_portfolio_transaction(
    uuid, uuid, text, numeric, numeric, text,
    timestamp with time zone, uuid, text
) from public, anon;
grant execute on function public.record_portfolio_transaction(
    uuid, uuid, text, numeric, numeric, text,
    timestamp with time zone, uuid, text
) to authenticated;

-- Mobile clients can read their own rows through RLS, but all mutation paths
-- are RPC/backend-only. REVOKE ALL also removes non-row operations such as
-- TRUNCATE, which RLS does not protect.
revoke all privileges on table public.portfolio_transactions
    from anon, authenticated;
revoke all privileges on table public.portfolio_cash_flows
    from anon, authenticated;
revoke all privileges on table public.portfolio_fifo_matches
    from anon, authenticated;
revoke all privileges on table public.portfolio_snapshots
    from anon, authenticated;
revoke all privileges on table public.portfolio_snapshot_positions
    from anon, authenticated;

grant select on table public.portfolio_transactions to authenticated;
grant select on table public.portfolio_cash_flows to authenticated;
grant select on table public.portfolio_fifo_matches to authenticated;
grant select on table public.portfolio_snapshots to authenticated;
grant select on table public.portfolio_snapshot_positions to authenticated;

commit;
