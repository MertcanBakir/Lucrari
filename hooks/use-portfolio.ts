/**
 * Lucrari — usePortfolio Custom Hook
 * 
 * Manages live Supabase portfolio state:
 * - Anonymous Auth & default portfolio initialization (with in-flight deduplication)
 * - In-flight deduplicated parallel fetching of positions, single source-of-truth cash state & live USD/TRY FX rate
 * - Out-of-order race condition prevention via request sequence counters
 * - Loading, Refreshing, Stale-Data, Empty, and Error state separation
 * - Pure aggregate financial calculations (Total Portfolio Value = Positions + Cash)
 * - Unified single mutation invalidation strategy via `subscribePortfolioChanges`
 * - Direct mutation methods (`initializeCashAccounts`, `addTransaction`, `addCashFlow`, `reverseTransaction`, `resetInvestments`)
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/context/auth-context';
import { ensureAnonymousSession } from '@/services/auth/auth-service';
import {
  ensureDefaultPortfolio,
  fetchPortfolioDataCombined,
  initializePortfolioCashAccounts,
  recordTransaction,
  recordCashFlow,
  reverseTransaction,
  reverseCashFlow,
  resetMyInvestments,
  subscribePortfolioChanges,
  type RecordTransactionParams,
  type RecordCashFlowParams,
  type ReverseTransactionParams,
  type ReverseCashFlowParams,
  type ResetInvestmentsParams,
} from '@/services/portfolio/portfolio-service';
import { type FxRateInfo } from '@/services/portfolio/fx-rate-service';
import {
  calculatePortfolioStats,
  calculateAllocationItems,
  type PortfolioStats,
  type AllocationItem,
  type AllocationKey,
} from '@/utils/financial-math';
import { formatPortfolioRpcError } from '@/utils/portfolio-errors';
import { createScopedLogger } from '@/utils/logger';
import type {
  Portfolio,
  PortfolioPosition,
  PortfolioCashState,
  InitializeCashAccountsResult,
  TransactionRecordResult,
  CashFlowRecordResult,
  ResetInvestmentsResult,
} from '@/types/database';

const log = createScopedLogger('usePortfolio');

export type { AllocationItem, AllocationKey, PortfolioStats };

/**
 * Transforms technical Supabase/network error messages into user-friendly Turkish text.
 */
function sanitizePortfolioErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('fetch failed') || msg.includes('Network') || msg.includes('timeout')) {
    return 'İnternet bağlantısı kurulamadı. Lütfen ağınızı kontrol edip tekrar deneyiniz.';
  }
  if (msg.includes('JWT') || msg.includes('auth') || msg.includes('oturum') || msg.includes('session')) {
    return 'Kullanıcı oturumu doğrulanamadı. Lütfen tekrar deneyiniz.';
  }
  return formatPortfolioRpcError(error);
}

export function usePortfolio() {
  const { user } = useAuth();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [cashState, setCashState] = useState<PortfolioCashState | null>(null);
  const [fxRateInfo, setFxRateInfo] = useState<FxRateInfo | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Request sequence counter and mount flag to prevent race conditions & unmount state updates
  const requestIdRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const lastFetchedTimestampRef = useRef<number>(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Loads portfolio, positions, cash state, and live FX rate from Supabase with in-flight deduplication.
   */
  const loadPortfolioData = useCallback(async (isRefresh = false, forceRefresh = false) => {
    const currentRequestId = ++requestIdRef.current;

    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      // 1. Ensure user is authenticated (anonymous session)
      const authResult = await ensureAnonymousSession();
      if (!authResult.user) {
        throw new Error(authResult.error || 'Kullanıcı oturumu doğrulanamadı.');
      }

      // 2. Ensure default portfolio exists
      const userPortfolio = await ensureDefaultPortfolio(authResult.user.id);

      if (!isMountedRef.current || currentRequestId !== requestIdRef.current) return;
      setPortfolio(userPortfolio);

      // 3. Fetch positions, cash state, and live FX rate via deduplicated in-flight fetcher
      const combined = await fetchPortfolioDataCombined(userPortfolio.id, { forceRefresh });

      if (!isMountedRef.current || currentRequestId !== requestIdRef.current) return;

      setPositions(combined.positions);
      setCashState(combined.cashState);
      setFxRateInfo(combined.fxRateInfo);

      const hasStaleMarketData =
        Boolean(combined.fxRateInfo?.isStale) ||
        combined.positions.some((position) => Boolean(position.price_is_stale));

      setIsStale(hasStaleMarketData);
      setError(null);
      lastFetchedTimestampRef.current = Date.now();

      log.info('Portföy verileri ve canlı kur başarıyla yüklendi', {
        portfolioId: userPortfolio.id,
        positionCount: combined.positions.length,
        isCashInitialized: combined.cashState.isInitialized,
        fxRate: combined.fxRateInfo.rate,
      });
    } catch (err) {
      if (!isMountedRef.current || currentRequestId !== requestIdRef.current) return;

      const rawMsg = err instanceof Error ? err.message : String(err);
      log.error('Portföy yükleme hatası (usePortfolio)', { error: rawMsg });

      const friendlyMessage = sanitizePortfolioErrorMessage(err);
      setError(friendlyMessage);

      // If we already have existing cached data (or previous successful fetch), retain it and flag as stale
      if (lastFetchedTimestampRef.current > 0) {
        setIsStale(true);
      }
    } finally {
      if (isMountedRef.current && currentRequestId === requestIdRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  // Initial load on mount and when user session changes
  useEffect(() => {
    loadPortfolioData(false, false);
  }, [user?.id, loadPortfolioData]);

  // Reactive subscription to all global portfolio mutations (single invalidation strategy)
  useEffect(() => {
    const unsubscribe = subscribePortfolioChanges(() => {
      log.info('Portföy mutasyon bildirimi alındı, veriler reaktif olarak yenileniyor...');
      loadPortfolioData(true, true);
    });
    return unsubscribe;
  }, [loadPortfolioData]);

  // Manual pull-to-refresh / retry action
  const refreshPortfolio = useCallback(async () => {
    await loadPortfolioData(true, true);
  }, [loadPortfolioData]);

  // Computed Portfolio Aggregate Metrics using pure financial math domain functions
  const stats = useMemo<PortfolioStats>(() => {
    return calculatePortfolioStats(positions, cashState, fxRateInfo);
  }, [positions, cashState, fxRateInfo]);

  // Dynamic Allocation Breakdown Items
  const allocationItems = useMemo<AllocationItem[]>(() => {
    return calculateAllocationItems(stats);
  }, [stats]);

  /**
   * Initializes cash accounts with explicit TRY & USD opening balances.
   */
  const initializeCashAccounts = useCallback(
    async (
      tryOpeningBalance: number,
      usdOpeningBalance: number,
      clientRequestId?: string
    ): Promise<InitializeCashAccountsResult> => {
      if (!portfolio) {
        throw new Error('Aktif portföy bulunamadı.');
      }

      return await initializePortfolioCashAccounts({
        portfolioId: portfolio.id,
        tryOpeningBalance,
        usdOpeningBalance,
        clientRequestId,
      });
    },
    [portfolio]
  );

  /**
   * Adds a transaction. Invalidation is automatically dispatched via notifyPortfolioChanged.
   */
  const addTransaction = useCallback(
    async (params: Omit<RecordTransactionParams, 'portfolioId'>): Promise<TransactionRecordResult> => {
      if (!portfolio) {
        throw new Error('Aktif portföy bulunamadı.');
      }

      return await recordTransaction({
        ...params,
        portfolioId: portfolio.id,
      });
    },
    [portfolio]
  );

  /**
   * Adds a cash flow (deposit/withdrawal). Invalidation is automatically dispatched.
   */
  const addCashFlow = useCallback(
    async (params: Omit<RecordCashFlowParams, 'portfolioId'>): Promise<CashFlowRecordResult> => {
      if (!portfolio) {
        throw new Error('Aktif portföy bulunamadı.');
      }

      return await recordCashFlow({
        ...params,
        portfolioId: portfolio.id,
      });
    },
    [portfolio]
  );

  /**
   * Reverses a transaction with audit trail. Invalidation is automatically dispatched.
   */
  const reverseTx = useCallback(
    async (params: ReverseTransactionParams) => {
      return await reverseTransaction(params);
    },
    []
  );

  /**
   * Reverses a cash flow with audit trail. Invalidation is automatically dispatched.
   */
  const reverseFlow = useCallback(
    async (params: ReverseCashFlowParams) => {
      return await reverseCashFlow(params);
    },
    []
  );

  /**
   * Clears all transactions, cash flows and positions using reset_my_investments RPC.
   */
  const resetInvestments = useCallback(async (params: ResetInvestmentsParams): Promise<ResetInvestmentsResult> => {
    return await resetMyInvestments(params);
  }, []);

  return {
    portfolio,
    positions,
    cashState,
    fxRateInfo,
    usdTryRate: fxRateInfo?.rate ?? null,
    stats,
    allocationItems,
    isCashInitialized: stats.isCashInitialized,
    availableCashTry: stats.cashTry,
    availableCashUsd: stats.cashUsd,
    isLoading,
    isRefreshing,
    isStale,
    error,
    lastFetchedTimestamp: lastFetchedTimestampRef.current,
    refreshPortfolio,
    initializeCashAccounts,
    addTransaction,
    addCashFlow,
    reverseTransaction: reverseTx,
    reverseCashFlow: reverseFlow,
    resetInvestments,
  };
}
