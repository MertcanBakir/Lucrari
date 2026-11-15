-- Central Job Tracking & Observability Engine Migration
-- Adds full job lifecycle, notification status, provider relation, and idempotency guarantees to public.refresh_runs.

BEGIN;

-- 1. Ensure Binance data provider exists in reference data
INSERT INTO public.data_providers (
    code, name, provider_type, official_source, base_url, is_active
) VALUES (
    'BINANCE', 'Binance Public Market Data API', 'market', true, 'https://data-api.binance.vision', true
) ON CONFLICT (code) DO NOTHING;

-- 2. Extend refresh_runs with tracking and notification metadata
ALTER TABLE public.refresh_runs
    ADD COLUMN IF NOT EXISTS operation_type text,
    ADD COLUMN IF NOT EXISTS provider_id uuid REFERENCES public.data_providers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS scope text,
    ADD COLUMN IF NOT EXISTS skip_reason text,
    ADD COLUMN IF NOT EXISTS github_run_attempt integer,
    ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ADD COLUMN IF NOT EXISTS notification_status text DEFAULT 'not_required' NOT NULL,
    ADD COLUMN IF NOT EXISTS notification_error text,
    ADD COLUMN IF NOT EXISTS notified_at timestamp with time zone;

-- 2.1 Operation type check constraint
ALTER TABLE public.refresh_runs
    DROP CONSTRAINT IF EXISTS refresh_runs_operation_type_check;

ALTER TABLE public.refresh_runs
    ADD CONSTRAINT refresh_runs_operation_type_check
    CHECK (operation_type IS NULL OR operation_type = ANY (ARRAY[
        'prices_sync'::text,
        'calendar_refresh'::text,
        'portfolio_snapshot'::text,
        'archive_backfill'::text
    ]));

-- 3. Update status constraints for refresh_runs (support 'skipped' lifecycle status)
ALTER TABLE public.refresh_runs
    DROP CONSTRAINT IF EXISTS refresh_runs_status_check;

ALTER TABLE public.refresh_runs
    ADD CONSTRAINT refresh_runs_status_check
    CHECK (status = ANY (ARRAY['running'::text, 'success'::text, 'partial'::text, 'failed'::text, 'skipped'::text]));

-- 4. Notification status check constraint
ALTER TABLE public.refresh_runs
    DROP CONSTRAINT IF EXISTS refresh_runs_notification_status_check;

ALTER TABLE public.refresh_runs
    ADD CONSTRAINT refresh_runs_notification_status_check
    CHECK (notification_status = ANY (ARRAY[
        'not_required'::text,
        'pending'::text,
        'sent'::text,
        'failed'::text,
        'disabled'::text,
        'not_configured'::text,
        'skipped_dry_run'::text
    ]));

-- 5. Notification consistency constraint (notified_at required only when sent)
ALTER TABLE public.refresh_runs
    DROP CONSTRAINT IF EXISTS refresh_runs_notification_consistency_check;

ALTER TABLE public.refresh_runs
    ADD CONSTRAINT refresh_runs_notification_consistency_check
    CHECK (
        (notification_status = 'sent' AND notified_at IS NOT NULL)
        OR
        (notification_status <> 'sent' AND notified_at IS NULL)
    );

-- 6. GitHub run attempt check constraint
ALTER TABLE public.refresh_runs
    DROP CONSTRAINT IF EXISTS refresh_runs_github_run_attempt_check;

ALTER TABLE public.refresh_runs
    ADD CONSTRAINT refresh_runs_github_run_attempt_check
    CHECK (github_run_attempt IS NULL OR github_run_attempt >= 1);

-- 7. GitHub run idempotency index (protect against duplicate runs on same attempt)
CREATE UNIQUE INDEX IF NOT EXISTS refresh_runs_github_idempotency_idx
    ON public.refresh_runs (job_name, github_run_id, github_run_attempt)
    WHERE (github_run_id IS NOT NULL AND github_run_attempt IS NOT NULL);

-- 8. Updated-at trigger for refresh_runs
DROP TRIGGER IF EXISTS refresh_runs_updated_at ON public.refresh_runs;
CREATE TRIGGER refresh_runs_updated_at
    BEFORE UPDATE ON public.refresh_runs
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 9. Extend provider_run_results with flexible metrics & updated scopes
ALTER TABLE public.provider_run_results
    ADD COLUMN IF NOT EXISTS metrics jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.provider_run_results
    DROP CONSTRAINT IF EXISTS provider_run_results_scope_check;

ALTER TABLE public.provider_run_results
    ADD CONSTRAINT provider_run_results_scope_check
    CHECK (scope = ANY (ARRAY[
        'BIST100'::text,
        'NASDAQ100'::text,
        'ECONOMIC'::text,
        'EARNINGS'::text,
        'CRYPTO'::text,
        'TEFAS'::text,
        'FX'::text,
        'PORTFOLIO'::text
    ]));

-- 10. RLS Security: operational metadata is strictly internal/backend
DROP POLICY IF EXISTS "Allow public read access to refresh_runs" ON public.refresh_runs;
DROP POLICY IF EXISTS "Allow public read access to provider_run_results" ON public.provider_run_results;

REVOKE ALL PRIVILEGES ON TABLE public.refresh_runs FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.provider_run_results FROM anon, authenticated;

COMMIT;
