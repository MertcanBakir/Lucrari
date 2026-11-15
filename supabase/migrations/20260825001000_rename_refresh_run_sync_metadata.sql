-- Replace the remaining rolling-cache term with the domain-level sync term.
-- This is a metadata-only rename; stored values and constraints are preserved.

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'refresh_runs'
          and column_name = 'cache_action'
    ) and not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'refresh_runs'
          and column_name = 'sync_action'
    ) then
        alter table public.refresh_runs rename column cache_action to sync_action;
    end if;
end
$$;
