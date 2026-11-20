-- Portfolio chart: historical currency conversion, market-level profits and scheduled capture.
begin;
alter table public.portfolio_snapshots add column usd_try_rate numeric check (usd_try_rate > 0 and usd_try_rate not in ('NaN'::numeric,'Infinity'::numeric)),
 add column usd_try_rate_at timestamptz, add column captured_at timestamptz, add column market_breakdown_complete boolean not null default false, add column usd_try_rate_is_stale boolean not null default false;
-- Recover only FX that was actually stored with the historical snapshot.
update public.portfolio_snapshots s set usd_try_rate=x.rate,usd_try_rate_at=x.rate_at
from (
 select distinct on (sp.snapshot_id) sp.snapshot_id,
 case when sp.price_currency='USD' then sp.fx_rate else 1/sp.fx_rate end rate,sp.fx_rate_at rate_at
 from public.portfolio_snapshot_positions sp join public.portfolio_snapshots h on h.id=sp.snapshot_id
 where sp.price_currency<>h.base_currency and sp.fx_rate>0
 order by sp.snapshot_id,sp.fx_rate_at desc nulls last,sp.id
) x where s.id=x.snapshot_id;
create table public.portfolio_snapshot_markets (
 snapshot_id uuid not null references public.portfolio_snapshots(id) on delete cascade,
 market text not null check(market in ('BIST100','NASDAQ100','CRYPTO','TEFAS','FX')),
 holdings_value_base numeric not null, unrealized_pnl_base numeric not null,realized_pnl_base numeric not null,
 primary key(snapshot_id,market)
);
alter table public.portfolio_snapshot_markets enable row level security;
revoke all on public.portfolio_snapshot_markets from public,anon,authenticated;
grant select on public.portfolio_snapshot_markets to authenticated;
create policy "Users read own snapshot markets" on public.portfolio_snapshot_markets for select to authenticated
using(exists(select 1 from public.portfolio_snapshots s join public.portfolios p on p.id=s.portfolio_id where s.id=snapshot_id and p.user_id=(select auth.uid())));

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
        usd_try_rate = (select lp.price from public.instrument_latest_prices lp join public.instruments i on i.id=lp.instrument_id where i.market='FX' and i.symbol='USDTRY' and i.is_active limit 1),
        usd_try_rate_at = (select lp.price_at from public.instrument_latest_prices lp join public.instruments i on i.id=lp.instrument_id where i.market='FX' and i.symbol='USDTRY' and i.is_active limit 1),
        usd_try_rate_is_stale = coalesce((select lp.is_stale from public.instrument_latest_prices lp join public.instruments i on i.id=lp.instrument_id where i.market='FX' and i.symbol='USDTRY' and i.is_active limit 1),true),
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

create or replace function public.get_portfolio_chart(p_portfolio_id uuid,p_range text default '1M',p_market text default 'ALL',p_currency text default 'TRY',p_metric text default 'VALUE')
returns table(snapshot_date date,value numeric,calculation_version integer,is_partial boolean,missing_fx boolean,missing_market_pnl boolean,captured_at timestamptz,source_count bigint)
language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
declare since_date date; today date:=(now() at time zone 'Europe/Istanbul')::date;
begin
 if auth.uid() is null then raise exception 'portfolio_authentication_required'; end if;
 if not exists(select 1 from public.portfolios where id=p_portfolio_id and user_id=auth.uid() and archived_at is null) then raise exception 'portfolio_not_found_or_forbidden'; end if;
 if p_range is null or p_range not in ('1W','1M','3M','6M','1Y','ALL') or p_market is null or p_market not in ('ALL','BIST100','NASDAQ100','CRYPTO','TEFAS','FX')
 or p_currency is null or p_currency not in ('TRY','USD') or p_metric is null or p_metric not in ('VALUE','PNL') then raise exception 'portfolio_chart_invalid_filter'; end if;
 since_date:=case p_range when '1W' then today-6 when '1M' then (today-interval '1 month')::date
 when '3M' then (today-interval '3 months')::date when '6M' then (today-interval '6 months')::date
 when '1Y' then (today-interval '1 year')::date else '-infinity'::date end;
 if p_market<>'ALL' and not exists(select 1 from public.portfolio_transactions t join public.instruments i on i.id=t.instrument_id where t.portfolio_id=p_portfolio_id and not t.is_reversed and i.market=p_market)
 and not exists(select 1 from public.portfolio_snapshot_positions sp join public.portfolio_snapshots h on h.id=sp.snapshot_id join public.instruments i on i.id=sp.instrument_id where h.portfolio_id=p_portfolio_id and i.market=p_market)
 and not exists(select 1 from public.portfolio_snapshot_markets m join public.portfolio_snapshots h on h.id=m.snapshot_id where h.portfolio_id=p_portfolio_id and m.market=p_market) then return; end if;
 return query with amounts as (
  select h.snapshot_date,h.calculation_version,h.valuation_status,h.captured_at,h.base_currency,h.usd_try_rate,h.usd_try_rate_is_stale,
   case when p_market='ALL' then case when p_metric='VALUE' then h.total_value_base else h.realized_pnl_base+h.unrealized_pnl_base end
    when p_metric='VALUE' then coalesce(m.holdings_value_base,(select coalesce(sum(sp.market_value_base),0) from public.portfolio_snapshot_positions sp join public.instruments i on i.id=sp.instrument_id where sp.snapshot_id=h.id and i.market=p_market))
    when h.market_breakdown_complete then coalesce(m.realized_pnl_base+m.unrealized_pnl_base,0)
    else null end amount,
   (p_market<>'ALL' and p_metric='PNL' and not h.market_breakdown_complete) missing_market_pnl
  from public.portfolio_snapshots h left join public.portfolio_snapshot_markets m on m.snapshot_id=h.id and m.market=p_market
  where h.portfolio_id=p_portfolio_id and h.snapshot_date between since_date and today
 ), converted as (
  select a.snapshot_date,case when a.base_currency=p_currency then a.amount
   when a.usd_try_rate is null then null when p_currency='TRY' then a.amount*a.usd_try_rate else a.amount/a.usd_try_rate end value,
   a.calculation_version,(a.valuation_status='partial' or (a.base_currency<>p_currency and a.usd_try_rate_is_stale)) is_partial,(a.base_currency<>p_currency and a.usd_try_rate is null) missing_fx,a.missing_market_pnl,a.captured_at,
   count(*) over() source_count,ntile(120) over(order by a.snapshot_date) bucket from amounts a
 ), ranked as (
  select c.*,row_number() over(partition by bucket order by c.snapshot_date) first_n,
   row_number() over(partition by bucket order by c.snapshot_date desc) last_n,
   row_number() over(partition by bucket order by c.value asc nulls last,c.snapshot_date) low_n,
   row_number() over(partition by bucket order by c.value desc nulls last,c.snapshot_date) high_n,
   row_number() over(partition by bucket order by (c.value is null) desc,c.snapshot_date) gap_n
  from converted c
 ) select r.snapshot_date,r.value,r.calculation_version,r.is_partial,r.missing_fx,r.missing_market_pnl,r.captured_at,r.source_count
 from ranked r where r.source_count<=600 or r.first_n=1 or r.last_n=1 or r.low_n=1 or r.high_n=1 or (r.value is null and r.gap_n=1)
 order by r.snapshot_date;
end $$;
revoke all on function public.get_portfolio_chart(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.get_portfolio_chart(uuid,text,text,text,text) to authenticated;

-- Opening the chart refreshes only the owner's current-day snapshot.
create or replace function public.refresh_portfolio_chart(p_portfolio_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if auth.uid() is null then raise exception 'portfolio_authentication_required'; end if;
 perform 1 from public.portfolios where id=p_portfolio_id and user_id=auth.uid() and archived_at is null for update;
 if not found then raise exception 'portfolio_not_found_or_forbidden'; end if;
 return private.build_portfolio_snapshot(p_portfolio_id,(now() at time zone 'Europe/Istanbul')::date);
end $$;
revoke all on function public.refresh_portfolio_chart(uuid) from public,anon,authenticated;
grant execute on function public.refresh_portfolio_chart(uuid) to authenticated;

-- Capture current values independently of whether the application is open.
create or replace function private.capture_portfolio_chart_snapshots()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare p record; completed integer:=0; failed integer:=0;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('portfolio_chart_snapshots',0)) then return jsonb_build_object('skipped',true); end if;
 for p in select id from public.portfolios where archived_at is null and (exists(select 1 from public.portfolio_transactions t where t.portfolio_id=portfolios.id) or exists(select 1 from public.portfolio_cash_accounts c where c.portfolio_id=portfolios.id and c.current_balance<>0)) order by id loop
  begin
   perform private.build_portfolio_snapshot(p.id,(now() at time zone 'Europe/Istanbul')::date);
   completed:=completed+1;
  exception when others then
   failed:=failed+1;
   raise warning 'Portfolio snapshot failed for %: %',p.id,sqlerrm;
  end;
 end loop;
 return jsonb_build_object('completed',completed,'failed',failed);
end $$;
revoke all on function private.capture_portfolio_chart_snapshots() from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.capture_portfolio_chart_snapshots() to service_role;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('lucrari-portfolio-chart-snapshots','55 * * * *','select private.capture_portfolio_chart_snapshots();');
notify pgrst,'reload schema';
commit;
