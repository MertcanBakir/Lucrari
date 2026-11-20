-- Keep chart FX identical to the quote used to value foreign holdings, even during concurrent quote updates.
begin;
CREATE OR REPLACE FUNCTION private.build_portfolio_snapshot(p_portfolio_id uuid, p_snapshot_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
    v_total_base numeric;
    v_absolute_pnl_base numeric;
    v_snapshot_id uuid;
    v_market record;
    v_status text := 'success';
    v_warnings jsonb := '[]'::jsonb;
    v_position record;
    v_fx_rate numeric;
    v_market_value_base numeric;
    v_cost_basis_base numeric;
begin
    if p_snapshot_date is null
       or p_snapshot_date <> (now() at time zone 'Europe/Istanbul')::date then
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
    select coalesce(sum(current_balance),0) into v_cash_try from public.portfolio_cash_accounts where portfolio_id=p_portfolio_id and currency='TRY';
    select coalesce(sum(current_balance),0) into v_cash_usd from public.portfolio_cash_accounts where portfolio_id=p_portfolio_id and currency='USD';

    select exists (
        select 1
        from public.portfolio_instruments pi
        join public.instruments i on i.id = pi.instrument_id
        cross join lateral private.get_portfolio_position_summary_at(
            p_portfolio_id, i.id, v_cutoff
        ) s
        where pi.portfolio_id = p_portfolio_id
          and (s.current_quantity > 0 or s.realized_pnl <> 0)
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
        absolute_pnl_base, valuation_status, warnings,
        calculation_version
    ) values (
        p_portfolio_id, p_snapshot_date, v_portfolio.base_currency,
        0, 0, 0, 0, 0, 0, 0,
        v_status, v_warnings, 2
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
        -- Product convention: the remaining instrument-currency average cost is
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

    -- Store all markets, including realized profits from sold-out instruments.
    delete from public.portfolio_snapshot_markets where snapshot_id=v_snapshot_id;
    for v_market in
      select i.market,
       sum(case when i.currency=v_portfolio.base_currency then s.realized_pnl
           when v_portfolio.base_currency='TRY' then s.realized_pnl*v_fx_price
           else s.realized_pnl/v_fx_price end) as realized
      from public.portfolio_instruments pi join public.instruments i on i.id=pi.instrument_id
      cross join lateral private.get_portfolio_position_summary_at(p_portfolio_id,i.id,v_cutoff) s
      where pi.portfolio_id=p_portfolio_id group by i.market
    loop
      insert into public.portfolio_snapshot_markets(snapshot_id,market,holdings_value_base,unrealized_pnl_base,realized_pnl_base)
      select v_snapshot_id,v_market.market,coalesce(sum(sp.market_value_base),0),
       coalesce(sum(sp.unrealized_pnl_base),0),v_market.realized
      from public.portfolio_snapshot_positions sp join public.instruments i on i.id=sp.instrument_id
      where sp.snapshot_id=v_snapshot_id and i.market=v_market.market;
    end loop;

    -- Include realized P/L from fully closed positions too.
    select coalesce(sum(s.realized_pnl * case
      when i.currency=v_portfolio.base_currency then 1
      when v_portfolio.base_currency='TRY' then v_fx_price else 1/v_fx_price end),0)
    into v_realized_base from public.portfolio_instruments pi
    join public.instruments i on i.id=pi.instrument_id
    cross join lateral private.get_portfolio_position_summary_at(p_portfolio_id,i.id,v_cutoff) s
    where pi.portfolio_id=p_portfolio_id;
    v_total_base := v_cash_base + v_holdings_base;
    v_absolute_pnl_base := v_realized_base + v_unrealized_base;

    update public.portfolio_snapshots
    set cash_value_base = v_cash_base,
        holdings_value_base = v_holdings_base,
        total_value_base = v_total_base,
        total_cost_base = v_cost_base,
        realized_pnl_base = v_realized_base,
        unrealized_pnl_base = v_unrealized_base,
        absolute_pnl_base = v_absolute_pnl_base,
        valuation_status = v_status,
        warnings = v_warnings,
        usd_try_rate = case when v_needs_fx then v_fx_price else (select lp.price from public.instrument_latest_prices lp join public.instruments i on i.id=lp.instrument_id where i.market='FX' and i.symbol='USDTRY' and i.is_active limit 1) end,
        usd_try_rate_at = case when v_needs_fx then v_fx_price_at else (select lp.price_at from public.instrument_latest_prices lp join public.instruments i on i.id=lp.instrument_id where i.market='FX' and i.symbol='USDTRY' and i.is_active limit 1) end,
        usd_try_rate_is_stale = case when v_needs_fx then coalesce(v_fx_is_stale,true) else coalesce((select lp.is_stale from public.instrument_latest_prices lp join public.instruments i on i.id=lp.instrument_id where i.market='FX' and i.symbol='USDTRY' and i.is_active limit 1),true) end,
        captured_at = clock_timestamp(),
        market_breakdown_complete = true,
        calculation_version = 2
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
        'warnings', v_warnings
    );
end;
$function$;
commit;
