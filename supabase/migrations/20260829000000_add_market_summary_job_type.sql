-- Restored from the applied Supabase migration history.

-- Migration: Add market_summary operation type to refresh_runs
BEGIN;

ALTER TABLE public.refresh_runs
    DROP CONSTRAINT IF EXISTS refresh_runs_operation_type_check;

ALTER TABLE public.refresh_runs
    ADD CONSTRAINT refresh_runs_operation_type_check
    CHECK (operation_type IS NULL OR operation_type = ANY (ARRAY[
        'prices_sync'::text,
        'calendar_refresh'::text,
        'portfolio_snapshot'::text,
        'archive_backfill'::text,
        'market_summary'::text
    ]));

COMMIT;
