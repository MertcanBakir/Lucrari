/**
 * Lucrari — useWatchlist Hook
 * 
 * Manages paginated watchlist presentation with single-source trigger, committed vs requested page separation,
 * page request generation tokens, dedicated page-error retry target, automatic page 0 reset on Add,
 * valid page fallback on Delete, and zero-frame render-time user isolation.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/context/auth-context';
import {
  fetchWatchlistPage,
  fetchAllWatchedInstrumentIds,
  setWatchlistItem,
  getWatchlistPageSnapshot,
  getWatchlistMembershipSnapshot,
  subscribeWatchlistChanges,
  isInstrumentMutationPending,
} from '@/services/watchlist/watchlist-service';
import type {
  WatchlistItem,
  WatchlistMembershipResult,
  ToggleWatchlistActionResult,
} from '@/types/watchlist';
import {
  createToggleWatchlistSuccessResult,
  createToggleWatchlistErrorResult,
} from '@/types/watchlist';
import {
  isWatchlistPageOutOfRangeError,
  formatWatchlistRpcError,
} from '@/utils/watchlist-errors';
import {
  resolveWatchlistViewState,
  resolveUserScopedWatchlistState,
  resolveUserScopedMembershipState,
  shouldAcceptWatchlistResult,
  type UserScopedWatchlistRawState,
  type RawMembershipState,
  type WatchlistViewStateResolution,
} from '@/utils/watchlist-view-state';
import { createScopedLogger } from '@/utils/logger';

const log = createScopedLogger('useWatchlist');

export const WATCHLIST_PAGE_SIZE = 20;

export type { ToggleWatchlistActionResult };

export interface UseWatchlistReturn {
  items: WatchlistItem[];
  allItemsOnPage: WatchlistItem[];
  totalCount: number;
  pageIndex: number;
  pageSize: number;
  totalPages: number;
  isExpanded: boolean;
  isLoading: boolean;
  isPageLoading: boolean;
  isStale: boolean;
  error: Error | null;
  hasLoadedSuccessfully: boolean;
  viewState: WatchlistViewStateResolution;
  watchedInstrumentIds: Set<string>;
  isMembershipLoading: boolean;
  isMembershipStale: boolean;
  membershipError: string | null;
  pendingInstrumentIds: Set<string>;
  expand: () => void;
  collapse: () => void;
  goToPage: (pageIndex: number) => Promise<void>;
  nextPage: () => Promise<void>;
  prevPage: () => Promise<void>;
  refetch: () => Promise<void>;
  retryPage: () => Promise<void>;
  toggleWatchlistItem: (instrumentId: string, isWatched: boolean) => Promise<ToggleWatchlistActionResult>;
  loadMembership: (forceRefresh?: boolean) => Promise<WatchlistMembershipResult>;
}

export function useWatchlist(): UseWatchlistReturn {
  const { userId, isAuthReady, error: authError, retryAuth } = useAuth();

  const currentUserIdRef = useRef<string | null>(userId);
  currentUserIdRef.current = userId;

  const isMountedRef = useRef<boolean>(true);
  const pageRequestIdRef = useRef<number>(0);

  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // User-scoped membership raw state
  const [rawMembership, setRawMembership] = useState<RawMembershipState>(() => {
    const initialMembership = userId ? getWatchlistMembershipSnapshot(userId) : null;
    return {
      stateUserId: userId,
      membershipSet: initialMembership ? new Set(initialMembership.instrumentIds) : new Set<string>(),
      isLoading: false,
      isStale: initialMembership?.isStale ?? false,
      error: null,
    };
  });

  // User-scoped pending mutation instrument IDs: { stateUserId, ids }
  const [pendingState, setPendingState] = useState<{
    stateUserId: string | null;
    ids: Set<string>;
  }>({
    stateUserId: userId,
    ids: new Set<string>(),
  });

  // Internal raw page state (committedPageIndex vs requestedPageIndex vs failedPageIndex)
  const [rawState, setRawState] = useState<UserScopedWatchlistRawState>(() => {
    const initialSnapshot = userId && isAuthReady ? getWatchlistPageSnapshot(userId, WATCHLIST_PAGE_SIZE, 0) : null;
    return {
      stateUserId: userId,
      committedPageIndex: 0,
      requestedPageIndex: 0,
      failedPageIndex: null,
      pageResult: initialSnapshot,
      isLoading: !initialSnapshot,
      isPageLoading: false,
      isStale: initialSnapshot?.isStale ?? false,
      error: null,
      hasLoadedSuccessfully: Boolean(initialSnapshot),
    };
  });

  // Reconcile user change
  useEffect(() => {
    pageRequestIdRef.current++;

    if (!userId || !isAuthReady) {
      setRawState({
        stateUserId: null,
        committedPageIndex: 0,
        requestedPageIndex: 0,
        failedPageIndex: null,
        pageResult: null,
        isLoading: !isAuthReady,
        isPageLoading: false,
        isStale: false,
        error: authError ? new Error(authError) : null,
        hasLoadedSuccessfully: false,
      });
      setRawMembership({
        stateUserId: null,
        membershipSet: new Set<string>(),
        isLoading: false,
        isStale: false,
        error: null,
      });
      setPendingState({
        stateUserId: null,
        ids: new Set<string>(),
      });
      return;
    }

    const userSnapshot = getWatchlistPageSnapshot(userId, WATCHLIST_PAGE_SIZE, 0);
    const membershipSnapshot = getWatchlistMembershipSnapshot(userId);

    setRawState({
      stateUserId: userId,
      committedPageIndex: 0,
      requestedPageIndex: 0,
      failedPageIndex: null,
      pageResult: userSnapshot,
      isLoading: !userSnapshot,
      isPageLoading: false,
      isStale: userSnapshot?.isStale ?? false,
      error: null,
      hasLoadedSuccessfully: Boolean(userSnapshot),
    });

    setRawMembership({
      stateUserId: userId,
      membershipSet: membershipSnapshot ? new Set(membershipSnapshot.instrumentIds) : new Set<string>(),
      isLoading: false,
      isStale: membershipSnapshot?.isStale ?? false,
      error: null,
    });

    setPendingState({
      stateUserId: userId,
      ids: new Set<string>(),
    });
  }, [userId, isAuthReady, authError]);

  // Subscribe to service-level change events
  useEffect(() => {
    isMountedRef.current = true;

    const unsubscribe = subscribeWatchlistChanges((event) => {
      if (!isMountedRef.current) return;
      if (event.userId !== currentUserIdRef.current) return;

      // Update membership set if mutation occurred
      if (event.mutation) {
        setRawMembership((prev) => {
          if (prev.stateUserId !== event.userId) {
            return prev;
          }
          const next = new Set(prev.membershipSet);
          if (event.mutation?.isWatched) {
            next.add(event.mutation.instrumentId);
          } else {
            next.delete(event.mutation!.instrumentId);
          }
          return {
            ...prev,
            membershipSet: next,
          };
        });
      }

      // If refreshed page matches committed page, update state
      if (event.refreshedPage) {
        const refreshedPageIndex = Math.floor(event.refreshedPage.offset / WATCHLIST_PAGE_SIZE);
        setRawState((prev) => {
          if (prev.committedPageIndex !== refreshedPageIndex) return prev;
          return {
            ...prev,
            stateUserId: event.userId,
            pageResult: event.refreshedPage || null,
            hasLoadedSuccessfully: true,
            isLoading: false,
            isPageLoading: false,
            isStale: event.refreshedPage?.isStale ?? false,
            error: null,
          };
        });
      }
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, []);

  // Single-source page fetcher with monotonic request generation token
  const loadPage = useCallback(
    async (targetPageIndex: number, forceRefresh = false) => {
      const activeUserId = currentUserIdRef.current;
      if (!isMountedRef.current || !activeUserId || !isAuthReady) return;

      const currentRequestId = ++pageRequestIdRef.current;
      const offset = targetPageIndex * WATCHLIST_PAGE_SIZE;
      const snapshot = getWatchlistPageSnapshot(activeUserId, WATCHLIST_PAGE_SIZE, offset);

      if (targetPageIndex === 0) {
        if (forceRefresh || !snapshot) {
          setRawState((prev) => ({
            ...prev,
            requestedPageIndex: targetPageIndex,
            isLoading: true,
            error: null,
          }));
        }
      } else {
        if (forceRefresh || !snapshot) {
          setRawState((prev) => ({
            ...prev,
            requestedPageIndex: targetPageIndex,
            isPageLoading: true,
            error: null,
          }));
        }
      }

      try {
        const result = await fetchWatchlistPage({
          limit: WATCHLIST_PAGE_SIZE,
          offset,
          forceRefresh,
        });

        if (
          shouldAcceptWatchlistResult({
            isMounted: isMountedRef.current,
            currentUserId: currentUserIdRef.current,
            activeUserId,
            dataUserId: result.userId,
            requestId: currentRequestId,
            activeRequestId: pageRequestIdRef.current,
            responseOffset: result.offset,
            expectedOffset: offset,
          })
        ) {
          // If returned result is empty for a nonzero offset, handle nonzero empty page fallback
          if (result.items.length === 0 && offset > 0) {
            const knownTotal = result.totalCount > 0 ? result.totalCount : (rawState.pageResult?.totalCount ?? 0);
            if (knownTotal > 0 && offset >= knownTotal) {
              const lastValidPage = Math.max(0, Math.floor((knownTotal - 1) / WATCHLIST_PAGE_SIZE));
              if (lastValidPage !== targetPageIndex) {
                log.info('Sayfalama toplam kaydı aştı, geçerli son sayfaya dönülüyor', {
                  offset,
                  knownTotal,
                  lastValidPage,
                });
                return loadPage(lastValidPage, forceRefresh);
              }
            }
          }

          setRawState({
            stateUserId: result.userId,
            committedPageIndex: targetPageIndex,
            requestedPageIndex: targetPageIndex,
            failedPageIndex: null,
            pageResult: result,
            hasLoadedSuccessfully: true,
            isLoading: false,
            isPageLoading: false,
            isStale: result.isStale,
            error: null,
          });
        }
      } catch (err: unknown) {
        if (
          isMountedRef.current &&
          currentUserIdRef.current === activeUserId &&
          pageRequestIdRef.current === currentRequestId
        ) {
          const errorObj = err instanceof Error ? err : new Error('İzleme listesi yüklenemedi');
          log.warn('İzleme listesi sayfası yüklenirken hata', errorObj);

          // If a nonzero page failed due to genuine out-of-bounds rejection, automatically step back
          if (targetPageIndex > 0 && isWatchlistPageOutOfRangeError(err)) {
            log.info('Sayfa aralık dışında tespit edildi, bir önceki sayfaya uzlaştırılıyor', {
              failedPageIndex: targetPageIndex,
              fallbackPage: targetPageIndex - 1,
            });
            return loadPage(targetPageIndex - 1, true);
          }

          setRawState((prev) => ({
            ...prev,
            failedPageIndex: targetPageIndex,
            isLoading: false,
            isPageLoading: false,
            error: errorObj,
          }));
        }
      }
    },
    [isAuthReady, rawState.pageResult?.totalCount]
  );

  // Initial fetch on mount / auth readiness
  useEffect(() => {
    if (userId && isAuthReady) {
      loadPage(0, false);
    }
  }, [userId, isAuthReady, loadPage]);

  // Expand / Collapse controls
  const expand = useCallback(() => {
    setIsExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    setIsExpanded(false);
    if (rawState.committedPageIndex !== 0) {
      loadPage(0, false);
    }
  }, [rawState.committedPageIndex, loadPage]);

  const goToPage = useCallback(
    async (targetPageIndex: number) => {
      if (targetPageIndex === rawState.committedPageIndex || targetPageIndex < 0) return;
      await loadPage(targetPageIndex, false);
    },
    [rawState.committedPageIndex, loadPage]
  );

  const nextPage = useCallback(async () => {
    const totalCount = rawState.pageResult?.totalCount ?? 0;
    if ((rawState.committedPageIndex + 1) * WATCHLIST_PAGE_SIZE < totalCount) {
      const next = rawState.committedPageIndex + 1;
      await loadPage(next, false);
    }
  }, [rawState.committedPageIndex, rawState.pageResult?.totalCount, loadPage]);

  const prevPage = useCallback(async () => {
    if (rawState.committedPageIndex > 0) {
      const prev = rawState.committedPageIndex - 1;
      await loadPage(prev, false);
    }
  }, [rawState.committedPageIndex, loadPage]);

  const refetch = useCallback(async () => {
    if (!userId && retryAuth) {
      await retryAuth();
    }
    await loadPage(rawState.committedPageIndex, true);
  }, [userId, retryAuth, rawState.committedPageIndex, loadPage]);

  // Page-error retry: strictly retries the failed requested page (e.g. offset 20) instead of resetting to page 0
  const retryPage = useCallback(async () => {
    const pageToRetry = rawState.failedPageIndex !== null ? rawState.failedPageIndex : rawState.committedPageIndex;
    await loadPage(pageToRetry, true);
  }, [rawState.failedPageIndex, rawState.committedPageIndex, loadPage]);

  // Membership set loader for search modal (NO watchedInstrumentIds dependency!)
  const loadMembership = useCallback(
    async (forceRefresh = false): Promise<WatchlistMembershipResult> => {
      const activeUserId = currentUserIdRef.current;
      if (!activeUserId || !isAuthReady) {
        return {
          userId: activeUserId || '',
          instrumentIds: new Set<string>(),
          isStale: false,
          timestamp: Date.now(),
        };
      }

      setRawMembership((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const result = await fetchAllWatchedInstrumentIds(forceRefresh);
        if (isMountedRef.current && currentUserIdRef.current === activeUserId) {
          setRawMembership({
            stateUserId: activeUserId,
            membershipSet: result.instrumentIds,
            isLoading: false,
            isStale: result.isStale,
            error: null,
          });
        }
        return result;
      } catch (err) {
        log.warn('İzleme üyeliği listesi yüklenemedi', { error: String(err) });
        if (isMountedRef.current && currentUserIdRef.current === activeUserId) {
          setRawMembership((prev) => ({
            ...prev,
            isLoading: false,
            error: 'İzleme listesi üyelik bilgisi alınamadı.',
          }));
        }
        throw err;
      }
    },
    [isAuthReady]
  );

  // Toggle mutation with last-intent resolution and reconciliation
  const toggleWatchlistItem = useCallback(
    async (instrumentId: string, isWatched: boolean): Promise<ToggleWatchlistActionResult> => {
      const activeUserId = currentUserIdRef.current;
      if (!activeUserId || !instrumentId) {
        return {
          success: false,
          error: 'Oturum bilgisi veya varlık kimliği eksik.',
        };
      }

      // Add to pending state for this active user
      setPendingState((prev) => ({
        stateUserId: activeUserId,
        ids: new Set(prev.stateUserId === activeUserId ? prev.ids : []).add(instrumentId),
      }));

      try {
        const res = await setWatchlistItem(instrumentId, isWatched);

        // Optimistically update membership state using TRUE res.isWatched
        if (isMountedRef.current && currentUserIdRef.current === activeUserId) {
          setRawMembership((prev) => {
            if (prev.stateUserId !== activeUserId) return prev;
            const next = new Set(prev.membershipSet);
            if (res.isWatched) {
              next.add(instrumentId);
            } else {
              next.delete(instrumentId);
            }
            return {
              ...prev,
              membershipSet: next,
            };
          });
        }

        // Page reconciliation using TRUE res.isWatched:
        // If Added -> Always reset to page 0 (created_at DESC puts it on page 0)
        // If Removed -> If on last page and it was the last item on that page, step back
        if (res.isWatched) {
          await loadPage(0, true);
        } else {
          const currentCount = rawState.pageResult?.items.length ?? 0;
          const currentTotal = rawState.pageResult?.totalCount ?? 0;
          if (currentCount <= 1 && rawState.committedPageIndex > 0 && currentTotal > 0) {
            const fallbackPage = Math.max(0, rawState.committedPageIndex - 1);
            await loadPage(fallbackPage, true);
          } else {
            await loadPage(rawState.committedPageIndex, true);
          }
        }

        return createToggleWatchlistSuccessResult(res);
      } catch (err) {
        const userFriendlyError = formatWatchlistRpcError(err);
        log.error('Watchlist toggle hatası', { instrumentId, isWatched, error: String(err) });
        return createToggleWatchlistErrorResult(userFriendlyError);
      } finally {
        if (isMountedRef.current && currentUserIdRef.current === activeUserId) {
          // Only remove pending spinner if service queue is genuinely finished for this instrument
          if (!isInstrumentMutationPending(activeUserId, instrumentId)) {
            setPendingState((prev) => {
              if (prev.stateUserId !== activeUserId) return prev;
              const next = new Set(prev.ids);
              next.delete(instrumentId);
              return {
                stateUserId: activeUserId,
                ids: next,
              };
            });
          }
        }
      }
    },
    [rawState.committedPageIndex, rawState.pageResult?.items.length, rawState.pageResult?.totalCount, loadPage]
  );

  // Compute render-time scoped state
  const currentSnapshot = userId
    ? getWatchlistPageSnapshot(userId, WATCHLIST_PAGE_SIZE, rawState.committedPageIndex * WATCHLIST_PAGE_SIZE)
    : null;

  const scopedState = useMemo(() => {
    return resolveUserScopedWatchlistState({
      rawState,
      currentUserId: userId,
      isAuthReady,
      authError,
      isExpanded,
      snapshot: currentSnapshot,
    });
  }, [rawState, userId, isAuthReady, authError, isExpanded, currentSnapshot]);

  // Compute render-time scoped membership state
  const currentMembershipSnapshot = userId ? getWatchlistMembershipSnapshot(userId) : null;
  const scopedMembership = useMemo(() => {
    return resolveUserScopedMembershipState({
      rawMembership,
      currentUserId: userId,
      isAuthReady,
      snapshot: currentMembershipSnapshot,
    });
  }, [rawMembership, userId, isAuthReady, currentMembershipSnapshot]);

  // Compute render-time scoped pending IDs
  const pendingInstrumentIds = useMemo(() => {
    if (!userId || pendingState.stateUserId !== userId) {
      return new Set<string>();
    }
    return pendingState.ids;
  }, [userId, pendingState]);

  // Compute total pages
  const totalPages = useMemo(() => {
    if (scopedState.totalCount <= 0) return 1;
    return Math.ceil(scopedState.totalCount / WATCHLIST_PAGE_SIZE);
  }, [scopedState.totalCount]);

  // Compute centralized viewState directly with REAL auth and data states
  const viewState = useMemo(() => {
    return resolveWatchlistViewState({
      isAuthReady,
      userId,
      authError,
      isLoading: scopedState.isLoading,
      isPageLoading: scopedState.isPageLoading,
      error: scopedState.error,
      hasLoadedSuccessfully: scopedState.hasLoadedSuccessfully,
      totalCount: scopedState.totalCount,
      itemsCount: scopedState.items.length,
      isStale: scopedState.isStale,
      pendingInstrumentIdsCount: pendingInstrumentIds.size,
    });
  }, [
    isAuthReady,
    userId,
    authError,
    scopedState.isLoading,
    scopedState.isPageLoading,
    scopedState.error,
    scopedState.hasLoadedSuccessfully,
    scopedState.totalCount,
    scopedState.items.length,
    scopedState.isStale,
    pendingInstrumentIds.size,
  ]);

  return {
    items: scopedState.items,
    allItemsOnPage: scopedState.allItemsOnPage,
    totalCount: scopedState.totalCount,
    pageIndex: scopedState.committedPageIndex,
    pageSize: WATCHLIST_PAGE_SIZE,
    totalPages,
    isExpanded,
    isLoading: scopedState.isLoading,
    isPageLoading: scopedState.isPageLoading,
    isStale: scopedState.isStale,
    error: scopedState.error,
    hasLoadedSuccessfully: scopedState.hasLoadedSuccessfully,
    viewState,
    watchedInstrumentIds: scopedMembership.watchedInstrumentIds,
    isMembershipLoading: scopedMembership.isMembershipLoading,
    isMembershipStale: scopedMembership.isMembershipStale,
    membershipError: scopedMembership.membershipError,
    pendingInstrumentIds,
    expand,
    collapse,
    goToPage,
    nextPage,
    prevPage,
    refetch,
    retryPage,
    toggleWatchlistItem,
    loadMembership,
  };
}
