/** Live portfolio state, manual cash and transaction mutations. */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/context/auth-context';
import { ensureAnonymousSession } from '@/services/auth/auth-service';
import {
  ensureDefaultPortfolio,
  fetchPortfolioDataCombined,
  setPortfolioCash,
  recordTransaction,
  reverseTransaction,
  resetMyInvestments,
  subscribePortfolioChanges,
  type RecordTransactionParams,
  type ReverseTransactionParams,
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
  PortfolioCash,
  PortfolioRealizedPnl,
  TransactionRecordResult,
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
  const [cash, setCash] = useState<PortfolioCash | null>(null);
  const [realizedPnl, setRealizedPnl] = useState<PortfolioRealizedPnl | null>(null);
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
      setCash(combined.cash);
      setRealizedPnl(combined.realizedPnl);
      setFxRateInfo(combined.fxRateInfo);

      const hasStaleMarketData =
        Boolean(combined.fxRateInfo?.isStale) ||
        combined.positions.some((position) => Boolean(position.price_is_stale));

      setIsStale(hasStaleMarketData);
      setError(null);
      lastFetchedTimestampRef.current = Date.now();

      log.debug('portfolio.load.completed', {
        message: 'Portfolio load completed.',
        context: { portfolioId: userPortfolio.id, positionCount: combined.positions.length, fxRate: combined.fxRateInfo.rate }
      });
    } catch (err) {
      if (!isMountedRef.current || currentRequestId !== requestIdRef.current) return;

      log.error('portfolio.load.failed', {
        message: 'Portfolio load failed.',
        error: err
      });

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
      log.debug('portfolio.refresh.requested', {
        message: 'Portfolio refresh requested.'
      });
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
    return calculatePortfolioStats(positions, cash, fxRateInfo, realizedPnl);
  }, [positions, cash, fxRateInfo, realizedPnl]);

  // Dynamic Allocation Breakdown Items
  const allocationItems = useMemo<AllocationItem[]>(() => {
    return calculateAllocationItems(stats);
  }, [stats]);

  const updateCash = useCallback(async (tryBalance: number, usdBalance: number) => {
    if (!portfolio) throw new Error('Aktif portföy bulunamadı.');
    await setPortfolioCash({ portfolioId: portfolio.id, tryBalance, usdBalance });
  }, [portfolio]);

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
   * Reverses a transaction with audit trail. Invalidation is automatically dispatched.
   */
  const reverseTx = useCallback(
    async (params: ReverseTransactionParams) => {
      return await reverseTransaction(params);
    },
    []
  );

  /** Live portfolio state, manual cash and transaction mutations. */
  const resetInvestments = useCallback(async (params: ResetInvestmentsParams): Promise<ResetInvestmentsResult> => {
    return await resetMyInvestments(params);
  }, []);

  return {
    portfolio,
    positions,
    cash,
    fxRateInfo,
    usdTryRate: fxRateInfo?.rate ?? null,
    stats,
    allocationItems,
    isLoading,
    isRefreshing,
    isStale,
    error,
    lastFetchedTimestamp: lastFetchedTimestampRef.current,
    refreshPortfolio,
    updateCash,
    addTransaction,
    reverseTransaction: reverseTx,
    resetInvestments,
  };
}
