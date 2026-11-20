-- Snapshot RLS policies look up ownership through public.portfolios.
-- SELECT privilege permits that lookup; the existing portfolios RLS policy
-- continues to restrict authenticated clients to their own rows.
grant select on table public.portfolios to authenticated;
