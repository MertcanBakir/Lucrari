/**
 * Lucrari — Watchlist View State Pure Engine & Resolver
 * 
 * Pure, deterministic functions resolving 10 distinct UI and view states for Watchlist:
 * 1. Initial Loading
 * 2. Initial Error (prevents false empty card during errors)
 * 3. True Empty Watchlist (totalCount === 0 after successful load)
 * 4. Normal Ready State (items displayed)
 * 5. Stale Data (retains data with refresh banner on background failure)
 * 6. Page Loading (small card spinner while retaining current committed page)
 * 7. Page Error (retains previous page, shows banner and retry)
 * 8. Auth Not Ready
 * 9. Auth Failed
 * 10. Mutation Pending
 */

import type { WatchlistItem, WatchlistPageResult, WatchlistMembershipResult } from '@/types/watchlist';
import { formatWatchlistRpcError } from './watchlist-errors';

export type WatchlistViewStateKind =
  | 'auth_not_ready'
  | 'auth_failed'
  | 'initial_loading'
  | 'initial_error'
  | 'true_empty'
  | 'page_loading'
  | 'page_error'
  | 'stale_data'
  | 'ready';

export interface ResolveWatchlistViewStateParams {
  isAuthReady: boolean;
  userId: string | null;
  authError: string | null;
  isLoading: boolean;
  isPageLoading: boolean;
  error: Error | string | null;
  hasLoadedSuccessfully: boolean;
  totalCount: number;
  itemsCount: number;
  isStale: boolean;
  pendingInstrumentIdsCount: number;
}

export interface WatchlistViewStateResolution {
  state: WatchlistViewStateKind;
  showInitialSpinner: boolean;
  showPageLoadingOverlay: boolean;
  errorMessage: string | null;
  showStaleBanner: boolean;
  staleNoticeText: string | null;
  showEmptyCard: boolean;
  showContentList: boolean;
  isActionDisabled: boolean;
}

/**
 * Pure evaluator for Watchlist view state.
 */
export function resolveWatchlistViewState(
  params: ResolveWatchlistViewStateParams
): WatchlistViewStateResolution {
  const {
    isAuthReady,
    userId,
    authError,
    isLoading,
    isPageLoading,
    error,
    hasLoadedSuccessfully,
    totalCount,
    itemsCount,
    isStale,
  } = params;

  // 1. Auth not ready
  if (!isAuthReady) {
    return {
      state: 'auth_not_ready',
      showInitialSpinner: true,
      showPageLoadingOverlay: false,
      errorMessage: null,
      showStaleBanner: false,
      staleNoticeText: null,
      showEmptyCard: false,
      showContentList: false,
      isActionDisabled: true,
    };
  }

  // 2. Auth ready but no user session
  if (!userId) {
    return {
      state: 'auth_failed',
      showInitialSpinner: false,
      showPageLoadingOverlay: false,
      errorMessage: authError || 'İzleme listesini görüntülemek için oturum açılması gerekmektedir.',
      showStaleBanner: false,
      staleNoticeText: null,
      showEmptyCard: false,
      showContentList: false,
      isActionDisabled: true,
    };
  }

  // 3. Initial loading (no data loaded yet)
  if (isLoading && !hasLoadedSuccessfully) {
    return {
      state: 'initial_loading',
      showInitialSpinner: true,
      showPageLoadingOverlay: false,
      errorMessage: null,
      showStaleBanner: false,
      staleNoticeText: null,
      showEmptyCard: false,
      showContentList: false,
      isActionDisabled: false,
    };
  }

  // 4. Initial error (fetch failed and no previous data)
  if (error && !hasLoadedSuccessfully) {
    return {
      state: 'initial_error',
      showInitialSpinner: false,
      showPageLoadingOverlay: false,
      errorMessage: formatWatchlistRpcError(error),
      showStaleBanner: false,
      staleNoticeText: null,
      showEmptyCard: false,
      showContentList: false,
      isActionDisabled: false,
    };
  }

  // 5. Subsequent page loading (data already loaded, transitioning page)
  if (isPageLoading && hasLoadedSuccessfully) {
    return {
      state: 'page_loading',
      showInitialSpinner: false,
      showPageLoadingOverlay: true,
      errorMessage: null,
      showStaleBanner: false,
      staleNoticeText: null,
      showEmptyCard: false,
      showContentList: true,
      isActionDisabled: false,
    };
  }

  // 6. Page error (subsequent page request failed, preserving previous page)
  if (error && hasLoadedSuccessfully && !isStale) {
    return {
      state: 'page_error',
      showInitialSpinner: false,
      showPageLoadingOverlay: false,
      errorMessage: formatWatchlistRpcError(error),
      showStaleBanner: false,
      staleNoticeText: null,
      showEmptyCard: false,
      showContentList: true,
      isActionDisabled: false,
    };
  }

  // 7. Stale data (background refresh failed or marked stale)
  if (isStale && hasLoadedSuccessfully) {
    return {
      state: 'stale_data',
      showInitialSpinner: false,
      showPageLoadingOverlay: false,
      errorMessage: null,
      showStaleBanner: true,
      staleNoticeText: 'İzleme listesi verisi güncel olmayabilir.',
      showEmptyCard: totalCount === 0,
      showContentList: totalCount > 0 && itemsCount > 0,
      isActionDisabled: false,
    };
  }

  // 8. True empty watchlist (successfully loaded and totalCount === 0)
  if (hasLoadedSuccessfully && totalCount === 0) {
    return {
      state: 'true_empty',
      showInitialSpinner: false,
      showPageLoadingOverlay: false,
      errorMessage: null,
      showStaleBanner: false,
      staleNoticeText: null,
      showEmptyCard: true,
      showContentList: false,
      isActionDisabled: false,
    };
  }

  // 9. Normal Ready state
  return {
    state: 'ready',
    showInitialSpinner: false,
    showPageLoadingOverlay: false,
    errorMessage: null,
    showStaleBanner: false,
    staleNoticeText: null,
    showEmptyCard: false,
    showContentList: true,
    isActionDisabled: false,
  };
}

/**
 * Pure helper for pagination calculation:
 * Strictly derives the range text from the COMMITTED page index and item count.
 * Returns start/end range text, e.g. "1–20 / 47" or "1–5 / 47".
 */
export function formatPaginationRangeText(
  committedPageIndex: number,
  pageSize: number,
  totalCount: number,
  itemsCount: number
): string {
  if (totalCount <= 0 || itemsCount <= 0) {
    return '0 / 0';
  }

  const start = committedPageIndex * pageSize + 1;
  const end = Math.min(start + itemsCount - 1, totalCount);

  return `${start}–${end} / ${totalCount}`;
}

export interface UserScopedWatchlistRawState {
  stateUserId: string | null;
  committedPageIndex: number;
  requestedPageIndex: number;
  failedPageIndex: number | null;
  pageResult: WatchlistPageResult | null;
  isLoading: boolean;
  isPageLoading: boolean;
  isStale: boolean;
  error: Error | null;
  hasLoadedSuccessfully: boolean;
}

export interface ResolveUserScopedWatchlistParams {
  rawState: UserScopedWatchlistRawState;
  currentUserId: string | null;
  isAuthReady: boolean;
  authError: string | null;
  isExpanded: boolean;
  snapshot: WatchlistPageResult | null;
}

/**
 * Pure selector computing the effective watchlist state on every render frame.
 * Guarantees that if the context userId switches from User A to User B, User A's items
 * are NEVER exposed on the transition render frame, even before useEffect runs.
 */
export function resolveUserScopedWatchlistState(
  params: ResolveUserScopedWatchlistParams
): {
  items: WatchlistItem[];
  allItemsOnPage: WatchlistItem[];
  totalCount: number;
  committedPageIndex: number;
  failedPageIndex: number | null;
  isLoading: boolean;
  isPageLoading: boolean;
  isStale: boolean;
  error: Error | null;
  hasLoadedSuccessfully: boolean;
} {
  const { rawState, currentUserId, isAuthReady, authError, isExpanded, snapshot } = params;

  // 1. Auth not ready yet -> Loading state
  if (!isAuthReady) {
    return {
      items: [],
      allItemsOnPage: [],
      totalCount: 0,
      committedPageIndex: 0,
      failedPageIndex: null,
      isLoading: true,
      isPageLoading: false,
      isStale: false,
      error: null,
      hasLoadedSuccessfully: false,
    };
  }

  // 2. Auth ready but no user session -> Controlled error state
  if (!currentUserId) {
    return {
      items: [],
      allItemsOnPage: [],
      totalCount: 0,
      committedPageIndex: 0,
      failedPageIndex: null,
      isLoading: false,
      isPageLoading: false,
      isStale: false,
      error: authError ? new Error(authError) : new Error('Kullanıcı oturumu doğrulanamadı.'),
      hasLoadedSuccessfully: false,
    };
  }

  // 3. User changed and rawState belongs to a previous user -> Use current user's snapshot or clean state
  if (rawState.stateUserId !== currentUserId) {
    if (snapshot) {
      const allItems = snapshot.items;
      const visibleItems = isExpanded ? allItems : allItems.slice(0, 5);
      const committedPageIndex = Math.floor(snapshot.offset / (snapshot.limit || 20));
      return {
        items: visibleItems,
        allItemsOnPage: allItems,
        totalCount: snapshot.totalCount,
        committedPageIndex,
        failedPageIndex: null,
        isLoading: false,
        isPageLoading: false,
        isStale: snapshot.isStale,
        error: null,
        hasLoadedSuccessfully: true,
      };
    }
    return {
      items: [],
      allItemsOnPage: [],
      totalCount: 0,
      committedPageIndex: 0,
      failedPageIndex: null,
      isLoading: true,
      isPageLoading: false,
      isStale: false,
      error: null,
      hasLoadedSuccessfully: false,
    };
  }

  // 4. Raw state belongs to current user
  const allItems = rawState.pageResult?.items || [];
  const visibleItems = isExpanded ? allItems : allItems.slice(0, 5);
  const totalCount = rawState.pageResult?.totalCount ?? (rawState.hasLoadedSuccessfully ? allItems.length : 0);

  return {
    items: visibleItems,
    allItemsOnPage: allItems,
    totalCount,
    committedPageIndex: rawState.committedPageIndex,
    failedPageIndex: rawState.failedPageIndex,
    isLoading: rawState.isLoading,
    isPageLoading: rawState.isPageLoading,
    isStale: rawState.isStale,
    error: rawState.error,
    hasLoadedSuccessfully: rawState.hasLoadedSuccessfully,
  };
}

/**
 * Pure helper validating whether an async watchlist page result can be accepted into hook state.
 */
export function shouldAcceptWatchlistResult(params: {
  isMounted: boolean;
  currentUserId: string | null;
  activeUserId: string;
  dataUserId: string;
  requestId?: number;
  activeRequestId?: number;
  responseOffset?: number;
  expectedOffset?: number;
}): boolean {
  const {
    isMounted,
    currentUserId,
    activeUserId,
    dataUserId,
    requestId,
    activeRequestId,
    responseOffset,
    expectedOffset,
  } = params;

  if (!isMounted) return false;
  if (!currentUserId || currentUserId !== activeUserId || dataUserId !== activeUserId) return false;
  if (requestId !== undefined && activeRequestId !== undefined && requestId !== activeRequestId) return false;
  if (responseOffset !== undefined && expectedOffset !== undefined && responseOffset !== expectedOffset) return false;

  return true;
}

export interface RawMembershipState {
  stateUserId: string | null;
  membershipSet: Set<string>;
  isLoading: boolean;
  isStale: boolean;
  error: string | null;
}

export interface ResolveUserScopedMembershipParams {
  rawMembership: RawMembershipState;
  currentUserId: string | null;
  isAuthReady: boolean;
  snapshot: WatchlistMembershipResult | null;
}

/**
 * Pure selector computing the effective membership set on every render frame.
 * Guarantees that if the context userId switches from User A to User B, User A's membership Set
 * is NEVER exposed on the transition render frame, even before useEffect runs.
 */
export function resolveUserScopedMembershipState(
  params: ResolveUserScopedMembershipParams
): {
  watchedInstrumentIds: Set<string>;
  isMembershipLoading: boolean;
  isMembershipStale: boolean;
  membershipError: string | null;
} {
  const { rawMembership, currentUserId, isAuthReady, snapshot } = params;

  if (!isAuthReady || !currentUserId) {
    return {
      watchedInstrumentIds: new Set<string>(),
      isMembershipLoading: false,
      isMembershipStale: false,
      membershipError: null,
    };
  }

  if (rawMembership.stateUserId !== currentUserId) {
    if (snapshot) {
      return {
        watchedInstrumentIds: new Set(snapshot.instrumentIds),
        isMembershipLoading: false,
        isMembershipStale: snapshot.isStale,
        membershipError: null,
      };
    }
    return {
      watchedInstrumentIds: new Set<string>(),
      isMembershipLoading: false,
      isMembershipStale: false,
      membershipError: null,
    };
  }

  return {
    watchedInstrumentIds: rawMembership.membershipSet,
    isMembershipLoading: rawMembership.isLoading,
    isMembershipStale: rawMembership.isStale,
    membershipError: rawMembership.error,
  };
}
