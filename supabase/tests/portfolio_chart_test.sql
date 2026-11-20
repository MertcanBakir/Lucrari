-- Synthetic chart history and access checks, always rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); fx uuid; provider text:='TEST_CHART'; first_id uuid; second_id uuid;
 today date:=(now() at time zone 'Europe/Istanbul')::date;
begin
 insert into auth.users(id) values(u);
 insert into public.portfolios(id,user_id,name,base_currency,is_default) values(p,u,'Chart test','TRY',false);
 -- Every market quote belongs to this rolled-back fixture, including the FX rate.
 insert into public.data_providers(code,name,provider_type)
 values(provider,'Chart test provider','market');
 insert into public.instruments(id,market,symbol,company_name,asset_type,currency)
 values(i,'BIST100','TEST_CHART_'||replace(i::text,'-',''),'Chart fixture','stock','TRY');
 insert into public.instrument_latest_prices(instrument_id,price,currency,price_at,provider_code)
 values(i,100,'TRY',now(),provider);
 insert into public.instruments(market,symbol,company_name,asset_type,currency,is_active)
 values('FX','USDTRY','Test USD/TRY','fx','TRY',true)
 on conflict(market,symbol) do update set asset_type='fx',currency='TRY',is_active=true
 returning id into fx;
 insert into public.instrument_latest_prices(instrument_id,price,currency,price_at,provider_code,is_stale)
 values(fx,40,'TRY',now(),provider,false)
 on conflict(instrument_id) do update set price=40,currency='TRY',price_at=now(),provider_code=excluded.provider_code,is_stale=false;
 insert into public.portfolio_snapshots(portfolio_id,snapshot_date,base_currency,cash_value_base,holdings_value_base,total_value_base,total_cost_base,realized_pnl_base,unrealized_pnl_base,absolute_pnl_base,calculation_version,usd_try_rate,market_breakdown_complete)
 values(p,today-2,'TRY',0,3000,3000,2700,100,300,400,1,30,false) returning id into first_id;
 insert into public.portfolio_snapshots(portfolio_id,snapshot_date,base_currency,cash_value_base,holdings_value_base,total_value_base,total_cost_base,realized_pnl_base,unrealized_pnl_base,absolute_pnl_base,calculation_version,usd_try_rate,market_breakdown_complete)
 values(p,today-1,'TRY',1000,5000,6000,4400,200,600,800,2,40,true) returning id into second_id;
 insert into public.portfolio_snapshot_positions(snapshot_id,instrument_id,quantity,price,price_currency,price_at,provider_code,fx_rate,market_value_base,cost_basis_base,unrealized_pnl_base)
 values(first_id,i,10,100,'TRY',now(),provider,1,1000,900,100);
 insert into public.portfolio_snapshot_markets(snapshot_id,market,holdings_value_base,unrealized_pnl_base,realized_pnl_base)
 values(second_id,'BIST100',2000,200,100),(second_id,'CRYPTO',3000,400,100);
 perform set_config('test.portfolio',p::text,true); perform set_config('test.user',u::text,true);
 perform set_config('request.jwt.claim.sub',u::text,true);
end $$;
set local role authenticated;
do $$ declare p uuid:=current_setting('test.portfolio')::uuid; rows_n integer; amount numeric; r record;
begin
 if not exists(select 1 from public.portfolios where id=current_setting('test.portfolio')::uuid) then raise exception 'Owner cannot read own portfolio'; end if;
 select count(*),max(value) into rows_n,amount from public.get_portfolio_chart(p,'ALL','ALL','USD','VALUE');
 if rows_n<>2 or amount<>150 then raise exception 'Historical FX conversion failed'; end if;
 select max(value) into amount from public.get_portfolio_chart(p,'ALL','ALL','USD','PNL');
 if amount<>20 then raise exception 'Realized plus unrealized P/L incorrect'; end if;
 select max(value) into amount from public.get_portfolio_chart(p,'ALL','BIST100','USD','VALUE');
 if amount<>50 then raise exception 'Market values or FX incorrect'; end if;
 select * into r from public.get_portfolio_chart(p,'ALL','BIST100','USD','PNL') order by snapshot_date limit 1;
 if r.value is not null or not r.missing_market_pnl then raise exception 'Invented legacy market P/L'; end if;
 select max(value) into amount from public.get_portfolio_chart(p,'ALL','BIST100','USD','PNL');
 if amount<>7.5 then raise exception 'New market P/L incorrect'; end if;
 if exists(select 1 from public.get_portfolio_chart(p,'ALL','TEFAS','TRY','VALUE')) then raise exception 'Invented absent market'; end if;
 begin perform public.get_portfolio_chart(p,'INVALID'); raise exception 'Invalid filter accepted';
 exception when raise_exception then if sqlerrm<>'portfolio_chart_invalid_filter' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if exists(select 1 from public.portfolios where id=p) then raise exception 'Portfolio ownership RLS leaked'; end if;
 if exists(select 1 from public.portfolio_snapshot_markets where snapshot_id in(select id from public.portfolio_snapshots where portfolio_id=p)) then raise exception 'Market RLS leaked'; end if;
 begin perform public.get_portfolio_chart(p); raise exception 'Cross-user chart accepted';
 exception when raise_exception then if sqlerrm<>'portfolio_not_found_or_forbidden' then raise; end if; end;
 begin perform public.refresh_portfolio_chart(p); raise exception 'Cross-user refresh accepted';
 exception when raise_exception then if sqlerrm<>'portfolio_not_found_or_forbidden' then raise; end if; end;
end $$;
reset role;
do $$ declare p uuid:=current_setting('test.portfolio')::uuid; begin
 update public.portfolio_snapshots set usd_try_rate=null where portfolio_id=p;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.user'),true);
set local role authenticated;
do $$ declare p uuid:=current_setting('test.portfolio')::uuid; begin
 if exists(select 1 from public.get_portfolio_chart(p,'ALL','ALL','USD','VALUE') where value is not null or not missing_fx) then raise exception 'Missing FX became fake value'; end if;
 if exists(select 1 from public.get_portfolio_chart(p,'ALL','ALL','TRY','VALUE') where value is null) then raise exception 'Native currency needs no FX'; end if;
 perform public.set_portfolio_cash(p,0,10);
 perform public.refresh_portfolio_chart(p);
 if not exists(select 1 from public.get_portfolio_chart(p,'1W','ALL','USD','VALUE') where snapshot_date=(now() at time zone 'Europe/Istanbul')::date and abs(value-10)<0.000000001) then raise exception 'Snapshot FX does not match valuation FX'; end if;
 if not exists(select 1 from public.portfolio_snapshots where portfolio_id=p and captured_at is not null and market_breakdown_complete) then raise exception 'Current capture missing'; end if;
end $$;
reset role;
-- Large histories retain extrema and endpoints with a bounded response.
insert into public.portfolio_snapshots(portfolio_id,snapshot_date,base_currency,cash_value_base,holdings_value_base,total_value_base,total_cost_base,realized_pnl_base,unrealized_pnl_base,absolute_pnl_base)
select current_setting('test.portfolio')::uuid,(now() at time zone 'Europe/Istanbul')::date-800+n,'TRY',0,n*2,case when n=350 then 1000000 else n*2 end,0,0,0,0 from generate_series(1,700) n;
set local role authenticated;
do $$ declare n integer; mx numeric; source bigint; begin
 select count(*),max(value),max(source_count) into n,mx,source from public.get_portfolio_chart(current_setting('test.portfolio')::uuid,'ALL');
 if n>600 or mx<>1000000 or source<>703 then raise exception 'Bounded extrema sampling failed: %,%,%',n,mx,source; end if;
 perform public.reset_my_investments(gen_random_uuid(),'RESET_ALL_INVESTMENTS');
 if exists(select 1 from public.get_portfolio_chart(current_setting('test.portfolio')::uuid,'ALL')) then raise exception 'Reset left chart data'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.get_portfolio_chart(current_setting('test.portfolio')::uuid); raise exception 'Anonymous chart read accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
