/**
 * Lucrari — Focus Refresh Decision Engine
 * 
 * Pure, deterministic evaluation for screen focus re-fetching.
 * Prevents:
 * - Duplicate requests during initial load (`lastFetchedTimestamp <= 0` or `isLoading`)
 * - Concurrent re-fetching during active pull-to-refresh (`isRefreshing`)
 * - Infinite error retry loops on tab switching when in error state (`Boolean(error)`)
 * - Unnecessary network traffic before TTL expiration
 */

export interface ShouldRefreshOnFocusParams {
  isLoading: boolean;
  isRefreshing: boolean;
  error: unknown;
  lastFetchedTimestamp: number;
  now?: number;
  ttlMs?: number;
}

export const FOCUS_REFETCH_STALE_TTL_MS = 30000;

/**
 * Determines whether a screen or tab gaining focus should trigger a portfolio refresh.
 */
export function shouldRefreshOnFocus({
  isLoading,
  isRefreshing,
  error,
  lastFetchedTimestamp,
  now = Date.now(),
  ttlMs = FOCUS_REFETCH_STALE_TTL_MS,
}: ShouldRefreshOnFocusParams): boolean {
  if (isLoading) return false;
  if (isRefreshing) return false;
  if (error !== null && error !== undefined && error !== false && error !== '') return false;
  if (lastFetchedTimestamp <= 0) return false;
  return now - lastFetchedTimestamp >= ttlMs;
}
