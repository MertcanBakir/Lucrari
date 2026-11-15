begin;

alter table public.portfolio_snapshots
    add column if not exists valuation_status text not null default 'success',
    add column if not exists warnings jsonb not null default '[]'::jsonb,
    add column if not exists calculation_version integer not null default 1;

alter table public.portfolio_snapshots
    drop constraint if exists portfolio_snapshots_valuation_status_check,
    add constraint portfolio_snapshots_valuation_status_check
        check (valuation_status in ('success', 'partial')),
    drop constraint if exists portfolio_snapshots_warnings_array_check,
    add constraint portfolio_snapshots_warnings_array_check
        check (jsonb_typeof(warnings) = 'array'),
    drop constraint if exists portfolio_snapshots_calculation_version_check,
    add constraint portfolio_snapshots_calculation_version_check
        check (calculation_version > 0);

alter table public.portfolio_snapshot_positions
    add column if not exists price_is_stale boolean not null default false,
    add column if not exists price_stale_reason text;

alter table public.portfolio_snapshot_positions
    drop constraint if exists portfolio_snapshot_positions_stale_consistency_check,
    add constraint portfolio_snapshot_positions_stale_consistency_check check (
        (price_is_stale = false and price_stale_reason is null)
        or
        (price_is_stale = true and price_stale_reason is not null)
    );

-- Date-aware helpers prevent later transactions from leaking into an older
-- snapshot when that snapshot is rebuilt.
create or replace function private.get_portfolio_position_summary_at(
    p_portfolio_id uuid,
    p_instrument_id uuid,
    p_cutoff timestamp with time zone
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
    with transaction_totals as (
        select
            coalesce(sum(case when t.transaction_type = 'BUY'
                              then t.quantity else -t.quantity end), 0::numeric)
                as current_quantity,
            coalesce(sum(case when t.transaction_type = 'BUY'
                              then t.quantity * t.unit_price else 0::numeric end), 0::numeric)
                as total_buy_cost
        from public.portfolio_transactions t
        where t.portfolio_id = p_portfolio_id
          and t.instrument_id = p_instrument_id
          and t.is_reversed = false
          and t.transaction_at <= p_cutoff
    ),
    fifo_totals as (
        select
            coalesce(sum(f.cost_basis), 0::numeric) as matched_cost,
            coalesce(sum(f.realized_pnl), 0::numeric) as realized_pnl
        from public.portfolio_fifo_matches f
        join public.portfolio_transactions sell_t
          on sell_t.id = f.sell_transaction_id
        where f.portfolio_id = p_portfolio_id
          and f.instrument_id = p_instrument_id
          and sell_t.is_reversed = false
          and sell_t.transaction_at <= p_cutoff
    )
    select
        t.current_quantity,
        t.total_buy_cost - f.matched_cost,
        f.realized_pnl
    from transaction_totals t cross join fifo_totals f;
$$;

create or replace function private.get_portfolio_cash_balance_at(
    p_portfolio_id uuid,
    p_currency text,
    p_cutoff timestamp with time zone
)
returns numeric
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
    with ledger as (
        select case c.flow_type when 'DEPOSIT' then c.amount else -c.amount end amount
        from public.portfolio_cash_flows c
        where c.portfolio_id = p_portfolio_id
          and c.currency = p_currency
          and c.is_reversed = false
          and c.flow_at <= p_cutoff
        union all
        select case t.transaction_type
                   when 'BUY' then -(t.quantity * t.unit_price)
                   else t.quantity * t.unit_price end amount
        from public.portfolio_transactions t
        where t.portfolio_id = p_portfolio_id
          and t.transaction_currency = p_currency
          and t.is_reversed = false
          and t.transaction_at <= p_cutoff
    )
    select coalesce(sum(amount), 0::numeric) from ledger;
$$;

create or replace function private.build_portfolio_snapshot(
    p_portfolio_id uuid,
    p_snapshot_date date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_portfolio public.portfolios%rowtype;
    v_cutoff timestamp with time zone;
    v_fx_price numeric;
    v_fx_price_at timestamp with time zone;
    v_fx_is_stale boolean := false;
    v_needs_fx boolean := false;
    v_cash_try numeric;
    v_cash_usd numeric;
    v_cash_base numeric := 0;
    v_holdings_base numeric := 0;
    v_cost_base numeric := 0;
    v_realized_base numeric := 0;
    v_unrealized_base numeric := 0;
    v_external_flow_base numeric := 0;
    v_weighted_external_flow_base numeric := 0;
    v_net_contributions_base numeric := 0;
    v_total_base numeric;
    v_absolute_pnl_base numeric;
    v_daily_return numeric;
    v_cumulative_twr numeric;
    v_previous public.portfolio_snapshots%rowtype;
    v_snapshot_id uuid;
    v_status text := 'success';
    v_warnings jsonb := '[]'::jsonb;
    v_position record;
    v_fx_rate numeric;
    v_market_value_base numeric;
    v_cost_basis_base numeric;
    v_seconds_elapsed numeric;
begin
    if p_snapshot_date is null
       or p_snapshot_date > (now() at time zone 'Europe/Istanbul')::date then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_snapshot_date';
    end if;

    select * into v_portfolio
    from public.portfolios p
    where p.id = p_portfolio_id and p.archived_at is null
    for update;
    if not found then
        raise exception using errcode = 'P0001', message = 'portfolio_snapshot_portfolio_not_found';
    end if;

    v_cutoff := ((p_snapshot_date + 1)::timestamp at time zone 'Europe/Istanbul')
                - interval '1 microsecond';
    v_cash_try := private.get_portfolio_cash_balance_at(p_portfolio_id, 'TRY', v_cutoff);
    v_cash_usd := private.get_portfolio_cash_balance_at(p_portfolio_id, 'USD', v_cutoff);

    select exists (
        select 1
        from public.portfolio_instruments pi
        join public.instruments i on i.id = pi.instrument_id
        cross join lateral private.get_portfolio_position_summary_at(
            p_portfolio_id, i.id, v_cutoff
        ) s
        where pi.portfolio_id = p_portfolio_id
          and s.current_quantity > 0
          and i.currency <> v_portfolio.base_currency
    ) or (v_portfolio.base_currency = 'TRY' and v_cash_usd <> 0)
      or (v_portfolio.base_currency = 'USD' and v_cash_try <> 0)
    into v_needs_fx;

    if v_needs_fx then
        select lp.price, lp.price_at, lp.is_stale
        into v_fx_price, v_fx_price_at, v_fx_is_stale
        from public.instrument_latest_prices lp
        join public.instruments i on i.id = lp.instrument_id
        where i.market = 'FX' and i.symbol = 'USDTRY'
          and i.asset_type = 'fx' and i.is_active = true;

        if not found or v_fx_price is null or v_fx_price <= 0 then
            raise exception using errcode = 'P0001', message = 'portfolio_fx_price_missing';
        end if;
        if v_fx_is_stale then
            v_status := 'partial';
            v_warnings := v_warnings || jsonb_build_array('USDTRY price is stale');
        end if;
    else
        v_fx_price := 1;
        v_fx_price_at := null;
    end if;

    v_cash_base := case v_portfolio.base_currency
        when 'TRY' then v_cash_try + v_cash_usd * v_fx_price
        else v_cash_usd + v_cash_try / v_fx_price
    end;

    -- Build the header first, then replace its position rows atomically.
    insert into public.portfolio_snapshots (
        portfolio_id, snapshot_date, base_currency,
        cash_value_base, holdings_value_base, total_value_base,
        total_cost_base, realized_pnl_base, unrealized_pnl_base,
        external_cash_flow_base, net_contributions_base, absolute_pnl_base,
        daily_return, cumulative_twr, valuation_status, warnings,
        calculation_version
    ) values (
        p_portfolio_id, p_snapshot_date, v_portfolio.base_currency,
        0, 0, 0, 0, 0, 0, 0, 0, 0, null, null,
        v_status, v_warnings, 1
    )
    on conflict (portfolio_id, snapshot_date) do update
    set base_currency = excluded.base_currency,
        calculation_version = excluded.calculation_version
    returning id into v_snapshot_id;

    delete from public.portfolio_snapshot_positions where snapshot_id = v_snapshot_id;

    for v_position in
        select
            i.id as instrument_id,
            i.currency,
            s.current_quantity as quantity,
            s.remaining_cost_basis,
            s.realized_pnl,
            lp.price,
            lp.price_at,
            lp.provider_code,
            lp.is_stale,
            lp.stale_reason
        from public.portfolio_instruments pi
        join public.instruments i on i.id = pi.instrument_id
        cross join lateral private.get_portfolio_position_summary_at(
            p_portfolio_id, i.id, v_cutoff
        ) s
        left join public.instrument_latest_prices lp on lp.instrument_id = i.id
        where pi.portfolio_id = p_portfolio_id
          and s.current_quantity > 0
        order by i.id
    loop
        if v_position.price is null then
            raise exception using
                errcode = 'P0001',
                message = 'portfolio_instrument_price_missing';
        end if;

        v_fx_rate := case
            when v_position.currency = v_portfolio.base_currency then 1
            when v_portfolio.base_currency = 'TRY' then v_fx_price
            else 1 / v_fx_price
        end;
        v_market_value_base := v_position.quantity * v_position.price * v_fx_rate;
        -- Product convention: the remaining instrument-currency FIFO cost is
        -- translated at snapshot FX. This does not claim transaction-date FX.
        v_cost_basis_base := v_position.remaining_cost_basis * v_fx_rate;

        v_holdings_base := v_holdings_base + v_market_value_base;
        v_cost_base := v_cost_base + v_cost_basis_base;
        v_realized_base := v_realized_base + v_position.realized_pnl * v_fx_rate;
        v_unrealized_base := v_unrealized_base
                             + v_market_value_base - v_cost_basis_base;

        if v_position.is_stale then
            v_status := 'partial';
            v_warnings := v_warnings || jsonb_build_array(
                format('Stale instrument price: %s', v_position.instrument_id)
            );
        end if;

        insert into public.portfolio_snapshot_positions (
            snapshot_id, instrument_id, quantity, price, price_currency,
            price_at, provider_code, fx_rate, fx_rate_at,
            market_value_base, cost_basis_base, unrealized_pnl_base,
            price_is_stale, price_stale_reason
        ) values (
            v_snapshot_id, v_position.instrument_id, v_position.quantity,
            v_position.price, v_position.currency, v_position.price_at,
            v_position.provider_code, v_fx_rate,
            case when v_fx_rate = 1 then null else v_fx_price_at end,
            v_market_value_base, v_cost_basis_base,
            v_market_value_base - v_cost_basis_base,
            v_position.is_stale, v_position.stale_reason
        );
    end loop;

    -- Realized P/L from closed instruments must also be included.
    select coalesce(sum(
        f.realized_pnl * case
            when f.currency = v_portfolio.base_currency then 1
            when v_portfolio.base_currency = 'TRY' then v_fx_price
            else 1 / v_fx_price
        end
    ), 0::numeric)
    into v_realized_base
    from public.portfolio_fifo_matches f
    join public.portfolio_transactions sell_t on sell_t.id = f.sell_transaction_id
    where f.portfolio_id = p_portfolio_id
      and sell_t.is_reversed = false
      and sell_t.transaction_at <= v_cutoff;

    select
        coalesce(sum(
            (case c.flow_type when 'DEPOSIT' then c.amount else -c.amount end)
            * case
                when c.currency = v_portfolio.base_currency then 1
                when v_portfolio.base_currency = 'TRY' then v_fx_price
                else 1 / v_fx_price
              end
        ), 0::numeric),
        coalesce(sum(
            (case c.flow_type when 'DEPOSIT' then c.amount else -c.amount end)
            * case
                when c.currency = v_portfolio.base_currency then 1
                when v_portfolio.base_currency = 'TRY' then v_fx_price
                else 1 / v_fx_price
              end
            * greatest(0::numeric, least(1::numeric,
                1 - extract(epoch from (
                    (c.flow_at at time zone 'Europe/Istanbul')
                    - date_trunc('day', c.flow_at at time zone 'Europe/Istanbul')
                )) / 86400
              ))
        ), 0::numeric)
    into v_external_flow_base, v_weighted_external_flow_base
    from public.portfolio_cash_flows c
    where c.portfolio_id = p_portfolio_id
      and c.is_reversed = false
      and (c.flow_at at time zone 'Europe/Istanbul')::date = p_snapshot_date;

    select coalesce(sum(
        (case c.flow_type when 'DEPOSIT' then c.amount else -c.amount end)
        * case
            when c.currency = v_portfolio.base_currency then 1
            when v_portfolio.base_currency = 'TRY' then v_fx_price
            else 1 / v_fx_price
          end
    ), 0::numeric)
    into v_net_contributions_base
    from public.portfolio_cash_flows c
    where c.portfolio_id = p_portfolio_id
      and c.is_reversed = false
      and c.flow_at <= v_cutoff;

    v_total_base := v_cash_base + v_holdings_base;
    v_absolute_pnl_base := v_total_base - v_net_contributions_base;

    select * into v_previous
    from public.portfolio_snapshots s
    where s.portfolio_id = p_portfolio_id
      and s.snapshot_date < p_snapshot_date
    order by s.snapshot_date desc
    limit 1;

    if found and v_previous.total_value_base + v_weighted_external_flow_base <> 0 then
        -- Daily Modified Dietz return: external flows are neutralized using
        -- their remaining fraction of the Istanbul calendar day.
        v_daily_return := (
            v_total_base - v_previous.total_value_base - v_external_flow_base
        ) / (
            v_previous.total_value_base + v_weighted_external_flow_base
        );
        v_cumulative_twr := (1 + coalesce(v_previous.cumulative_twr, 0))
                            * (1 + v_daily_return) - 1;
    else
        v_daily_return := null;
        v_cumulative_twr := 0;
    end if;

    update public.portfolio_snapshots
    set cash_value_base = v_cash_base,
        holdings_value_base = v_holdings_base,
        total_value_base = v_total_base,
        total_cost_base = v_cost_base,
        realized_pnl_base = v_realized_base,
        unrealized_pnl_base = v_unrealized_base,
        external_cash_flow_base = v_external_flow_base,
        net_contributions_base = v_net_contributions_base,
        absolute_pnl_base = v_absolute_pnl_base,
        daily_return = v_daily_return,
        cumulative_twr = v_cumulative_twr,
        valuation_status = v_status,
        warnings = v_warnings,
        calculation_version = 1
    where id = v_snapshot_id;

    return jsonb_build_object(
        'snapshot_id', v_snapshot_id,
        'portfolio_id', p_portfolio_id,
        'snapshot_date', p_snapshot_date,
        'valuation_status', v_status,
        'position_count', (
            select count(*) from public.portfolio_snapshot_positions
            where snapshot_id = v_snapshot_id
        ),
        'total_value_base', v_total_base::text,
        'daily_return', case when v_daily_return is null then null
                             else v_daily_return::text end,
        'cumulative_twr', v_cumulative_twr::text,
        'warnings', v_warnings
    );
end;
$$;

revoke all on function private.get_portfolio_position_summary_at(uuid, uuid, timestamp with time zone)
    from public, anon, authenticated;
revoke all on function private.get_portfolio_cash_balance_at(uuid, text, timestamp with time zone)
    from public, anon, authenticated;
revoke all on function private.build_portfolio_snapshot(uuid, date)
    from public, anon, authenticated;

commit;
