-- Diagnostics contain only enumerated events and HTTP status codes, never free text.
create table public.mobile_diagnostic_logs (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  level text not null check (level in ('info', 'warn', 'error')),
  event text not null,
  error_code text check (error_code in ('notification_auth_required','notification_invalid_device','notification_device_conflict','notification_invalid_preferences')),
  http_status integer check (http_status between 100 and 599),
  platform text not null check (platform in ('ios', 'android', 'web')),
  app_version text not null check (app_version ~ '^[0-9]+(\.[0-9]+){1,3}$'),
  environment text not null check (environment = 'preview')
);
create index mobile_diagnostic_logs_received_at_idx on public.mobile_diagnostic_logs (received_at desc, id desc);
alter table public.mobile_diagnostic_logs enable row level security;
revoke all on public.mobile_diagnostic_logs from public, anon, authenticated;

create function public.submit_mobile_diagnostics(p_entries jsonb, p_expected_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare item jsonb; v_user uuid := auth.uid(); v_event text; v_level text; v_status integer; v_count integer;
begin
  if v_user is null or p_expected_user is distinct from v_user then raise exception 'diagnostics_auth_required'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) not between 1 and 20 or pg_column_size(p_entries) > 16384 then
    raise exception 'diagnostics_invalid_batch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 9917));
  select count(*) into v_count from public.mobile_diagnostic_logs where user_id = v_user and received_at > now() - interval '1 hour';
  if v_count + jsonb_array_length(p_entries) > 200 then raise exception 'diagnostics_rate_limited'; end if;
  for item in select value from jsonb_array_elements(p_entries) loop
    v_event := item->>'event'; v_level := item->>'level';
    if jsonb_typeof(item) <> 'object' or item->>'id' is null or item->>'timestamp' is null or item->>'event' is null or item->>'level' is null or item->>'platform' is null or item->>'appVersion' is null or item->>'environment' is null or (select count(*) from jsonb_object_keys(item)) <> 9
      or v_event not in ('analysis.report.invalid','analysis.report.loading','analysis.request.failed','analysis.request.retry','analysis.start.accepted','auth.anonymous.failed','auth.anonymous.invalid','auth.bootstrap.exception','auth.bootstrap.failed','auth.session.lookup.failed','auth.session.read.failed','auth.signout.failed','auth.subscription.failed','auth.user.read.failed','calendar.earnings.failed','calendar.economic.failed','calendar.event.failed','calendar.load.failed','calendar.lookup.failed','calendar.native.unavailable','calendar.permission.failed','calendar.response.discarded','fx.instrument.missing','fx.load.failed','fx.price.invalid','fx.query.failed','instrument.search.exception','instrument.search.failed','notification.device.registration.failed','notification.response.read.failed','portfolio.activity.network.failed','portfolio.activity.next.failed','portfolio.activity.owner.failed','portfolio.activity.page.failed','portfolio.activity.rpc.failed','portfolio.default.conflict','portfolio.default.create.failed','portfolio.default.failed','portfolio.default.lookup.failed','portfolio.default.refetch.failed','portfolio.listener.failed','portfolio.load.failed','portfolio.ownership.cache.stale','portfolio.ownership.listener.failed','portfolio.ownership.load.failed','portfolio.ownership.refresh.failed','portfolio.ownership.response.discarded','portfolio.ownership.revision.exhausted','portfolio.ownership.revision.retry','portfolio.ownership.session.missing','portfolio.positions.failed','portfolio.positions.rpc.failed','portfolio.reset.failed','portfolio.reset.rpc.failed','portfolio.transaction.failed','portfolio.transaction.reverse.failed','portfolio.transaction.reverse.rpc.failed','portfolio.transaction.rpc.failed','server.management.failed','supabase.health.refresh.failed','system.health.cache.stale','system.health.failed','system.health.rpc.failed','system.health.session.failed','watchlist.listener.failed','watchlist.membership.cache.stale','watchlist.membership.failed','watchlist.membership.load.failed','watchlist.membership.response.discarded','watchlist.membership.revision.exhausted','watchlist.mutation.failed','watchlist.mutation.invalid','watchlist.mutation.rpc.failed','watchlist.page.failed','watchlist.page.invalid','watchlist.page.revision.exhausted','watchlist.page.rpc.failed','watchlist.session.missing')
      or v_level not in ('info','warn','error') or item->>'environment' <> 'preview'
      or item->>'platform' not in ('ios','android','web')
      or item->>'appVersion' !~ '^[0-9]+(\.[0-9]+){1,3}$'
      or item->>'timestamp' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'
      or (item->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or not (item ?& array['id','timestamp','level','event','status','code','platform','appVersion','environment'])
      or (item->'code' <> 'null'::jsonb and coalesce(item->>'code','') not in ('notification_auth_required','notification_invalid_device','notification_device_conflict','notification_invalid_preferences')) then
      raise exception 'diagnostics_invalid_entry';
    end if;
    if item->'status' <> 'null'::jsonb and (jsonb_typeof(item->'status') <> 'number' or (item->>'status') !~ '^[1-5][0-9]{2}$') then raise exception 'diagnostics_invalid_entry'; end if;
    v_status := (item->>'status')::integer;
    insert into public.mobile_diagnostic_logs(event_id,user_id,occurred_at,level,event,http_status,error_code,platform,app_version,environment)
    values ((item->>'id')::uuid,v_user,(item->>'timestamp')::timestamptz,v_level,v_event,v_status,item->>'code',item->>'platform',item->>'appVersion','preview')
    on conflict (event_id) do nothing;
  end loop;
end $$;
revoke all on function public.submit_mobile_diagnostics(jsonb, uuid) from public, anon;
grant execute on function public.submit_mobile_diagnostics(jsonb, uuid) to authenticated;

create function public.prune_mobile_diagnostics() returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.mobile_diagnostic_logs where received_at < now() - interval '30 days';
  delete from public.mobile_diagnostic_logs where id in (select id from public.mobile_diagnostic_logs order by received_at desc, id desc offset 10000);
end $$;
revoke all on function public.prune_mobile_diagnostics() from public, anon, authenticated;
create extension if not exists pg_cron with schema pg_catalog;
-- Sunday 00:00 UTC = Sunday 03:00 in Türkiye.
select cron.schedule('lucrari-diagnostics-weekly-cleanup', '0 0 * * 0', 'select public.prune_mobile_diagnostics()');
