-- Run after the simplified portfolio migration. Every fixture is rolled back.
begin;
do $$ declare u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); fx uuid; begin
 insert into auth.users(id) values(u);
 insert into public.portfolios(id,user_id,name,base_currency,is_default) values(p,u,'Moving average test','TRY',false);
 insert into public.instruments(id,market,symbol,company_name,asset_type,currency)
 values(i,'BIST100','TEST_AVERAGE_'||replace(i::text,'-',''),'Average-cost fixture','stock','TRY');
 insert into public.data_providers(code,name,provider_type)
 values('TEST_AVERAGE','Average-cost test provider','market');
 insert into public.instrument_latest_prices(instrument_id,price,currency,price_at,provider_code)
 values(i,100,'TRY',now(),'TEST_AVERAGE');
 insert into public.instruments(market,symbol,company_name,asset_type,currency,is_active)
 values('FX','USDTRY','Test USD/TRY','fx','TRY',true)
 on conflict(market,symbol) do update set asset_type='fx',currency='TRY',is_active=true
 returning id into fx;
 insert into public.instrument_latest_prices(instrument_id,price,currency,price_at,provider_code,is_stale)
 values(fx,40,'TRY',now(),'TEST_AVERAGE',false)
 on conflict(instrument_id) do update set price=40,currency='TRY',price_at=now(),provider_code=excluded.provider_code,is_stale=false;
 perform set_config('test.user',u::text,true);
 perform set_config('test.portfolio',p::text,true);
 perform set_config('test.instrument',i::text,true);
 perform set_config('request.jwt.claim.sub',u::text,true);
end $$;
set local role authenticated;
do $$
declare
 p uuid:=current_setting('test.portfolio')::uuid; i uuid:=current_setting('test.instrument')::uuid;
 r jsonb; cash jsonb; first_buy uuid; sale uuid; request_id uuid:=gen_random_uuid();
 t timestamptz:=now()-interval '4 days'; count_before bigint;
begin
 cash:=public.get_portfolio_cash(p);
 if cash <> '{"try_balance":0,"usd_balance":0}'::jsonb then raise exception 'Cash must be optional'; end if;
 r:=public.record_portfolio_transaction(p,i,'BUY',10,100,'TRY',t,request_id,null);
 first_buy:=(r->>'transaction_id')::uuid;
 if (r->>'current_quantity')::numeric<>10 then raise exception 'Buy without cash failed'; end if;
 r:=public.record_portfolio_transaction(p,i,'BUY',10,100,'TRY',t,request_id,null);
 if not (r->>'was_replayed')::boolean then raise exception 'Retry duplicated trade'; end if;
 begin
  perform public.record_portfolio_transaction(p,i,'BUY',11,100,'TRY',t,request_id,null);
  raise exception 'Conflicting retry accepted';
 exception when raise_exception then if sqlerrm<>'portfolio_idempotency_conflict' then raise; end if; end;
 perform public.set_portfolio_cash(p,123.45,12.5);
 perform public.record_portfolio_transaction(p,i,'BUY',10,200,'TRY',t+interval '1 day',gen_random_uuid(),null);
 r:=public.record_portfolio_transaction(p,i,'SELL',10,250,'TRY',t+interval '2 days',gen_random_uuid(),null);
 if (r->>'remaining_cost_basis')::numeric<>1500 or (r->>'realized_pnl')::numeric<>1000 then raise exception 'Weighted average partial sale incorrect: %',r; end if;
 perform public.record_portfolio_transaction(p,i,'BUY',10,50,'TRY',t+interval '3 days',gen_random_uuid(),null);
 r:=public.record_portfolio_transaction(p,i,'SELL',20,120,'TRY',now()-interval '1 hour',gen_random_uuid(),null);
 sale:=(r->>'transaction_id')::uuid;
 if (r->>'current_quantity')::numeric<>0 or (r->>'remaining_cost_basis')::numeric<>0 or (r->>'realized_pnl')::numeric<>1400 then raise exception 'Full close incorrect'; end if;
 if (public.get_portfolio_realized_pnl(p)->>'try_pnl')::numeric<>1400 then raise exception 'Closed instrument profit lost'; end if;
 if exists(select 1 from public.get_portfolio_positions(p)) then raise exception 'Closed instrument remains in holdings'; end if;
 if public.get_portfolio_cash(p)<>'{"try_balance":123.45,"usd_balance":12.5}'::jsonb then raise exception 'Trades changed manual cash'; end if;
 begin
  perform public.record_portfolio_transaction(p,i,'SELL',1,100,'TRY',t-interval '1 day',gen_random_uuid(),null);
  raise exception 'Historical oversell accepted';
 exception when raise_exception then if sqlerrm<>'portfolio_insufficient_position' then raise; end if; end;
 begin
  perform public.reverse_portfolio_transaction(first_buy,gen_random_uuid(),'test');
  raise exception 'Invalid reversal accepted';
 exception when raise_exception then if sqlerrm<>'portfolio_insufficient_position' then raise; end if; end;
 r:=public.reverse_portfolio_transaction(sale,gen_random_uuid(),'test');
 if (r->>'current_quantity')::numeric<>20 or (r->>'remaining_cost_basis')::numeric<>2000 then raise exception 'Sale reversal incorrect'; end if;
 begin
  perform public.set_portfolio_cash(p,-1,0); raise exception 'Negative cash accepted';
 exception when raise_exception then if sqlerrm<>'portfolio_invalid_cash_amount' then raise; end if; end;
 select count(*) into count_before from public.get_my_portfolio_activity(p,100);
 if count_before<>5 then raise exception 'Trade history incorrect: %',count_before; end if;
 -- A fresh account cannot read or modify this portfolio.
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.set_portfolio_cash(p,0,0); raise exception 'Cross-user write accepted';
 exception when raise_exception then if sqlerrm<>'portfolio_not_found_or_forbidden' then raise; end if; end;
 begin
  perform public.get_portfolio_positions(p); raise exception 'Cross-user read accepted';
 exception when raise_exception then if sqlerrm<>'portfolio_not_found_or_forbidden' then raise; end if; end;
end $$;
reset role;
-- Exercise snapshot generation using the new cost engine, without altering history.
select private.build_portfolio_snapshot(current_setting('test.portfolio')::uuid,(now() at time zone 'Europe/Istanbul')::date);
do $$ begin
 if to_regclass('public.portfolio_fifo_matches') is not null or to_regclass('public.portfolio_cash_flows') is not null then raise exception 'Legacy tables remain'; end if;
 if exists(select 1 from public.portfolio_snapshots where portfolio_id=current_setting('test.portfolio')::uuid and calculation_version<>2) then raise exception 'Wrong calculation version'; end if;
end $$;
-- Reset removes manual cash and trade history, and remains retry-safe.
select set_config('request.jwt.claim.sub',current_setting('test.user'),true);
set local role authenticated;
do $$ declare r jsonb; key uuid:=gen_random_uuid(); p uuid:=current_setting('test.portfolio')::uuid; begin
 r:=public.reset_my_investments(key,'RESET_ALL_INVESTMENTS');
 if (r->>'deleted_transaction_count')::integer<>5 or (r->>'deleted_snapshot_count')::integer<>1 then raise exception 'Reset counts incorrect: %',r; end if;
 if public.get_portfolio_cash(p)<>'{"try_balance":0,"usd_balance":0}'::jsonb then raise exception 'Reset left manual cash'; end if;
 if exists(select 1 from public.get_my_portfolio_activity(p,100)) then raise exception 'Reset left trade history'; end if;
 if not (public.reset_my_investments(key,'RESET_ALL_INVESTMENTS')->>'was_replayed')::boolean then raise exception 'Reset retry failed'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
  perform public.get_portfolio_cash(current_setting('test.portfolio')::uuid);
  raise exception 'Anonymous read accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
