/**
 * Lucrari — usePortfolioActivity React Hook
 * 
 * Orchestrates live portfolio activity stream, keyset cursor pagination,
 * 280ms search debounce, reactive mutation invalidation,
 * and strict zero-frame query isolation (User + Portfolio + Filter + Search).
 * 
 * Features:
 * - Monotonic portfolio-resolution generation token and live activeUserIdRef verification
 *   ensuring User A's delayed response never affects User B's state, errors, or loading states.
 * - Live activeQueryKeyRef for immediate render-time load-more rejection upon filter/search changes.
 * - Full metadata query scoping (items, hasMore, nextCursor, isStale, initialError, loadMoreError).
 * - Scoped portfolio resolution state (status, userId, portfolioId, portfolioName, error).
 * - Stable portfolio change subscription that does not re-subscribe on filter/search changes.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/auth-context';
import {
  ensureDefaultPortfolio,
  subscribePortfolioChanges,
} from '@/services/portfolio/portfolio-service';
import {
  fetchPortfolioActivityPage,
  PORTFOLIO_ACTIVITY_PAGE_SIZE,
} from '@/services/portfolio/portfolio-activity-service';
import {
  buildActivityQueryKey,
  resolvePortfolioActivityViewState,
  resolveQueryScopedActivityState,
  resolveUserScopedPortfolioState,
  shouldAcceptPortfolioResolutionResult,
  canTriggerLoadMore,
  shouldAcceptLoadMoreResult,
  shouldAcceptLoadMoreFinally,
  reduceLoadMoreItems,
  buildPortfolioSubscriptionScopeKey,
  shouldAcceptPortfolioChangeNotification,
  type PortfolioActivityViewState,
  type PortfolioResolutionStatus,
} from '@/utils/portfolio-activity-view-state';
import { createScopedLogger } from '@/utils/logger';
import type {
  PortfolioActivityItem,
  PortfolioActivitySection,
  PortfolioActivityFilter,
} from '@/types/portfolio-activity';

const log = createScopedLogger('usePortfolioActivity');

export const SEARCH_DEBOUNCE_MS = 280;

export interface UsePortfolioActivityOptions {
  customPortfolioId?: string;
  initialFilter?: PortfolioActivityFilter;
}

export interface UsePortfolioActivityResult {
  items: PortfolioActivityItem[];
  sections: PortfolioActivitySection[];
  activeFilter: PortfolioActivityFilter;
  searchQuery: string;
  debouncedSearch: string;
  hasMore: boolean;
  isLoadingInitial: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  isStale: boolean;
  initialError: string | null;
  loadMoreError: string | null;
  isResolvingPortfolio: boolean;
  portfolioResolutionError: string | null;
  viewState: PortfolioActivityViewState;
  portfolioId: string | null;
  portfolioName: string | null;
  setFilter: (filter: PortfolioActivityFilter) => void;
  setSearchQuery: (query: string) => void;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  retryLoadMore: () => Promise<void>;
  retryAuth: () => Promise<void>;
  retryPortfolioResolution: () => Promise<void>;
}

export function usePortfolioActivity(
  options?: UsePortfolioActivityOptions
): UsePortfolioActivityResult {
  const { user, isAuthReady, error: authError, retryAuth } = useAuth();
  const activeUserId = user?.id || null;

  const [activeFilter, setActiveFilterState] = useState<PortfolioActivityFilter>(
    options?.initialFilter || 'ALL'
  );
  const [searchQuery, setSearchQueryState] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');

  // Lifecycle & synchronization refs
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const activeUserIdRef = useRef(activeUserId);
  activeUserIdRef.current = activeUserId;

  // Portfolio resolution state (fully user-scoped)
  const [portfolioResolutionState, setPortfolioResolutionState] = useState<{
    status: PortfolioResolutionStatus;
    userId: string | null;
    portfolioId: string | null;
    portfolioName: string | null;
    error: string | null;
  }>({
    status: options?.customPortfolioId ? 'success' : activeUserId ? 'loading' : 'idle',
    userId: activeUserId,
    portfolioId: options?.customPortfolioId || null,
    portfolioName: options?.customPortfolioId ? 'Seçili Portföy' : null,
    error: null,
  });

  // Pure render-time user-scoped portfolio selection (zero-frame isolation)
  const userScopedPortfolio = useMemo(() => {
    return resolveUserScopedPortfolioState(activeUserId, portfolioResolutionState, isAuthReady);
  }, [activeUserId, portfolioResolutionState, isAuthReady]);

  const resolvedPortfolioId = userScopedPortfolio.portfolioId;
  const portfolioName = userScopedPortfolio.portfolioName;
  const isResolvingPortfolio = userScopedPortfolio.isResolvingPortfolio;
  const portfolioResolutionError = userScopedPortfolio.error;

  // Raw data from service
  const [rawState, setRawState] = useState<{
    items: PortfolioActivityItem[];
    loadedQueryKey: string | null;
    nextCursor: any | null;
    hasMore: boolean;
    isStale: boolean;
    initialError: string | null;
    loadMoreError: string | null;
  }>({
    items: [],
    loadedQueryKey: null,
    nextCursor: null,
    hasMore: false,
    isStale: false,
    initialError: null,
    loadMoreError: null,
  });

  // Loading states
  const [isLoadingInitial, setIsLoadingInitial] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);

  // Synchronization refs
  const portfolioResolutionTokenRef = useRef(0);
  const queryGenRef = useRef(0);
  const loadMoreTokenSeq = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const rawStateRef = useRef(rawState);
  rawStateRef.current = rawState;

  // Cleanup/transition guard: Invalidate in-flight portfolio resolution on user/auth change immediately
  useEffect(() => {
    const tokenRef = portfolioResolutionTokenRef;
    return () => {
      tokenRef.current++;
    };
  }, [activeUserId, isAuthReady]);

  // 1. Debounce search query input (280ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(handler);
  }, [searchQuery]);

  // 2. Compute Active Query Identity Key
  const activeQueryKey = useMemo(() => {
    return buildActivityQueryKey(
      activeUserId,
      resolvedPortfolioId,
      activeFilter,
      debouncedSearch
    );
  }, [activeUserId, resolvedPortfolioId, activeFilter, debouncedSearch]);

  const activeQueryKeyRef = useRef(activeQueryKey);
  activeQueryKeyRef.current = activeQueryKey;

  // 3. Resolve default portfolio with monotonic token and active user verification
  const resolvePortfolio = useCallback(async () => {
    const currentUserId = activeUserId;

    if (options?.customPortfolioId) {
      setPortfolioResolutionState({
        status: 'success',
        userId: currentUserId,
        portfolioId: options.customPortfolioId,
        portfolioName: 'Seçili Portföy',
        error: null,
      });
      return;
    }

    if (!isAuthReady || !currentUserId) {
      setPortfolioResolutionState({
        status: 'idle',
        userId: currentUserId,
        portfolioId: null,
        portfolioName: null,
        error: null,
      });
      return;
    }

    const token = ++portfolioResolutionTokenRef.current;

    setPortfolioResolutionState({
      status: 'loading',
      userId: currentUserId,
      portfolioId: null,
      portfolioName: null,
      error: null,
    });

    const checkAccept = () =>
      shouldAcceptPortfolioResolutionResult({
        isMounted: isMountedRef.current,
        requestToken: token,
        activeToken: portfolioResolutionTokenRef.current,
        requestUserId: currentUserId,
        currentActiveUserId: activeUserIdRef.current,
      });

    try {
      log.debug('portfolio.activity.owner.resolving', {
        message: 'Portfolio activity owner resolving.',
        context: { userId: currentUserId, generation: token }
      });
      const portfolio = await ensureDefaultPortfolio(currentUserId);

      // Discard if user changed, newer resolution started, or unmounted
      if (!checkAccept()) {
        log.debug('portfolio.activity.owner.discarded', {
          message: 'Portfolio activity owner discarded.'
        });
        return;
      }

      if (portfolio?.id) {
        setPortfolioResolutionState({
          status: 'success',
          userId: currentUserId,
          portfolioId: portfolio.id,
          portfolioName: portfolio.name || 'Ana Portföy',
          error: null,
        });
      } else {
        throw new Error('Varsayılan portföy bulunamadı.');
      }
    } catch (err: unknown) {
      if (!checkAccept()) {
        return;
      }
      const msg = 'Portföy bilgisi alınamadı. Lütfen tekrar deneyiniz.';
      log.warn('portfolio.activity.owner.failed', {
        message: 'Portfolio activity owner failed.',
        error: err
      });
      setPortfolioResolutionState({
        status: 'error',
        userId: currentUserId,
        portfolioId: null,
        portfolioName: null,
        error: msg,
      });
    }
  }, [options?.customPortfolioId, isAuthReady, activeUserId]);

  useEffect(() => {
    resolvePortfolio();
  }, [resolvePortfolio]);

  // 4. Primary fetch for active query (Page 1)
  const loadInitialPage = useCallback(
    async (isRefreshAction = false) => {
      const currentUserId = activeUserIdRef.current;
      const currentPortfolioId = resolvedPortfolioId;

      if (!isAuthReady || !currentUserId || !currentPortfolioId) {
        setIsLoadingInitial(false);
        return;
      }

      const generationToken = ++queryGenRef.current;
      // Invalidate any in-flight load-more from previous query
      loadMoreTokenSeq.current++;
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);

      if (isRefreshAction) {
        setIsRefreshing(true);
      } else {
        setIsLoadingInitial(true);
      }

      const targetQueryKey = activeQueryKey;

      try {
        log.debug('portfolio.activity.page.loading', {
          message: 'Portfolio activity page loading.',
          context: { portfolioId: currentPortfolioId, filter: activeFilter, hasSearch: Boolean(debouncedSearch), isRefreshAction, generationToken }
        });

        const result = await fetchPortfolioActivityPage({
          portfolioId: currentPortfolioId,
          limit: PORTFOLIO_ACTIVITY_PAGE_SIZE,
          filter: activeFilter,
          search: debouncedSearch,
          cursor: null,
          forceRefresh: isRefreshAction,
        });

        if (
          generationToken !== queryGenRef.current ||
          currentUserId !== activeUserIdRef.current ||
          !isMountedRef.current
        ) {
          log.debug('portfolio.activity.page.discarded', {
            message: 'Portfolio activity page discarded.'
          });
          return;
        }

        setRawState({
          items: result.items,
          loadedQueryKey: targetQueryKey,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
          isStale: result.isStale,
          initialError: null,
          loadMoreError: null,
        });
      } catch (err: unknown) {
        if (
          generationToken !== queryGenRef.current ||
          currentUserId !== activeUserIdRef.current ||
          !isMountedRef.current
        ) {
          return;
        }

        const errMsg =
          err instanceof Error ? err.message : 'Portföy hareketleri yüklenemedi.';
        log.warn('portfolio.activity.page.failed', {
          message: 'Portfolio activity page failed.',
          context: { isRefreshAction },
          error: err
        });

        if (
          isRefreshAction &&
          rawStateRef.current.loadedQueryKey === targetQueryKey &&
          rawStateRef.current.items.length > 0
        ) {
          setRawState((prev) => ({
            ...prev,
            isStale: true,
          }));
        } else {
          setRawState({
            items: [],
            loadedQueryKey: targetQueryKey, // Scoped to active query
            nextCursor: null,
            hasMore: false,
            isStale: false,
            initialError: errMsg,
            loadMoreError: null,
          });
        }
      } finally {
        if (generationToken === queryGenRef.current && isMountedRef.current) {
          setIsLoadingInitial(false);
          setIsRefreshing(false);
        }
      }
    },
    [
      isAuthReady,
      resolvedPortfolioId,
      activeFilter,
      debouncedSearch,
      activeQueryKey,
    ]
  );

  // 5. Trigger primary fetch when active query changes
  useEffect(() => {
    if (isAuthReady && activeUserId && resolvedPortfolioId) {
      loadInitialPage(false);
    }
  }, [isAuthReady, activeUserId, resolvedPortfolioId, activeFilter, debouncedSearch, loadInitialPage]);

  // 6. Stable subscription to portfolio changes (Does NOT re-subscribe on filter/search changes)
  const loadInitialPageRef = useRef(loadInitialPage);
  loadInitialPageRef.current = loadInitialPage;

  const activePortfolioIdRef = useRef(resolvedPortfolioId);
  activePortfolioIdRef.current = resolvedPortfolioId;

  useEffect(() => {
    if (!resolvedPortfolioId || !activeUserId) return;

    const subscriptionScopeKey = buildPortfolioSubscriptionScopeKey(
      activeUserId,
      resolvedPortfolioId
    );

    const unsubscribe = subscribePortfolioChanges(() => {
      const currentActiveScopeKey = buildPortfolioSubscriptionScopeKey(
        activeUserIdRef.current,
        activePortfolioIdRef.current
      );

      if (
        shouldAcceptPortfolioChangeNotification(
          subscriptionScopeKey,
          currentActiveScopeKey
        )
      ) {
        log.debug('portfolio.activity.refresh.requested', {
          message: 'Portfolio activity refresh requested.'
        });
        loadInitialPageRef.current(true);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [resolvedPortfolioId, activeUserId]);

  // 7. Load more (Keyset pagination next page with live activeQueryKeyRef validation)
  const loadMore = useCallback(async () => {
    const currentState = rawStateRef.current;
    const canTrigger = canTriggerLoadMore({
      isLoadingMore: isLoadingMoreRef.current,
      isLoadingInitial,
      isRefreshing,
      hasMore: currentState.hasMore,
      hasCursor: Boolean(currentState.nextCursor),
      hasPortfolio: Boolean(resolvedPortfolioId),
      hasUser: Boolean(activeUserId),
      isQueryMatch: currentState.loadedQueryKey === activeQueryKeyRef.current,
    });

    if (!canTrigger) {
      return;
    }

    const currentToken = ++loadMoreTokenSeq.current;
    const currentQueryKey = activeQueryKeyRef.current;
    const currentCursor = currentState.nextCursor;

    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      log.debug('portfolio.activity.next.loading', {
        message: 'Portfolio activity next loading.',
        context: { hasCursor: Boolean(currentCursor), filter: activeFilter, hasSearch: Boolean(debouncedSearch), currentToken }
      });

      const result = await fetchPortfolioActivityPage({
        portfolioId: resolvedPortfolioId!,
        limit: PORTFOLIO_ACTIVITY_PAGE_SIZE,
        filter: activeFilter,
        search: debouncedSearch,
        cursor: currentCursor,
      });

      // Validate against live activeQueryKeyRef and token
      if (
        !shouldAcceptLoadMoreResult({
          requestToken: currentToken,
          activeToken: loadMoreTokenSeq.current,
          requestQueryKey: currentQueryKey,
          activeQueryKey: activeQueryKeyRef.current,
        }) ||
        !isMountedRef.current
      ) {
        log.debug('portfolio.activity.next.discarded', {
          message: 'Portfolio activity next discarded.'
        });
        return;
      }

      setRawState((prev) => {
        if (prev.loadedQueryKey !== currentQueryKey) return prev;
        return {
          ...prev,
          items: reduceLoadMoreItems(prev.items, result.items),
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
          isStale: result.isStale,
          loadMoreError: null,
        };
      });
    } catch (err: unknown) {
      if (
        !shouldAcceptLoadMoreResult({
          requestToken: currentToken,
          activeToken: loadMoreTokenSeq.current,
          requestQueryKey: currentQueryKey,
          activeQueryKey: activeQueryKeyRef.current,
        }) ||
        !isMountedRef.current
      ) {
        return;
      }

      const errMsg =
        err instanceof Error ? err.message : 'Sonraki sayfa yüklenemedi.';
      log.warn('portfolio.activity.next.failed', {
        message: 'Portfolio activity next failed.',
        error: err
      });

      setRawState((prev) => {
        if (prev.loadedQueryKey !== currentQueryKey) return prev;
        return {
          ...prev,
          loadMoreError: errMsg,
        };
      });
    } finally {
      if (
        shouldAcceptLoadMoreFinally(currentToken, loadMoreTokenSeq.current) &&
        isMountedRef.current
      ) {
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    }
  }, [
    isLoadingInitial,
    isRefreshing,
    resolvedPortfolioId,
    activeUserId,
    activeFilter,
    debouncedSearch,
  ]);

  const retryLoadMore = useCallback(async () => {
    await loadMore();
  }, [loadMore]);

  const refresh = useCallback(async () => {
    await loadInitialPage(true);
  }, [loadInitialPage]);

  const setFilter = useCallback((filter: PortfolioActivityFilter) => {
    setActiveFilterState(filter);
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryState(query);
  }, []);

  // 8. Zero-Frame Render-Time Query Scoping (Includes all metadata)
  const queryScoped = useMemo(() => {
    return resolveQueryScopedActivityState(
      activeQueryKey,
      rawState.loadedQueryKey,
      rawState
    );
  }, [activeQueryKey, rawState]);

  // 9. Deterministic View-State Resolution
  const viewState = useMemo(() => {
    return resolvePortfolioActivityViewState({
      isAuthReady,
      hasAuthUser: Boolean(activeUserId),
      authError,
      hasPortfolio: Boolean(resolvedPortfolioId),
      isResolvingPortfolio,
      portfolioResolutionError,
      isActiveQueryLoaded: queryScoped.isQueryMatch,
      isLoadingInitial,
      isRefreshing,
      isLoadingMore,
      initialError: queryScoped.initialError,
      loadMoreError: queryScoped.loadMoreError,
      isStale: queryScoped.isStale,
      itemCount: queryScoped.items.length,
      activeFilter,
      searchQuery: debouncedSearch,
    });
  }, [
    isAuthReady,
    activeUserId,
    authError,
    resolvedPortfolioId,
    isResolvingPortfolio,
    portfolioResolutionError,
    queryScoped,
    isLoadingInitial,
    isRefreshing,
    isLoadingMore,
    activeFilter,
    debouncedSearch,
  ]);

  return {
    items: queryScoped.items,
    sections: queryScoped.sections,
    activeFilter,
    searchQuery,
    debouncedSearch,
    hasMore: queryScoped.hasMore,
    isLoadingInitial,
    isRefreshing,
    isLoadingMore,
    isStale: queryScoped.isStale,
    initialError: queryScoped.initialError,
    loadMoreError: queryScoped.loadMoreError,
    isResolvingPortfolio,
    portfolioResolutionError,
    viewState,
    portfolioId: resolvedPortfolioId,
    portfolioName,
    setFilter,
    setSearchQuery,
    refresh,
    loadMore,
    retryLoadMore,
    retryAuth,
    retryPortfolioResolution: resolvePortfolio,
  };
}
