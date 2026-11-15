/**
 * Lucrari — Supabase Portfolio Service
 * 
 * Provides live, strongly-typed RPC and database operations for portfolio management:
 * - Provisioning / ensuring default user portfolio (with in-flight deduplication & hardened error handling)
 * - Fetching real-time FIFO positions via `get_portfolio_positions` RPC
 * - Fetching cash state & balances via single source of truth `get_portfolio_cash_state` RPC
 * - Idempotent BUY / SELL transactions via `record_portfolio_transaction` RPC
 * - Idempotent DEPOSIT / WITHDRAWAL cash flows via `record_cash_flow` RPC
 * - Reversing transactions and cash flows with audit trail
 * - Atomic reset via `reset_my_investments` RPC
 */

import { getSupabaseClient } from '@/services/supabase/client';
import { createScopedLogger } from '@/utils/logger';
import { generateUUID } from '@/utils/uuid';
import { createPortfolioOperationError, PortfolioOperationError } from '@/utils/portfolio-errors';
import { fetchUsdTryRate, type FxRateInfo } from './fx-rate-service';
import type {
  Portfolio,
  PortfolioPosition,
  PortfolioCashState,
  InitializeCashAccountsResult,
  TransactionRecordResult,
  CashFlowRecordResult,
  ResetInvestmentsResult,
  TransactionType,
  CashFlowType,
  CurrencyCode,
} from '@/types/database';

const log = createScopedLogger('PortfolioService');

type PortfolioChangeListener = () => void;
const portfolioChangeListeners = new Set<PortfolioChangeListener>();

/**
 * Notifies all active portfolio subscribers (hooks, screens) that portfolio data has changed.
 */
export function notifyPortfolioChanged(): void {
  portfolioChangeListeners.forEach((listener) => {
    try {
      listener();
    } catch (err) {
      log.error('PortfolioChangeListener hatası', { error: String(err) });
    }
  });
}

/**
 * Subscribes to portfolio mutations (transactions, cash flows, resets) to trigger automatic reactive updates.
 */
export function subscribePortfolioChanges(listener: PortfolioChangeListener): () => void {
  portfolioChangeListeners.add(listener);
  return () => {
    portfolioChangeListeners.delete(listener);
  };
}

export interface InitializePortfolioCashAccountsParams {
  portfolioId: string;
  tryOpeningBalance: number;
  usdOpeningBalance: number;
  clientRequestId?: string;
}

export interface RecordTransactionParams {
  portfolioId: string;
  instrumentId: string;
  transactionType: TransactionType;
  quantity: number;
  unitPrice: number;
  currency: CurrencyCode;
  transactionAt?: string;
  clientRequestId?: string;
  notes?: string | null;
}

export interface RecordCashFlowParams {
  portfolioId: string;
  flowType: CashFlowType;
  amount: number;
  currency: CurrencyCode;
  flowAt?: string;
  clientRequestId?: string;
  notes?: string | null;
}

export interface ReverseTransactionParams {
  transactionId: string;
  reason: string;
  clientRequestId?: string;
}

export interface ReverseCashFlowParams {
  cashFlowId: string;
  reason: string;
  clientRequestId?: string;
}

export interface ResetInvestmentsParams {
  clientRequestId: string;
}

const inFlightDefaultPortfolio = new Map<string, Promise<Portfolio>>();

/**
 * Ensures an active default portfolio exists for the given user ID.
 * If one exists, returns it immediately; otherwise creates a new "Ana Portföyüm" record.
 * Deduplicates concurrent calls for the same user ID.
 * 
 * Hardened behavior:
 * - If query error occurs, throws immediately without attempting unsafe INSERT.
 * - If concurrent race occurs during INSERT, gracefully re-fetches and returns existing portfolio.
 */
export async function ensureDefaultPortfolio(userId: string): Promise<Portfolio> {
  const existing = inFlightDefaultPortfolio.get(userId);
  if (existing) {
    log.debug('Eşzamanlı default portfolio sorgusu birleştirildi (deduplication)', { userId });
    return existing;
  }

  const promise = (async (): Promise<Portfolio> => {
    const client = getSupabaseClient();

    try {
      // 1. Check for an existing non-archived portfolio
      const { data: existingPort, error: fetchError } = await client
        .from('portfolios')
        .select('*')
        .eq('user_id', userId)
        .is('archived_at', null)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        log.error('Portföy aranırken sorgu hatası alındı', { error: fetchError.message });
        throw createPortfolioOperationError('Portföy bilgisi alınamadı', fetchError);
      }

      if (existingPort) {
        log.debug('Mevcut portföy doğrulandı', { portfolioId: existingPort.id, name: existingPort.name });
        return existingPort;
      }

      // 2. No portfolio exists — provision default portfolio
      log.info('Kullanıcı için yeni varsayılan portföy oluşturuluyor...', { userId });

      const { data: newPortfolio, error: createError } = await client
        .from('portfolios')
        .insert({
          user_id: userId,
          name: 'Ana Portföyüm',
          base_currency: 'TRY',
          is_default: true,
        })
        .select()
        .single();

      if (createError) {
        // In case of concurrent unique constraint race (23505), re-fetch existing default portfolio
        if (createError.code === '23505' || createError.message?.includes('duplicate') || createError.message?.includes('unique')) {
          log.warn('Eşzamanlı oluşturma çakışması tespit edildi, varsayılan portföy yeniden sorgulanıyor...', { userId });
          const { data: reFetched, error: reFetchError } = await client
            .from('portfolios')
            .select('*')
            .eq('user_id', userId)
            .eq('is_default', true)
            .is('archived_at', null)
            .maybeSingle();

          if (reFetchError) {
            log.error('Çakışma sonrası portföy yeniden sorgulanamadı', { error: reFetchError.message });
            throw createPortfolioOperationError('Portföy bilgisi alınamadı', reFetchError);
          }

          if (reFetched) {
            return reFetched;
          }
        }

        const errMsg = createError?.message || 'Varsayılan portföy oluşturulamadı.';
        log.error(errMsg, { error: createError });
        throw createPortfolioOperationError('Varsayılan portföy oluşturulamadı', createError);
      }

      if (!newPortfolio) {
        throw new PortfolioOperationError('Varsayılan portföy oluşturulamadı.');
      }

      log.info('Varsayılan portföy başarıyla oluşturuldu', { portfolioId: newPortfolio.id });
      return newPortfolio;
    } catch (error) {
      if (error instanceof PortfolioOperationError) {
        throw error;
      }
      log.error('Portföy sağlama hatası', { error: String(error) });
      throw createPortfolioOperationError('Portföy bilgisi alınamadı', error);
    }
  })();

  inFlightDefaultPortfolio.set(userId, promise);
  try {
    return await promise;
  } finally {
    if (inFlightDefaultPortfolio.get(userId) === promise) {
      inFlightDefaultPortfolio.delete(userId);
    }
  }
}

/**
 * Fetches all open positions for a portfolio via typed `get_portfolio_positions` RPC.
 */
export async function fetchPortfolioPositions(portfolioId: string): Promise<PortfolioPosition[]> {
  const client = getSupabaseClient();

  try {
    const { data, error } = await client.rpc('get_portfolio_positions', {
      p_portfolio_id: portfolioId,
    });

    if (error) {
      log.error('Pozisyonlar alınamadı', { portfolioId, error: error.message });
      throw createPortfolioOperationError('Pozisyonlar yüklenemedi', error);
    }

    return (data || []) as PortfolioPosition[];
  } catch (error) {
    if (error instanceof PortfolioOperationError) {
      throw error;
    }
    log.error('fetchPortfolioPositions istisnası', { error: String(error) });
    throw createPortfolioOperationError('Pozisyonlar yüklenemedi', error);
  }
}

/**
 * Fetches cash account initialization state and balances for a portfolio via typed `get_portfolio_cash_state` RPC.
 * Single source of truth for cash state and multi-currency balances.
 */
export async function fetchPortfolioCashState(portfolioId: string): Promise<PortfolioCashState> {
  const client = getSupabaseClient();

  try {
    const { data, error } = await client.rpc('get_portfolio_cash_state', {
      p_portfolio_id: portfolioId,
    });

    if (error) {
      log.error('Nakit durumu alınamadı', { portfolioId, error: error.message });
      throw createPortfolioOperationError('Nakit durumu yüklenemedi', error);
    }

    return {
      portfolioId: data?.portfolio_id || portfolioId,
      isInitialized: Boolean(data?.is_initialized),
      balances: Array.isArray(data?.balances)
        ? data.balances.map((b) => ({
            currency: b.currency,
            openingBalance: b.opening_balance != null ? Number(b.opening_balance) : null,
            currentBalance: b.current_balance != null ? Number(b.current_balance) : null,
            initializedAt: b.initialized_at ?? null,
          }))
        : [],
    };
  } catch (error) {
    if (error instanceof PortfolioOperationError) {
      throw error;
    }
    log.error('fetchPortfolioCashState istisnası', { error: String(error) });
    throw createPortfolioOperationError('Nakit durumu yüklenemedi', error);
  }
}

/**
 * Initializes TRY and USD cash accounts for a portfolio with explicit opening balances via typed RPC.
 */
export async function initializePortfolioCashAccounts(
  params: InitializePortfolioCashAccountsParams
): Promise<InitializeCashAccountsResult> {
  const client = getSupabaseClient();
  const clientRequestId = params.clientRequestId || generateUUID();

  try {
    const { data, error } = await client.rpc('initialize_portfolio_cash_accounts', {
      p_portfolio_id: params.portfolioId,
      p_try_opening_balance: params.tryOpeningBalance,
      p_usd_opening_balance: params.usdOpeningBalance,
      p_client_request_id: clientRequestId,
    });

    if (error) {
      log.error('Nakit hesabı başlatılamadı', { params, error: error.message });
      throw createPortfolioOperationError('Nakit hesabı başlatılamadı', error);
    }

    log.info('Nakit hesabı başarıyla başlatıldı', {
      portfolioId: params.portfolioId,
      isInitialized: data?.is_initialized,
      wasReplayed: data?.was_replayed,
    });

    notifyPortfolioChanged();
    return data as InitializeCashAccountsResult;
  } catch (error) {
    if (error instanceof PortfolioOperationError) {
      throw error;
    }
    log.error('initializePortfolioCashAccounts istisnası', { error: String(error) });
    throw createPortfolioOperationError('Nakit hesabı başlatılamadı', error);
  }
}

export interface CombinedPortfolioData {
  positions: PortfolioPosition[];
  cashState: PortfolioCashState;
  fxRateInfo: FxRateInfo;
}

const inFlightPortfolioFetches = new Map<string, Promise<CombinedPortfolioData>>();

/**
 * Fetches positions, cash state, and live USD/TRY FX rate in parallel.
 * Exclusively uses `get_portfolio_cash_state` as the single source of cash truth.
 * Automatically deduplicates concurrent in-flight requests for the same portfolioId.
 */
export async function fetchPortfolioDataCombined(
  portfolioId: string,
  options?: { forceRefresh?: boolean }
): Promise<CombinedPortfolioData> {
  const existing = inFlightPortfolioFetches.get(portfolioId);
  if (existing) {
    log.debug('Eşzamanlı portföy sorgusu birleştirildi (deduplication)', { portfolioId });
    return existing;
  }

  const fetchPromise = (async (): Promise<CombinedPortfolioData> => {
    const [positions, cashState, fxRateInfo] = await Promise.all([
      fetchPortfolioPositions(portfolioId),
      fetchPortfolioCashState(portfolioId),
      fetchUsdTryRate(options),
    ]);
    return { positions, cashState, fxRateInfo };
  })();

  inFlightPortfolioFetches.set(portfolioId, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    if (inFlightPortfolioFetches.get(portfolioId) === fetchPromise) {
      inFlightPortfolioFetches.delete(portfolioId);
    }
  }
}

/**
 * Clears any in-flight portfolio cache map (useful for test isolation).
 */
export function clearInFlightPortfolioFetches(): void {
  inFlightPortfolioFetches.clear();
  inFlightDefaultPortfolio.clear();
}

/**
 * Atomically records an owned portfolio BUY / SELL transaction via typed `record_portfolio_transaction` RPC.
 * Rebuilds FIFO matches and updates position summaries idempotently.
 */
export async function recordTransaction(params: RecordTransactionParams): Promise<TransactionRecordResult> {
  const client = getSupabaseClient();
  const clientRequestId = params.clientRequestId || generateUUID();
  const transactionAt = params.transactionAt || new Date().toISOString();

  try {
    const { data, error } = await client.rpc('record_portfolio_transaction', {
      p_portfolio_id: params.portfolioId,
      p_instrument_id: params.instrumentId,
      p_transaction_type: params.transactionType,
      p_quantity: params.quantity,
      p_unit_price: params.unitPrice,
      p_transaction_currency: params.currency,
      p_transaction_at: transactionAt,
      p_client_request_id: clientRequestId,
      p_notes: params.notes || null,
    });

    if (error) {
      log.error('İşlem kaydedilemedi', { params, error: error.message });
      throw createPortfolioOperationError('İşlem kaydedilemedi', error);
    }

    log.info('İşlem başarıyla kaydedildi', {
      transactionId: data?.transaction_id,
      wasReplayed: data?.was_replayed,
      currentQuantity: data?.current_quantity,
    });

    notifyPortfolioChanged();
    return data as TransactionRecordResult;
  } catch (error) {
    if (error instanceof PortfolioOperationError) {
      throw error;
    }
    log.error('recordTransaction istisnası', { error: String(error) });
    throw createPortfolioOperationError('İşlem kaydedilemedi', error);
  }
}

/**
 * Atomically records a cash flow (DEPOSIT / WITHDRAWAL) via typed `record_cash_flow` RPC.
 */
export async function recordCashFlow(params: RecordCashFlowParams): Promise<CashFlowRecordResult> {
  const client = getSupabaseClient();
  const clientRequestId = params.clientRequestId || generateUUID();
  const flowAt = params.flowAt || new Date().toISOString();

  try {
    const { data, error } = await client.rpc('record_cash_flow', {
      p_portfolio_id: params.portfolioId,
      p_flow_type: params.flowType,
      p_amount: params.amount,
      p_currency: params.currency,
      p_flow_at: flowAt,
      p_client_request_id: clientRequestId,
      p_notes: params.notes || null,
    });

    if (error) {
      log.error('Nakit hareketi kaydedilemedi', { params, error: error.message });
      throw createPortfolioOperationError('Nakit hareketi kaydedilemedi', error);
    }

    log.info('Nakit hareketi kaydedildi', {
      cashFlowId: data?.cash_flow_id,
      balance: data?.cash_balance,
      currency: data?.currency,
    });

    notifyPortfolioChanged();
    return data as CashFlowRecordResult;
  } catch (error) {
    if (error instanceof PortfolioOperationError) {
      throw error;
    }
    log.error('recordCashFlow istisnası', { error: String(error) });
    throw createPortfolioOperationError('Nakit hareketi kaydedilemedi', error);
  }
}

/**
 * Reverses a transaction via typed `reverse_portfolio_transaction` RPC.
 */
export async function reverseTransaction(params: ReverseTransactionParams): Promise<TransactionRecordResult> {
  const client = getSupabaseClient();
  const clientRequestId = params.clientRequestId || generateUUID();

  try {
    const { data, error } = await client.rpc('reverse_portfolio_transaction', {
      p_transaction_id: params.transactionId,
      p_client_request_id: clientRequestId,
      p_reason: params.reason,
    });

    if (error) {
      log.error('İşlem iptal edilemedi', { params, error: error.message });
      throw createPortfolioOperationError('İşlem iptal edilemedi', error);
    }

    notifyPortfolioChanged();
    return data as TransactionRecordResult;
  } catch (error) {
    if (error instanceof PortfolioOperationError) {
      throw error;
    }
    log.error('reverseTransaction istisnası', { error: String(error) });
    throw createPortfolioOperationError('İşlem iptal edilemedi', error);
  }
}

/**
 * Reverses a cash flow via typed `reverse_cash_flow` RPC.
 */
export async function reverseCashFlow(params: ReverseCashFlowParams): Promise<CashFlowRecordResult> {
  const client = getSupabaseClient();
  const clientRequestId = params.clientRequestId || generateUUID();

  try {
    const { data, error } = await client.rpc('reverse_cash_flow', {
      p_cash_flow_id: params.cashFlowId,
      p_client_request_id: clientRequestId,
      p_reason: params.reason,
    });

    if (error) {
      log.error('Nakit akışı iptal edilemedi', { params, error: error.message });
      throw createPortfolioOperationError('Nakit akışı iptal edilemedi', error);
    }

    notifyPortfolioChanged();
    return data as CashFlowRecordResult;
  } catch (error) {
    if (error instanceof PortfolioOperationError) {
      throw error;
    }
    log.error('reverseCashFlow istisnası', { error: String(error) });
    throw createPortfolioOperationError('Nakit akışı iptal edilemedi', error);
  }
}

/**
 * Atomically clears the authenticated user's investment transactions, cash flows,
 * FIFO ledger matches, instrument links, and snapshots via typed `reset_my_investments` RPC.
 * Preserves the user's Supabase auth session, portfolio name, and base currency.
 * 
 * Strict contract:
 * - Requires explicit `clientRequestId`.
 * - Fixed confirmation string 'RESET_ALL_INVESTMENTS'.
 * - Does NOT use unsafe direct table deletion fallback.
 */
export async function resetMyInvestments(params: ResetInvestmentsParams): Promise<ResetInvestmentsResult> {
  if (!params || !params.clientRequestId || typeof params.clientRequestId !== 'string' || params.clientRequestId.trim() === '') {
    throw new PortfolioOperationError('Yatırımları sıfırlamak için geçerli bir clientRequestId zorunludur.');
  }

  const client = getSupabaseClient();
  const clientRequestId = params.clientRequestId;
  const confirmation = 'RESET_ALL_INVESTMENTS';

  try {
    log.info('Kullanıcı yatırımları sıfırlanıyor (reset_my_investments RPC)...', {
      clientRequestId,
    });

    const { data, error } = await client.rpc('reset_my_investments', {
      p_client_request_id: clientRequestId,
      p_confirmation: confirmation,
    });

    if (error) {
      log.error('reset_my_investments RPC hatası', { error: error.message });
      throw createPortfolioOperationError('Yatırımlar sıfırlanamadı', error);
    }

    log.info('Yatırımlar başarıyla sıfırlandı', {
      wasReplayed: data?.was_replayed,
      deletedTransactions: data?.deleted_transaction_count,
      deletedCashFlows: data?.deleted_cash_flow_count,
      deletedSnapshots: data?.deleted_snapshot_count,
    });

    notifyPortfolioChanged();
    return data as ResetInvestmentsResult;
  } catch (error) {
    if (error instanceof PortfolioOperationError) {
      throw error;
    }
    log.error('resetMyInvestments istisnası', { error: String(error) });
    throw createPortfolioOperationError('Yatırımlar sıfırlanamadı', error);
  }
}

/**
 * Archives all active portfolios for the given user ID to cleanly reset portfolio history.
 */
export async function archiveAllUserPortfolios(userId: string): Promise<void> {
  const client = getSupabaseClient();
  try {
    log.info('Kullanıcının portföyleri arşivleniyor...', { userId });
    await client
      .from('portfolios')
      .update({ archived_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('archived_at', null);
    notifyPortfolioChanged();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('Portföyler arşivlenirken uyarı alındı', { error: msg });
  }
}
