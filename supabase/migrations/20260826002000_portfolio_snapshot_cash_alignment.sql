begin;

-- Historical snapshots must use the same opening-balance boundary as the
-- current cash RPC. Activity created before initialization is intentionally
-- excluded because the user-entered opening balance already represents it.
create or replace function private.get_portfolio_cash_balance_at(
    p_portfolio_id uuid,
    p_currency text,
    p_cutoff timestamp with time zone
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

    if not found or v_account.initialized_at > p_cutoff then
        return 0;
    end if;

    select coalesce(sum(l.amount), 0::numeric) into v_net_flow
    from (
        select case c.flow_type
                   when 'DEPOSIT' then c.amount
                   else -c.amount
               end as amount
        from public.portfolio_cash_flows c
        where c.portfolio_id = p_portfolio_id
          and c.currency = p_currency
          and c.is_reversed = false
          and c.created_at >= v_account.initialized_at
          and c.flow_at <= p_cutoff

        union all

        select case t.transaction_type
                   when 'BUY' then -(t.quantity * t.unit_price)
                   else t.quantity * t.unit_price
               end as amount
        from public.portfolio_transactions t
        where t.portfolio_id = p_portfolio_id
          and t.transaction_currency = p_currency
          and t.is_reversed = false
          and t.created_at >= v_account.initialized_at
          and t.transaction_at <= p_cutoff
    ) l;

    v_balance := v_account.opening_balance + v_net_flow;
    if v_balance < 0 then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_cash_invariant_violation';
    end if;

    return v_balance;
end;
$$;

-- Keep the price/position implementation from the snapshot engine and wrap it
-- with the new cash-account contribution and performance rules.
alter function private.build_portfolio_snapshot(uuid, date)
    rename to build_portfolio_snapshot_before_cash_accounts;

revoke all on function private.build_portfolio_snapshot_before_cash_accounts(uuid, date)
    from public, anon, authenticated;

create function private.build_portfolio_snapshot(
    p_portfolio_id uuid,
    p_snapshot_date date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_result jsonb;
    v_snapshot public.portfolio_snapshots%rowtype;
    v_portfolio public.portfolios%rowtype;
    v_previous public.portfolio_snapshots%rowtype;
    v_cutoff timestamp with time zone;
    v_cash_complete boolean;
    v_previous_cash_complete boolean := false;
    v_has_preinit_activity boolean := false;
    v_has_foreign_contribution boolean := false;
    v_fx_price numeric;
    v_fx_is_stale boolean := false;
    v_external_flow_base numeric := 0;
    v_weighted_external_flow_base numeric := 0;
    v_net_contributions_base numeric := 0;
    v_daily_return numeric;
    v_cumulative_twr numeric := 0;
    v_status text;
    v_warnings jsonb;
    v_cash_warning constant text := 'Cash accounts were not initialized at snapshot cutoff';
    v_history_warning constant text := 'Pre-initialization activity is excluded from the cash performance baseline';
    v_fx_warning constant text := 'USDTRY price is missing for cash-flow conversion';
begin
    v_result := private.build_portfolio_snapshot_before_cash_accounts(
        p_portfolio_id,
        p_snapshot_date
    );

    select * into v_snapshot
    from public.portfolio_snapshots
    where id = (v_result ->> 'snapshot_id')::uuid
    for update;

    select * into v_portfolio
    from public.portfolios
    where id = p_portfolio_id;

    v_cutoff := ((p_snapshot_date + 1)::timestamp at time zone 'Europe/Istanbul')
                - interval '1 microsecond';

    select count(*) = 2
    into v_cash_complete
    from public.portfolio_cash_accounts a
    where a.portfolio_id = p_portfolio_id
      and a.currency in ('TRY', 'USD')
      and a.initialized_at <= v_cutoff;

    select exists (
        select 1
        from public.portfolio_transactions t
        join public.portfolio_cash_accounts a
          on a.portfolio_id = t.portfolio_id
         and a.currency = t.transaction_currency
        where t.portfolio_id = p_portfolio_id
          and t.created_at < a.initialized_at
    ) or exists (
        select 1
        from public.portfolio_cash_flows c
        join public.portfolio_cash_accounts a
          on a.portfolio_id = c.portfolio_id
         and a.currency = c.currency
        where c.portfolio_id = p_portfolio_id
          and c.created_at < a.initialized_at
    ) into v_has_preinit_activity;

    select exists (
        select 1
        from (
            select a.currency
            from public.portfolio_cash_accounts a
            where a.portfolio_id = p_portfolio_id
              and a.initialized_at <= v_cutoff
              and a.opening_balance <> 0

            union all

            select c.currency
            from public.portfolio_cash_flows c
            join public.portfolio_cash_accounts a
              on a.portfolio_id = c.portfolio_id
             and a.currency = c.currency
            where c.portfolio_id = p_portfolio_id
              and c.is_reversed = false
              and c.created_at >= a.initialized_at
              and c.flow_at <= v_cutoff
        ) contributions
        where contributions.currency <> v_portfolio.base_currency
    ) into v_has_foreign_contribution;

    select lp.price, lp.is_stale
    into v_fx_price, v_fx_is_stale
    from public.instrument_latest_prices lp
    join public.instruments i on i.id = lp.instrument_id
    where i.market = 'FX'
      and i.symbol = 'USDTRY'
      and i.asset_type = 'fx'
      and i.is_active = true;

    v_status := v_snapshot.valuation_status;
    v_warnings := v_snapshot.warnings;

    if not v_cash_complete then
        v_status := 'partial';
        if not (v_warnings ? v_cash_warning) then
            v_warnings := v_warnings || jsonb_build_array(v_cash_warning);
        end if;
    end if;

    if v_has_preinit_activity then
        v_status := 'partial';
        if not (v_warnings ? v_history_warning) then
            v_warnings := v_warnings || jsonb_build_array(v_history_warning);
        end if;
    end if;

    if v_has_foreign_contribution and (v_fx_price is null or v_fx_price <= 0) then
        v_status := 'partial';
        if not (v_warnings ? v_fx_warning) then
            v_warnings := v_warnings || jsonb_build_array(v_fx_warning);
        end if;
    elsif v_has_foreign_contribution and v_fx_is_stale then
        v_status := 'partial';
        if not (v_warnings ? 'USDTRY price is stale') then
            v_warnings := v_warnings || jsonb_build_array('USDTRY price is stale');
        end if;
    end if;

    with contributions as (
        select
            a.opening_balance as amount,
            a.currency,
            a.initialized_at as occurred_at
        from public.portfolio_cash_accounts a
        where a.portfolio_id = p_portfolio_id
          and a.initialized_at <= v_cutoff
          and a.opening_balance <> 0

        union all

        select
            case c.flow_type when 'DEPOSIT' then c.amount else -c.amount end,
            c.currency,
            c.flow_at
        from public.portfolio_cash_flows c
        join public.portfolio_cash_accounts a
          on a.portfolio_id = c.portfolio_id
         and a.currency = c.currency
        where c.portfolio_id = p_portfolio_id
          and c.is_reversed = false
          and c.created_at >= a.initialized_at
          and c.flow_at <= v_cutoff
    ), converted as (
        select
            amount * case
                when currency = v_portfolio.base_currency then 1
                when v_fx_price is null or v_fx_price <= 0 then null
                when v_portfolio.base_currency = 'TRY' then v_fx_price
                else 1 / v_fx_price
            end as amount_base,
            occurred_at
        from contributions
    )
    select
        coalesce(sum(amount_base) filter (
            where (occurred_at at time zone 'Europe/Istanbul')::date = p_snapshot_date
        ), 0::numeric),
        coalesce(sum(
            amount_base * greatest(0::numeric, least(1::numeric,
                1 - extract(epoch from (
                    (occurred_at at time zone 'Europe/Istanbul')
                    - date_trunc('day', occurred_at at time zone 'Europe/Istanbul')
                )) / 86400
            ))
        ) filter (
            where (occurred_at at time zone 'Europe/Istanbul')::date = p_snapshot_date
        ), 0::numeric),
        coalesce(sum(amount_base), 0::numeric)
    into
        v_external_flow_base,
        v_weighted_external_flow_base,
        v_net_contributions_base
    from converted;

    select * into v_previous
    from public.portfolio_snapshots s
    where s.portfolio_id = p_portfolio_id
      and s.snapshot_date < p_snapshot_date
    order by s.snapshot_date desc
    limit 1;

    if found then
        select count(*) = 2
        into v_previous_cash_complete
        from public.portfolio_cash_accounts a
        where a.portfolio_id = p_portfolio_id
          and a.currency in ('TRY', 'USD')
          and a.initialized_at <= (
              ((v_previous.snapshot_date + 1)::timestamp at time zone 'Europe/Istanbul')
              - interval '1 microsecond'
          );

        if v_cash_complete
           and v_previous_cash_complete
           and v_previous.total_value_base + v_weighted_external_flow_base <> 0 then
            v_daily_return := (
                v_snapshot.total_value_base
                - v_previous.total_value_base
                - v_external_flow_base
            ) / (
                v_previous.total_value_base + v_weighted_external_flow_base
            );
            v_cumulative_twr := (1 + coalesce(v_previous.cumulative_twr, 0))
                                * (1 + v_daily_return) - 1;
        else
            v_daily_return := null;
            v_cumulative_twr := coalesce(v_previous.cumulative_twr, 0);
        end if;
    else
        v_daily_return := null;
        v_cumulative_twr := 0;
    end if;

    update public.portfolio_snapshots
    set external_cash_flow_base = v_external_flow_base,
        net_contributions_base = v_net_contributions_base,
        absolute_pnl_base = total_value_base - v_net_contributions_base,
        daily_return = v_daily_return,
        cumulative_twr = v_cumulative_twr,
        valuation_status = v_status,
        warnings = v_warnings,
        calculation_version = 2
    where id = v_snapshot.id;

    return v_result || jsonb_build_object(
        'valuation_status', v_status,
        'daily_return', case when v_daily_return is null then null else v_daily_return::text end,
        'cumulative_twr', v_cumulative_twr::text,
        'warnings', v_warnings
    );
end;
$$;

revoke all on function private.get_portfolio_cash_balance_at(uuid, text, timestamp with time zone)
    from public, anon, authenticated;
revoke all on function private.build_portfolio_snapshot(uuid, date)
    from public, anon, authenticated;

commit;
