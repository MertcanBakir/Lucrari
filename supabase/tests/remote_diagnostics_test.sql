begin;
insert into auth.users (id, aud, role) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','authenticated','authenticated');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select public.submit_mobile_diagnostics('[{"id":"11111111-1111-4111-8111-111111111111","timestamp":"2026-11-24T00:00:00.000Z","level":"warn","event":"analysis.request.failed","status":503,"code":null,"platform":"ios","appVersion":"1.0.0","environment":"preview"}]'::jsonb, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.submit_mobile_diagnostics('[{"id":"11111111-1111-4111-8111-111111111111","timestamp":"2026-11-24T00:00:00.000Z","level":"warn","event":"analysis.request.failed","status":503,"code":null,"platform":"ios","appVersion":"1.0.0","environment":"preview"}]'::jsonb, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$ begin
  begin perform public.submit_mobile_diagnostics('[]'::jsonb,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); raise exception 'wrong account accepted'; exception when raise_exception then if sqlerrm <> 'diagnostics_auth_required' then raise; end if; end;
  begin perform public.submit_mobile_diagnostics('[{"id":"11111111-1111-4111-8111-111111111112","timestamp":"2026-11-24T00:00:00.000Z","level":"warn","event":"analysis.request.failed","status":503,"code":null,"platform":"ios","appVersion":"1.0.0","environment":"preview","token":"secret"}]'::jsonb,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); raise exception 'extra field accepted'; exception when raise_exception then if sqlerrm <> 'diagnostics_invalid_entry' then raise; end if; end;
  begin perform count(*) from public.mobile_diagnostic_logs; raise exception 'direct read permitted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin if (select count(*) from public.mobile_diagnostic_logs where event_id='11111111-1111-4111-8111-111111111111') <> 1 then raise exception 'idempotency failed'; end if; end $$;
insert into public.mobile_diagnostic_logs(event_id,user_id,occurred_at,received_at,level,event,platform,app_version,environment)
select gen_random_uuid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),now() - interval '31 days','warn','analysis.request.failed','ios','1.0.0','preview';
select public.prune_mobile_diagnostics();
do $$ begin if exists(select 1 from public.mobile_diagnostic_logs where received_at < now() - interval '30 days') then raise exception 'retention failed'; end if; end $$;
insert into public.mobile_diagnostic_logs(event_id,user_id,occurred_at,received_at,level,event,platform,app_version,environment)
select gen_random_uuid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),now() - (g * interval '1 second'),'warn','analysis.request.failed','ios','1.0.0','preview' from generate_series(1,10005) g;
select public.prune_mobile_diagnostics();
do $$ begin
  if (select count(*) from public.mobile_diagnostic_logs) <> 10000 then raise exception 'count retention failed'; end if;
  if not exists(select 1 from cron.job where jobname = 'lucrari-diagnostics-weekly-cleanup' and schedule = '0 0 * * 0' and active) then raise exception 'cron schedule missing'; end if;
end $$;
rollback;
