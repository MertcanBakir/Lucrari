/**
 * Supabase Database TypeScript Definitions
 * 
 * Mapped from Lucrari PostgreSQL Schema.
 * Includes instruments (BIST100, NASDAQ100, CRYPTO, TEFAS, FX),
 * latest prices, user portfolios, transactions, cash flows, FIFO matches,
 * snapshots, earnings events, and economic calendar.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type MarketType = 'BIST100' | 'NASDAQ100' | 'CRYPTO' | 'TEFAS' | 'FX';
export type ExtendedMarketType = MarketType | 'ALL';
export type AssetType = 'stock' | 'crypto' | 'fund' | 'fx';
export type CurrencyCode = 'TRY' | 'USD';
export type ProviderType = 'earnings' | 'economic' | 'market';
export type TriggerType = 'scheduled' | 'manual' | 'backfill';
export type JobStatus = 'running' | 'success' | 'partial' | 'failed';
export type ProviderScope = 'BIST100' | 'NASDAQ100' | 'ECONOMIC';
export type FiscalPeriod = 'Q1' | 'Q2' | 'Q3' | 'FY';
export type TradingSession = 'pre_market' | 'time_not_supplied' | 'after_hours';
export type CountryCode = 'TR' | 'US';
export type TransactionType = 'BUY' | 'SELL';
export type CashFlowType = 'DEPOSIT' | 'WITHDRAWAL';

export interface Database {
  public: {
    Tables: {
      instruments: {
        Row: {
          id: string;
          market: MarketType;
          symbol: string;
          company_name: string;
          is_active: boolean;
          asset_type: AssetType;
          currency: CurrencyCode;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          market: MarketType;
          symbol: string;
          company_name: string;
          is_active?: boolean;
          asset_type: AssetType;
          currency: CurrencyCode;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          market?: MarketType;
          symbol?: string;
          company_name?: string;
          is_active?: boolean;
          asset_type?: AssetType;
          currency?: CurrencyCode;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      instrument_latest_prices: {
        Row: {
          instrument_id: string;
          price: number;
          currency: CurrencyCode;
          previous_close: number | null;
          change_amount: number | null;
          change_percent: number | null;
          price_at: string;
          fetched_at: string;
          provider_code: string;
          is_stale: boolean;
          stale_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          instrument_id: string;
          price: number;
          currency: CurrencyCode;
          previous_close?: number | null;
          change_amount?: number | null;
          change_percent?: number | null;
          price_at: string;
          fetched_at?: string;
          provider_code: string;
          is_stale?: boolean;
          stale_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          instrument_id?: string;
          price?: number;
          currency?: CurrencyCode;
          previous_close?: number | null;
          change_amount?: number | null;
          change_percent?: number | null;
          price_at?: string;
          fetched_at?: string;
          provider_code?: string;
          is_stale?: boolean;
          stale_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      portfolios: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          base_currency: CurrencyCode;
          is_default: boolean;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          base_currency: CurrencyCode;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          base_currency?: CurrencyCode;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      portfolio_instruments: {
        Row: {
          id: string;
          portfolio_id: string;
          instrument_id: string;
          is_visible: boolean;
          display_order: number;
          added_at: string;
        };
        Insert: {
          id?: string;
          portfolio_id: string;
          instrument_id: string;
          is_visible?: boolean;
          display_order?: number;
          added_at?: string;
        };
        Update: {
          id?: string;
          portfolio_id?: string;
          instrument_id?: string;
          is_visible?: boolean;
          display_order?: number;
          added_at?: string;
        };
        Relationships: [];
      };
      portfolio_transactions: {
        Row: {
          id: string;
          portfolio_id: string;
          instrument_id: string;
          transaction_type: TransactionType;
          quantity: number;
          unit_price: number;
          transaction_currency: CurrencyCode;
          transaction_at: string;
          client_request_id: string;
          notes: string | null;
          is_reversed: boolean;
          reversed_at: string | null;
          reversal_reason: string | null;
          reversal_client_request_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          portfolio_id: string;
          instrument_id: string;
          transaction_type: TransactionType;
          quantity: number;
          unit_price: number;
          transaction_currency: CurrencyCode;
          transaction_at: string;
          client_request_id: string;
          notes?: string | null;
          is_reversed?: boolean;
          reversed_at?: string | null;
          reversal_reason?: string | null;
          reversal_client_request_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          portfolio_id?: string;
          instrument_id?: string;
          transaction_type?: TransactionType;
          quantity?: number;
          unit_price?: number;
          transaction_currency?: CurrencyCode;
          transaction_at?: string;
          client_request_id?: string;
          notes?: string | null;
          is_reversed?: boolean;
          reversed_at?: string | null;
          reversal_reason?: string | null;
          reversal_client_request_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      portfolio_cash_accounts: {
        Row: {
          portfolio_id: string;
          currency: CurrencyCode;
          opening_balance: number;
          initialized_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          portfolio_id: string;
          currency: CurrencyCode;
          opening_balance?: number;
          initialized_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          portfolio_id?: string;
          currency?: CurrencyCode;
          opening_balance?: number;
          initialized_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      portfolio_cash_flows: {
        Row: {
          id: string;
          portfolio_id: string;
          flow_type: CashFlowType;
          amount: number;
          currency: CurrencyCode;
          flow_at: string;
          client_request_id: string;
          notes: string | null;
          is_reversed: boolean;
          reversed_at: string | null;
          reversal_reason: string | null;
          reversal_client_request_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          portfolio_id: string;
          flow_type: CashFlowType;
          amount: number;
          currency: CurrencyCode;
          flow_at: string;
          client_request_id: string;
          notes?: string | null;
          is_reversed?: boolean;
          reversed_at?: string | null;
          reversal_reason?: string | null;
          reversal_client_request_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          portfolio_id?: string;
          flow_type?: CashFlowType;
          amount?: number;
          currency?: CurrencyCode;
          flow_at?: string;
          client_request_id?: string;
          notes?: string | null;
          is_reversed?: boolean;
          reversed_at?: string | null;
          reversal_reason?: string | null;
          reversal_client_request_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      portfolio_fifo_matches: {
        Row: {
          id: string;
          portfolio_id: string;
          instrument_id: string;
          buy_transaction_id: string;
          sell_transaction_id: string;
          matched_quantity: number;
          buy_unit_price: number;
          sell_unit_price: number;
          cost_basis: number;
          proceeds: number;
          realized_pnl: number;
          currency: CurrencyCode;
          created_at: string;
        };
        Insert: {
          id?: string;
          portfolio_id: string;
          instrument_id: string;
          buy_transaction_id: string;
          sell_transaction_id: string;
          matched_quantity: number;
          buy_unit_price: number;
          sell_unit_price: number;
          cost_basis: number;
          proceeds: number;
          realized_pnl: number;
          currency: CurrencyCode;
          created_at?: string;
        };
        Update: {
          id?: string;
          portfolio_id?: string;
          instrument_id?: string;
          buy_transaction_id?: string;
          sell_transaction_id?: string;
          matched_quantity?: number;
          buy_unit_price?: number;
          sell_unit_price?: number;
          cost_basis?: number;
          proceeds?: number;
          realized_pnl?: number;
          currency?: CurrencyCode;
          created_at?: string;
        };
        Relationships: [];
      };
      portfolio_snapshots: {
        Row: {
          id: string;
          portfolio_id: string;
          snapshot_date: string;
          base_currency: CurrencyCode;
          cash_value_base: number;
          holdings_value_base: number;
          total_value_base: number;
          total_cost_base: number;
          realized_pnl_base: number;
          unrealized_pnl_base: number;
          external_cash_flow_base: number;
          net_contributions_base: number;
          absolute_pnl_base: number;
          daily_return: number | null;
          cumulative_twr: number | null;
          valuation_status: 'success' | 'partial';
          warnings: Json;
          calculation_version: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          portfolio_id: string;
          snapshot_date: string;
          base_currency: CurrencyCode;
          cash_value_base: number;
          holdings_value_base: number;
          total_value_base: number;
          total_cost_base: number;
          realized_pnl_base: number;
          unrealized_pnl_base: number;
          external_cash_flow_base: number;
          net_contributions_base: number;
          absolute_pnl_base: number;
          daily_return?: number | null;
          cumulative_twr?: number | null;
          valuation_status?: 'success' | 'partial';
          warnings?: Json;
          calculation_version?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          portfolio_id?: string;
          snapshot_date?: string;
          base_currency?: CurrencyCode;
          cash_value_base?: number;
          holdings_value_base?: number;
          total_value_base?: number;
          total_cost_base?: number;
          realized_pnl_base?: number;
          unrealized_pnl_base?: number;
          external_cash_flow_base?: number;
          net_contributions_base?: number;
          absolute_pnl_base?: number;
          daily_return?: number | null;
          cumulative_twr?: number | null;
          valuation_status?: 'success' | 'partial';
          warnings?: Json;
          calculation_version?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      portfolio_snapshot_positions: {
        Row: {
          id: string;
          snapshot_id: string;
          instrument_id: string;
          quantity: number;
          price: number;
          price_currency: CurrencyCode;
          price_at: string;
          provider_code: string;
          price_is_stale: boolean;
          price_stale_reason: string | null;
          fx_rate: number;
          fx_rate_at: string | null;
          market_value_base: number;
          cost_basis_base: number;
          unrealized_pnl_base: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          snapshot_id: string;
          instrument_id: string;
          quantity: number;
          price: number;
          price_currency: CurrencyCode;
          price_at: string;
          provider_code: string;
          price_is_stale?: boolean;
          price_stale_reason?: string | null;
          fx_rate: number;
          fx_rate_at?: string | null;
          market_value_base: number;
          cost_basis_base: number;
          unrealized_pnl_base: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          snapshot_id?: string;
          instrument_id?: string;
          quantity?: number;
          price?: number;
          price_currency?: CurrencyCode;
          price_at?: string;
          provider_code?: string;
          price_is_stale?: boolean;
          price_stale_reason?: string | null;
          fx_rate?: number;
          fx_rate_at?: string | null;
          market_value_base?: number;
          cost_basis_base?: number;
          unrealized_pnl_base?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      kap_member_mappings: {
        Row: {
          id: string;
          instrument_id: string;
          mkk_member_oid: string;
          kap_company_name: string | null;
          last_verified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          instrument_id: string;
          mkk_member_oid: string;
          kap_company_name?: string | null;
          last_verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          instrument_id?: string;
          mkk_member_oid?: string;
          kap_company_name?: string | null;
          last_verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      data_providers: {
        Row: {
          id: string;
          code: string;
          name: string;
          provider_type: ProviderType;
          official_source: boolean;
          base_url: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          name: string;
          provider_type: ProviderType;
          official_source?: boolean;
          base_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          name?: string;
          provider_type?: ProviderType;
          official_source?: boolean;
          base_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      refresh_runs: {
        Row: {
          id: string;
          job_name: string;
          trigger_type: TriggerType;
          target_year: number | null;
          started_at: string;
          finished_at: string | null;
          coverage_start: string | null;
          coverage_end: string | null;
          status: JobStatus;
          sync_action: string | null;
          fresh_event_count: number;
          final_event_count: number;
          warnings: Json;
          metrics: Json;
          error: string | null;
          github_run_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          job_name: string;
          trigger_type?: TriggerType;
          target_year?: number | null;
          started_at: string;
          finished_at?: string | null;
          coverage_start?: string | null;
          coverage_end?: string | null;
          status: JobStatus;
          sync_action?: string | null;
          fresh_event_count?: number;
          final_event_count?: number;
          warnings?: Json;
          metrics?: Json;
          error?: string | null;
          github_run_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          job_name?: string;
          trigger_type?: TriggerType;
          target_year?: number | null;
          started_at?: string;
          finished_at?: string | null;
          coverage_start?: string | null;
          coverage_end?: string | null;
          status?: JobStatus;
          sync_action?: string | null;
          fresh_event_count?: number;
          final_event_count?: number;
          warnings?: Json;
          metrics?: Json;
          error?: string | null;
          github_run_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      provider_run_results: {
        Row: {
          id: string;
          refresh_run_id: string;
          provider_id: string;
          scope: ProviderScope;
          status: 'success' | 'partial' | 'failed';
          structure_validated: boolean | null;
          observed_count: number;
          candidate_count: number;
          fresh_event_count: number;
          carried_forward_count: number;
          malformed_count: number;
          retry_count: number;
          warnings: Json;
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          refresh_run_id: string;
          provider_id: string;
          scope: ProviderScope;
          status: 'success' | 'partial' | 'failed';
          structure_validated?: boolean | null;
          observed_count?: number;
          candidate_count?: number;
          fresh_event_count?: number;
          carried_forward_count?: number;
          malformed_count?: number;
          retry_count?: number;
          warnings?: Json;
          error?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          refresh_run_id?: string;
          provider_id?: string;
          scope?: ProviderScope;
          status?: 'success' | 'partial' | 'failed';
          structure_validated?: boolean | null;
          observed_count?: number;
          candidate_count?: number;
          fresh_event_count?: number;
          carried_forward_count?: number;
          malformed_count?: number;
          retry_count?: number;
          warnings?: Json;
          error?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      earnings_events: {
        Row: {
          id: string;
          instrument_id: string;
          market: MarketType;
          identity_key: string;
          fiscal_year: number | null;
          fiscal_period: FiscalPeriod | null;
          period_start: string | null;
          period_end: string | null;
          earnings_date: string;
          session: TradingSession | null;
          date_type: string | null;
          provider_id: string | null;
          source_provider: string | null;
          source_event_id: string | null;
          source_url: string | null;
          source_type: string | null;
          publish_date: string | null;
          disclosure_index: number | null;
          is_active: boolean;
          is_stale: boolean;
          carried_forward: boolean;
          first_seen_at: string;
          last_seen_at: string;
          last_changed_at: string | null;
          last_refresh_run_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          instrument_id: string;
          market: MarketType;
          identity_key: string;
          fiscal_year?: number | null;
          fiscal_period?: FiscalPeriod | null;
          period_start?: string | null;
          period_end?: string | null;
          earnings_date: string;
          session?: TradingSession | null;
          date_type?: string | null;
          provider_id?: string | null;
          source_provider?: string | null;
          source_event_id?: string | null;
          source_url?: string | null;
          source_type?: string | null;
          publish_date?: string | null;
          disclosure_index?: number | null;
          is_active?: boolean;
          is_stale?: boolean;
          carried_forward?: boolean;
          first_seen_at?: string;
          last_seen_at?: string;
          last_changed_at?: string | null;
          last_refresh_run_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          instrument_id?: string;
          market?: MarketType;
          identity_key?: string;
          fiscal_year?: number | null;
          fiscal_period?: FiscalPeriod | null;
          period_start?: string | null;
          period_end?: string | null;
          earnings_date?: string;
          session?: TradingSession | null;
          date_type?: string | null;
          provider_id?: string | null;
          source_provider?: string | null;
          source_event_id?: string | null;
          source_url?: string | null;
          source_type?: string | null;
          publish_date?: string | null;
          disclosure_index?: number | null;
          is_active?: boolean;
          is_stale?: boolean;
          carried_forward?: boolean;
          first_seen_at?: string;
          last_seen_at?: string;
          last_changed_at?: string | null;
          last_refresh_run_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      economic_events: {
        Row: {
          id: string;
          identity_key: string;
          provider_id: string;
          event_code: string | null;
          name: string;
          country: CountryCode;
          reference_period: string | null;
          scheduled_at: string;
          source_event_id: string | null;
          source_url: string | null;
          is_active: boolean;
          is_stale: boolean;
          carried_forward: boolean;
          first_seen_at: string;
          last_seen_at: string;
          last_changed_at: string | null;
          last_refresh_run_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          identity_key: string;
          provider_id: string;
          event_code?: string | null;
          name: string;
          country: CountryCode;
          reference_period?: string | null;
          scheduled_at: string;
          source_event_id?: string | null;
          source_url?: string | null;
          is_active?: boolean;
          is_stale?: boolean;
          carried_forward?: boolean;
          first_seen_at?: string;
          last_seen_at?: string;
          last_changed_at?: string | null;
          last_refresh_run_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          identity_key?: string;
          provider_id?: string;
          event_code?: string | null;
          name?: string;
          country?: CountryCode;
          reference_period?: string | null;
          scheduled_at?: string;
          source_event_id?: string | null;
          source_url?: string | null;
          is_active?: boolean;
          is_stale?: boolean;
          carried_forward?: boolean;
          first_seen_at?: string;
          last_changed_at?: string | null;
          last_refresh_run_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_watchlist_items: {
        Row: {
          id: string;
          user_id: string;
          instrument_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          instrument_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          instrument_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      set_updated_at: {
        Args: Record<PropertyKey, never>;
        Returns: unknown;
      };
      get_portfolio_positions: {
        Args: {
          p_portfolio_id: string;
        };
        Returns: {
          instrument_id: string;
          market: MarketType;
          symbol: string;
          company_name: string;
          currency: CurrencyCode;
          is_visible: boolean;
          quantity: number;
          remaining_cost_basis: number;
          average_cost: number | null;
          realized_pnl: number;
          latest_price: number | null;
          change_percent: number | null;
          change_amount: number | null;
          price_at: string | null;
          provider_code: string | null;
          price_is_stale: boolean | null;
          price_stale_reason: string | null;
          market_value: number | null;
          unrealized_pnl: number | null;
        }[];
      };
      get_portfolio_cash_balances: {
        Args: {
          p_portfolio_id: string;
        };
        Returns: {
          currency: CurrencyCode;
          balance: number;
        }[];
      };
      record_portfolio_transaction: {
        Args: {
          p_portfolio_id: string;
          p_instrument_id: string;
          p_transaction_type: TransactionType;
          p_quantity: number;
          p_unit_price: number;
          p_transaction_currency: CurrencyCode;
          p_transaction_at: string;
          p_client_request_id: string;
          p_notes?: string | null;
        };
        Returns: {
          transaction_id: string;
          was_replayed: boolean;
          current_quantity: string;
          remaining_cost_basis: string;
          realized_pnl: string;
          available_cash: string;
        };
      };
      record_cash_flow: {
        Args: {
          p_portfolio_id: string;
          p_flow_type: CashFlowType;
          p_amount: number;
          p_currency: CurrencyCode;
          p_flow_at: string;
          p_client_request_id: string;
          p_notes?: string | null;
        };
        Returns: {
          cash_flow_id: string;
          was_replayed: boolean;
          cash_balance: string;
          currency: CurrencyCode;
        };
      };
      reverse_portfolio_transaction: {
        Args: {
          p_transaction_id: string;
          p_client_request_id: string;
          p_reason: string;
        };
        Returns: {
          transaction_id: string;
          was_replayed: boolean;
          current_quantity: string;
          remaining_cost_basis: string;
          realized_pnl: string;
        };
      };
      reverse_cash_flow: {
        Args: {
          p_cash_flow_id: string;
          p_client_request_id: string;
          p_reason: string;
        };
        Returns: {
          cash_flow_id: string;
          was_replayed: boolean;
          cash_balance: string;
          currency: CurrencyCode;
        };
      };
      initialize_portfolio_cash_accounts: {
        Args: {
          p_portfolio_id: string;
          p_try_opening_balance: number;
          p_usd_opening_balance: number;
          p_client_request_id: string;
        };
        Returns: {
          portfolio_id: string;
          is_initialized: boolean;
          balances: {
            currency: CurrencyCode;
            opening_balance: number;
            current_balance: number;
            initialized_at: string;
          }[];
          was_replayed: boolean;
        };
      };
      get_portfolio_cash_state: {
        Args: {
          p_portfolio_id: string;
        };
        Returns: {
          portfolio_id: string;
          is_initialized: boolean;
          balances: {
            currency: CurrencyCode;
            opening_balance: number | null;
            current_balance: number | null;
            initialized_at: string | null;
          }[];
        };
      };
      reset_my_investments: {
        Args: {
          p_client_request_id: string;
          p_confirmation: string;
        };
        Returns: {
          was_replayed: boolean;
          reset_at: string;
          portfolio_count: number;
          deleted_transaction_count: number;
          deleted_cash_flow_count: number;
          deleted_fifo_match_count: number;
          deleted_instrument_count: number;
          deleted_snapshot_count: number;
          deleted_snapshot_position_count: number;
          deleted_request_key_count: number;
        };
      };
      get_mobile_system_health: {
        Args: Record<string, never>;
        Returns: {
          job_code: string;
          category: string;
          display_name: string;
          sort_order: number;
          execution_status:
            | 'running'
            | 'success'
            | 'partial'
            | 'failed'
            | 'skipped'
            | 'never_run';
          health_status:
            | 'healthy'
            | 'warning'
            | 'critical'
            | 'running'
            | 'inactive'
            | 'unknown';
          last_started_at: string | null;
          last_finished_at: string | null;
          last_success_at: string | null;
          duration_seconds: number | null;
          is_overdue: boolean;
          message_code:
            | 'JOB_OK'
            | 'JOB_PARTIAL'
            | 'JOB_FAILED'
            | 'JOB_OVERDUE'
            | 'JOB_RUNNING'
            | 'JOB_SKIPPED'
            | 'JOB_NEVER_RUN';
          checked_at: string;
        }[];
      };
      get_my_watchlist: {
        Args: {
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          watchlist_id: string;
          instrument_id: string;
          symbol: string;
          company_name: string;
          market: string;
          asset_type: string;
          currency: string;
          is_active: boolean;
          has_price: boolean;
          price: number | null;
          change_amount: number | null;
          change_percent: number | null;
          price_at: string | null;
          price_is_stale: boolean | null;
          stale_reason: string | null;
          added_at: string;
          total_count: number;
        }[];
      };
      set_my_watchlist_item: {
        Args: {
          p_instrument_id: string;
          p_is_watched: boolean;
        };
        Returns: {
          instrument_id: string;
          is_watched: boolean;
          was_changed: boolean;
          watchlist_id: string | null;
        }[];
      };
      get_my_portfolio_activity: {
        Args: {
          p_portfolio_id: string;
          p_limit?: number;
          p_filter?: 'ALL' | 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL';
          p_search?: string | null;
          p_before_occurred_at?: string | null;
          p_before_created_at?: string | null;
          p_before_source_kind?: 'TRANSACTION' | 'CASH_FLOW' | null;
          p_before_activity_id?: string | null;
        };
        Returns: {
          activity_id: string;
          source_kind: 'TRANSACTION' | 'CASH_FLOW';
          activity_type: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL';
          portfolio_id: string;
          instrument_id: string | null;
          symbol: string | null;
          company_name: string | null;
          market: string | null;
          quantity: number | null;
          unit_price: number | null;
          gross_amount: number;
          currency: CurrencyCode;
          occurred_at: string;
          created_at: string;
          notes: string | null;
          is_reversed: boolean;
          reversed_at: string | null;
          reversal_reason: string | null;
          has_more: boolean;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

// Convenient Row Entity Types for application domain
export type Instrument = Database['public']['Tables']['instruments']['Row'];
export type InstrumentLatestPrice = Database['public']['Tables']['instrument_latest_prices']['Row'];
export type Portfolio = Database['public']['Tables']['portfolios']['Row'];
export type PortfolioCashAccount = Database['public']['Tables']['portfolio_cash_accounts']['Row'];
export type PortfolioInstrument = Database['public']['Tables']['portfolio_instruments']['Row'];
export type PortfolioTransaction = Database['public']['Tables']['portfolio_transactions']['Row'];
export type PortfolioCashFlow = Database['public']['Tables']['portfolio_cash_flows']['Row'];
export type PortfolioFifoMatch = Database['public']['Tables']['portfolio_fifo_matches']['Row'];
export type PortfolioSnapshot = Database['public']['Tables']['portfolio_snapshots']['Row'];
export type PortfolioSnapshotPosition = Database['public']['Tables']['portfolio_snapshot_positions']['Row'];
export type KapMemberMapping = Database['public']['Tables']['kap_member_mappings']['Row'];
export type DataProvider = Database['public']['Tables']['data_providers']['Row'];
export type RefreshRun = Database['public']['Tables']['refresh_runs']['Row'];
export type ProviderRunResult = Database['public']['Tables']['provider_run_results']['Row'];
export type EarningsEvent = Database['public']['Tables']['earnings_events']['Row'];
export type EconomicEvent = Database['public']['Tables']['economic_events']['Row'];
export type UserWatchlistItem = Database['public']['Tables']['user_watchlist_items']['Row'];

// RPC Domain Return Types
export type PortfolioPosition = Database['public']['Functions']['get_portfolio_positions']['Returns'][number];
export type PortfolioCashBalance = Database['public']['Functions']['get_portfolio_cash_balances']['Returns'][number];
export type TransactionRecordResult = Database['public']['Functions']['record_portfolio_transaction']['Returns'];
export type CashFlowRecordResult = Database['public']['Functions']['record_cash_flow']['Returns'];
export type ResetInvestmentsResult = Database['public']['Functions']['reset_my_investments']['Returns'];
export type InitializeCashAccountsResult = Database['public']['Functions']['initialize_portfolio_cash_accounts']['Returns'];
export type GetCashStateResult = Database['public']['Functions']['get_portfolio_cash_state']['Returns'];
export type SystemHealthRpcItem = Database['public']['Functions']['get_mobile_system_health']['Returns'][number];
export type WatchlistRpcItem = Database['public']['Functions']['get_my_watchlist']['Returns'][number];
export type SetWatchlistItemRpcResult = Database['public']['Functions']['set_my_watchlist_item']['Returns'][number];
export type PortfolioActivityRpcItem = Database['public']['Functions']['get_my_portfolio_activity']['Returns'][number];

export interface PortfolioCashAccountBalance {
  currency: CurrencyCode;
  openingBalance: number | null;
  currentBalance: number | null;
  initializedAt: string | null;
}

export interface PortfolioCashState {
  portfolioId: string;
  isInitialized: boolean;
  balances: PortfolioCashAccountBalance[];
}

// Generic helper utilities
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
