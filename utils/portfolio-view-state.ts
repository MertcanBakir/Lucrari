/**
 * Lucrari — Pure Portfolio View State Decision Engine
 * 
 * Determines dashboard display states (initial loading, initial error, stale data, readiness):
 * - If data has never loaded successfully before (hasLoadedSuccessfully = false / lastFetchedTimestamp <= 0),
 *   errors show the full initial PortfolioErrorView.
 * - Once data has loaded successfully at least once (hasLoadedSuccessfully = true / lastFetchedTimestamp > 0),
 *   subsequent refresh errors retain cached positions/cash and display stale data indicators
 *   rather than replacing the screen with a full error view (even for 0-position cash-only portfolios).
 */

export interface ResolvePortfolioViewStateParams {
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  hasLoadedSuccessfully: boolean;
}

export interface PortfolioViewState {
  isInitialLoading: boolean;
  isInitialError: boolean;
  showStaleBanner: boolean;
  isReady: boolean;
}

/**
 * Resolves the visual and interactive state of the portfolio screen.
 */
export function resolvePortfolioViewState({
  isLoading,
  error,
  hasLoadedSuccessfully,
}: ResolvePortfolioViewStateParams): PortfolioViewState {
  // 1. Initial load cycle (never loaded successfully before)
  if (!hasLoadedSuccessfully) {
    if (error) {
      return {
        isInitialLoading: false,
        isInitialError: true,
        showStaleBanner: false,
        isReady: false,
      };
    }
    return {
      isInitialLoading: isLoading,
      isInitialError: false,
      showStaleBanner: false,
      isReady: false,
    };
  }

  // 2. Subsequent refresh cycle (has loaded data successfully in the past)
  // Preserves cached cash and positions; marks data as stale on refresh failure
  return {
    isInitialLoading: false,
    isInitialError: false,
    showStaleBanner: Boolean(error),
    isReady: true,
  };
}
