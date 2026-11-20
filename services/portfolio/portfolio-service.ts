/** Portfolio operations with moving average cost and optional manual cash. */

import { getSupabaseClient } from '@/services/supabase/client';
import { createScopedLogger } from '@/utils/logger';
import { generateUUID } from '@/utils/uuid';
import { createPortfolioOperationError, PortfolioOperationError } from '@/utils/portfolio-errors';
import { fetchUsdTryRate, type FxRateInfo } from './fx-rate-service';
import type {
  Portfolio,
  PortfolioPosition,
  PortfolioCash,
  PortfolioRealizedPnl,
  TransactionRecordResult,
  ResetInvestmentsResult,
  TransactionType,
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
      log.error('portfolio.listener.failed', {
        message: 'Portfolio listener failed.',
        error: err
      });
    }
  });
}

/** Subscribe to successful portfolio mutations. */
export function subscribePortfolioChanges(listener: PortfolioChangeListener): () => void {
  portfolioChangeListeners.add(listener);
  return () => {
    portfolioChangeListeners.delete(listener);
  };
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


export interface ReverseTransactionParams {
  transactionId: string;
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
    log.debug('portfolio.default.deduplicated', {
      message: 'Portfolio default deduplicated.',
      context: { userId }
    });
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
        log.error('portfolio.default.lookup.failed', {
          message: 'Portfolio default lookup failed.',
          error: fetchError
        });
        throw createPortfolioOperationError('Portföy bilgisi alınamadı', fetchError);
      }

      if (existingPort) {
        log.debug('portfolio.default.found', {
          message: 'Portfolio default found.',
          context: { portfolioId: existingPort.id }
        });
        return existingPort;
      }

      // 2. No portfolio exists — provision default portfolio
      log.info('portfolio.default.creating', {
        message: 'Portfolio default creating.',
        context: { userId }
      });

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
          log.warn('portfolio.default.conflict', {
            message: 'Portfolio default conflict.',
            context: { userId }
          });
          const { data: reFetched, error: reFetchError } = await client
            .from('portfolios')
            .select('*')
            .eq('user_id', userId)
            .eq('is_default', true)
            .is('archived_at', null)
            .maybeSingle();

          if (reFetchError) {
            log.error('portfolio.default.refetch.failed', {
              message: 'Portfolio default refetch failed.',
              error: reFetchError
            });
            throw createPortfolioOperationError('Portföy bilgisi alınamadı', reFetchError);
          }

          if (reFetched) {
            return reFetched;
          }
        }

        log.error('portfolio.default.create.failed', {
          message: 'Portfolio default create failed.',
          error: createError
        });
        throw createPortfolioOperationError('Varsayılan portföy oluşturulamadı', createError);
      }

      if (!newPortfolio) {
        throw new PortfolioOperationError('Varsayılan portföy oluşturulamadı.');
      }

      log.info('portfolio.default.created', {
        message: 'Portfolio default created.',
        context: { portfolioId: newPortfolio.id }
      });
      return newPortfolio;
    } catch (error) {
      if (error instanceof PortfolioOperationError) {
        throw error;
      }
      log.error('portfolio.default.failed', {
        message: 'Portfolio default failed.',
        error: error
      });
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
      log.error('portfolio.positions.rpc.failed', {
        message: 'Portfolio positions rpc failed.',
        context: { portfolioId },
        error: error
      });
      throw createPortfolioOperationError('Pozisyonlar yüklenemedi', error);
    }

    return (data || []) as PortfolioPosition[];
  } catch (error) {
    if (error instanceof PortfolioOperationError) {
      throw error;
    }
    log.error('portfolio.positions.failed', {
      message: 'Portfolio positions failed.',
      error: error
    });
    throw createPortfolioOperationError('Pozisyonlar yüklenemedi', error);
  }
}

/** Reject malformed financial responses instead of converting missing values to zero. */
function readAmount(value: unknown, nonNegative = false): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') {
    throw createPortfolioOperationError('Geçersiz finansal tutar alındı.');
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || (nonNegative && amount < 0)) {
    throw createPortfolioOperationError('Geçersiz finansal tutar alındı.');
  }
  return amount;
}

/** Reads optional manually maintained cash; missing accounts mean no cash entered. */
export async function fetchPortfolioCash(portfolioId: string): Promise<PortfolioCash> {
 const { data, error } = await getSupabaseClient().rpc('get_portfolio_cash', { p_portfolio_id: portfolioId });
 if (error) throw createPortfolioOperationError('Nakit tutarı yüklenemedi', error);
 return { tryBalance: readAmount(data?.try_balance, true), usdBalance: readAmount(data?.usd_balance, true) };
}

export async function setPortfolioCash(params: PortfolioCash & { portfolioId: string }): Promise<void> {
 const { error } = await getSupabaseClient().rpc('set_portfolio_cash', {
  p_portfolio_id: params.portfolioId, p_try_balance: params.tryBalance, p_usd_balance: params.usdBalance,
 });
 if (error) throw createPortfolioOperationError('Nakit tutarı kaydedilemedi', error);
 notifyPortfolioChanged();
}

export async function fetchRealizedPnl(portfolioId: string): Promise<PortfolioRealizedPnl> {
 const { data, error } = await getSupabaseClient().rpc('get_portfolio_realized_pnl', { p_portfolio_id: portfolioId });
 if (error) throw createPortfolioOperationError('Satış kârı yüklenemedi', error);
 return { tryPnl: readAmount(data?.try_pnl), usdPnl: readAmount(data?.usd_pnl) };
}

export interface CombinedPortfolioData {
  positions: PortfolioPosition[];
  cash: PortfolioCash;
  realizedPnl: PortfolioRealizedPnl;
  fxRateInfo: FxRateInfo;
}

const inFlightPortfolioFetches = new Map<string, Promise<CombinedPortfolioData>>();

/** Fetch holdings, manual cash, realized sale profit and FX concurrently. */
export async function fetchPortfolioDataCombined(
  portfolioId: string,
  options?: { forceRefresh?: boolean }
): Promise<CombinedPortfolioData> {
  const existing = inFlightPortfolioFetches.get(portfolioId);
  if (existing) {
    log.debug('portfolio.request.deduplicated', {
      message: 'Portfolio request deduplicated.',
      context: { portfolioId }
    });
    return existing;
  }

  const fetchPromise = (async (): Promise<CombinedPortfolioData> => {
    const [positions, cash, fxRateInfo, realizedPnl] = await Promise.all([
      fetchPortfolioPositions(portfolioId),
      fetchPortfolioCash(portfolioId),
      fetchUsdTryRate(options),
      fetchRealizedPnl(portfolioId),
    ]);
    return { positions, cash, fxRateInfo, realizedPnl };
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

/** Record a trade; the server validates the complete dated position history. */
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
      log.error('portfolio.transaction.rpc.failed', {
        message: 'Portfolio transaction rpc failed.',
        error: error
      });
      throw createPortfolioOperationError('İşlem kaydedilemedi', error);
    }

    log.info('portfolio.transaction.created', {
      message: 'Portfolio transaction created.',
      context: { transactionId: data?.transaction_id, wasReplayed: data?.was_replayed, currentQuantity: data?.current_quantity }
    });

    notifyPortfolioChanged();
    return data as TransactionRecordResult;
  } catch (error) {
    if (error instanceof PortfolioOperationError) {
      throw error;
    }
    log.error('portfolio.transaction.failed', {
      message: 'Portfolio transaction failed.',
      error: error
    });
    throw createPortfolioOperationError('İşlem kaydedilemedi', error);
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
      log.error('portfolio.transaction.reverse.rpc.failed', {
        message: 'Portfolio transaction reverse rpc failed.',
        error: error
      });
      throw createPortfolioOperationError('İşlem iptal edilemedi', error);
    }

    notifyPortfolioChanged();
    return data as TransactionRecordResult;
  } catch (error) {
    if (error instanceof PortfolioOperationError) {
      throw error;
    }
    log.error('portfolio.transaction.reverse.failed', {
      message: 'Portfolio transaction reverse failed.',
      error: error
    });
    throw createPortfolioOperationError('İşlem iptal edilemedi', error);
  }
}

/** Reset investment records without changing the authenticated account. */
export async function resetMyInvestments(params: ResetInvestmentsParams): Promise<ResetInvestmentsResult> {
  if (!params || !params.clientRequestId || typeof params.clientRequestId !== 'string' || params.clientRequestId.trim() === '') {
    throw new PortfolioOperationError('Yatırımları sıfırlamak için geçerli bir clientRequestId zorunludur.');
  }

  const client = getSupabaseClient();
  const clientRequestId = params.clientRequestId;
  const confirmation = 'RESET_ALL_INVESTMENTS';

  try {
    log.info('portfolio.reset.started', {
      message: 'Portfolio reset started.',
      context: { clientRequestId }
    });

    const { data, error } = await client.rpc('reset_my_investments', {
      p_client_request_id: clientRequestId,
      p_confirmation: confirmation,
    });

    if (error) {
      log.error('portfolio.reset.rpc.failed', {
        message: 'Portfolio reset rpc failed.',
        error: error
      });
      throw createPortfolioOperationError('Yatırımlar sıfırlanamadı', error);
    }

    log.info('portfolio.reset.completed', {
      message: 'Portfolio reset completed.',
      context: { wasReplayed: data?.was_replayed, deletedTransactions: data?.deleted_transaction_count, deletedSnapshots: data?.deleted_snapshot_count }
    });

    notifyPortfolioChanged();
    return data as ResetInvestmentsResult;
  } catch (error) {
    if (error instanceof PortfolioOperationError) {
      throw error;
    }
    log.error('portfolio.reset.failed', {
      message: 'Portfolio reset failed.',
      error: error
    });
    throw createPortfolioOperationError('Yatırımlar sıfırlanamadı', error);
  }
}
