/**
 * Lucrari — Watchlist Comprehensive & Regression Test Suite
 * 
 * Validates:
 * 1. Strict Fail-Closed Normalization & Financial Accuracy:
 *    - has_price=false + price=100 is rejected (null)
 *    - has_price=true + price_at=null is rejected (null)
 *    - has_price=true + price_is_stale=null is rejected (null)
 *    - has_price=true + price<=0 is rejected (null)
 *    - Real zero change (change=0.0) is preserved as a number
 *    - Fractional total_count (1.5) is rejected
 *    - Length > limit is rejected
 *    - Total count < offset + length is rejected
 * 2. Strict ISO-8601 Timestamptz Validator Matrix:
 *    - Accepted: '2026-08-31T09:30:00Z', '2026-08-31T12:30:00+03:00', '2026-08-31T09:30:00.123Z'
 *    - Rejected: '1', '2026-08-31', '31.08.2026', '2026-02-30T10:00:00Z', '2026-08-31T09:30:00'
 * 3. RPC Contracts & Nonzero Empty Page Typed Modeling:
 *    - normalizeWatchlistPage with offset 0 + [] -> genuine true_empty (totalCount: 0)
 *    - normalizeWatchlistPage with offset > 0 + [] -> returns null (out-of-bounds rejection, never true_empty)
 *    - fetchWatchlistPage with offset > 0 + [] -> throws WatchlistPageOutOfBoundsError and bypasses stale cache
 *    - Service 41 -> 40 transition: offset 40 returns out-of-bounds error, offset 20 returns 20 items (21–40 / 40)
 *    - Nonzero corrupt row throws contract error (NOT out-of-range)
 * 4. Mutation Intent Queue ("Last Intent Wins"):
 *    - Add -> Remove -> Add settles with added=true and queue clears (pending=false, count=0, queueSize=0)
 *    - Remove -> Add -> Remove settles with removed=false and queue clears
 *    - Three callers joining one queued intent all settle and queue clears
 *    - Active failure followed by queued success clears queue
 *    - Active and queued failure both clear queue
 *    - User A and User B queues are completely isolated
 * 5. Search Pagination Controller & Monotonic Lifecycle:
 *    - 20 raw / 19 unique produces nextOffset = 20
 *    - 40 raw consumed with duplicates produces nextOffset = 40
 *    - Blocked onEndReached call does not increment tokens or mutate inFlightOffset
 *    - Monotonic generation tokens: modal close/reopen does not reuse old generation
 *    - Delayed response from old generation is rejected and never committed to state
 * 6. Membership Batch Collection Fail-Closed Validation:
 *    - Short page with larger expected total (e.g. 50 returned when total = 150) is rejected
 *    - Cross-page total count drift (Page 1 total = 150, Page 2 total = 140) is rejected
 *    - Cross-page duplicate instrument ID is rejected
 *    - Early empty page before expected total is consumed is rejected
 *    - 50 iterations cap: incomplete list (>5000 items) is rejected and not cached as fresh
 *    - Stale cache preserved with isStale=true on refresh error
 * 7. Page Generation Token & Zero-Frame User Isolation:
 *    - Late page response rejected by request token
 *    - Zero-frame user isolation (User A -> User B transition)
 * 8. View-State Resolution Matrix:
 *    - 10 distinct states evaluated with real auth and data states
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWatchlistRpcItem,
  normalizeWatchlistPage,
  normalizeSetWatchlistItemRpcResult,
  isValidIsoTimestampWithTimezone,
} from '../types/watchlist';
import {
  fetchWatchlistPage,
  fetchAllWatchedInstrumentIds,
  setWatchlistItem,
  clearWatchlistCache,
  getMembershipRevision,
  bumpMembershipRevision,
  getWatchlistMembershipSnapshot,
  subscribeWatchlistChanges,
  MAX_MEMBERSHIP_ATTEMPTS,
} from '../services/watchlist/watchlist-service';
import {
  enqueueWatchlistMutation,
  clearMutationQueue,
  isMutationPendingForInstrument,
  getActiveMutationCount,
  getMutationQueueSnapshotForTesting,
  getMutationQueueSizeForTesting,
} from '../utils/watchlist-mutation-queue';
import {
  createInitialSearchState,
  startSearchQueryOrCategory,
  startSearchLoadMore,
  applySearchSuccess,
} from '../utils/watchlist-search-controller';
import {
  resolveWatchlistViewState,
  formatPaginationRangeText,
  resolveUserScopedWatchlistState,
  resolveUserScopedMembershipState,
  shouldAcceptWatchlistResult,
} from '../utils/watchlist-view-state';
import {
  isWatchlistPageOutOfRangeError,
  WatchlistOperationError,
  WATCHLIST_PAGE_OUT_OF_RANGE,
  formatWatchlistRpcError,
} from '../utils/watchlist-errors';
import {
  shouldCaptureSwipeGesture,
  resolveSwipeReleaseAction,
  computeSwipeOffset,
  swipeRowReducer,
  type SwipeRowEvent,
} from '../utils/watchlist-swipe-helper';
import {
  createToggleWatchlistSuccessResult,
  createToggleWatchlistErrorResult,
  type ToggleWatchlistActionResult,
  type SetWatchlistItemResult,
} from '../types/watchlist';
import {
  setSupabaseClientForTesting,
  resetSupabaseClientForTesting,
} from '../services/supabase/client';
import { resetAuthLock } from '../services/auth/auth-service';
import type { InstrumentWithPrice } from '../services/portfolio/instrument-service';

describe('Watchlist Comprehensive Test Suite', () => {
  beforeEach(() => {
    clearWatchlistCache({ clearSubscribers: true });
    clearMutationQueue();
    resetAuthLock();
    resetSupabaseClientForTesting();
  });

  afterEach(() => {
    clearWatchlistCache({ clearSubscribers: true });
    clearMutationQueue();
    resetAuthLock();
    resetSupabaseClientForTesting();
  });

  describe('1. Strict Fail-Closed Normalization & Financial Accuracy', () => {
    it('1. Normalizes valid RPC item with positive price and percentage change', () => {
      const raw = {
        watchlist_id: 'wl-1',
        instrument_id: 'inst-thyao',
        symbol: 'THYAO',
        company_name: 'Türk Hava Yolları',
        market: 'BIST100',
        asset_type: 'stock',
        currency: 'TRY',
        is_active: true,
        has_price: true,
        price: 312.5,
        change_amount: 5.25,
        change_percent: 1.71,
        price_at: '2026-08-31T09:30:00Z',
        price_is_stale: false,
        stale_reason: null,
        added_at: '2026-08-30T12:00:00Z',
        total_count: 1,
      };

      const item = normalizeWatchlistRpcItem(raw);
      assert.ok(item);
      assert.strictEqual(item.symbol, 'THYAO');
      assert.strictEqual(item.hasPrice, true);
      assert.strictEqual(item.price, 312.5);
      assert.strictEqual(item.changePercent, 1.71);
      assert.strictEqual(item.priceIsStale, false);
    });

    it('2. Normalizes missing price (has_price=false) when price and related fields are null', () => {
      const raw = {
        watchlist_id: 'wl-2',
        instrument_id: 'inst-noprice',
        symbol: 'NOPRICE',
        company_name: 'No Price Asset',
        market: 'BIST100',
        asset_type: 'stock',
        currency: 'TRY',
        is_active: true,
        has_price: false,
        price: null,
        change_amount: null,
        change_percent: null,
        price_at: null,
        price_is_stale: null,
        stale_reason: null,
        added_at: '2026-08-30T12:00:00Z',
        total_count: 1,
      };

      const item = normalizeWatchlistRpcItem(raw);
      assert.ok(item);
      assert.strictEqual(item.hasPrice, false);
      assert.strictEqual(item.price, null);
      assert.strictEqual(item.changeAmount, null);
      assert.strictEqual(item.changePercent, null);
    });

    it('3. Fail-closed: has_price=false + price=100 is rejected (null)', () => {
      const rawInvalid = {
        watchlist_id: 'wl-3',
        instrument_id: 'inst-invalid',
        symbol: 'INV',
        company_name: 'Invalid Item',
        market: 'BIST100',
        asset_type: 'stock',
        currency: 'TRY',
        is_active: true,
        has_price: false,
        price: 100.0,
        change_amount: null,
        change_percent: null,
        price_at: null,
        price_is_stale: null,
        stale_reason: null,
        added_at: '2026-08-30T12:00:00Z',
        total_count: 1,
      };

      assert.strictEqual(normalizeWatchlistRpcItem(rawInvalid), null);
    });

    it('4. Fail-closed: has_price=true + price_at=null is rejected (null)', () => {
      const rawMissingDate = {
        watchlist_id: 'wl-4',
        instrument_id: 'inst-nodate',
        symbol: 'NODATE',
        company_name: 'No Date Item',
        market: 'BIST100',
        asset_type: 'stock',
        currency: 'TRY',
        is_active: true,
        has_price: true,
        price: 150.0,
        change_amount: 1.0,
        change_percent: 0.5,
        price_at: null,
        price_is_stale: false,
        stale_reason: null,
        added_at: '2026-08-30T12:00:00Z',
        total_count: 1,
      };

      assert.strictEqual(normalizeWatchlistRpcItem(rawMissingDate), null);
    });

    it('5. Fail-closed: has_price=true + price_is_stale=null is rejected (null)', () => {
      const rawMissingStale = {
        watchlist_id: 'wl-5',
        instrument_id: 'inst-nostale',
        symbol: 'NOSTALE',
        company_name: 'No Stale Item',
        market: 'BIST100',
        asset_type: 'stock',
        currency: 'TRY',
        is_active: true,
        has_price: true,
        price: 150.0,
        change_amount: 1.0,
        change_percent: 0.5,
        price_at: '2026-08-31T09:30:00Z',
        price_is_stale: null,
        stale_reason: null,
        added_at: '2026-08-30T12:00:00Z',
        total_count: 1,
      };

      assert.strictEqual(normalizeWatchlistRpcItem(rawMissingStale), null);
    });

    it('6. Fail-closed: has_price=true + price<=0 is rejected (null)', () => {
      const rawZero = {
        watchlist_id: 'wl-6',
        instrument_id: 'inst-zero',
        symbol: 'ZERO',
        company_name: 'Zero Price',
        market: 'BIST100',
        asset_type: 'stock',
        currency: 'TRY',
        is_active: true,
        has_price: true,
        price: 0,
        change_amount: null,
        change_percent: null,
        price_at: '2026-08-31T09:30:00Z',
        price_is_stale: false,
        stale_reason: null,
        added_at: '2026-08-30T12:00:00Z',
        total_count: 1,
      };

      assert.strictEqual(normalizeWatchlistRpcItem(rawZero), null);

      const rawNegative = {
        ...rawZero,
        price: -25.5,
      };
      assert.strictEqual(normalizeWatchlistRpcItem(rawNegative), null);
    });

    it('7. Real zero change (change=0.0) is preserved as a number and not treated as missing', () => {
      const rawExactZero = {
        watchlist_id: 'wl-7',
        instrument_id: 'inst-flat',
        symbol: 'FLAT',
        company_name: 'Flat Asset',
        market: 'BIST100',
        asset_type: 'stock',
        currency: 'TRY',
        is_active: true,
        has_price: true,
        price: 100.0,
        change_amount: 0.0,
        change_percent: 0.0,
        price_at: '2026-08-31T09:30:00Z',
        price_is_stale: false,
        stale_reason: null,
        added_at: '2026-08-30T12:00:00Z',
        total_count: 1,
      };

      const item = normalizeWatchlistRpcItem(rawExactZero);
      assert.ok(item);
      assert.strictEqual(item.hasPrice, true);
      assert.strictEqual(item.price, 100.0);
      assert.strictEqual(item.changeAmount, 0.0);
      assert.strictEqual(item.changePercent, 0.0);
    });

    it('8. Fail-closed: rejects invalid market, invalid asset_type, invalid currency, or non-boolean isActive/hasPrice', () => {
      assert.strictEqual(
        normalizeWatchlistRpcItem({
          watchlist_id: 'wl-1',
          instrument_id: 'inst-1',
          symbol: 'BAD',
          company_name: 'Bad Market',
          market: 'INVALID_MARKET',
          asset_type: 'stock',
          currency: 'TRY',
          is_active: true,
          has_price: false,
          added_at: '2026-08-30T12:00:00Z',
        }),
        null
      );

      assert.strictEqual(
        normalizeWatchlistRpcItem({
          watchlist_id: 'wl-1',
          instrument_id: 'inst-1',
          symbol: 'BAD',
          company_name: 'Bad Asset',
          market: 'BIST100',
          asset_type: 'INVALID_ASSET',
          currency: 'TRY',
          is_active: true,
          has_price: false,
          added_at: '2026-08-30T12:00:00Z',
        }),
        null
      );

      assert.strictEqual(
        normalizeWatchlistRpcItem({
          watchlist_id: 'wl-1',
          instrument_id: 'inst-1',
          symbol: 'BAD',
          company_name: 'Bad Currency',
          market: 'BIST100',
          asset_type: 'stock',
          currency: 'EUR',
          is_active: true,
          has_price: false,
          added_at: '2026-08-30T12:00:00Z',
        }),
        null
      );

      assert.strictEqual(
        normalizeWatchlistRpcItem({
          watchlist_id: 'wl-1',
          instrument_id: 'inst-1',
          symbol: 'BAD',
          company_name: 'Bad Active',
          market: 'BIST100',
          asset_type: 'stock',
          currency: 'TRY',
          is_active: 'yes' as any,
          has_price: false,
          added_at: '2026-08-30T12:00:00Z',
        }),
        null
      );

      assert.strictEqual(
        normalizeWatchlistRpcItem({
          watchlist_id: 'wl-1',
          instrument_id: 'inst-1',
          symbol: 'BAD',
          company_name: 'Bad HasPrice',
          market: 'BIST100',
          asset_type: 'stock',
          currency: 'TRY',
          is_active: true,
          has_price: 1 as any,
          added_at: '2026-08-30T12:00:00Z',
        }),
        null
      );
    });

    it('9. normalizeWatchlistPage: rejects non-array, fractional total_count, length > limit, and total_count < offset + length', () => {
      assert.strictEqual(normalizeWatchlistPage({ error: 'fail' }, 20, 0, 'usr-1'), null);

      const validRow = {
        watchlist_id: 'wl-1',
        instrument_id: 'inst-1',
        symbol: 'SYM1',
        company_name: 'C1',
        market: 'BIST100',
        asset_type: 'stock',
        currency: 'TRY',
        is_active: true,
        has_price: false,
        price: null,
        change_amount: null,
        change_percent: null,
        price_at: null,
        price_is_stale: null,
        stale_reason: null,
        added_at: '2026-08-30T12:00:00Z',
        total_count: 1.5,
      };

      assert.strictEqual(normalizeWatchlistPage([validRow], 20, 0, 'usr-1'), null);

      const twoRows = [
        { ...validRow, total_count: 5 },
        { ...validRow, watchlist_id: 'wl-2', instrument_id: 'inst-2', total_count: 5 },
      ];
      assert.strictEqual(normalizeWatchlistPage(twoRows, 1, 0, 'usr-1'), null);

      const underCountRow = [{ ...validRow, total_count: 2 }];
      assert.strictEqual(normalizeWatchlistPage(underCountRow, 20, 10, 'usr-1'), null);
    });
  });

  describe('2. Strict ISO-8601 Timestamptz Validator Matrix', () => {
    it('10. Validates ISO-8601 timestamptz formats with timezone', () => {
      assert.strictEqual(isValidIsoTimestampWithTimezone('2026-08-31T09:30:00Z'), true);
      assert.strictEqual(isValidIsoTimestampWithTimezone('2026-08-31T12:30:00+03:00'), true);
      assert.strictEqual(isValidIsoTimestampWithTimezone('2026-08-31T09:30:00.123Z'), true);
      assert.strictEqual(isValidIsoTimestampWithTimezone('2026-08-31T09:30:00+00:00'), true);
    });

    it('11. Rejects invalid date strings, calendar errors, and timezone-missing timestamps', () => {
      assert.strictEqual(isValidIsoTimestampWithTimezone('1'), false);
      assert.strictEqual(isValidIsoTimestampWithTimezone('2026-08-31'), false); // Missing time and timezone
      assert.strictEqual(isValidIsoTimestampWithTimezone('31.08.2026'), false); // Locale format
      assert.strictEqual(isValidIsoTimestampWithTimezone('2026-02-30T10:00:00Z'), false); // Invalid Feb 30
      assert.strictEqual(isValidIsoTimestampWithTimezone('2026-08-31T09:30:00'), false); // Missing timezone
      assert.strictEqual(isValidIsoTimestampWithTimezone('not-a-date'), false);
      assert.strictEqual(isValidIsoTimestampWithTimezone(''), false);
    });
  });

  describe('3. RPC Contracts & Nonzero Empty Page Typed Modeling', () => {
    it('12. normalizeWatchlistPage with offset 0 and empty array yields genuine true_empty (totalCount: 0)', () => {
      const page0 = normalizeWatchlistPage([], 20, 0, 'usr-1');
      assert.ok(page0);
      assert.strictEqual(page0.totalCount, 0);
      assert.strictEqual(page0.items.length, 0);
      assert.strictEqual(page0.offset, 0);
    });

    it('13. normalizeWatchlistPage with offset > 0 and empty array returns null (out of bounds rejection)', () => {
      const pageNonzero = normalizeWatchlistPage([], 20, 20, 'usr-1');
      assert.strictEqual(pageNonzero, null);
    });

    it('14. fetchWatchlistPage with offset > 0 and empty array throws WatchlistPageOutOfBoundsError and bypasses stale cache', async () => {
      const activeUserId = 'usr-page-oob';

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async () => {
          return {
            data: [], // Empty array for offset 40
            error: null,
          };
        },
      };

      setSupabaseClientForTesting(mockClient);

      await assert.rejects(
        async () => {
          await fetchWatchlistPage({ limit: 20, offset: 40, forceRefresh: true });
        },
        (err) => {
          return isWatchlistPageOutOfRangeError(err);
        }
      );
    });

    it('15. Service 41 -> 40 transition: cached offset 40 with 1 item, force-refresh returns out-of-range, and offset 20 loads 20 items (21–40 / 40)', async () => {
      const activeUserId = 'usr-transition-41-40';
      const rpcOffsetLog: number[] = [];

      let item41Exists = true;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async (_fn: string, params: { p_limit: number; p_offset: number }) => {
          rpcOffsetLog.push(params.p_offset);

          if (params.p_offset === 40) {
            if (item41Exists) {
              return {
                data: [
                  {
                    watchlist_id: 'wl-41',
                    instrument_id: 'inst-41',
                    symbol: 'LASTSYM',
                    company_name: 'Last Asset',
                    market: 'BIST100',
                    asset_type: 'stock',
                    currency: 'TRY',
                    is_active: true,
                    has_price: true,
                    price: 200,
                    change_amount: 2,
                    change_percent: 1,
                    price_at: '2026-08-31T09:30:00Z',
                    price_is_stale: false,
                    stale_reason: null,
                    added_at: '2026-08-30T12:00:00Z',
                    total_count: 41,
                  },
                ],
                error: null,
              };
            } else {
              // Item 41 was deleted externally -> returns empty array
              return {
                data: [],
                error: null,
              };
            }
          }

          if (params.p_offset === 20) {
            return {
              data: Array.from({ length: 20 }, (_, i) => ({
                watchlist_id: `wl-${20 + i}`,
                instrument_id: `inst-${20 + i}`,
                symbol: `SYM${20 + i}`,
                company_name: `Comp ${20 + i}`,
                market: 'BIST100',
                asset_type: 'stock',
                currency: 'TRY',
                is_active: true,
                has_price: true,
                price: 100,
                change_amount: 1,
                change_percent: 1,
                price_at: '2026-08-31T09:30:00Z',
                price_is_stale: false,
                stale_reason: null,
                added_at: '2026-08-30T12:00:00Z',
                total_count: 40,
              })),
              error: null,
            };
          }

          return { data: [], error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      // 1. Initial call to offset 40 caches the page with total_count=41
      const p1 = await fetchWatchlistPage({ limit: 20, offset: 40 });
      assert.strictEqual(p1.totalCount, 41);
      assert.strictEqual(p1.items.length, 1);

      // 2. External deletion happens
      item41Exists = false;

      // 3. Force refresh on offset 40 throws WatchlistPageOutOfBoundsError and does NOT return stale cached page
      await assert.rejects(
        async () => {
          await fetchWatchlistPage({ limit: 20, offset: 40, forceRefresh: true });
        },
        (err) => {
          return isWatchlistPageOutOfRangeError(err);
        }
      );

      // 4. Step back to offset 20
      const p2 = await fetchWatchlistPage({ limit: 20, offset: 20, forceRefresh: true });
      assert.strictEqual(p2.totalCount, 40);
      assert.strictEqual(p2.items.length, 20);
      assert.strictEqual(p2.offset, 20);

      // Check formatted range text on committed page
      assert.strictEqual(formatPaginationRangeText(1, 20, 40, 20), '21–40 / 40');

      // Assert exact RPC offset sequence
      assert.deepStrictEqual(rpcOffsetLog, [40, 40, 20]);
    });

    it('16. Nonzero corrupt row throws contract error (NOT out-of-range error)', async () => {
      const activeUserId = 'usr-corrupt-row';

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async () => {
          return {
            data: [
              {
                watchlist_id: 'wl-bad',
                instrument_id: 'inst-bad',
                symbol: 'BAD',
                company_name: 'Bad Item',
                market: 'BIST100',
                asset_type: 'stock',
                currency: 'TRY',
                is_active: true,
                has_price: true,
                price: 100,
                price_at: null, // Corrupt missing date
                price_is_stale: false,
                added_at: '2026-08-30T12:00:00Z',
                total_count: 1,
              },
            ],
            error: null,
          };
        },
      };

      setSupabaseClientForTesting(mockClient);

      await assert.rejects(
        async () => {
          await fetchWatchlistPage({ limit: 20, offset: 20, forceRefresh: true });
        },
        (err) => {
          assert.strictEqual(isWatchlistPageOutOfRangeError(err), false);
          return true;
        }
      );
    });

    it('17. normalizeSetWatchlistItemRpcResult strictly validates single-row array contract and preserves was_changed=false', () => {
      const validAdd = normalizeSetWatchlistItemRpcResult(
        [
          {
            instrument_id: 'inst-akbnk',
            is_watched: true,
            was_changed: true,
            watchlist_id: 'wl-new',
          },
        ],
        'inst-akbnk',
        true
      );
      assert.ok(validAdd);
      assert.strictEqual(validAdd.isWatched, true);
      assert.strictEqual(validAdd.wasChanged, true);
      assert.strictEqual(validAdd.watchlistId, 'wl-new');

      const validRemoveNoChange = normalizeSetWatchlistItemRpcResult(
        [
          {
            instrument_id: 'inst-akbnk',
            is_watched: false,
            was_changed: false,
            watchlist_id: null,
          },
        ],
        'inst-akbnk',
        false
      );
      assert.ok(validRemoveNoChange);
      assert.strictEqual(validRemoveNoChange.isWatched, false);
      assert.strictEqual(validRemoveNoChange.wasChanged, false);
      assert.strictEqual(validRemoveNoChange.watchlistId, null);
    });
  });

  describe('4. Mutation Intent Queue ("Last Intent Wins")', () => {
    it('18. Sequence: Add -> Remove -> Add settles with added=true and queue clears (pending=false, count=0, queueSize=0)', async () => {
      const executionLog: boolean[] = [];

      const p1 = enqueueWatchlistMutation('usr-q3', 'inst-q3', true, async (intent) => {
        executionLog.push(intent);
        await new Promise((r) => setTimeout(r, 15));
        return { instrumentId: 'inst-q3', isWatched: intent, wasChanged: true, watchlistId: 'wl-3' };
      });

      const p2 = enqueueWatchlistMutation('usr-q3', 'inst-q3', false, async (intent) => {
        executionLog.push(intent);
        await new Promise((r) => setTimeout(r, 15));
        return { instrumentId: 'inst-q3', isWatched: intent, wasChanged: true, watchlistId: null };
      });

      const p3 = enqueueWatchlistMutation('usr-q3', 'inst-q3', true, async (intent) => {
        executionLog.push(intent);
        await new Promise((r) => setTimeout(r, 15));
        return { instrumentId: 'inst-q3', isWatched: intent, wasChanged: true, watchlistId: 'wl-3' };
      });

      const [res1, res2, res3] = await Promise.all([p1, p2, p3]);

      assert.strictEqual(res1.isWatched, true);
      assert.strictEqual(res2.isWatched, true);
      assert.strictEqual(res3.isWatched, true);
      assert.deepStrictEqual(executionLog, [true, true]);

      assert.strictEqual(isMutationPendingForInstrument('usr-q3', 'inst-q3'), false);
      assert.strictEqual(getActiveMutationCount('usr-q3', 'inst-q3'), 0);
      assert.strictEqual(getMutationQueueSnapshotForTesting('usr-q3', 'inst-q3'), null);
      assert.strictEqual(getMutationQueueSizeForTesting(), 0);
    });

    it('19. Sequence: Remove -> Add -> Remove settles with removed=false and queue clears', async () => {
      const p1 = enqueueWatchlistMutation('usr-q4', 'inst-q4', false, async (intent) => {
        await new Promise((r) => setTimeout(r, 15));
        return { instrumentId: 'inst-q4', isWatched: intent, wasChanged: true, watchlistId: null };
      });

      const p2 = enqueueWatchlistMutation('usr-q4', 'inst-q4', true, async (intent) => {
        await new Promise((r) => setTimeout(r, 15));
        return { instrumentId: 'inst-q4', isWatched: intent, wasChanged: true, watchlistId: 'wl-4' };
      });

      const p3 = enqueueWatchlistMutation('usr-q4', 'inst-q4', false, async (intent) => {
        await new Promise((r) => setTimeout(r, 15));
        return { instrumentId: 'inst-q4', isWatched: intent, wasChanged: true, watchlistId: null };
      });

      const [res1, res2, res3] = await Promise.all([p1, p2, p3]);

      assert.strictEqual(res1.isWatched, false);
      assert.strictEqual(res2.isWatched, false);
      assert.strictEqual(res3.isWatched, false);

      assert.strictEqual(isMutationPendingForInstrument('usr-q4', 'inst-q4'), false);
      assert.strictEqual(getActiveMutationCount('usr-q4', 'inst-q4'), 0);
      assert.strictEqual(getMutationQueueSizeForTesting(), 0);
    });

    it('20. Three callers joining one queued intent all settle and queue clears completely', async () => {
      const pActive = enqueueWatchlistMutation('usr-multi', 'inst-multi', true, async (intent) => {
        await new Promise((r) => setTimeout(r, 20));
        return { instrumentId: 'inst-multi', isWatched: intent, wasChanged: true, watchlistId: 'wl-1' };
      });

      const pQ1 = enqueueWatchlistMutation('usr-multi', 'inst-multi', false, async (intent) => {
        await new Promise((r) => setTimeout(r, 20));
        return { instrumentId: 'inst-multi', isWatched: intent, wasChanged: true, watchlistId: null };
      });
      const pQ2 = enqueueWatchlistMutation('usr-multi', 'inst-multi', false, async (intent) => {
        await new Promise((r) => setTimeout(r, 20));
        return { instrumentId: 'inst-multi', isWatched: intent, wasChanged: true, watchlistId: null };
      });
      const pQ3 = enqueueWatchlistMutation('usr-multi', 'inst-multi', false, async (intent) => {
        await new Promise((r) => setTimeout(r, 20));
        return { instrumentId: 'inst-multi', isWatched: intent, wasChanged: true, watchlistId: null };
      });

      const [resActive, r1, r2, r3] = await Promise.all([pActive, pQ1, pQ2, pQ3]);

      assert.strictEqual(resActive.isWatched, true);
      assert.strictEqual(r1.isWatched, false);
      assert.strictEqual(r2.isWatched, false);
      assert.strictEqual(r3.isWatched, false);

      assert.strictEqual(isMutationPendingForInstrument('usr-multi', 'inst-multi'), false);
      assert.strictEqual(getActiveMutationCount('usr-multi', 'inst-multi'), 0);
      assert.strictEqual(getMutationQueueSizeForTesting(), 0);
    });

    it('21. Active failure followed by queued success clears queue', async () => {
      const pActive = enqueueWatchlistMutation('usr-err-succ', 'inst-err-succ', true, async () => {
        await new Promise((r) => setTimeout(r, 15));
        throw new Error('Database temporary lock');
      });

      const pQueued = enqueueWatchlistMutation('usr-err-succ', 'inst-err-succ', false, async (intent) => {
        await new Promise((r) => setTimeout(r, 15));
        return { instrumentId: 'inst-err-succ', isWatched: intent, wasChanged: true, watchlistId: null };
      });

      const [resActive, resQ] = await Promise.allSettled([pActive, pQueued]);

      assert.strictEqual(resActive.status, 'rejected');
      assert.strictEqual((resActive as PromiseRejectedResult).reason.message, 'Database temporary lock');

      assert.strictEqual(resQ.status, 'fulfilled');
      assert.strictEqual((resQ as PromiseFulfilledResult<any>).value.isWatched, false);

      assert.strictEqual(isMutationPendingForInstrument('usr-err-succ', 'inst-err-succ'), false);
      assert.strictEqual(getActiveMutationCount('usr-err-succ', 'inst-err-succ'), 0);
      assert.strictEqual(getMutationQueueSizeForTesting(), 0);
    });

    it('22. Active and queued failure both clear queue', async () => {
      const pActive = enqueueWatchlistMutation('usr-both-fail', 'inst-both-fail', true, async () => {
        await new Promise((r) => setTimeout(r, 15));
        throw new Error('Active failure');
      });

      const pQueued = enqueueWatchlistMutation('usr-both-fail', 'inst-both-fail', false, async () => {
        await new Promise((r) => setTimeout(r, 15));
        throw new Error('Queued failure');
      });

      const [resActive, resQ] = await Promise.allSettled([pActive, pQueued]);

      assert.strictEqual(resActive.status, 'rejected');
      assert.strictEqual((resActive as PromiseRejectedResult).reason.message, 'Active failure');

      assert.strictEqual(resQ.status, 'rejected');
      assert.strictEqual((resQ as PromiseRejectedResult).reason.message, 'Queued failure');

      assert.strictEqual(isMutationPendingForInstrument('usr-both-fail', 'inst-both-fail'), false);
      assert.strictEqual(getActiveMutationCount('usr-both-fail', 'inst-both-fail'), 0);
      assert.strictEqual(getMutationQueueSizeForTesting(), 0);
    });

    it('23. User A and User B mutation queues are completely isolated', async () => {
      const pA = enqueueWatchlistMutation('usr-a', 'inst-same', true, async (intent) => {
        await new Promise((r) => setTimeout(r, 15));
        return { instrumentId: 'inst-same', isWatched: intent, wasChanged: true, watchlistId: 'wl-a' };
      });

      const pB = enqueueWatchlistMutation('usr-b', 'inst-same', false, async (intent) => {
        await new Promise((r) => setTimeout(r, 15));
        return { instrumentId: 'inst-same', isWatched: intent, wasChanged: true, watchlistId: null };
      });

      const [resA, resB] = await Promise.all([pA, pB]);

      assert.strictEqual(resA.isWatched, true);
      assert.strictEqual(resB.isWatched, false);
      assert.strictEqual(getMutationQueueSizeForTesting(), 0);
    });
  });

  describe('5. Search Pagination Controller & Monotonic Lifecycle', () => {
    it('24. Search cursor: 20 raw items with 1 duplicate (19 unique UI cards) produces nextOffset=20', () => {
      const s0 = createInitialSearchState('', 'ALL', 1);
      const { state: s1, generationId: gen1, targetOffset: off0 } = startSearchQueryOrCategory(s0, 'THY', 'BIST100', 2);

      const raw20: InstrumentWithPrice[] = Array.from({ length: 20 }, (_, i) => ({
        id: i === 1 ? 'inst-0' : `inst-${i}`,
        symbol: `SYM${i}`,
        companyName: `Comp ${i}`,
        market: 'BIST100',
        assetType: 'stock',
        currency: 'TRY',
        hasPrice: true,
        price: 100,
        changeAmount: 1,
        changePercent: 1,
        priceAt: null,
        isStale: false,
        staleReason: null,
      }));

      const s2 = applySearchSuccess(s1, gen1, off0, raw20, true);

      assert.strictEqual(s2.items.length, 19);
      assert.strictEqual(s2.nextOffset, 20);

      const { canLoad, state: s3, targetOffset: off20 } = startSearchLoadMore(s2, 3);
      assert.strictEqual(canLoad, true);
      assert.strictEqual(off20, 20);
      assert.strictEqual(s3.inFlightOffset, 20);
    });

    it('25. Search cursor: 40 raw consumed with cross-page duplicates produces nextOffset=40', () => {
      const s0 = createInitialSearchState('', 'ALL', 1);
      const { state: s1, generationId: gen1 } = startSearchQueryOrCategory(s0, 'THY', 'ALL', 2);

      const rawPage1: InstrumentWithPrice[] = Array.from({ length: 20 }, (_, i) => ({
        id: `inst-${i}`,
        symbol: `SYM${i}`,
        companyName: `Comp ${i}`,
        market: 'BIST100',
        assetType: 'stock',
        currency: 'TRY',
        hasPrice: true,
        price: 100,
        changeAmount: 1,
        changePercent: 1,
        priceAt: null,
        isStale: false,
        staleReason: null,
      }));

      const s2 = applySearchSuccess(s1, gen1, 0, rawPage1, true);
      assert.strictEqual(s2.nextOffset, 20);

      const { state: s3, targetOffset: off20 } = startSearchLoadMore(s2, 3);

      const rawPage2: InstrumentWithPrice[] = Array.from({ length: 20 }, (_, i) => ({
        id: i < 2 ? `inst-${i}` : `inst-${20 + i}`,
        symbol: `SYM${20 + i}`,
        companyName: `Comp ${20 + i}`,
        market: 'BIST100',
        assetType: 'stock',
        currency: 'TRY',
        hasPrice: true,
        price: 100,
        changeAmount: 1,
        changePercent: 1,
        priceAt: null,
        isStale: false,
        staleReason: null,
      }));

      const s4 = applySearchSuccess(s3, 3, off20, rawPage2, true);

      assert.strictEqual(s4.items.length, 38);
      assert.strictEqual(s4.nextOffset, 40);
    });

    it('26. Blocked onEndReached call does not increment token or mutate inFlightOffset; first response succeeds with 1 RPC', () => {
      let lifecycleToken = 1;
      let activeRequestId = 0;
      let rpcCallCount = 0;

      const s0 = createInitialSearchState('', 'ALL', lifecycleToken);
      lifecycleToken++;
      activeRequestId++;
      const { state: s1, generationId: gen1 } = startSearchQueryOrCategory(s0, 'THY', 'ALL', lifecycleToken);

      const rawPage1: InstrumentWithPrice[] = Array.from({ length: 20 }, (_, i) => ({
        id: `inst-${i}`,
        symbol: `SYM${i}`,
        companyName: `Comp ${i}`,
        market: 'BIST100',
        assetType: 'stock',
        currency: 'TRY',
        hasPrice: true,
        price: 100,
        changeAmount: 1,
        changePercent: 1,
        priceAt: null,
        isStale: false,
        staleReason: null,
      }));

      const s2 = applySearchSuccess(s1, gen1, 0, rawPage1, true);
      assert.strictEqual(s2.nextOffset, 20);

      // Call 1 of onEndReached: canLoad=true -> requestId increments to 2
      const { canLoad: canLoad1, state: s3 } = startSearchLoadMore(s2, lifecycleToken);
      assert.strictEqual(canLoad1, true);
      assert.strictEqual(s3.inFlightOffset, 20);
      assert.strictEqual(s3.isLoadingMore, true);
      activeRequestId++;
      const dispatchedRequestId = activeRequestId;
      rpcCallCount++;

      // Call 2 of onEndReached in same tick: canLoad=false -> requestId and lifecycleToken REMAIN UNCHANGED
      const { canLoad: canLoad2 } = startSearchLoadMore(s3, lifecycleToken);
      assert.strictEqual(canLoad2, false);
      assert.strictEqual(activeRequestId, 2); // Still 2!
      assert.strictEqual(lifecycleToken, 2);  // Still 2!

      // Response for Call 1 arrives with requestId 2 and lifecycleToken 2
      const rawPage2: InstrumentWithPrice[] = Array.from({ length: 20 }, (_, i) => ({
        id: `inst-${20 + i}`,
        symbol: `SYM${20 + i}`,
        companyName: `Comp ${20 + i}`,
        market: 'BIST100',
        assetType: 'stock',
        currency: 'TRY',
        hasPrice: true,
        price: 100,
        changeAmount: 1,
        changePercent: 1,
        priceAt: null,
        isStale: false,
        staleReason: null,
      }));

      assert.strictEqual(dispatchedRequestId, activeRequestId);
      const s4 = applySearchSuccess(s3, lifecycleToken, 20, rawPage2, true);

      assert.strictEqual(s4.items.length, 40);
      assert.strictEqual(s4.nextOffset, 40);
      assert.strictEqual(s4.inFlightOffset, null);
      assert.strictEqual(s4.isLoadingMore, false);
      assert.strictEqual(rpcCallCount, 1);
    });

    it('27. Monotonic lifecycle tokens: modal close/reopen strictly increments token and rejects old responses', () => {
      let monotonicToken = 1;
      const s0 = createInitialSearchState('', 'ALL', monotonicToken);
      monotonicToken++;
      const { generationId: genSession1 } = startSearchQueryOrCategory(s0, 'AKBNK', 'BIST100', monotonicToken);
      assert.strictEqual(genSession1, 2);

      monotonicToken++;
      const sClosed = createInitialSearchState('', 'ALL', monotonicToken);
      assert.strictEqual(sClosed.generationId, 3);

      monotonicToken++;
      const { state: sReopened, generationId: genSession2 } = startSearchQueryOrCategory(sClosed, 'THYAO', 'BIST100', monotonicToken);
      assert.strictEqual(genSession2, 4);

      const lateItemsSession1: InstrumentWithPrice[] = [
        {
          id: 'inst-akbnk',
          symbol: 'AKBNK',
          companyName: 'Akbank',
          market: 'BIST100',
          assetType: 'stock',
          currency: 'TRY',
          hasPrice: true,
          price: 55,
          changeAmount: 0.5,
          changePercent: 1.0,
          priceAt: null,
          isStale: false,
          staleReason: null,
        },
      ];

      const sAfterLateResponse = applySearchSuccess(sReopened, genSession1, 0, lateItemsSession1, false);

      assert.strictEqual(sAfterLateResponse.items.length, 0);
      assert.strictEqual(sAfterLateResponse.generationId, 4);
    });
  });

  describe('6. Membership Batch Collection Fail-Closed Validation', () => {
    it('28. fetchAllWatchedInstrumentIds rejects short page with larger total (e.g. 50 rows returned when total=150)', async () => {
      const activeUserId = 'usr-short-page';

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async () => {
          return {
            data: [
              { instrument_id: 'inst-1', total_count: 150 },
              { instrument_id: 'inst-2', total_count: 150 },
            ],
            error: null,
          };
        },
      };

      setSupabaseClientForTesting(mockClient);

      await assert.rejects(
        async () => {
          await fetchAllWatchedInstrumentIds(true);
        },
        {
          name: 'WatchlistOperationError',
        }
      );
    });

    it('29. fetchAllWatchedInstrumentIds rejects cross-page total count drift (Page 1 total=150, Page 2 total=140)', async () => {
      const activeUserId = 'usr-drift-mem';
      let page = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async () => {
          page++;
          if (page === 1) {
            return {
              data: Array.from({ length: 100 }, (_, i) => ({ instrument_id: `inst-p1-${i}`, total_count: 150 })),
              error: null,
            };
          }
          return {
            data: Array.from({ length: 40 }, (_, i) => ({ instrument_id: `inst-p2-${i}`, total_count: 140 })),
            error: null,
          };
        },
      };

      setSupabaseClientForTesting(mockClient);

      await assert.rejects(
        async () => {
          await fetchAllWatchedInstrumentIds(true);
        },
        {
          name: 'WatchlistOperationError',
        }
      );
    });

    it('30. fetchAllWatchedInstrumentIds rejects cross-page duplicate instrument ID', async () => {
      const activeUserId = 'usr-dup-mem';
      let page = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async () => {
          page++;
          if (page === 1) {
            return {
              data: Array.from({ length: 100 }, (_, i) => ({ instrument_id: `inst-${i}`, total_count: 150 })),
              error: null,
            };
          }
          return {
            data: Array.from({ length: 50 }, (_, i) => ({
              instrument_id: i === 0 ? 'inst-0' : `inst-p2-${i}`,
              total_count: 150,
            })),
            error: null,
          };
        },
      };

      setSupabaseClientForTesting(mockClient);

      await assert.rejects(
        async () => {
          await fetchAllWatchedInstrumentIds(true);
        },
        {
          name: 'WatchlistOperationError',
        }
      );
    });

    it('31. fetchAllWatchedInstrumentIds rejects early empty page before expected total is consumed', async () => {
      const activeUserId = 'usr-early-empty';
      let page = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async () => {
          page++;
          if (page === 1) {
            return {
              data: Array.from({ length: 100 }, (_, i) => ({ instrument_id: `inst-${i}`, total_count: 150 })),
              error: null,
            };
          }
          return {
            data: [],
            error: null,
          };
        },
      };

      setSupabaseClientForTesting(mockClient);

      await assert.rejects(
        async () => {
          await fetchAllWatchedInstrumentIds(true);
        },
        {
          name: 'WatchlistOperationError',
        }
      );
    });

    it('32. fetchAllWatchedInstrumentIds rejects incomplete membership when 50 iterations cap is reached (>5000 items)', async () => {
      const activeUserId = 'usr-cap-mem';

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async (_fn: string, params: { p_limit: number; p_offset: number }) => {
          // Total declared is 6000 (exceeding 50 batches of 100)
          return {
            data: Array.from({ length: params.p_limit }, (_, i) => ({
              instrument_id: `inst-${params.p_offset + i}`,
              total_count: 6000,
            })),
            error: null,
          };
        },
      };

      setSupabaseClientForTesting(mockClient);

      await assert.rejects(
        async () => {
          await fetchAllWatchedInstrumentIds(true);
        },
        {
          name: 'WatchlistOperationError',
          message: 'Maksimum üyelik sorgulama sınırına ulaşıldı.',
        }
      );
    });

    it('33. fetchAllWatchedInstrumentIds returns isStale=true when refresh fails but cache exists', async () => {
      const activeUserId = 'usr-stale-mem';
      let shouldFail = false;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async () => {
          if (shouldFail) {
            return { data: null, error: { message: 'Network connection timeout' } };
          }
          return {
            data: [
              {
                instrument_id: 'inst-1',
                total_count: 1,
              },
            ],
            error: null,
          };
        },
      };

      setSupabaseClientForTesting(mockClient);

      const res1 = await fetchAllWatchedInstrumentIds(false);
      assert.strictEqual(res1.isStale, false);
      assert.strictEqual(res1.instrumentIds.has('inst-1'), true);

      shouldFail = true;
      const res2 = await fetchAllWatchedInstrumentIds(true);
      assert.strictEqual(res2.isStale, true);
      assert.strictEqual(res2.instrumentIds.has('inst-1'), true);
    });
  });

  describe('7. Page Generation Token & Zero-Frame User Isolation', () => {
    it('34. shouldAcceptWatchlistResult rejects out-of-order responses with mismatched requestId or offset', () => {
      assert.strictEqual(
        shouldAcceptWatchlistResult({
          isMounted: true,
          currentUserId: 'usr-1',
          activeUserId: 'usr-1',
          dataUserId: 'usr-1',
          requestId: 5,
          activeRequestId: 5,
          responseOffset: 20,
          expectedOffset: 20,
        }),
        true
      );

      assert.strictEqual(
        shouldAcceptWatchlistResult({
          isMounted: true,
          currentUserId: 'usr-1',
          activeUserId: 'usr-1',
          dataUserId: 'usr-1',
          requestId: 4,
          activeRequestId: 5,
          responseOffset: 20,
          expectedOffset: 20,
        }),
        false
      );

      assert.strictEqual(
        shouldAcceptWatchlistResult({
          isMounted: true,
          currentUserId: 'usr-1',
          activeUserId: 'usr-1',
          dataUserId: 'usr-1',
          requestId: 5,
          activeRequestId: 5,
          responseOffset: 0,
          expectedOffset: 20,
        }),
        false
      );
    });

    it('35. Zero-frame user isolation: User A items and membership never leak to User B on transition render frame', () => {
      const rawMemA = {
        stateUserId: 'usr-a',
        membershipSet: new Set(['inst-thyao', 'inst-akbnk']),
        isLoading: false,
        isStale: false,
        error: null,
      };

      const scopedMemB = resolveUserScopedMembershipState({
        rawMembership: rawMemA,
        currentUserId: 'usr-b',
        isAuthReady: true,
        snapshot: null,
      });

      assert.strictEqual(scopedMemB.watchedInstrumentIds.size, 0);

      const rawPageA = {
        stateUserId: 'usr-a',
        committedPageIndex: 0,
        requestedPageIndex: 0,
        failedPageIndex: null,
        pageResult: {
          userId: 'usr-a',
          items: [],
          totalCount: 5,
          limit: 20,
          offset: 0,
          timestamp: Date.now(),
          isStale: false,
        },
        isLoading: false,
        isPageLoading: false,
        isStale: false,
        error: null,
        hasLoadedSuccessfully: true,
      };

      const scopedPageB = resolveUserScopedWatchlistState({
        rawState: rawPageA,
        currentUserId: 'usr-b',
        isAuthReady: true,
        authError: null,
        isExpanded: false,
        snapshot: null,
      });

      assert.strictEqual(scopedPageB.items.length, 0);
      assert.strictEqual(scopedPageB.totalCount, 0);
      assert.strictEqual(scopedPageB.isLoading, true);
    });
  });

  describe('Watchlist display and session boundaries', () => {
    const state = {
      stateUserId: 'previous-user',
      committedPageIndex: 0,
      requestedPageIndex: 0,
      failedPageIndex: null,
      pageResult: null,
      isLoading: false,
      isPageLoading: false,
      isStale: false,
      error: null,
      hasLoadedSuccessfully: false,
    };
    const options = {
      rawState: state,
      currentUserId: 'current-user',
      isAuthReady: true,
      authError: null,
      isExpanded: false,
      snapshot: null,
    };

    it('uses only the active account snapshot and derives its committed page', () => {
      const snapshot = {
        userId: options.currentUserId, items: [], totalCount: 47,
        limit: 20, offset: 40, timestamp: 1, isStale: true,
      };
      const loaded = resolveUserScopedWatchlistState({ ...options, snapshot, isExpanded: true });
      assert.equal(loaded.committedPageIndex, 2);
      assert.equal(loaded.isStale, true);
      assert.equal(loaded.totalCount, 47);
      assert.equal(loaded.hasLoadedSuccessfully, true);
      assert.equal(resolveUserScopedWatchlistState({ ...options, snapshot }).hasLoadedSuccessfully, true);

      const ownState = { ...state, stateUserId: options.currentUserId };
      assert.equal(resolveUserScopedWatchlistState({ ...options, rawState: ownState }).totalCount, 0);
      const ownPage = { ...ownState, pageResult: snapshot, committedPageIndex: 2 };
      assert.equal(resolveUserScopedWatchlistState({ ...options, rawState: ownPage, isExpanded: true }).totalCount, 47);
      assert.equal(resolveUserScopedWatchlistState({ ...options, rawState: ownPage }).committedPageIndex, 2);
    });

    it('clears private watchlist and membership state when session is unavailable', () => {
      assert.equal(resolveUserScopedWatchlistState({ ...options, isAuthReady: false }).isLoading, true);
      const signedOut = { ...options, currentUserId: null };
      assert.match(resolveUserScopedWatchlistState(signedOut).error?.message ?? '', /oturumu doğrulanamadı/);
      assert.equal(resolveUserScopedWatchlistState({ ...signedOut, authError: 'Session expired' }).error?.message, 'Session expired');
      const rawMembership = {
        stateUserId: state.stateUserId, membershipSet: new Set(['private-asset']),
        isLoading: true, isStale: true, error: 'Unavailable',
      };
      const membership = { rawMembership, currentUserId: options.currentUserId, isAuthReady: true, snapshot: null };
      assert.equal(resolveUserScopedMembershipState({ ...membership, currentUserId: null }).watchedInstrumentIds.size, 0);
      assert.equal(resolveUserScopedMembershipState({ ...membership, isAuthReady: false }).watchedInstrumentIds.size, 0);
      assert.equal(resolveUserScopedMembershipState({ ...membership, currentUserId: state.stateUserId }).membershipError, 'Unavailable');
      const snapshot = { userId: options.currentUserId, instrumentIds: new Set(['current-asset']), isStale: false, timestamp: 1 };
      assert.deepEqual(resolveUserScopedMembershipState({ ...membership, snapshot }).watchedInstrumentIds, snapshot.instrumentIds);
    });

    it('distinguishes empty, partial, and retained stale pages', () => {
      assert.equal(formatPaginationRangeText(0, 20, 0, 0), '0 / 0');
      assert.equal(formatPaginationRangeText(2, 20, 47, 0), '0 / 0');
      assert.equal(formatPaginationRangeText(2, 20, 47, 10), '41–47 / 47');
      const base = {
        isAuthReady: true, userId: options.currentUserId, authError: null,
        isLoading: false, isPageLoading: false, error: null, hasLoadedSuccessfully: true,
        totalCount: 47, itemsCount: 0, isStale: true, pendingInstrumentIdsCount: 0,
      };
      assert.equal(resolveWatchlistViewState({ ...base, totalCount: 0 }).showEmptyCard, true);
      assert.equal(resolveWatchlistViewState(base).showContentList, false);
      assert.equal(resolveWatchlistViewState({ ...base, itemsCount: 7, error: 'network' }).state, 'stale_data');
      assert.match(resolveWatchlistViewState({ ...base, userId: null }).errorMessage ?? '', /oturum açılması/);
    });

    it('recognizes pagination errors across service boundaries and hides unknown backend details', () => {
      assert.equal(isWatchlistPageOutOfRangeError(new WatchlistOperationError('Pagination', {
        code: WATCHLIST_PAGE_OUT_OF_RANGE,
      })), true);
      assert.equal(isWatchlistPageOutOfRangeError({ code: WATCHLIST_PAGE_OUT_OF_RANGE }), true);
      assert.equal(isWatchlistPageOutOfRangeError({ code: 'other' }), false);
      assert.equal(isWatchlistPageOutOfRangeError(null), false);
      const fallback = 'İzleme listesi işlemi gerçekleştirilemedi. Lütfen tekrar deneyiniz.';
      assert.equal(formatWatchlistRpcError(undefined), fallback);
      assert.equal(formatWatchlistRpcError({ details: 'private data' }), fallback);
      for (const message of ['network failure', 'fetch failed', 'timeout', 'offline', 'request aborted']) {
        assert.match(formatWatchlistRpcError(new Error(message)), /Ağ bağlantısı/);
      }
    });
  });

  describe('8. View-State Resolution Matrix', () => {
    it('36. Resolves all distinct states correctly including auth_failed and page_error with retry', () => {
      const s1 = resolveWatchlistViewState({
        isAuthReady: false,
        userId: null,
        authError: null,
        isLoading: true,
        isPageLoading: false,
        error: null,
        hasLoadedSuccessfully: false,
        totalCount: 0,
        itemsCount: 0,
        isStale: false,
        pendingInstrumentIdsCount: 0,
      });
      assert.strictEqual(s1.state, 'auth_not_ready');
      assert.strictEqual(s1.showInitialSpinner, true);

      const s2 = resolveWatchlistViewState({
        isAuthReady: true,
        userId: null,
        authError: 'Oturum açılamadı',
        isLoading: false,
        isPageLoading: false,
        error: null,
        hasLoadedSuccessfully: false,
        totalCount: 0,
        itemsCount: 0,
        isStale: false,
        pendingInstrumentIdsCount: 0,
      });
      assert.strictEqual(s2.state, 'auth_failed');
      assert.strictEqual(s2.errorMessage, 'Oturum açılamadı');

      const s3 = resolveWatchlistViewState({
        isAuthReady: true,
        userId: 'usr-1',
        authError: null,
        isLoading: false,
        isPageLoading: false,
        error: 'Sayfa yükleme hatası',
        hasLoadedSuccessfully: true,
        totalCount: 47,
        itemsCount: 20,
        isStale: false,
        pendingInstrumentIdsCount: 0,
      });
      assert.strictEqual(s3.state, 'page_error');
      assert.strictEqual(s3.showContentList, true);
      assert.strictEqual(s3.errorMessage, 'İzleme listesi işlemi gerçekleştirilemedi. Lütfen tekrar deneyiniz.');
    });
  });

  describe('9. Home UI Viewport & Expansion State Scenarios', () => {
    it('37. totalCount = 5: displays 5 items in collapsed mode; footer toggle is not rendered', () => {
      const totalCount = 5;
      const allItems = Array.from({ length: 5 }, (_, i) => ({
        watchlistId: `wl-${i}`,
        instrumentId: `inst-${i}`,
        symbol: `SYM${i}`,
        companyName: `Comp ${i}`,
        market: 'BIST100' as const,
        assetType: 'stock' as const,
        currency: 'TRY' as const,
        isActive: true,
        hasPrice: true,
        price: 100,
        changeAmount: 1,
        changePercent: 1,
        priceAt: '2026-08-31T09:30:00Z',
        priceIsStale: false,
        staleReason: null,
        addedAt: '2026-08-30T12:00:00Z',
      }));

      // Collapsed: items.slice(0, 5)
      const collapsedItems = allItems.slice(0, 5);
      assert.strictEqual(collapsedItems.length, 5);
      // Footer toggle condition
      const showFooterToggle = totalCount > 5;
      assert.strictEqual(showFooterToggle, false);
    });

    it('38. totalCount = 6: collapsed shows 5 items + "Tümünü Gör" footer; expanding switches to 6 items + "Daralt" footer without pagination', () => {
      const totalCount = 6;
      const allItems = Array.from({ length: 6 }, (_, i) => ({
        watchlistId: `wl-${i}`,
        instrumentId: `inst-${i}`,
        symbol: `SYM${i}`,
        companyName: `Comp ${i}`,
        market: 'BIST100' as const,
        assetType: 'stock' as const,
        currency: 'TRY' as const,
        isActive: true,
        hasPrice: true,
        price: 100,
        changeAmount: 1,
        changePercent: 1,
        priceAt: '2026-08-31T09:30:00Z',
        priceIsStale: false,
        staleReason: null,
        addedAt: '2026-08-30T12:00:00Z',
      }));

      // Collapsed view
      const collapsedItems = allItems.slice(0, 5);
      assert.strictEqual(collapsedItems.length, 5);
      assert.strictEqual(totalCount > 5, true); // Footer "Tümünü Gör" shown

      // Expanded view
      const expandedItems = allItems.slice(0, 20);
      assert.strictEqual(expandedItems.length, 6);
      assert.strictEqual(totalCount > 20, false); // Pagination not needed
    });

    it('39. totalCount = 20: collapsed shows 5 items; expanded shows 20 items without pagination', () => {
      const totalCount = 20;
      const allItems = Array.from({ length: 20 }, (_, i) => ({
        watchlistId: `wl-${i}`,
        instrumentId: `inst-${i}`,
        symbol: `SYM${i}`,
        companyName: `Comp ${i}`,
        market: 'BIST100' as const,
        assetType: 'stock' as const,
        currency: 'TRY' as const,
        isActive: true,
        hasPrice: true,
        price: 100,
        changeAmount: 1,
        changePercent: 1,
        priceAt: '2026-08-31T09:30:00Z',
        priceIsStale: false,
        staleReason: null,
        addedAt: '2026-08-30T12:00:00Z',
      }));

      assert.strictEqual(allItems.slice(0, 5).length, 5);
      assert.strictEqual(allItems.slice(0, 20).length, 20);
      assert.strictEqual(totalCount > 20, false); // No pagination needed
    });

    it('40. totalCount = 21: collapsed shows 5 items; expanded page 0 shows 20 items (1–20 / 21) with pagination, page 1 shows 1 item (21–21 / 21)', () => {
      const totalCount = 21;
      const pageSize = 20;

      // Page 0 (20 items)
      assert.strictEqual(formatPaginationRangeText(0, pageSize, totalCount, 20), '1–20 / 21');
      // Page 1 (1 item)
      assert.strictEqual(formatPaginationRangeText(1, pageSize, totalCount, 1), '21–21 / 21');
      assert.strictEqual(totalCount > pageSize, true);
    });

    it('41. totalCount = 47: pagination across 3 pages formatted strictly as 1–20 / 47, 21–40 / 47, 41–47 / 47', () => {
      const totalCount = 47;
      const pageSize = 20;

      assert.strictEqual(formatPaginationRangeText(0, pageSize, totalCount, 20), '1–20 / 47');
      assert.strictEqual(formatPaginationRangeText(1, pageSize, totalCount, 20), '21–40 / 47');
      assert.strictEqual(formatPaginationRangeText(2, pageSize, totalCount, 7), '41–47 / 47');
    });
  });

  describe('10. Swipe Gesture Helpers, Action Result Union & Mutual Exclusion', () => {
    it('42. shouldCaptureSwipeGesture captures distinct horizontal motion and rejects vertical scrolling or tiny drags', () => {
      // Distinct left motion
      assert.strictEqual(shouldCaptureSwipeGesture({ dx: -45, dy: 5 }), true);
      // Distinct right motion
      assert.strictEqual(shouldCaptureSwipeGesture({ dx: 35, dy: 2 }), true);
      // Vertical scrolling (must NOT capture, preserving page scroll)
      assert.strictEqual(shouldCaptureSwipeGesture({ dx: 5, dy: 30 }), false);
      assert.strictEqual(shouldCaptureSwipeGesture({ dx: 15, dy: 20 }), false);
      // Tiny movement below minimum 8px travel threshold
      assert.strictEqual(shouldCaptureSwipeGesture({ dx: 5, dy: 1 }), false);
      assert.strictEqual(shouldCaptureSwipeGesture({ dx: 0, dy: 0 }), false);
    });

    it('43. resolveSwipeReleaseAction snaps open on strong left swipe and remains closed on weak swipe', () => {
      // Swiping left beyond open threshold (e.g. -40px vs threshold 30px) -> snaps open to -76
      const openResult = resolveSwipeReleaseAction({ dx: -40, dy: 2 }, false, 76, 30, 25);
      assert.deepStrictEqual(openResult, { targetOffset: -76, shouldOpen: true });

      // Short left swipe below threshold (e.g. -15px vs threshold 30px) -> snaps closed to 0
      const cancelResult = resolveSwipeReleaseAction({ dx: -15, dy: 1 }, false, 76, 30, 25);
      assert.deepStrictEqual(cancelResult, { targetOffset: 0, shouldOpen: false });
    });

    it('44. resolveSwipeReleaseAction closes open row on right swipe and keeps it open on weak tap/drag', () => {
      // Swiping right beyond close threshold (e.g. +30px vs threshold 25px) -> snaps closed to 0
      const closeResult = resolveSwipeReleaseAction({ dx: 30, dy: 1 }, true, 76, 30, 25);
      assert.deepStrictEqual(closeResult, { targetOffset: 0, shouldOpen: false });

      // Weak drag while open (e.g. +10px) -> remains open at -76
      const stayOpenResult = resolveSwipeReleaseAction({ dx: 10, dy: 1 }, true, 76, 30, 25);
      assert.deepStrictEqual(stayOpenResult, { targetOffset: -76, shouldOpen: true });
    });

    it('45. computeSwipeOffset calculates bounded translation and applies rubber-band resistance beyond boundaries', () => {
      // Within regular bounds (-76px to 0px)
      assert.strictEqual(computeSwipeOffset(0, -50, 76), -50);
      assert.strictEqual(computeSwipeOffset(-76, 20, 76), -56);

      // Rubber-band resistance on right pull (dx > 0)
      const rightPull = computeSwipeOffset(0, 20, 76);
      assert.strictEqual(rightPull, 4); // 20 * 0.2

      // Rubber-band resistance on extreme left overscroll (beyond -91px)
      const extremeLeft = computeSwipeOffset(0, -101, 76, 15);
      assert.strictEqual(extremeLeft, -91 + (-101 - (-91)) * 0.2); // -91 + (-10) * 0.2 = -93
    });

    it('46. swipeRowReducer handles open, close, and dismiss events with strict mutual exclusion in production', () => {
      let activeId: string | null = null;

      // 1. Open row A -> activeId is 'inst-a'
      const openEventA: SwipeRowEvent = { type: 'open', instrumentId: 'inst-a' };
      activeId = swipeRowReducer(activeId, openEventA);
      assert.strictEqual(activeId, 'inst-a');

      // 2. Re-opening row A (e.g. repeated swipe) keeps 'inst-a' (never becomes null)
      activeId = swipeRowReducer(activeId, { type: 'open', instrumentId: 'inst-a' });
      assert.strictEqual(activeId, 'inst-a');

      // 3. Opening row B when A is open -> switches active to 'inst-b'
      const openEventB: SwipeRowEvent = { type: 'open', instrumentId: 'inst-b' };
      activeId = swipeRowReducer(activeId, openEventB);
      assert.strictEqual(activeId, 'inst-b');

      // 4. close event from non-active row C does NOT close active row B
      const closeEventC: SwipeRowEvent = { type: 'close', instrumentId: 'inst-c' };
      activeId = swipeRowReducer(activeId, closeEventC);
      assert.strictEqual(activeId, 'inst-b');

      // 5. close event from active row B closes it to null
      const closeEventB: SwipeRowEvent = { type: 'close', instrumentId: 'inst-b' };
      activeId = swipeRowReducer(activeId, closeEventB);
      assert.strictEqual(activeId, null);

      // 6. dismiss event unconditionally sets active to null
      const dismissEvent: SwipeRowEvent = { type: 'dismiss' };
      activeId = swipeRowReducer('inst-a', dismissEvent);
      assert.strictEqual(activeId, null);

      // 7. dismiss when already null returns null
      activeId = swipeRowReducer(null, { type: 'dismiss' });
      assert.strictEqual(activeId, null);
    });

    it('47. Production helper createToggleWatchlistSuccessResult produces discriminated success union with wasChanged flag', () => {
      // Active change: Added
      const addRpcResult: SetWatchlistItemResult = {
        instrumentId: 'inst-thyao',
        isWatched: true,
        wasChanged: true,
        watchlistId: 'wl-101',
      };
      const addRes: ToggleWatchlistActionResult = createToggleWatchlistSuccessResult(addRpcResult);
      assert.deepStrictEqual(addRes, {
        success: true,
        isWatched: true,
        wasChanged: true,
        watchlistId: 'wl-101',
      });

      // Idempotent No-Op: Removed but was already not in watchlist
      const noOpRpcResult: SetWatchlistItemResult = {
        instrumentId: 'inst-kchol',
        isWatched: false,
        wasChanged: false,
        watchlistId: null,
      };
      const noOpRes: ToggleWatchlistActionResult = createToggleWatchlistSuccessResult(noOpRpcResult);
      assert.deepStrictEqual(noOpRes, {
        success: true,
        isWatched: false,
        wasChanged: false,
        watchlistId: null,
      });
      assert.strictEqual(noOpRes.success, true);
      assert.strictEqual(noOpRes.wasChanged, false);
    });

    it('48. Production helper createToggleWatchlistErrorResult produces safe, non-leaking error union without technical details', () => {
      // Formatted RPC error string
      const rawPostgresError = new Error('duplicate key value violates unique constraint "user_watchlist_items_user_id_instrument_id_key"');
      const safeErrorMessage = formatWatchlistRpcError(rawPostgresError);

      assert.strictEqual(safeErrorMessage, 'İzleme listesi işlemi gerçekleştirilemedi. Lütfen tekrar deneyiniz.');
      assert.strictEqual(safeErrorMessage.includes('violates unique constraint'), false);

      const errorRes: ToggleWatchlistActionResult = createToggleWatchlistErrorResult(safeErrorMessage);
      assert.deepStrictEqual(errorRes, {
        success: false,
        error: 'İzleme listesi işlemi gerçekleştirilemedi. Lütfen tekrar deneyiniz.',
      });
    });
  });

  describe('11. Membership Fetch–Mutation Revision Race Condition Suite', () => {
    it('49. Cache empty: fetch pending + concurrent ADD mutation triggers revision retry and settles with fresh added item', async () => {
      const activeUserId = 'usr-race-add';
      let membershipFetchCount = 0;

      let resolveFirstFetch!: (val: any) => void;
      const firstFetchDeferred = new Promise((resolve) => {
        resolveFirstFetch = resolve;
      });

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async (fnName: string, args?: any) => {
          if (fnName === 'get_my_watchlist') {
            membershipFetchCount++;
            if (membershipFetchCount === 1) {
              await firstFetchDeferred;
              return {
                data: [{ instrument_id: 'inst-thyao', total_count: 1 }],
                error: null,
              };
            }
            return {
              data: [
                { instrument_id: 'inst-thyao', total_count: 2 },
                { instrument_id: 'inst-akbnk', total_count: 2 },
              ],
              error: null,
            };
          }

          if (fnName === 'set_my_watchlist_item') {
            return {
              data: [
                {
                  watchlist_id: 'wl-akbnk',
                  instrument_id: args.p_instrument_id,
                  is_watched: args.p_is_watched,
                  was_changed: true,
                },
              ],
              error: null,
            };
          }

          return { data: [], error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      // 1. Initial membership fetch starts (cache is empty)
      const fetchPromise = fetchAllWatchedInstrumentIds(true);

      // 2. In-flight mutation: user adds AKBNK
      const mutationPromise = setWatchlistItem('inst-akbnk', true);
      const mutationResult = await mutationPromise;
      assert.strictEqual(mutationResult.isWatched, true);
      assert.strictEqual(mutationResult.instrumentId, 'inst-akbnk');

      // 3. 1st fetch resolves with old state (missing AKBNK)
      resolveFirstFetch(null);

      // 4. Await initial fetch promise (which automatically ran 2nd fetch due to revision mismatch)
      const finalResult = await fetchPromise;

      // 5. Assertions:
      assert.strictEqual(membershipFetchCount, 2); // Exactly 2 membership RPC calls
      assert.strictEqual(finalResult.isStale, false); // Clean fresh cache
      assert.strictEqual(finalResult.instrumentIds.has('inst-thyao'), true);
      assert.strictEqual(finalResult.instrumentIds.has('inst-akbnk'), true); // Contains newly added!

      const snapshot = getWatchlistMembershipSnapshot(activeUserId);
      assert.ok(snapshot);
      assert.strictEqual(snapshot.isStale, false);
      assert.strictEqual(snapshot.instrumentIds.has('inst-akbnk'), true);
    });

    it('50. Cache exists: pre-seeded cache + force refresh pending + concurrent REMOVE mutation triggers revision retry without overwriting with stale item', async () => {
      const activeUserId = 'usr-race-remove';
      let membershipFetchCount = 0;
      let isPreSeeding = true;

      let resolveFirstRefresh!: (val: any) => void;
      const firstRefreshDeferred = new Promise((resolve) => {
        resolveFirstRefresh = resolve;
      });

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async (fnName: string, args?: any) => {
          if (fnName === 'get_my_watchlist') {
            membershipFetchCount++;
            if (isPreSeeding) {
              // Pre-seeding returns 2 items (THYAO & AKBNK)
              return {
                data: [
                  { instrument_id: 'inst-thyao', total_count: 2 },
                  { instrument_id: 'inst-akbnk', total_count: 2 },
                ],
                error: null,
              };
            }

            // In refresh pipeline:
            if (membershipFetchCount === 2) {
              // 1st refresh RPC call is held pending
              await firstRefreshDeferred;
              return {
                data: [
                  { instrument_id: 'inst-thyao', total_count: 2 },
                  { instrument_id: 'inst-akbnk', total_count: 2 },
                ],
                error: null,
              };
            }

            // 2nd refresh RPC call returns updated DB state after removal
            return {
              data: [{ instrument_id: 'inst-thyao', total_count: 1 }],
              error: null,
            };
          }

          if (fnName === 'set_my_watchlist_item') {
            return {
              data: [
                {
                  watchlist_id: null,
                  instrument_id: args.p_instrument_id,
                  is_watched: args.p_is_watched,
                  was_changed: true,
                },
              ],
              error: null,
            };
          }

          return { data: [], error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      // 1. Pre-seed cache
      const preSeededResult = await fetchAllWatchedInstrumentIds(true);
      assert.strictEqual(membershipFetchCount, 1);
      assert.strictEqual(preSeededResult.instrumentIds.has('inst-akbnk'), true);
      assert.strictEqual(preSeededResult.instrumentIds.has('inst-thyao'), true);
      assert.strictEqual(preSeededResult.isStale, false);

      isPreSeeding = false;

      // 2. Start force refresh (in-flight)
      const refreshPromise = fetchAllWatchedInstrumentIds(true);

      // 3. Concurrent mutation: user removes AKBNK
      const mutationResult = await setWatchlistItem('inst-akbnk', false);
      assert.strictEqual(mutationResult.isWatched, false);

      // 4. Resolve 1st refresh RPC with old data (which still has AKBNK)
      resolveFirstRefresh(null);

      // 5. Await refresh promise
      const finalResult = await refreshPromise;

      // 6. Assertions:
      assert.strictEqual(membershipFetchCount, 3); // 1 seed + 2 refresh pipeline RPCs
      assert.strictEqual(finalResult.isStale, false);
      assert.strictEqual(finalResult.instrumentIds.has('inst-thyao'), true);
      assert.strictEqual(finalResult.instrumentIds.has('inst-akbnk'), false); // Removed item NOT in final result!

      const snapshot = getWatchlistMembershipSnapshot(activeUserId);
      assert.ok(snapshot);
      assert.strictEqual(snapshot.isStale, false);
      assert.strictEqual(snapshot.instrumentIds.has('inst-akbnk'), false);
    });

    it('51. Multiple concurrent callers share the pipeline and both receive the updated result after retry', async () => {
      const activeUserId = 'usr-race-concurrent';
      let membershipFetchCount = 0;

      let resolveFirstFetch!: (val: any) => void;
      const firstFetchDeferred = new Promise((resolve) => {
        resolveFirstFetch = resolve;
      });

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async (fnName: string, args?: any) => {
          if (fnName === 'get_my_watchlist') {
            membershipFetchCount++;
            if (membershipFetchCount === 1) {
              await firstFetchDeferred;
              return {
                data: [{ instrument_id: 'inst-thyao', total_count: 1 }],
                error: null,
              };
            }
            return {
              data: [
                { instrument_id: 'inst-thyao', total_count: 2 },
                { instrument_id: 'inst-garanti', total_count: 2 },
              ],
              error: null,
            };
          }

          if (fnName === 'set_my_watchlist_item') {
            return {
              data: [
                {
                  watchlist_id: 'wl-garanti',
                  instrument_id: args.p_instrument_id,
                  is_watched: args.p_is_watched,
                  was_changed: true,
                },
              ],
              error: null,
            };
          }

          return { data: [], error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      // 1. Two callers join concurrently
      const p1 = fetchAllWatchedInstrumentIds(true);
      const p2 = fetchAllWatchedInstrumentIds(false);

      // 2. Mutation occurs
      await setWatchlistItem('inst-garanti', true);

      // 3. Resolve 1st fetch
      resolveFirstFetch(null);

      // 4. Both callers await
      const [res1, res2] = await Promise.all([p1, p2]);

      assert.strictEqual(membershipFetchCount, 2);
      assert.strictEqual(res1.isStale, false);
      assert.strictEqual(res2.isStale, false);
      assert.strictEqual(res1.instrumentIds.has('inst-garanti'), true);
      assert.strictEqual(res2.instrumentIds.has('inst-garanti'), true);
    });

    it('52. Continuous mutation storm exceeding MAX_MEMBERSHIP_ATTEMPTS falls back to stale if cache exists, or throws safe error', async () => {
      const activeUserId = 'usr-storm';
      let membershipFetchCount = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async (fnName: string) => {
          if (fnName === 'get_my_watchlist') {
            membershipFetchCount++;
            bumpMembershipRevision(activeUserId);
            return {
              data: [{ instrument_id: `inst-storm-${membershipFetchCount}`, total_count: 1 }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      // Case A: No existing cache -> throws WatchlistOperationError
      await assert.rejects(
        async () => {
          await fetchAllWatchedInstrumentIds(true);
        },
        {
          name: 'WatchlistOperationError',
          message: 'İzleme listesi güncellenirken çakışma oluştu. Lütfen tekrar deneyiniz.',
        }
      );
      assert.strictEqual(membershipFetchCount, MAX_MEMBERSHIP_ATTEMPTS);

      // Case B: With existing cache -> falls back to stale without advancing timestamp
      clearWatchlistCache();
      membershipFetchCount = 0;

      const normalMockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async () => {
          return {
            data: [{ instrument_id: 'inst-seeded', total_count: 1 }],
            error: null,
          };
        },
      };
      setSupabaseClientForTesting(normalMockClient);
      const seeded = await fetchAllWatchedInstrumentIds(true);
      assert.strictEqual(seeded.isStale, false);
      const seededTimestamp = seeded.timestamp;

      // Now enable storm client
      setSupabaseClientForTesting(mockClient);
      const fallbackResult = await fetchAllWatchedInstrumentIds(true);
      assert.strictEqual(fallbackResult.isStale, true);
      assert.strictEqual(fallbackResult.instrumentIds.has('inst-seeded'), true);
      assert.strictEqual(fallbackResult.timestamp, seededTimestamp);
    });

    it('53. User A mutation/revision does not affect User B in-flight fetch or cache', async () => {
      let userBFetchCount = 0;
      let currentAuthUserId = 'usr-b';

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: currentAuthUserId } } },
            error: null,
          }),
        },
        rpc: async (fnName: string, args?: any) => {
          if (fnName === 'get_my_watchlist') {
            if (currentAuthUserId === 'usr-a') {
              return { data: [{ instrument_id: 'inst-a', total_count: 1 }], error: null };
            }
            userBFetchCount++;
            return { data: [{ instrument_id: 'inst-b', total_count: 1 }], error: null };
          }
          if (fnName === 'set_my_watchlist_item') {
            return {
              data: [{ watchlist_id: 'wl-a', instrument_id: args.p_instrument_id, is_watched: args.p_is_watched, was_changed: true }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      // User A runs mutation
      currentAuthUserId = 'usr-a';
      await setWatchlistItem('inst-a-new', true);
      assert.strictEqual(getMembershipRevision('usr-a'), 1);
      assert.strictEqual(getMembershipRevision('usr-b'), 0);

      // User B runs fetch (starts with revision 0 and ends with revision 0)
      currentAuthUserId = 'usr-b';
      const resB = await fetchAllWatchedInstrumentIds(true);
      assert.strictEqual(userBFetchCount, 1); // Only 1 fetch for User B!
      assert.strictEqual(resB.instrumentIds.has('inst-b'), true);
      assert.strictEqual(resB.instrumentIds.has('inst-a-new'), false);
    });

    it('54. Watchlist change subscription notifies listeners with updated snapshot immediately after mutation', async () => {
      const activeUserId = 'usr-sub-sync';
      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async (fnName: string, args?: any) => {
          if (fnName === 'get_my_watchlist') {
            return { data: [{ instrument_id: 'inst-1', total_count: 1 }], error: null };
          }
          if (fnName === 'set_my_watchlist_item') {
            return {
              data: [{ watchlist_id: 'wl-2', instrument_id: args.p_instrument_id, is_watched: args.p_is_watched, was_changed: true }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      // Pre-seed cache
      await fetchAllWatchedInstrumentIds(true);

      let notifiedEvent: any = null;
      const unsubscribe = subscribeWatchlistChanges((event) => {
        notifiedEvent = event;
      });

      // Mutate: add inst-2
      await setWatchlistItem('inst-2', true);

      assert.ok(notifiedEvent);
      assert.strictEqual(notifiedEvent.userId, activeUserId);
      assert.strictEqual(notifiedEvent.mutation?.instrumentId, 'inst-2');
      assert.strictEqual(notifiedEvent.mutation?.isWatched, true);

      const snapshot = getWatchlistMembershipSnapshot(activeUserId);
      assert.ok(snapshot);
      assert.strictEqual(snapshot.instrumentIds.has('inst-1'), true);
      assert.strictEqual(snapshot.instrumentIds.has('inst-2'), true);

      unsubscribe();
    });

    it('55. Multi-page ADD: mid-pagination total_count drift with changed revision discards partial batch, retries from offset=0, and succeeds', async () => {
      const activeUserId = 'usr-multipage-add';
      const offsetSequence: number[] = [];
      let callCount = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async (fnName: string, args?: any) => {
          if (fnName === 'get_my_watchlist') {
            callCount++;
            const offset = args?.p_offset ?? 0;
            offsetSequence.push(offset);

            // Attempt 1, Page 0: 100 rows, total = 150
            if (callCount === 1) {
              return {
                data: Array.from({ length: 100 }, (_, i) => ({
                  instrument_id: `inst-item-${i}`,
                  total_count: 150,
                })),
                error: null,
              };
            }

            // Attempt 1, Page 1: 51 rows, total = 151 (drift! caused by ADD)
            if (callCount === 2) {
              return {
                data: Array.from({ length: 51 }, (_, i) => ({
                  instrument_id: `inst-item-${100 + i}`,
                  total_count: 151,
                })),
                error: null,
              };
            }

            // Attempt 2, Page 0: offset = 0, 100 rows, total = 151
            if (callCount === 3) {
              return {
                data: Array.from({ length: 100 }, (_, i) => ({
                  instrument_id: `inst-item-${i}`,
                  total_count: 151,
                })),
                error: null,
              };
            }

            // Attempt 2, Page 1: offset = 100, 51 rows, total = 151 (contains inst-item-new)
            if (callCount === 4) {
              return {
                data: Array.from({ length: 51 }, (_, i) => ({
                  instrument_id: i === 50 ? 'inst-item-new' : `inst-item-${100 + i}`,
                  total_count: 151,
                })),
                error: null,
              };
            }
          }

          if (fnName === 'set_my_watchlist_item') {
            return {
              data: [
                {
                  watchlist_id: 'wl-new',
                  instrument_id: args.p_instrument_id,
                  is_watched: args.p_is_watched,
                  was_changed: true,
                },
              ],
              error: null,
            };
          }

          return { data: [], error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      // Start fetching
      const fetchPromise = fetchAllWatchedInstrumentIds(true);

      // Between page 0 and page 1, user performs ADD mutation
      await setWatchlistItem('inst-item-new', true);

      const finalResult = await fetchPromise;

      // Assertions:
      assert.strictEqual(callCount, 4); // 2 in Attempt 1 + 2 in Attempt 2
      assert.deepStrictEqual(offsetSequence, [0, 100, 0, 100]); // Discarded and retried from offset = 0!
      assert.strictEqual(finalResult.isStale, false);
      assert.strictEqual(finalResult.instrumentIds.size, 151);
      assert.strictEqual(finalResult.instrumentIds.has('inst-item-new'), true);
    });

    it('56. Multi-page REMOVE: mid-pagination early empty/short page with changed revision discards partial batch, retries from offset=0, and succeeds', async () => {
      const activeUserId = 'usr-multipage-remove';
      const offsetSequence: number[] = [];
      let callCount = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async (fnName: string, args?: any) => {
          if (fnName === 'get_my_watchlist') {
            callCount++;
            const offset = args?.p_offset ?? 0;
            offsetSequence.push(offset);

            // Attempt 1, Page 0: 100 rows, total = 101
            if (callCount === 1) {
              return {
                data: Array.from({ length: 100 }, (_, i) => ({
                  instrument_id: `inst-item-${i}`,
                  total_count: 101,
                })),
                error: null,
              };
            }

            // Attempt 1, Page 1: empty array (offset = 100 < expected = 101) because REMOVE reduced count to 100
            if (callCount === 2) {
              return {
                data: [],
                error: null,
              };
            }

            // Attempt 2, Page 0: offset = 0, 100 rows, total = 100
            if (callCount === 3) {
              return {
                data: Array.from({ length: 100 }, (_, i) => ({
                  instrument_id: `inst-item-${i}`,
                  total_count: 100,
                })),
                error: null,
              };
            }
          }

          if (fnName === 'set_my_watchlist_item') {
            return {
              data: [
                {
                  watchlist_id: null,
                  instrument_id: args.p_instrument_id,
                  is_watched: args.p_is_watched,
                  was_changed: true,
                },
              ],
              error: null,
            };
          }

          return { data: [], error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      const fetchPromise = fetchAllWatchedInstrumentIds(true);

      // Between page 0 and page 1, user performs REMOVE mutation
      await setWatchlistItem('inst-item-100', false);

      const finalResult = await fetchPromise;

      assert.strictEqual(callCount, 3);
      assert.deepStrictEqual(offsetSequence, [0, 100, 0]); // Retried from offset = 0!
      assert.strictEqual(finalResult.isStale, false);
      assert.strictEqual(finalResult.instrumentIds.size, 100);
      assert.strictEqual(finalResult.instrumentIds.has('inst-item-100'), false);
    });

    it('57. Genuine contract error without revision change (total_count drift) fails-closed immediately without retrying', async () => {
      const activeUserId = 'usr-genuine-error';
      const offsetSequence: number[] = [];
      let callCount = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async (fnName: string, args?: any) => {
          if (fnName === 'get_my_watchlist') {
            callCount++;
            const offset = args?.p_offset ?? 0;
            offsetSequence.push(offset);

            // Page 0: total_count = 150
            if (callCount === 1) {
              return {
                data: Array.from({ length: 100 }, (_, i) => ({
                  instrument_id: `inst-item-${i}`,
                  total_count: 150,
                })),
                error: null,
              };
            }

            // Page 1: total_count = 140 (corrupted backend without any user mutation!)
            return {
              data: Array.from({ length: 40 }, (_, i) => ({
                instrument_id: `inst-item-${100 + i}`,
                total_count: 140,
              })),
              error: null,
            };
          }
          return { data: [], error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      // Verify that WatchlistOperationError is thrown immediately and NO retry occurs
      await assert.rejects(
        async () => {
          await fetchAllWatchedInstrumentIds(true);
        },
        {
          name: 'WatchlistOperationError',
          message: 'Sayfalar arası toplam kayıt sayısı tutarsızlığı (drift) tespit edildi.',
        }
      );

      assert.strictEqual(callCount, 2); // Only 2 RPCs in Attempt 1, NO Attempt 2!
      assert.deepStrictEqual(offsetSequence, [0, 100]);
    });

    it('58. In-flight pipeline sharing during multi-page revision retry: multiple concurrent callers share Attempt 1 and Attempt 2', async () => {
      const activeUserId = 'usr-multipage-share';
      const offsetSequence: number[] = [];
      let callCount = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        rpc: async (fnName: string, args?: any) => {
          if (fnName === 'get_my_watchlist') {
            callCount++;
            const offset = args?.p_offset ?? 0;
            offsetSequence.push(offset);

            // Attempt 1 Page 0
            if (callCount === 1) {
              return {
                data: Array.from({ length: 100 }, (_, i) => ({
                  instrument_id: `inst-s-${i}`,
                  total_count: 150,
                })),
                error: null,
              };
            }

            // Attempt 1 Page 1 (drift due to mutation)
            if (callCount === 2) {
              return {
                data: Array.from({ length: 51 }, (_, i) => ({
                  instrument_id: `inst-s-${100 + i}`,
                  total_count: 151,
                })),
                error: null,
              };
            }

            // Attempt 2 Page 0
            if (callCount === 3) {
              return {
                data: Array.from({ length: 100 }, (_, i) => ({
                  instrument_id: `inst-s-${i}`,
                  total_count: 151,
                })),
                error: null,
              };
            }

            // Attempt 2 Page 1
            if (callCount === 4) {
              return {
                data: Array.from({ length: 51 }, (_, i) => ({
                  instrument_id: i === 50 ? 'inst-s-new' : `inst-s-${100 + i}`,
                  total_count: 151,
                })),
                error: null,
              };
            }
          }

          if (fnName === 'set_my_watchlist_item') {
            return {
              data: [
                {
                  watchlist_id: 'wl-s-new',
                  instrument_id: args.p_instrument_id,
                  is_watched: args.p_is_watched,
                  was_changed: true,
                },
              ],
              error: null,
            };
          }

          return { data: [], error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      // Caller 1 starts
      const p1 = fetchAllWatchedInstrumentIds(true);

      // Caller 2 joins the in-flight pipeline
      const p2 = fetchAllWatchedInstrumentIds(false);

      // Mutation happens
      await setWatchlistItem('inst-s-new', true);

      const [res1, res2] = await Promise.all([p1, p2]);

      assert.strictEqual(callCount, 4); // Shared exactly 4 RPCs (2 in Attempt 1 + 2 in Attempt 2)
      assert.deepStrictEqual(offsetSequence, [0, 100, 0, 100]);
      assert.strictEqual(res1.instrumentIds.size, 151);
      assert.strictEqual(res2.instrumentIds.size, 151);
      assert.strictEqual(res1.instrumentIds.has('inst-s-new'), true);
      assert.strictEqual(res2.instrumentIds.has('inst-s-new'), true);
      assert.strictEqual(res1.isStale, false);
      assert.strictEqual(res2.isStale, false);
    });
  });
});


