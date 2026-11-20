-- Restored from the applied Supabase migration history.

-- Migration: Mobile System Health Observability RPC
-- Exposes an authenticated, hardened SECURITY DEFINER RPC to fetch current status of all 10 tracked jobs.
-- Strictly limited to 13 non-sensitive observability fields.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_mobile_system_health()
RETURNS TABLE (
    job_code text,
    category text,
    display_name text,
    sort_order integer,
    execution_status text,
    health_status text,
    last_started_at timestamp with time zone,
    last_finished_at timestamp with time zone,
    last_success_at timestamp with time zone,
    duration_seconds numeric,
    is_overdue boolean,
    message_code text,
    checked_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_checked_at timestamp with time zone := pg_catalog.now();
BEGIN
    -- 1. Fail-closed authentication gate
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING errcode = 'P0001', message = 'authentication_required';
    END IF;

    RETURN QUERY
    WITH job_catalog (
        job_name,
        job_code,
        category,
        display_name,
        sort_order,
        run_overdue_after,
        success_stale_after
    ) AS (
        VALUES
            ('bist_latest_prices_job'::text,           'BIST_PRICES'::text,        'prices'::text,    'BIST 100 Fiyatları'::text,     1, interval '72 hours', interval '96 hours'),
            ('nasdaq_latest_prices_job'::text,         'NASDAQ_PRICES'::text,      'prices'::text,    'ABD Hisse Fiyatları'::text,    2, interval '72 hours', interval '96 hours'),
            ('binance_crypto_latest_prices_job'::text, 'CRYPTO_PRICES'::text,      'prices'::text,    'Kripto Para Fiyatları'::text,  3, interval '14 hours', interval '24 hours'),
            ('tefas_latest_prices_job'::text,          'TEFAS_PRICES'::text,       'prices'::text,    'TEFAS Fon Fiyatları'::text,    4, interval '76 hours', interval '96 hours'),
            ('fx_latest_price_job'::text,              'USDTRY_PRICE'::text,       'prices'::text,    'USD/TRY Kuru'::text,           5, interval '76 hours', interval '96 hours'),
            ('earnings_refresh_job'::text,             'EARNINGS_CALENDAR'::text,  'calendar'::text,  'Finansal Sonuç Takvimi'::text, 6, interval '36 hours', interval '48 hours'),
            ('economic_calendar_refresh_job'::text,    'ECONOMIC_CALENDAR'::text,  'calendar'::text,  'Ekonomik Takvim'::text,        7, interval '36 hours', interval '48 hours'),
            ('portfolio_snapshots_job'::text,          'PORTFOLIO_SNAPSHOTS'::text,'portfolio'::text, 'Portföy Değerleme'::text,      8, interval '36 hours', interval '48 hours'),
            ('morning_job'::text,                      'MORNING_SUMMARY'::text,    'summary'::text,   'Sabah Piyasa Özeti'::text,     9, interval '76 hours', interval '96 hours'),
            ('closing_job'::text,                      'CLOSING_SUMMARY'::text,    'summary'::text,   'Kapanış Piyasa Özeti'::text,   10, interval '76 hours', interval '96 hours')
    ),
    latest_runs AS (
        SELECT DISTINCT ON (r.job_name)
            r.job_name,
            r.id,
            r.status,
            r.started_at,
            r.finished_at,
            CASE
                WHEN r.finished_at IS NOT NULL AND r.started_at IS NOT NULL
                THEN pg_catalog.round(
                    GREATEST(
                        EXTRACT(EPOCH FROM (r.finished_at - r.started_at))::numeric,
                        0::numeric
                    ),
                    2
                )
                ELSE NULL
            END AS duration_seconds
        FROM public.refresh_runs r
        WHERE r.job_name IN (SELECT jc.job_name FROM job_catalog jc)
        ORDER BY
            r.job_name,
            r.started_at DESC,
            r.created_at DESC,
            r.id DESC
    ),
    latest_successes AS (
        SELECT DISTINCT ON (r.job_name)
            r.job_name,
            r.finished_at AS last_success_at
        FROM public.refresh_runs r
        WHERE r.job_name IN (SELECT jc.job_name FROM job_catalog jc)
          AND r.status = 'success'
          AND r.finished_at IS NOT NULL
        ORDER BY
            r.job_name,
            r.finished_at DESC,
            r.started_at DESC,
            r.created_at DESC,
            r.id DESC
    )
    SELECT
        jc.job_code,
        jc.category,
        jc.display_name,
        jc.sort_order,

        -- execution_status: running | success | partial | failed | skipped | never_run
        COALESCE(lr.status, 'never_run'::text) AS execution_status,

        -- health_status: healthy | warning | critical | running | inactive | unknown
        CASE
            -- 1. Never run
            WHEN lr.id IS NULL THEN 'unknown'::text

            -- 2. Currently running
            WHEN lr.status = 'running' THEN
                CASE
                    WHEN lr.started_at < (v_checked_at - interval '2 hours') THEN 'critical'::text
                    ELSE 'running'::text
                END

            -- 3. Success
            WHEN lr.status = 'success' THEN
                CASE
                    WHEN lr.started_at < (v_checked_at - jc.run_overdue_after) THEN 'warning'::text
                    ELSE 'healthy'::text
                END

            -- 4. Partial
            WHEN lr.status = 'partial' THEN
                CASE
                    WHEN lr.started_at < (v_checked_at - jc.run_overdue_after) THEN 'warning'::text
                    ELSE 'warning'::text
                END

            -- 5. Failed
            WHEN lr.status = 'failed' THEN
                CASE
                    WHEN ls.last_success_at IS NOT NULL AND ls.last_success_at >= (v_checked_at - jc.success_stale_after)
                    THEN 'warning'::text
                    ELSE 'critical'::text
                END

            -- 6. Skipped
            WHEN lr.status = 'skipped' THEN
                CASE
                    WHEN lr.started_at < (v_checked_at - jc.run_overdue_after) THEN 'warning'::text
                    ELSE 'inactive'::text
                END

            ELSE 'unknown'::text
        END AS health_status,

        lr.started_at AS last_started_at,
        lr.finished_at AS last_finished_at,
        ls.last_success_at AS last_success_at,
        lr.duration_seconds,

        -- is_overdue: boolean
        CASE
            WHEN lr.id IS NULL THEN false
            WHEN lr.status = 'running' THEN (lr.started_at < (v_checked_at - interval '2 hours'))
            ELSE (lr.started_at < (v_checked_at - jc.run_overdue_after))
        END AS is_overdue,

        -- message_code: JOB_OK | JOB_PARTIAL | JOB_FAILED | JOB_OVERDUE | JOB_RUNNING | JOB_SKIPPED | JOB_NEVER_RUN
        CASE
            WHEN lr.id IS NULL THEN 'JOB_NEVER_RUN'::text
            WHEN lr.status = 'running' THEN
                CASE
                    WHEN lr.started_at < (v_checked_at - interval '2 hours') THEN 'JOB_OVERDUE'::text
                    ELSE 'JOB_RUNNING'::text
                END
            WHEN lr.status = 'success' THEN
                CASE
                    WHEN lr.started_at < (v_checked_at - jc.run_overdue_after) THEN 'JOB_OVERDUE'::text
                    ELSE 'JOB_OK'::text
                END
            WHEN lr.status = 'partial' THEN
                CASE
                    WHEN lr.started_at < (v_checked_at - jc.run_overdue_after) THEN 'JOB_OVERDUE'::text
                    ELSE 'JOB_PARTIAL'::text
                END
            WHEN lr.status = 'failed' THEN 'JOB_FAILED'::text
            WHEN lr.status = 'skipped' THEN
                CASE
                    WHEN lr.started_at < (v_checked_at - jc.run_overdue_after) THEN 'JOB_OVERDUE'::text
                    ELSE 'JOB_SKIPPED'::text
                END
            ELSE 'JOB_NEVER_RUN'::text
        END AS message_code,

        v_checked_at AS checked_at
    FROM job_catalog jc
    LEFT JOIN latest_runs lr ON lr.job_name = jc.job_name
    LEFT JOIN latest_successes ls ON ls.job_name = jc.job_name
    ORDER BY jc.sort_order ASC;
END;
$$;

-- Explicitly set function owner to postgres
ALTER FUNCTION public.get_mobile_system_health() OWNER TO postgres;

-- Revoke all default access from PUBLIC and anon, grant execute strictly to authenticated
REVOKE ALL ON FUNCTION public.get_mobile_system_health() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_mobile_system_health() FROM anon;

GRANT EXECUTE ON FUNCTION public.get_mobile_system_health() TO authenticated;

-- Ensure operational tables remain strictly inaccessible to mobile roles
REVOKE ALL PRIVILEGES ON TABLE public.refresh_runs FROM anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.provider_run_results FROM anon, authenticated;

COMMIT;
