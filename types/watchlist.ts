/**
 * Lucrari — Watchlist Domain Models, Types & Strict Fail-Closed Normalization
 * 
 * Strict data contract normalization for `get_my_watchlist` and `set_my_watchlist_item` RPCs.
 * Rejects fractional total_counts, out-of-range arrays, invalid markets, asset types, currencies, dates, and non-array responses.
 * Enforces strict price normalization contract:
 * - has_price=false: price and all related fields MUST be null/undefined (non-null rejects row).
 * - has_price=true: price (>0 finite), price_at (valid ISO date with timezone), price_is_stale (boolean) are mandatory.
 * Guarantees zero synthetic fallback prices or mock IDs.
 */

import type { MarketType, AssetType, CurrencyCode, WatchlistRpcItem } from './database';
import { isValidIsoTimestampWithTimezone } from '@/utils/validation';
export { isValidIsoTimestampWithTimezone };

export interface WatchlistItem {
  watchlistId: string;
  instrumentId: string;
  symbol: string;
  companyName: string;
  market: MarketType;
  assetType: AssetType;
  currency: CurrencyCode;
  isActive: boolean;
  hasPrice: boolean;
  price: number | null;
  changeAmount: number | null;
  changePercent: number | null;
  priceAt: string | null;
  priceIsStale: boolean | null;
  staleReason: string | null;
  addedAt: string;
}

export interface WatchlistPageResult {
  userId: string;
  items: WatchlistItem[];
  totalCount: number;
  limit: number;
  offset: number;
  timestamp: number;
  isStale: boolean;
}

export interface WatchlistMembershipResult {
  userId: string;
  instrumentIds: Set<string>;
  isStale: boolean;
  timestamp: number;
}

export interface SetWatchlistItemResult {
  instrumentId: string;
  isWatched: boolean;
  wasChanged: boolean;
  watchlistId: string | null;
}

export type ToggleWatchlistActionResult =
  | {
      success: true;
      isWatched: boolean;
      wasChanged: boolean;
      watchlistId: string | null;
    }
  | {
      success: false;
      error: string;
    };

export function createToggleWatchlistSuccessResult(
  result: SetWatchlistItemResult
): ToggleWatchlistActionResult {
  return {
    success: true,
    isWatched: result.isWatched,
    wasChanged: result.wasChanged,
    watchlistId: result.watchlistId,
  };
}

export function createToggleWatchlistErrorResult(
  error: string
): ToggleWatchlistActionResult {
  return {
    success: false,
    error,
  };
}

const VALID_MARKETS = new Set<MarketType>(['BIST100', 'NASDAQ100', 'CRYPTO', 'TEFAS', 'FX']);
const VALID_ASSET_TYPES = new Set<AssetType>(['stock', 'crypto', 'fund', 'fx']);
const VALID_CURRENCIES = new Set<CurrencyCode>(['TRY', 'USD']);

/**
 * Normalizes a single raw row from `get_my_watchlist` RPC with strict fail-closed contract validation.
 * Returns null if ANY mandatory field is missing, invalid, or improperly typed (no fallback guesswork).
 */
export function normalizeWatchlistRpcItem(raw: unknown): WatchlistItem | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const row = raw as Partial<WatchlistRpcItem>;

  const watchlistId = typeof row.watchlist_id === 'string' ? row.watchlist_id.trim() : '';
  const instrumentId = typeof row.instrument_id === 'string' ? row.instrument_id.trim() : '';
  const symbol = typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : '';
  const companyName = typeof row.company_name === 'string' ? row.company_name.trim() : '';

  if (!watchlistId || !instrumentId || !symbol || !companyName) {
    return null;
  }

  // Strict enum / type guards (NO fallback defaults)
  if (typeof row.market !== 'string' || !VALID_MARKETS.has(row.market as MarketType)) {
    return null;
  }
  const market = row.market as MarketType;

  if (typeof row.asset_type !== 'string' || !VALID_ASSET_TYPES.has(row.asset_type as AssetType)) {
    return null;
  }
  const assetType = row.asset_type as AssetType;

  if (typeof row.currency !== 'string' || !VALID_CURRENCIES.has(row.currency as CurrencyCode)) {
    return null;
  }
  const currency = row.currency as CurrencyCode;

  if (typeof row.is_active !== 'boolean') {
    return null;
  }
  const isActive = row.is_active;

  if (typeof row.has_price !== 'boolean') {
    return null;
  }

  if (!isValidIsoTimestampWithTimezone(row.added_at)) {
    return null;
  }
  const addedAt = (row.added_at as string).trim();

  let hasPrice = false;
  let price: number | null = null;
  let changeAmount: number | null = null;
  let changePercent: number | null = null;
  let priceAt: string | null = null;
  let priceIsStale: boolean | null = null;
  let staleReason: string | null = null;

  if (row.has_price === false) {
    // Strict contract: when has_price is false, price and all related fields MUST be null/undefined.
    // If any price field contains a non-null value, reject the row as corrupt contract violation.
    if (
      (row.price !== null && row.price !== undefined) ||
      (row.change_amount !== null && row.change_amount !== undefined) ||
      (row.change_percent !== null && row.change_percent !== undefined) ||
      (row.price_at !== null && row.price_at !== undefined) ||
      (row.price_is_stale !== null && row.price_is_stale !== undefined) ||
      (row.stale_reason !== null && row.stale_reason !== undefined)
    ) {
      return null;
    }
  } else {
    // has_price === true: price (>0 finite), price_at (valid ISO timestamptz), price_is_stale (boolean) are mandatory.
    if (
      typeof row.price !== 'number' ||
      !Number.isFinite(row.price) ||
      row.price <= 0
    ) {
      return null;
    }
    price = row.price;
    hasPrice = true;

    if (!isValidIsoTimestampWithTimezone(row.price_at)) {
      return null;
    }
    priceAt = (row.price_at as string).trim();

    if (typeof row.price_is_stale !== 'boolean') {
      return null;
    }
    priceIsStale = row.price_is_stale;

    // Optional change fields: must be null or finite number (real 0 is preserved)
    if (row.change_amount !== null && row.change_amount !== undefined) {
      if (typeof row.change_amount !== 'number' || !Number.isFinite(row.change_amount)) {
        return null;
      }
      changeAmount = row.change_amount;
    }

    if (row.change_percent !== null && row.change_percent !== undefined) {
      if (typeof row.change_percent !== 'number' || !Number.isFinite(row.change_percent)) {
        return null;
      }
      changePercent = row.change_percent;
    }

    if (typeof row.stale_reason === 'string' && row.stale_reason.trim()) {
      staleReason = row.stale_reason.trim();
    }
  }

  return {
    watchlistId,
    instrumentId,
    symbol,
    companyName,
    market,
    assetType,
    currency,
    isActive,
    hasPrice,
    price,
    changeAmount,
    changePercent,
    priceAt,
    priceIsStale,
    staleReason,
    addedAt,
  };
}

/**
 * Normalizes a full page array returned from `get_my_watchlist` RPC.
 * Rejects the entire page if:
 * - rawArray is not an array,
 * - rawArray has length > limit,
 * - offset > 0 but rawArray is empty (out of bounds; returns null so caller handles reconciliation),
 * - rawArray has fractional total_count or total_count < offset + length,
 * - or if ANY row violates the contract.
 */
export function normalizeWatchlistPage(
  rawArray: unknown,
  limit: number,
  offset: number,
  userId: string
): WatchlistPageResult | null {
  if (!Array.isArray(rawArray)) {
    return null;
  }

  if (rawArray.length > limit) {
    return null;
  }

  // Nonzero offset with empty rows is out-of-bounds (does not carry total_count)
  if (rawArray.length === 0) {
    if (offset > 0) {
      return null;
    }
    return {
      userId,
      items: [],
      totalCount: 0,
      limit,
      offset: 0,
      timestamp: Date.now(),
      isStale: false,
    };
  }

  // Validate expected total_count from row 0: must be strict non-negative integer
  const firstRow = rawArray[0];
  if (
    !firstRow ||
    typeof firstRow !== 'object' ||
    typeof (firstRow as { total_count?: unknown }).total_count !== 'number' ||
    !Number.isInteger((firstRow as { total_count: number }).total_count) ||
    (firstRow as { total_count: number }).total_count < 0
  ) {
    return null;
  }

  const expectedTotalCount = (firstRow as { total_count: number }).total_count;

  // Total count must be at least offset + rawArray.length
  if (expectedTotalCount < offset + rawArray.length) {
    return null;
  }

  const items: WatchlistItem[] = [];

  for (const rawItem of rawArray) {
    if (
      !rawItem ||
      typeof rawItem !== 'object' ||
      typeof (rawItem as { total_count?: unknown }).total_count !== 'number' ||
      (rawItem as { total_count: number }).total_count !== expectedTotalCount
    ) {
      // Inconsistent total_count across page rows
      return null;
    }

    const normalized = normalizeWatchlistRpcItem(rawItem);
    if (!normalized) {
      // Fail-closed: invalid item rejects entire page
      return null;
    }
    items.push(normalized);
  }

  return {
    userId,
    items,
    totalCount: expectedTotalCount,
    limit,
    offset,
    timestamp: Date.now(),
    isStale: false,
  };
}

/**
 * Strictly normalizes the response of `set_my_watchlist_item` RPC.
 * Validates that the response is a single-row array and that the returned values match the contract and requested intent.
 */
export function normalizeSetWatchlistItemRpcResult(
  raw: unknown,
  expectedInstrumentId: string,
  expectedIsWatched: boolean
): SetWatchlistItemResult | null {
  if (!Array.isArray(raw) || raw.length !== 1) {
    return null;
  }

  const row = raw[0];
  if (!row || typeof row !== 'object') {
    return null;
  }

  const instrumentId = typeof row.instrument_id === 'string' ? row.instrument_id.trim() : '';
  const isWatched = typeof row.is_watched === 'boolean' ? row.is_watched : null;
  const wasChanged = typeof row.was_changed === 'boolean' ? row.was_changed : null;
  const watchlistId =
    typeof row.watchlist_id === 'string'
      ? row.watchlist_id.trim()
      : row.watchlist_id === null
        ? null
        : undefined;

  // Fail-closed if contract is violated or returned state does not match requested state
  if (
    !instrumentId ||
    instrumentId !== expectedInstrumentId ||
    isWatched === null ||
    isWatched !== expectedIsWatched ||
    wasChanged === null ||
    watchlistId === undefined
  ) {
    return null;
  }

  // If is_watched is true, watchlist_id must be non-empty string. If false, must be null.
  if (isWatched === true && !watchlistId) {
    return null;
  }
  if (isWatched === false && watchlistId !== null) {
    return null;
  }

  return {
    instrumentId,
    isWatched,
    wasChanged,
    watchlistId,
  };
}
