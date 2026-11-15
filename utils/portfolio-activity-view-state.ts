/**
 * Lucrari — Portfolio Activity View State Resolution Engine
 * 
 * Pure, deterministic resolver for resolving unambiguous UI view states for Portfolio Activity.
 * Strictly scopes all data and metadata (items, sections, hasMore, nextCursor, isStale, initialError, loadMoreError)
 * to the active Query Identity (userId + portfolioId + filter + normalizedSearch) for render-time zero-frame leakage prevention.
 * 
 * Strictly separates:
 * - Auth not ready / Auth failure
 * - Portfolio resolution loading / Portfolio resolution failure
 * - Initial loading / Initial query error
 * - Stale fallback data / Empty states (true vs filtered)
 */

import type {
  PortfolioActivityFilter,
  PortfolioActivityItem,
  PortfolioActivitySection,
  PortfolioActivityCursor,
} from '@/types/portfolio-activity';
import { groupActivitiesByDate } from '@/utils/portfolio-activity-formatters';

export type PortfolioActivityViewState =
  | 'auth_not_ready'
  | 'auth_failed'
  | 'initial_loading'
  | 'initial_error'
  | 'true_empty'
  | 'filtered_empty'
  | 'ready'
  | 'stale_data'
  | 'refreshing'
  | 'loading_more'
  | 'load_more_error';

export type PortfolioResolutionStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UserScopedPortfolioState {
  status: PortfolioResolutionStatus;
  userId: string | null;
  portfolioId: string | null;
  portfolioName: string | null;
  error: string | null;
  isResolvingPortfolio: boolean;
  isUserMatch: boolean;
}

export interface UserScopedActivityState {
  items: PortfolioActivityItem[];
  sections: PortfolioActivitySection[];
  isUserMatch: boolean;
}

export interface QueryScopedActivityState {
  items: PortfolioActivityItem[];
  sections: PortfolioActivitySection[];
  hasMore: boolean;
  nextCursor: PortfolioActivityCursor | null;
  isStale: boolean;
  initialError: string | null;
  loadMoreError: string | null;
  isQueryMatch: boolean;
}

/**
 * Builds deterministic query identity key incorporating user, portfolio, filter, and search.
 */
export function buildActivityQueryKey(
  userId: string | null | undefined,
  portfolioId: string | null | undefined,
  filter: PortfolioActivityFilter,
  debouncedSearch: string
): string {
  const normSearch = (debouncedSearch || '').trim().toLowerCase();
  const uId = (userId || '').trim() || 'anon';
  const pId = (portfolioId || '').trim() || 'none';
  return `${uId}:${pId}:${filter}:${normSearch}`;
}

/**
 * Pure render-time scoping helper to prevent even a single frame of data or metadata
 * (items, sections, hasMore, nextCursor, isStale, initialError, loadMoreError) from
 * leaking across User A -> User B, Portfolio A -> Portfolio B, or Query A -> Query B transitions.
 */
export function resolveQueryScopedActivityState(
  activeQueryKey: string,
  loadedQueryKey: string | null,
  rawState:
    | PortfolioActivityItem[]
    | {
        items: PortfolioActivityItem[];
        hasMore?: boolean;
        nextCursor?: PortfolioActivityCursor | null;
        isStale?: boolean;
        initialError?: string | null;
        loadMoreError?: string | null;
      }
): QueryScopedActivityState {
  const isQueryMatch = Boolean(
    activeQueryKey && loadedQueryKey && activeQueryKey === loadedQueryKey
  );

  if (!isQueryMatch) {
    return {
      items: [],
      sections: [],
      hasMore: false,
      nextCursor: null,
      isStale: false,
      initialError: null,
      loadMoreError: null,
      isQueryMatch: false,
    };
  }

  const items = Array.isArray(rawState) ? rawState : rawState.items || [];
  const hasMore = Array.isArray(rawState) ? false : Boolean(rawState.hasMore);
  const nextCursor = Array.isArray(rawState) ? null : rawState.nextCursor ?? null;
  const isStale = Array.isArray(rawState) ? false : Boolean(rawState.isStale);
  const initialError = Array.isArray(rawState) ? null : rawState.initialError ?? null;
  const loadMoreError = Array.isArray(rawState) ? null : rawState.loadMoreError ?? null;

  return {
    items,
    sections: groupActivitiesByDate(items),
    hasMore,
    nextCursor,
    isStale,
    initialError,
    loadMoreError,
    isQueryMatch: true,
  };
}

/**
 * Pure render-time scoping helper for user-scoped portfolio resolution state.
 * Scopes portfolioId, portfolioName, status, error, and isResolvingPortfolio strictly to activeUserId.
 * If activeUserId does not match state.userId, old errors and IDs are immediately wiped and resolution defaults to loading.
 */
export function resolveUserScopedPortfolioState(
  activeUserId: string | null,
  state: {
    status?: PortfolioResolutionStatus;
    userId: string | null;
    portfolioId: string | null;
    portfolioName: string | null;
    error?: string | null;
  },
  isAuthReady = true
): UserScopedPortfolioState {
  const hasActiveUser = Boolean(activeUserId && activeUserId.trim().length > 0);
  const isMatch = Boolean(hasActiveUser && state.userId === activeUserId);

  if (!isMatch) {
    const isResolving = isAuthReady && hasActiveUser;
    return {
      status: isResolving ? 'loading' : 'idle',
      userId: activeUserId,
      portfolioId: null,
      portfolioName: null,
      error: null,
      isResolvingPortfolio: isResolving,
      isUserMatch: false,
    };
  }

  const status =
    state.status ||
    (state.error ? 'error' : state.portfolioId ? 'success' : 'loading');
  const isResolving = status === 'loading';

  return {
    status,
    userId: state.userId,
    portfolioId: state.portfolioId,
    portfolioName: state.portfolioName,
    error: state.error || null,
    isResolvingPortfolio: isResolving,
    isUserMatch: true,
  };
}

/**
 * Pure decision function to determine if a new default portfolio resolution should be triggered.
 */
export interface ShouldTriggerPortfolioResolutionParams {
  isAuthReady: boolean;
  activeUserId: string | null;
  customPortfolioId?: string;
  currentResolutionUserId: string | null;
  currentResolutionStatus: PortfolioResolutionStatus;
}

export function shouldTriggerPortfolioResolution(
  params: ShouldTriggerPortfolioResolutionParams
): boolean {
  if (params.customPortfolioId) {
    return true;
  }

  if (!params.isAuthReady || !params.activeUserId) {
    return false;
  }

  // Avoid duplicate resolution if already resolving or resolved for this exact user
  if (
    params.currentResolutionUserId === params.activeUserId &&
    (params.currentResolutionStatus === 'loading' || params.currentResolutionStatus === 'success')
  ) {
    return false;
  }

  return true;
}

/**
 * Backward-compatible helper for user-scoping items.
 */
export function resolveUserScopedActivityState(
  loadedUserId: string | null,
  activeUserId: string | null,
  items: PortfolioActivityItem[]
): UserScopedActivityState {
  if (!activeUserId || !loadedUserId || loadedUserId !== activeUserId) {
    return {
      items: [],
      sections: [],
      isUserMatch: false,
    };
  }

  return {
    items,
    sections: groupActivitiesByDate(items),
    isUserMatch: true,
  };
}

/**
 * Decision controller for asynchronous portfolio resolution races.
 * Verifies that the component is still mounted, request generation token is active,
 * and the resolution belongs to the currently active user (not a stale closure value).
 */
export interface PortfolioResolutionAcceptParams {
  isMounted: boolean;
  requestToken: number;
  activeToken: number;
  requestUserId: string | null;
  currentActiveUserId: string | null;
}

export function shouldAcceptPortfolioResolutionResult(
  params: PortfolioResolutionAcceptParams
): boolean {
  return (
    params.isMounted &&
    params.requestToken === params.activeToken &&
    params.requestUserId !== null &&
    params.requestUserId === params.currentActiveUserId
  );
}

/**
 * Controller parameters and guards for load-more pagination.
 */
export interface CanTriggerLoadMoreParams {
  isLoadingMore: boolean;
  isLoadingInitial: boolean;
  isRefreshing: boolean;
  hasMore: boolean;
  hasCursor: boolean;
  hasPortfolio: boolean;
  hasUser: boolean;
  isQueryMatch: boolean;
}

export function canTriggerLoadMore(params: CanTriggerLoadMoreParams): boolean {
  return (
    !params.isLoadingMore &&
    !params.isLoadingInitial &&
    !params.isRefreshing &&
    params.hasMore &&
    params.hasCursor &&
    params.hasPortfolio &&
    params.hasUser &&
    params.isQueryMatch
  );
}

export interface ShouldAcceptLoadMoreResultParams {
  requestToken: number;
  activeToken: number;
  requestQueryKey: string;
  activeQueryKey: string;
}

export function shouldAcceptLoadMoreResult(
  params: ShouldAcceptLoadMoreResultParams
): boolean {
  return (
    params.requestToken === params.activeToken &&
    params.requestQueryKey === params.activeQueryKey
  );
}

export function shouldAcceptLoadMoreFinally(
  requestToken: number,
  activeToken: number
): boolean {
  return requestToken === activeToken;
}

export function reduceLoadMoreItems(
  existingItems: PortfolioActivityItem[],
  newItems: PortfolioActivityItem[]
): PortfolioActivityItem[] {
  const existingKeys = new Set(existingItems.map((i) => i.compositeKey));
  const uniqueIncoming = newItems.filter((i) => !existingKeys.has(i.compositeKey));
  return [...existingItems, ...uniqueIncoming];
}

/**
 * Pure Subscription Scope Key and notification acceptance helpers.
 */
export function buildPortfolioSubscriptionScopeKey(
  userId: string | null | undefined,
  portfolioId: string | null | undefined
): string {
  const uId = (userId || '').trim() || 'anon';
  const pId = (portfolioId || '').trim() || 'none';
  return `${uId}:${pId}`;
}

export function shouldAcceptPortfolioChangeNotification(
  notificationScopeKey: string,
  activeScopeKey: string
): boolean {
  return (
    Boolean(notificationScopeKey) &&
    Boolean(activeScopeKey) &&
    notificationScopeKey === activeScopeKey &&
    !notificationScopeKey.includes('anon') &&
    !notificationScopeKey.includes('none')
  );
}

export interface ResolvePortfolioActivityViewStateParams {
  isAuthReady: boolean;
  hasAuthUser: boolean;
  authError?: string | null;
  hasPortfolio: boolean;
  isResolvingPortfolio?: boolean;
  portfolioResolutionError?: string | null;
  isActiveQueryLoaded: boolean;
  isLoadingInitial: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  initialError?: string | null;
  loadMoreError?: string | null;
  isStale: boolean;
  itemCount: number;
  activeFilter: PortfolioActivityFilter;
  searchQuery: string;
}

/**
 * Resolves the primary view state with strict priority:
 * 1. Auth not ready -> auth_not_ready
 * 2. Auth failed (authError or no auth user) -> auth_failed
 * 3. Portfolio resolution in progress -> initial_loading
 * 4. Portfolio resolution failed -> initial_error
 * 5. Query initial error -> initial_error
 * 6. Query initial loading -> initial_loading
 * 7. Active items exist:
 *    - isRefreshing -> refreshing
 *    - isLoadingMore -> loading_more
 *    - loadMoreError -> load_more_error
 *    - isStale -> stale_data
 *    - ready -> ready
 * 8. Empty states:
 *    - filter !== 'ALL' || search -> filtered_empty
 *    - true_empty
 */
export function resolvePortfolioActivityViewState(
  params: ResolvePortfolioActivityViewStateParams
): PortfolioActivityViewState {
  const {
    isAuthReady,
    hasAuthUser,
    authError,
    hasPortfolio,
    isResolvingPortfolio,
    portfolioResolutionError,
    isActiveQueryLoaded,
    isLoadingInitial,
    isRefreshing,
    isLoadingMore,
    initialError,
    loadMoreError,
    isStale,
    itemCount,
    activeFilter,
    searchQuery,
  } = params;

  // 1. Auth state verification
  if (!isAuthReady) {
    return 'auth_not_ready';
  }

  if (!hasAuthUser || Boolean(authError)) {
    return 'auth_failed';
  }

  // 2. Portfolio resolution state verification
  if (isResolvingPortfolio && !hasPortfolio) {
    return 'initial_loading';
  }

  if (portfolioResolutionError || !hasPortfolio) {
    return 'initial_error';
  }

  // 3. Initial error on active query (must NOT be masked as empty or stale)
  if (initialError && (!isActiveQueryLoaded || itemCount === 0)) {
    return 'initial_error';
  }

  // 4. Initial loading on active query
  if (!isActiveQueryLoaded || (itemCount === 0 && isLoadingInitial)) {
    return 'initial_loading';
  }

  // 5. Active items view states
  if (itemCount > 0) {
    if (isRefreshing) {
      return 'refreshing';
    }
    if (isLoadingMore) {
      return 'loading_more';
    }
    if (loadMoreError) {
      return 'load_more_error';
    }
    if (isStale) {
      return 'stale_data';
    }
    return 'ready';
  }

  // 6. Empty states (itemCount === 0, successfully loaded)
  const isSearchActive = Boolean(searchQuery && searchQuery.trim().length > 0);
  const isFilterActive = activeFilter !== 'ALL';

  if (isFilterActive || isSearchActive) {
    return 'filtered_empty';
  }

  return 'true_empty';
}
