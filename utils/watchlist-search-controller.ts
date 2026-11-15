/**
 * Lucrari — Watchlist Search Pagination Controller & Pure Reducer
 * 
 * Manages search pagination (0 -> 20 -> 40 -> 60), monotonic generation-based race condition protection,
 * duplicate instrument filtering without cursor corruption, and clean lifecycle reset on modal close.
 */

import type { ExtendedMarketType } from '@/types/database';
import type { InstrumentWithPrice } from '@/services/portfolio/instrument-service';

export interface WatchlistSearchState {
  query: string;
  category: ExtendedMarketType;
  generationId: number;
  items: InstrumentWithPrice[]; // Unique cards displayed in UI
  nextOffset: number; // Raw server offset consumed (independent of duplicate items)
  inFlightOffset: number | null;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
}

export function createInitialSearchState(
  query = '',
  category: ExtendedMarketType = 'ALL',
  generationId = 0
): WatchlistSearchState {
  return {
    query,
    category,
    generationId,
    items: [],
    nextOffset: 0,
    inFlightOffset: null,
    hasMore: true,
    isLoading: false,
    isLoadingMore: false,
    error: null,
  };
}

export function startSearchQueryOrCategory(
  state: WatchlistSearchState,
  newQuery: string,
  newCategory: ExtendedMarketType,
  explicitGenerationId?: number
): { state: WatchlistSearchState; generationId: number; targetOffset: number } {
  const nextGen = typeof explicitGenerationId === 'number' ? explicitGenerationId : state.generationId + 1;
  const nextState: WatchlistSearchState = {
    query: newQuery,
    category: newCategory,
    generationId: nextGen,
    items: [],
    nextOffset: 0,
    inFlightOffset: 0,
    hasMore: true,
    isLoading: true,
    isLoadingMore: false,
    error: null,
  };

  return { state: nextState, generationId: nextGen, targetOffset: 0 };
}

export function startSearchLoadMore(
  state: WatchlistSearchState,
  explicitGenerationId?: number
): { canLoad: boolean; state: WatchlistSearchState; targetOffset: number; generationId: number } {
  const effectiveGen = typeof explicitGenerationId === 'number' ? explicitGenerationId : state.generationId;

  if (
    !state.hasMore ||
    state.isLoading ||
    state.isLoadingMore ||
    state.inFlightOffset !== null
  ) {
    return { canLoad: false, state, targetOffset: 0, generationId: effectiveGen };
  }

  const targetOffset = state.nextOffset;
  const nextState: WatchlistSearchState = {
    ...state,
    generationId: effectiveGen,
    inFlightOffset: targetOffset,
    isLoadingMore: true,
    error: null,
  };

  return { canLoad: true, state: nextState, targetOffset, generationId: effectiveGen };
}

export function applySearchSuccess(
  state: WatchlistSearchState,
  generationId: number,
  targetOffset: number,
  rawItems: InstrumentWithPrice[],
  hasMoreFromApi: boolean
): WatchlistSearchState {
  // Reject stale generations from superseded queries, categories, or closed modal sessions
  if (generationId !== state.generationId) {
    return state;
  }

  // Calculate nextOffset strictly from raw server consumed rows: targetOffset + rawItems.length
  const rawCount = rawItems.length;
  const computedNextOffset = targetOffset + rawCount;
  const effectiveHasMore = hasMoreFromApi && rawCount > 0;

  if (targetOffset === 0) {
    // Initial page: Deduplicate for UI
    const seen = new Set<string>();
    const deduped: InstrumentWithPrice[] = [];
    for (const item of rawItems) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        deduped.push(item);
      }
    }

    return {
      ...state,
      items: deduped,
      nextOffset: computedNextOffset,
      inFlightOffset: null,
      hasMore: effectiveHasMore,
      isLoading: false,
      isLoadingMore: false,
      error: null,
    };
  }

  // Load-more page: Merge and deduplicate against existing items for UI display
  const seen = new Set<string>(state.items.map((it) => it.id));
  const dedupedNew: InstrumentWithPrice[] = [];

  for (const item of rawItems) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      dedupedNew.push(item);
    }
  }

  const mergedItems = [...state.items, ...dedupedNew];

  return {
    ...state,
    items: mergedItems,
    nextOffset: computedNextOffset,
    inFlightOffset: null,
    hasMore: effectiveHasMore,
    isLoading: false,
    isLoadingMore: false,
    error: null,
  };
}

export function applySearchFailure(
  state: WatchlistSearchState,
  generationId: number,
  error: string
): WatchlistSearchState {
  if (generationId !== state.generationId) {
    return state;
  }

  return {
    ...state,
    inFlightOffset: null,
    isLoading: false,
    isLoadingMore: false,
    error,
  };
}
