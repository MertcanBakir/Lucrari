begin;

-- These tables contain backend operational metadata and are not mobile API data.
drop policy if exists "Allow public read access to refresh_runs"
    on public.refresh_runs;
drop policy if exists "Allow public read access to provider_run_results"
    on public.provider_run_results;
drop policy if exists "Allow public read access to kap_member_mappings"
    on public.kap_member_mappings;

-- Defense in depth: keep PostgREST roles from accessing the tables even if RLS
-- is accidentally disabled later. Direct backend PostgreSQL access is unchanged.
revoke all privileges on table public.refresh_runs from anon, authenticated;
revoke all privileges on table public.provider_run_results from anon, authenticated;
revoke all privileges on table public.kap_member_mappings from anon, authenticated;

-- The application does not write or read this empty legacy table.
drop table if exists public.email_deliveries;

commit;
