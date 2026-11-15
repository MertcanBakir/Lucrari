-- FinBot Supabase baseline schema
-- Generated from the live public schema on 2026-08-25.
-- Platform-managed Supabase event triggers and ownership metadata are intentionally excluded.


--
-- Name: set_portfolio_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_portfolio_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    new.updated_at = now();
    return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: data_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    provider_type text NOT NULL,
    official_source boolean DEFAULT false NOT NULL,
    base_url text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT data_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['earnings'::text, 'economic'::text, 'market'::text])))
);


--
-- Name: earnings_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.earnings_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    instrument_id uuid NOT NULL,
    market text NOT NULL,
    identity_key text NOT NULL,
    fiscal_year integer,
    fiscal_period text,
    period_start date,
    period_end date,
    earnings_date date NOT NULL,
    session text,
    date_type text,
    provider_id uuid,
    source_provider text,
    source_event_id text,
    source_url text,
    source_type text,
    publish_date date,
    disclosure_index bigint,
    is_active boolean DEFAULT true NOT NULL,
    is_stale boolean DEFAULT false NOT NULL,
    carried_forward boolean DEFAULT false NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_changed_at timestamp with time zone,
    last_refresh_run_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT earnings_events_check CHECK (((period_start IS NULL) OR (period_end IS NULL) OR (period_start <= period_end))),
    CONSTRAINT earnings_events_check1 CHECK ((((market = 'BIST100'::text) AND (fiscal_year IS NOT NULL) AND (fiscal_period IS NOT NULL) AND (period_start IS NOT NULL) AND (period_end IS NOT NULL) AND (session IS NULL)) OR ((market = 'NASDAQ100'::text) AND (session IS NOT NULL)))),
    CONSTRAINT earnings_events_fiscal_period_check CHECK (((fiscal_period IS NULL) OR (fiscal_period = ANY (ARRAY['Q1'::text, 'Q2'::text, 'Q3'::text, 'FY'::text])))),
    CONSTRAINT earnings_events_market_check CHECK ((market = ANY (ARRAY['BIST100'::text, 'NASDAQ100'::text]))),
    CONSTRAINT earnings_events_session_check CHECK (((session IS NULL) OR (session = ANY (ARRAY['pre_market'::text, 'time_not_supplied'::text, 'after_hours'::text]))))
);


--
-- Name: economic_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.economic_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identity_key text NOT NULL,
    provider_id uuid NOT NULL,
    event_code text,
    name text NOT NULL,
    country text NOT NULL,
    reference_period text,
    scheduled_at timestamp with time zone NOT NULL,
    source_event_id text,
    source_url text,
    is_active boolean DEFAULT true NOT NULL,
    is_stale boolean DEFAULT false NOT NULL,
    carried_forward boolean DEFAULT false NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_changed_at timestamp with time zone,
    last_refresh_run_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT economic_events_country_check CHECK ((country = ANY (ARRAY['TR'::text, 'US'::text])))
);


--
-- Name: email_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    refresh_run_id uuid,
    email_type text NOT NULL,
    subject text NOT NULL,
    status text NOT NULL,
    attempt_number integer DEFAULT 1 NOT NULL,
    sent_at timestamp with time zone,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_deliveries_attempt_number_check CHECK ((attempt_number > 0)),
    CONSTRAINT email_deliveries_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text, 'skipped'::text, 'skipped_not_configured'::text, 'skipped_dry_run'::text, 'skipped_no_email'::text])))
);


--
-- Name: instrument_latest_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instrument_latest_prices (
    instrument_id uuid NOT NULL,
    price numeric(30,12) NOT NULL,
    currency text NOT NULL,
    previous_close numeric(30,12),
    change_amount numeric(30,12),
    change_percent numeric(20,8),
    price_at timestamp with time zone NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    provider_code text NOT NULL,
    is_stale boolean DEFAULT false NOT NULL,
    stale_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT instrument_latest_prices_currency_check CHECK ((currency = ANY (ARRAY['TRY'::text, 'USD'::text]))),
    CONSTRAINT instrument_latest_prices_previous_close_check CHECK (((previous_close IS NULL) OR (previous_close > (0)::numeric))),
    CONSTRAINT instrument_latest_prices_price_check CHECK ((price > (0)::numeric))
);


--
-- Name: instruments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instruments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market text NOT NULL,
    symbol text NOT NULL,
    company_name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    asset_type text NOT NULL,
    currency text NOT NULL,
    CONSTRAINT instruments_asset_type_check CHECK ((asset_type = ANY (ARRAY['stock'::text, 'crypto'::text, 'fund'::text, 'fx'::text]))),
    CONSTRAINT instruments_currency_check CHECK ((currency = ANY (ARRAY['TRY'::text, 'USD'::text]))),
    CONSTRAINT instruments_market_check CHECK ((market = ANY (ARRAY['BIST100'::text, 'NASDAQ100'::text, 'CRYPTO'::text, 'TEFAS'::text, 'FX'::text])))
);


--
-- Name: kap_member_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kap_member_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    instrument_id uuid NOT NULL,
    mkk_member_oid text NOT NULL,
    kap_company_name text,
    last_verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: portfolio_cash_flows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_cash_flows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    portfolio_id uuid NOT NULL,
    flow_type text NOT NULL,
    amount numeric(30,12) NOT NULL,
    currency text NOT NULL,
    flow_at timestamp with time zone NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portfolio_cash_flows_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT portfolio_cash_flows_currency_check CHECK ((currency = ANY (ARRAY['TRY'::text, 'USD'::text]))),
    CONSTRAINT portfolio_cash_flows_flow_type_check CHECK ((flow_type = ANY (ARRAY['DEPOSIT'::text, 'WITHDRAWAL'::text])))
);


--
-- Name: portfolio_fifo_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_fifo_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    portfolio_id uuid NOT NULL,
    instrument_id uuid NOT NULL,
    buy_transaction_id uuid NOT NULL,
    sell_transaction_id uuid NOT NULL,
    matched_quantity numeric(30,12) NOT NULL,
    buy_unit_price numeric(30,12) NOT NULL,
    sell_unit_price numeric(30,12) NOT NULL,
    cost_basis numeric(30,12) NOT NULL,
    proceeds numeric(30,12) NOT NULL,
    realized_pnl numeric(30,12) NOT NULL,
    currency text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fifo_different_transactions CHECK ((buy_transaction_id <> sell_transaction_id)),
    CONSTRAINT portfolio_fifo_matches_buy_unit_price_check CHECK ((buy_unit_price > (0)::numeric)),
    CONSTRAINT portfolio_fifo_matches_cost_basis_check CHECK ((cost_basis >= (0)::numeric)),
    CONSTRAINT portfolio_fifo_matches_currency_check CHECK ((currency = ANY (ARRAY['TRY'::text, 'USD'::text]))),
    CONSTRAINT portfolio_fifo_matches_matched_quantity_check CHECK ((matched_quantity > (0)::numeric)),
    CONSTRAINT portfolio_fifo_matches_proceeds_check CHECK ((proceeds >= (0)::numeric)),
    CONSTRAINT portfolio_fifo_matches_sell_unit_price_check CHECK ((sell_unit_price > (0)::numeric))
);


--
-- Name: portfolio_instruments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_instruments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    portfolio_id uuid NOT NULL,
    instrument_id uuid NOT NULL,
    is_visible boolean DEFAULT true NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portfolio_instruments_display_order_check CHECK ((display_order >= 0))
);


--
-- Name: portfolio_snapshot_positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_snapshot_positions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid NOT NULL,
    instrument_id uuid NOT NULL,
    quantity numeric(30,12) NOT NULL,
    price numeric(30,12) NOT NULL,
    price_currency text NOT NULL,
    price_at timestamp with time zone NOT NULL,
    provider_code text NOT NULL,
    fx_rate numeric(30,12) NOT NULL,
    fx_rate_at timestamp with time zone,
    market_value_base numeric(30,12) NOT NULL,
    cost_basis_base numeric(30,12) NOT NULL,
    unrealized_pnl_base numeric(30,12) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portfolio_snapshot_positions_cost_basis_base_check CHECK ((cost_basis_base >= (0)::numeric)),
    CONSTRAINT portfolio_snapshot_positions_fx_rate_check CHECK ((fx_rate > (0)::numeric)),
    CONSTRAINT portfolio_snapshot_positions_market_value_base_check CHECK ((market_value_base >= (0)::numeric)),
    CONSTRAINT portfolio_snapshot_positions_price_check CHECK ((price > (0)::numeric)),
    CONSTRAINT portfolio_snapshot_positions_price_currency_check CHECK ((price_currency = ANY (ARRAY['TRY'::text, 'USD'::text]))),
    CONSTRAINT portfolio_snapshot_positions_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: portfolio_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    portfolio_id uuid NOT NULL,
    snapshot_date date NOT NULL,
    base_currency text NOT NULL,
    cash_value_base numeric(30,12) NOT NULL,
    holdings_value_base numeric(30,12) NOT NULL,
    total_value_base numeric(30,12) NOT NULL,
    total_cost_base numeric(30,12) NOT NULL,
    realized_pnl_base numeric(30,12) NOT NULL,
    unrealized_pnl_base numeric(30,12) NOT NULL,
    external_cash_flow_base numeric(30,12) NOT NULL,
    net_contributions_base numeric(30,12) NOT NULL,
    absolute_pnl_base numeric(30,12) NOT NULL,
    daily_return numeric(24,12),
    cumulative_twr numeric(24,12),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portfolio_snapshots_base_currency_check CHECK ((base_currency = ANY (ARRAY['TRY'::text, 'USD'::text])))
);


--
-- Name: portfolio_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    portfolio_id uuid NOT NULL,
    instrument_id uuid NOT NULL,
    transaction_type text NOT NULL,
    quantity numeric(30,12) NOT NULL,
    unit_price numeric(30,12) NOT NULL,
    transaction_currency text NOT NULL,
    transaction_at timestamp with time zone NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portfolio_transactions_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT portfolio_transactions_transaction_currency_check CHECK ((transaction_currency = ANY (ARRAY['TRY'::text, 'USD'::text]))),
    CONSTRAINT portfolio_transactions_transaction_type_check CHECK ((transaction_type = ANY (ARRAY['BUY'::text, 'SELL'::text]))),
    CONSTRAINT portfolio_transactions_unit_price_check CHECK ((unit_price > (0)::numeric))
);


--
-- Name: portfolios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    base_currency text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT portfolios_base_currency_check CHECK ((base_currency = ANY (ARRAY['TRY'::text, 'USD'::text]))),
    CONSTRAINT portfolios_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0))
);


--
-- Name: provider_run_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_run_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    refresh_run_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    scope text NOT NULL,
    status text NOT NULL,
    structure_validated boolean,
    observed_count integer DEFAULT 0 NOT NULL,
    candidate_count integer DEFAULT 0 NOT NULL,
    fresh_event_count integer DEFAULT 0 NOT NULL,
    carried_forward_count integer DEFAULT 0 NOT NULL,
    malformed_count integer DEFAULT 0 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT provider_run_results_candidate_count_check CHECK ((candidate_count >= 0)),
    CONSTRAINT provider_run_results_carried_forward_count_check CHECK ((carried_forward_count >= 0)),
    CONSTRAINT provider_run_results_fresh_event_count_check CHECK ((fresh_event_count >= 0)),
    CONSTRAINT provider_run_results_malformed_count_check CHECK ((malformed_count >= 0)),
    CONSTRAINT provider_run_results_observed_count_check CHECK ((observed_count >= 0)),
    CONSTRAINT provider_run_results_retry_count_check CHECK ((retry_count >= 0)),
    CONSTRAINT provider_run_results_scope_check CHECK ((scope = ANY (ARRAY['BIST100'::text, 'NASDAQ100'::text, 'ECONOMIC'::text]))),
    CONSTRAINT provider_run_results_status_check CHECK ((status = ANY (ARRAY['success'::text, 'partial'::text, 'failed'::text])))
);


--
-- Name: refresh_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_name text NOT NULL,
    trigger_type text DEFAULT 'scheduled'::text NOT NULL,
    target_year integer,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    coverage_start date,
    coverage_end date,
    status text NOT NULL,
    cache_action text,
    fresh_event_count integer DEFAULT 0 NOT NULL,
    final_event_count integer DEFAULT 0 NOT NULL,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    error text,
    github_run_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT refresh_runs_check CHECK (((coverage_start IS NULL) OR (coverage_end IS NULL) OR (coverage_start <= coverage_end))),
    CONSTRAINT refresh_runs_check1 CHECK (((finished_at IS NULL) OR (finished_at >= started_at))),
    CONSTRAINT refresh_runs_final_event_count_check CHECK ((final_event_count >= 0)),
    CONSTRAINT refresh_runs_fresh_event_count_check CHECK ((fresh_event_count >= 0)),
    CONSTRAINT refresh_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'success'::text, 'partial'::text, 'failed'::text]))),
    CONSTRAINT refresh_runs_trigger_type_check CHECK ((trigger_type = ANY (ARRAY['scheduled'::text, 'manual'::text, 'backfill'::text])))
);


--
-- Name: data_providers data_providers_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_providers
    ADD CONSTRAINT data_providers_code_key UNIQUE (code);


--
-- Name: data_providers data_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_providers
    ADD CONSTRAINT data_providers_pkey PRIMARY KEY (id);


--
-- Name: earnings_events earnings_events_market_identity_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_events
    ADD CONSTRAINT earnings_events_market_identity_key_key UNIQUE (market, identity_key);


--
-- Name: earnings_events earnings_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_events
    ADD CONSTRAINT earnings_events_pkey PRIMARY KEY (id);


--
-- Name: economic_events economic_events_identity_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_events
    ADD CONSTRAINT economic_events_identity_key_key UNIQUE (identity_key);


--
-- Name: economic_events economic_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_events
    ADD CONSTRAINT economic_events_pkey PRIMARY KEY (id);


--
-- Name: email_deliveries email_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_pkey PRIMARY KEY (id);


--
-- Name: email_deliveries email_deliveries_refresh_run_id_email_type_attempt_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_refresh_run_id_email_type_attempt_number_key UNIQUE (refresh_run_id, email_type, attempt_number);


--
-- Name: instrument_latest_prices instrument_latest_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instrument_latest_prices
    ADD CONSTRAINT instrument_latest_prices_pkey PRIMARY KEY (instrument_id);


--
-- Name: instruments instruments_market_symbol_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instruments
    ADD CONSTRAINT instruments_market_symbol_key UNIQUE (market, symbol);


--
-- Name: instruments instruments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instruments
    ADD CONSTRAINT instruments_pkey PRIMARY KEY (id);


--
-- Name: kap_member_mappings kap_member_mappings_instrument_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kap_member_mappings
    ADD CONSTRAINT kap_member_mappings_instrument_id_key UNIQUE (instrument_id);


--
-- Name: kap_member_mappings kap_member_mappings_mkk_member_oid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kap_member_mappings
    ADD CONSTRAINT kap_member_mappings_mkk_member_oid_key UNIQUE (mkk_member_oid);


--
-- Name: kap_member_mappings kap_member_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kap_member_mappings
    ADD CONSTRAINT kap_member_mappings_pkey PRIMARY KEY (id);


--
-- Name: portfolio_cash_flows portfolio_cash_flows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_cash_flows
    ADD CONSTRAINT portfolio_cash_flows_pkey PRIMARY KEY (id);


--
-- Name: portfolio_fifo_matches portfolio_fifo_match_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_fifo_matches
    ADD CONSTRAINT portfolio_fifo_match_unique UNIQUE (sell_transaction_id, buy_transaction_id);


--
-- Name: portfolio_fifo_matches portfolio_fifo_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_fifo_matches
    ADD CONSTRAINT portfolio_fifo_matches_pkey PRIMARY KEY (id);


--
-- Name: portfolio_instruments portfolio_instruments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_instruments
    ADD CONSTRAINT portfolio_instruments_pkey PRIMARY KEY (id);


--
-- Name: portfolio_instruments portfolio_instruments_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_instruments
    ADD CONSTRAINT portfolio_instruments_unique UNIQUE (portfolio_id, instrument_id);


--
-- Name: portfolio_snapshot_positions portfolio_snapshot_position_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_snapshot_positions
    ADD CONSTRAINT portfolio_snapshot_position_unique UNIQUE (snapshot_id, instrument_id);


--
-- Name: portfolio_snapshot_positions portfolio_snapshot_positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_snapshot_positions
    ADD CONSTRAINT portfolio_snapshot_positions_pkey PRIMARY KEY (id);


--
-- Name: portfolio_snapshots portfolio_snapshot_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_snapshots
    ADD CONSTRAINT portfolio_snapshot_unique UNIQUE (portfolio_id, snapshot_date);


--
-- Name: portfolio_snapshots portfolio_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_snapshots
    ADD CONSTRAINT portfolio_snapshots_pkey PRIMARY KEY (id);


--
-- Name: portfolio_transactions portfolio_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_transactions
    ADD CONSTRAINT portfolio_transactions_pkey PRIMARY KEY (id);


--
-- Name: portfolio_transactions portfolio_transactions_scope_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_transactions
    ADD CONSTRAINT portfolio_transactions_scope_unique UNIQUE (id, portfolio_id, instrument_id);


--
-- Name: portfolios portfolios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolios
    ADD CONSTRAINT portfolios_pkey PRIMARY KEY (id);


--
-- Name: provider_run_results provider_run_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_run_results
    ADD CONSTRAINT provider_run_results_pkey PRIMARY KEY (id);


--
-- Name: provider_run_results provider_run_results_refresh_run_id_provider_id_scope_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_run_results
    ADD CONSTRAINT provider_run_results_refresh_run_id_provider_id_scope_key UNIQUE (refresh_run_id, provider_id, scope);


--
-- Name: refresh_runs refresh_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_runs
    ADD CONSTRAINT refresh_runs_pkey PRIMARY KEY (id);


--
-- Name: idx_earnings_events_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_earnings_events_active ON public.earnings_events USING btree (market, is_active, earnings_date);


--
-- Name: idx_earnings_events_instrument; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_earnings_events_instrument ON public.earnings_events USING btree (instrument_id, earnings_date DESC);


--
-- Name: idx_earnings_events_market_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_earnings_events_market_date ON public.earnings_events USING btree (market, earnings_date);


--
-- Name: idx_economic_events_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_economic_events_country ON public.economic_events USING btree (country, scheduled_at);


--
-- Name: idx_economic_events_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_economic_events_date ON public.economic_events USING btree (scheduled_at);


--
-- Name: idx_economic_events_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_economic_events_provider ON public.economic_events USING btree (provider_id, scheduled_at);


--
-- Name: idx_email_deliveries_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_deliveries_run ON public.email_deliveries USING btree (refresh_run_id);


--
-- Name: idx_email_deliveries_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_deliveries_status ON public.email_deliveries USING btree (status, created_at DESC);


--
-- Name: idx_instruments_market_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instruments_market_active ON public.instruments USING btree (market, is_active);


--
-- Name: idx_provider_results_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_results_provider ON public.provider_run_results USING btree (provider_id, created_at DESC);


--
-- Name: idx_provider_results_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_results_run ON public.provider_run_results USING btree (refresh_run_id);


--
-- Name: idx_refresh_runs_job_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_runs_job_started ON public.refresh_runs USING btree (job_name, started_at DESC);


--
-- Name: idx_refresh_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_runs_status ON public.refresh_runs USING btree (status, started_at DESC);


--
-- Name: instrument_latest_prices_price_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX instrument_latest_prices_price_at_idx ON public.instrument_latest_prices USING btree (price_at DESC);


--
-- Name: instrument_latest_prices_stale_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX instrument_latest_prices_stale_idx ON public.instrument_latest_prices USING btree (is_stale) WHERE (is_stale = true);


--
-- Name: portfolio_cash_flows_portfolio_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portfolio_cash_flows_portfolio_date_idx ON public.portfolio_cash_flows USING btree (portfolio_id, flow_at, created_at);


--
-- Name: portfolio_fifo_matches_buy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portfolio_fifo_matches_buy_idx ON public.portfolio_fifo_matches USING btree (buy_transaction_id);


--
-- Name: portfolio_fifo_matches_instrument_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portfolio_fifo_matches_instrument_idx ON public.portfolio_fifo_matches USING btree (portfolio_id, instrument_id);


--
-- Name: portfolio_fifo_matches_portfolio_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portfolio_fifo_matches_portfolio_idx ON public.portfolio_fifo_matches USING btree (portfolio_id);


--
-- Name: portfolio_instruments_instrument_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portfolio_instruments_instrument_id_idx ON public.portfolio_instruments USING btree (instrument_id);


--
-- Name: portfolio_snapshot_positions_instrument_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portfolio_snapshot_positions_instrument_idx ON public.portfolio_snapshot_positions USING btree (instrument_id);


--
-- Name: portfolio_snapshots_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portfolio_snapshots_date_idx ON public.portfolio_snapshots USING btree (portfolio_id, snapshot_date DESC);


--
-- Name: portfolio_transactions_fifo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portfolio_transactions_fifo_idx ON public.portfolio_transactions USING btree (portfolio_id, instrument_id, transaction_at, created_at);


--
-- Name: portfolio_transactions_portfolio_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portfolio_transactions_portfolio_date_idx ON public.portfolio_transactions USING btree (portfolio_id, transaction_at, created_at);


--
-- Name: portfolios_one_default_per_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX portfolios_one_default_per_user_idx ON public.portfolios USING btree (user_id) WHERE ((is_default = true) AND (archived_at IS NULL));


--
-- Name: portfolios_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portfolios_user_id_idx ON public.portfolios USING btree (user_id);


--
-- Name: data_providers data_providers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER data_providers_updated_at BEFORE UPDATE ON public.data_providers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: earnings_events earnings_events_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER earnings_events_updated_at BEFORE UPDATE ON public.earnings_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: economic_events economic_events_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER economic_events_updated_at BEFORE UPDATE ON public.economic_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: instrument_latest_prices instrument_latest_prices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER instrument_latest_prices_updated_at BEFORE UPDATE ON public.instrument_latest_prices FOR EACH ROW EXECUTE FUNCTION public.set_portfolio_updated_at();


--
-- Name: instruments instruments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER instruments_updated_at BEFORE UPDATE ON public.instruments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: kap_member_mappings kap_member_mappings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER kap_member_mappings_updated_at BEFORE UPDATE ON public.kap_member_mappings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: portfolio_cash_flows portfolio_cash_flows_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portfolio_cash_flows_updated_at BEFORE UPDATE ON public.portfolio_cash_flows FOR EACH ROW EXECUTE FUNCTION public.set_portfolio_updated_at();


--
-- Name: portfolio_transactions portfolio_transactions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portfolio_transactions_updated_at BEFORE UPDATE ON public.portfolio_transactions FOR EACH ROW EXECUTE FUNCTION public.set_portfolio_updated_at();


--
-- Name: portfolios portfolios_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portfolios_updated_at BEFORE UPDATE ON public.portfolios FOR EACH ROW EXECUTE FUNCTION public.set_portfolio_updated_at();


--
-- Name: earnings_events earnings_events_instrument_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_events
    ADD CONSTRAINT earnings_events_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(id) ON DELETE RESTRICT;


--
-- Name: earnings_events earnings_events_last_refresh_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_events
    ADD CONSTRAINT earnings_events_last_refresh_run_id_fkey FOREIGN KEY (last_refresh_run_id) REFERENCES public.refresh_runs(id) ON DELETE SET NULL;


--
-- Name: earnings_events earnings_events_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_events
    ADD CONSTRAINT earnings_events_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.data_providers(id) ON DELETE RESTRICT;


--
-- Name: economic_events economic_events_last_refresh_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_events
    ADD CONSTRAINT economic_events_last_refresh_run_id_fkey FOREIGN KEY (last_refresh_run_id) REFERENCES public.refresh_runs(id) ON DELETE SET NULL;


--
-- Name: economic_events economic_events_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.economic_events
    ADD CONSTRAINT economic_events_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.data_providers(id) ON DELETE RESTRICT;


--
-- Name: email_deliveries email_deliveries_refresh_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_refresh_run_id_fkey FOREIGN KEY (refresh_run_id) REFERENCES public.refresh_runs(id) ON DELETE SET NULL;


--
-- Name: portfolio_fifo_matches fifo_buy_same_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_fifo_matches
    ADD CONSTRAINT fifo_buy_same_scope_fk FOREIGN KEY (buy_transaction_id, portfolio_id, instrument_id) REFERENCES public.portfolio_transactions(id, portfolio_id, instrument_id) ON DELETE CASCADE;


--
-- Name: portfolio_fifo_matches fifo_sell_same_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_fifo_matches
    ADD CONSTRAINT fifo_sell_same_scope_fk FOREIGN KEY (sell_transaction_id, portfolio_id, instrument_id) REFERENCES public.portfolio_transactions(id, portfolio_id, instrument_id) ON DELETE CASCADE;


--
-- Name: instrument_latest_prices instrument_latest_prices_instrument_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instrument_latest_prices
    ADD CONSTRAINT instrument_latest_prices_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(id) ON DELETE CASCADE;


--
-- Name: kap_member_mappings kap_member_mappings_instrument_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kap_member_mappings
    ADD CONSTRAINT kap_member_mappings_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(id) ON DELETE CASCADE;


--
-- Name: portfolio_cash_flows portfolio_cash_flows_portfolio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_cash_flows
    ADD CONSTRAINT portfolio_cash_flows_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;


--
-- Name: portfolio_instruments portfolio_instruments_instrument_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_instruments
    ADD CONSTRAINT portfolio_instruments_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(id) ON DELETE CASCADE;


--
-- Name: portfolio_instruments portfolio_instruments_portfolio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_instruments
    ADD CONSTRAINT portfolio_instruments_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;


--
-- Name: portfolio_snapshot_positions portfolio_snapshot_positions_instrument_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_snapshot_positions
    ADD CONSTRAINT portfolio_snapshot_positions_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(id) ON DELETE RESTRICT;


--
-- Name: portfolio_snapshot_positions portfolio_snapshot_positions_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_snapshot_positions
    ADD CONSTRAINT portfolio_snapshot_positions_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.portfolio_snapshots(id) ON DELETE CASCADE;


--
-- Name: portfolio_snapshots portfolio_snapshots_portfolio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_snapshots
    ADD CONSTRAINT portfolio_snapshots_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;


--
-- Name: portfolio_transactions portfolio_transactions_instrument_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_transactions
    ADD CONSTRAINT portfolio_transactions_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(id) ON DELETE RESTRICT;


--
-- Name: portfolio_transactions portfolio_transactions_portfolio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_transactions
    ADD CONSTRAINT portfolio_transactions_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;


--
-- Name: portfolios portfolios_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolios
    ADD CONSTRAINT portfolios_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: provider_run_results provider_run_results_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_run_results
    ADD CONSTRAINT provider_run_results_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.data_providers(id) ON DELETE RESTRICT;


--
-- Name: provider_run_results provider_run_results_refresh_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_run_results
    ADD CONSTRAINT provider_run_results_refresh_run_id_fkey FOREIGN KEY (refresh_run_id) REFERENCES public.refresh_runs(id) ON DELETE CASCADE;


--
-- Name: data_providers Allow public read access to data_providers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to data_providers" ON public.data_providers FOR SELECT TO authenticated, anon USING (true);


--
-- Name: earnings_events Allow public read access to earnings_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to earnings_events" ON public.earnings_events FOR SELECT TO authenticated, anon USING (true);


--
-- Name: economic_events Allow public read access to economic_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to economic_events" ON public.economic_events FOR SELECT TO authenticated, anon USING (true);


--
-- Name: email_deliveries Allow public read access to email_deliveries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to email_deliveries" ON public.email_deliveries FOR SELECT TO authenticated, anon USING (true);


--
-- Name: instruments Allow public read access to instruments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to instruments" ON public.instruments FOR SELECT TO authenticated, anon USING (true);


--
-- Name: kap_member_mappings Allow public read access to kap_member_mappings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to kap_member_mappings" ON public.kap_member_mappings FOR SELECT TO authenticated, anon USING (true);


--
-- Name: instrument_latest_prices Allow public read access to latest prices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to latest prices" ON public.instrument_latest_prices FOR SELECT TO authenticated, anon USING (true);


--
-- Name: provider_run_results Allow public read access to provider_run_results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to provider_run_results" ON public.provider_run_results FOR SELECT TO authenticated, anon USING (true);


--
-- Name: refresh_runs Allow public read access to refresh_runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to refresh_runs" ON public.refresh_runs FOR SELECT TO authenticated, anon USING (true);


--
-- Name: portfolio_instruments Users can create own portfolio instruments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own portfolio instruments" ON public.portfolio_instruments FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = portfolio_instruments.portfolio_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: portfolios Users can create own portfolios; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own portfolios" ON public.portfolios FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: portfolio_instruments Users can delete own portfolio instruments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own portfolio instruments" ON public.portfolio_instruments FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = portfolio_instruments.portfolio_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: portfolios Users can delete own portfolios; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own portfolios" ON public.portfolios FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: portfolio_fifo_matches Users can read own fifo matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own fifo matches" ON public.portfolio_fifo_matches FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = portfolio_fifo_matches.portfolio_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: portfolio_cash_flows Users can read own portfolio cash flows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own portfolio cash flows" ON public.portfolio_cash_flows FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = portfolio_cash_flows.portfolio_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: portfolio_instruments Users can read own portfolio instruments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own portfolio instruments" ON public.portfolio_instruments FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = portfolio_instruments.portfolio_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: portfolio_snapshots Users can read own portfolio snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own portfolio snapshots" ON public.portfolio_snapshots FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = portfolio_snapshots.portfolio_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: portfolio_transactions Users can read own portfolio transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own portfolio transactions" ON public.portfolio_transactions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = portfolio_transactions.portfolio_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: portfolios Users can read own portfolios; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own portfolios" ON public.portfolios FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: portfolio_snapshot_positions Users can read own snapshot positions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own snapshot positions" ON public.portfolio_snapshot_positions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.portfolio_snapshots ps
     JOIN public.portfolios p ON ((p.id = ps.portfolio_id)))
  WHERE ((ps.id = portfolio_snapshot_positions.snapshot_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: portfolio_instruments Users can update own portfolio instruments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own portfolio instruments" ON public.portfolio_instruments FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = portfolio_instruments.portfolio_id) AND (p.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.portfolios p
  WHERE ((p.id = portfolio_instruments.portfolio_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: portfolios Users can update own portfolios; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own portfolios" ON public.portfolios FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: data_providers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.data_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: earnings_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.earnings_events ENABLE ROW LEVEL SECURITY;

--
-- Name: economic_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.economic_events ENABLE ROW LEVEL SECURITY;

--
-- Name: email_deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: instrument_latest_prices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.instrument_latest_prices ENABLE ROW LEVEL SECURITY;

--
-- Name: instruments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.instruments ENABLE ROW LEVEL SECURITY;

--
-- Name: kap_member_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kap_member_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: portfolio_cash_flows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portfolio_cash_flows ENABLE ROW LEVEL SECURITY;

--
-- Name: portfolio_fifo_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portfolio_fifo_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: portfolio_instruments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portfolio_instruments ENABLE ROW LEVEL SECURITY;

--
-- Name: portfolio_snapshot_positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portfolio_snapshot_positions ENABLE ROW LEVEL SECURITY;

--
-- Name: portfolio_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portfolio_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: portfolio_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portfolio_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: portfolios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_run_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_run_results ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refresh_runs ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

