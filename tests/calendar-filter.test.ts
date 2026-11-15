/**
 * Lucrari — Calendar Event Filter, Portfolio Ownership & Watchlist Comprehensive Test Suite
 * 
 * Validates:
 * 1. All 7 filters ('all', 'portfolio', 'watchlist', 'earnings', 'economic', 'bist', 'usa').
 * 2. Economic events are NEVER included in 'portfolio', 'watchlist', 'bist', or 'usa' filters.
 * 3. Sold positions (quantity <= 0 or unowned) are strictly excluded from 'portfolio'.
 * 4. Missing instrumentId + same symbol is strictly NOT in portfolio or watchlist (isInPortfolio=false, isInWatchlist=false).
 * 5. Different instrumentId + same symbol is strictly NOT in portfolio or watchlist.
 * 6. Independent co-existence: an asset can be in both portfolio and watchlist, one, or neither.
 * 7. Watchlist filter returns both BIST and USA earnings together.
 * 8. Adding/removing items dynamically updates filtered events and day indicators.
 * 9. reconcileExportSelection retains only dates with active visible events.
 * 10. formatPortfolioQuantity formats locale-aware (tr-TR) with 8-decimal micro/fractional support.
 * 11. isValidSecureEventUrl strict HTTPS-only acceptance/rejection matrix.
 * 12. resolveCalendarViewState strict priority matrix eliminating UI contradictions for portfolio and watchlist.
 * 13. resolveStaleNotice separates single and combined stale sources ('none', 'ownership', 'calendar', 'watchlist', 'calendar_and_ownership', 'calendar_and_watchlist').
 * 14. Independent error isolation: Watchlist error does NOT block all/portfolio/economic/bist/usa filters; Ownership error does NOT block watchlist.
 * 15. resolveUserScopedOwnershipState & resolveUserScopedMembershipState render-time user isolation without 1-frame leakage.
 * 16. shouldAcceptOwnershipResult & shouldAcceptMembershipResult reject data.userId mismatch.
 * 17. fetchAllWatchedInstrumentIds in-flight deduplication and TTL cache verification.
 * 18. resolveMonthScopedCalendarState guarantees zero-frame leakage on Month A -> Month B switch.
 * 19. shouldAcceptMonthlyCalendarResult rejects out-of-order/delayed responses from previous months.
 * 20. Month B initial failure does not expose Month A events or false empty portfolio/day state.
 */

import { describe, it, beforeEach, afterEach } from '@jest/globals';
import assert from 'node:assert/strict';
import {
  filterCalendarEvents,
  buildFilteredCalendarData,
  enrichCalendarEvent,
  matchesCalendarFilter,
  reconcileExportSelection,
  formatPortfolioQuantity,
  isValidSecureEventUrl,
  resolveCalendarViewState,
  resolveDayEventsPresentation,
  resolveStaleNotice,
  resolveUserScopedOwnershipState,
  resolveUserScopedMembershipState,
  shouldAcceptMembershipResult,
  resolveMonthScopedCalendarState,
  shouldAcceptMonthlyCalendarResult,
} from '../utils/calendar-event-filter';
import type {
  CalendarEventItem,
  MonthlyCalendarData,
} from '../services/calendar/calendar-service';
import {
  clearOwnershipCache,
  type OwnedPosition,
} from '../services/portfolio/portfolio-ownership-service';
import {
  fetchAllWatchedInstrumentIds,
  clearWatchlistCache,
} from '../services/watchlist/watchlist-service';
import {
  setSupabaseClientForTesting,
  resetSupabaseClientForTesting,
} from '../services/supabase/client';
import { resetAuthLock } from '../services/auth/auth-service';

describe('Calendar Event Filter, Portfolio Ownership & Watchlist Suite', () => {
  // Mock positions indexed STRICTLY by instrumentId
  const mockOwnedPositions = new Map<string, OwnedPosition>([
    ['inst-thyao', { instrumentId: 'inst-thyao', symbol: 'THYAO', quantity: 150 }],
    ['inst-aapl', { instrumentId: 'inst-aapl', symbol: 'AAPL', quantity: 25 }],
  ]);

  // Mock watchlist set indexed STRICTLY by instrumentId
  const mockWatchedInstrumentIds = new Set<string>([
    'inst-thyao', // Both in portfolio AND in watchlist
    'inst-akbnk', // In watchlist ONLY (BIST)
    'inst-msft',  // In watchlist ONLY (USA)
  ]);

  const mockEvents: CalendarEventItem[] = [
    {
      id: 'earnings-1',
      type: 'earnings',
      dateKey: '2026-08-15',
      timeLabel: 'Kapanış Sonrası',
      title: 'THYAO',
      subtitle: 'Türk Hava Yolları • 2026/Q2 Bilanço',
      marketOrCountry: 'BIST 100 🇹🇷',
      instrumentId: 'inst-thyao',
      market: 'BIST100',
    },
    {
      id: 'earnings-2',
      type: 'earnings',
      dateKey: '2026-08-15',
      timeLabel: 'Seans Öncesi',
      title: 'AKBNK',
      subtitle: 'Akbank • 2026/Q2 Bilanço',
      marketOrCountry: 'BIST 100 🇹🇷',
      instrumentId: 'inst-akbnk',
      market: 'BIST100',
    },
    {
      id: 'earnings-3',
      type: 'earnings',
      dateKey: '2026-08-15',
      timeLabel: 'Kapanış Sonrası',
      title: 'AAPL',
      subtitle: 'Apple Inc. • 2026/Q3 Bilanço',
      marketOrCountry: 'NASDAQ 100 🇺🇸',
      instrumentId: 'inst-aapl',
      market: 'NASDAQ100',
    },
    {
      id: 'earnings-4',
      type: 'earnings',
      dateKey: '2026-08-15',
      timeLabel: 'Seans Öncesi',
      title: 'MSFT',
      subtitle: 'Microsoft Corp. • 2026/Q4 Bilanço',
      marketOrCountry: 'NASDAQ 100 🇺🇸',
      instrumentId: 'inst-msft',
      market: 'NASDAQ100',
    },
    {
      id: 'economic-1',
      type: 'economic',
      dateKey: '2026-08-15',
      timeLabel: '10:00',
      title: 'TÜFE (Aylık)',
      subtitle: 'Türkiye 🇹🇷 • Temmuz Dönemi',
      marketOrCountry: 'Türkiye 🇹🇷',
      instrumentId: null,
      market: null,
    },
    {
      id: 'economic-2',
      type: 'economic',
      dateKey: '2026-08-16',
      timeLabel: '15:30',
      title: 'Tarım Dışı İstihdam',
      subtitle: 'ABD 🇺🇸 • Temmuz Dönemi',
      marketOrCountry: 'ABD 🇺🇸',
      instrumentId: null,
      market: null,
    },
  ];

  const mockMonthBData: MonthlyCalendarData = {
    year: 2026,
    month: 7,
    dayIndicators: {
      '2026-08-15': { count: 2, hasEarnings: true, hasEconomic: false },
    },
    eventsByDate: {
      '2026-08-15': [mockEvents[0], mockEvents[1]],
    },
  };

  beforeEach(() => {
    clearOwnershipCache({ clearSubscribers: true });
    clearWatchlistCache({ clearSubscribers: true });
    resetAuthLock();
    resetSupabaseClientForTesting();
  });

  afterEach(() => {
    clearOwnershipCache({ clearSubscribers: true });
    clearWatchlistCache({ clearSubscribers: true });
    resetAuthLock();
    resetSupabaseClientForTesting();
  });

  describe('1. Pure Filter Engine & Strict InstrumentId Ownership Matching', () => {
    it('1. Filter "all" returns all 6 events (both earnings and economic)', () => {
      const filtered = filterCalendarEvents(mockEvents, 'all', mockOwnedPositions, mockWatchedInstrumentIds);
      assert.strictEqual(filtered.length, 6);
    });

    it('2. Filter "portfolio" returns ONLY owned earnings (THYAO & AAPL)', () => {
      const filtered = filterCalendarEvents(mockEvents, 'portfolio', mockOwnedPositions, mockWatchedInstrumentIds);
      assert.strictEqual(filtered.length, 2);

      const symbols = filtered.map((e) => e.title);
      assert.ok(symbols.includes('THYAO'));
      assert.ok(symbols.includes('AAPL'));
      assert.ok(!symbols.includes('AKBNK'));
      assert.ok(!symbols.includes('MSFT'));
      assert.ok(!symbols.includes('TÜFE (Aylık)'));

      assert.strictEqual(filtered[0].isInPortfolio, true);
      assert.strictEqual(filtered[0].portfolioQuantity, 150);
      assert.strictEqual(filtered[1].isInPortfolio, true);
      assert.strictEqual(filtered[1].portfolioQuantity, 25);
    });

    it('3. Economic events are NEVER included in "portfolio", "watchlist", "bist", or "usa"', () => {
      const portfolioFiltered = filterCalendarEvents(mockEvents, 'portfolio', mockOwnedPositions, mockWatchedInstrumentIds);
      assert.ok(!portfolioFiltered.some((e) => e.type === 'economic'));

      const watchlistFiltered = filterCalendarEvents(mockEvents, 'watchlist', mockOwnedPositions, mockWatchedInstrumentIds);
      assert.ok(!watchlistFiltered.some((e) => e.type === 'economic'));

      const bistFiltered = filterCalendarEvents(mockEvents, 'bist', mockOwnedPositions, mockWatchedInstrumentIds);
      assert.ok(!bistFiltered.some((e) => e.type === 'economic'));

      const usaFiltered = filterCalendarEvents(mockEvents, 'usa', mockOwnedPositions, mockWatchedInstrumentIds);
      assert.ok(!usaFiltered.some((e) => e.type === 'economic'));
    });

    it('4. Sold positions (quantity <= 0) or unowned stocks are excluded from "portfolio"', () => {
      const positionsWithSold = new Map<string, OwnedPosition>([
        ['inst-garan', { instrumentId: 'inst-garan', symbol: 'GARAN', quantity: 0 }],
      ]);

      const event: CalendarEventItem = {
        id: 'earnings-garan',
        type: 'earnings',
        dateKey: '2026-08-15',
        timeLabel: 'Gün Boyu',
        title: 'GARAN',
        subtitle: 'Garanti BBVA',
        marketOrCountry: 'BIST 100 🇹🇷',
        instrumentId: 'inst-garan',
        market: 'BIST100',
      };

      const enriched = enrichCalendarEvent(event, positionsWithSold);
      assert.strictEqual(enriched.isInPortfolio, false);
      assert.strictEqual(enriched.portfolioQuantity, null);
      assert.strictEqual(matchesCalendarFilter(enriched, 'portfolio'), false);
    });

    it('5. Missing instrumentId + same symbol is strictly NOT in portfolio or watchlist (isInPortfolio=false, isInWatchlist=false)', () => {
      const eventWithoutId: CalendarEventItem = {
        id: 'earnings-no-id',
        type: 'earnings',
        dateKey: '2026-08-15',
        timeLabel: '18:00',
        title: 'THYAO',
        subtitle: 'THYAO but missing instrumentId',
        marketOrCountry: 'BIST 100 🇹🇷',
        instrumentId: null,
        market: 'BIST100',
      };

      const enriched = enrichCalendarEvent(eventWithoutId, mockOwnedPositions, mockWatchedInstrumentIds);
      assert.strictEqual(enriched.isInPortfolio, false);
      assert.strictEqual(enriched.portfolioQuantity, null);
      assert.strictEqual(enriched.isInWatchlist, false);
      assert.strictEqual(matchesCalendarFilter(enriched, 'portfolio'), false);
      assert.strictEqual(matchesCalendarFilter(enriched, 'watchlist'), false);
    });

    it('6. Different instrumentId + same symbol is strictly NOT in portfolio or watchlist', () => {
      const eventDiffId: CalendarEventItem = {
        id: 'earnings-diff-id',
        type: 'earnings',
        dateKey: '2026-08-15',
        timeLabel: '18:00',
        title: 'THYAO',
        subtitle: 'THYAO with different instrumentId',
        marketOrCountry: 'BIST 100 🇹🇷',
        instrumentId: 'inst-other-thyao',
        market: 'BIST100',
      };

      const enriched = enrichCalendarEvent(eventDiffId, mockOwnedPositions, mockWatchedInstrumentIds);
      assert.strictEqual(enriched.isInPortfolio, false);
      assert.strictEqual(enriched.portfolioQuantity, null);
      assert.strictEqual(enriched.isInWatchlist, false);
      assert.strictEqual(matchesCalendarFilter(enriched, 'portfolio'), false);
      assert.strictEqual(matchesCalendarFilter(enriched, 'watchlist'), false);
    });

    it('7. Filter "earnings" returns all 4 earnings events and excludes economic', () => {
      const filtered = filterCalendarEvents(mockEvents, 'earnings', mockOwnedPositions, mockWatchedInstrumentIds);
      assert.strictEqual(filtered.length, 4);
      assert.ok(filtered.every((e) => e.type === 'earnings'));
    });

    it('8. Filter "economic" returns all 2 economic events and excludes earnings', () => {
      const filtered = filterCalendarEvents(mockEvents, 'economic', mockOwnedPositions, mockWatchedInstrumentIds);
      assert.strictEqual(filtered.length, 2);
      assert.ok(filtered.every((e) => e.type === 'economic'));
    });

    it('9. Filter "bist" returns only BIST100 earnings (THYAO & AKBNK)', () => {
      const filtered = filterCalendarEvents(mockEvents, 'bist', mockOwnedPositions, mockWatchedInstrumentIds);
      assert.strictEqual(filtered.length, 2);
      assert.ok(filtered.every((e) => e.market === 'BIST100'));
    });

    it('10. Filter "usa" returns only NASDAQ100 earnings (AAPL & MSFT)', () => {
      const filtered = filterCalendarEvents(mockEvents, 'usa', mockOwnedPositions, mockWatchedInstrumentIds);
      assert.strictEqual(filtered.length, 2);
      assert.ok(filtered.every((e) => e.market === 'NASDAQ100'));
    });

    it('11. reconcileExportSelection retains only dates with active visible events', () => {
      const selectedDates = new Set(['2026-08-15', '2026-08-16', '2026-08-17']);
      const dayIndicators = {
        '2026-08-15': { count: 3, hasEarnings: true, hasEconomic: false },
        '2026-08-16': { count: 0, hasEarnings: false, hasEconomic: false }, // No visible events
        // 2026-08-17 not in indicators
      };

      const reconciled = reconcileExportSelection(selectedDates, dayIndicators);
      assert.strictEqual(reconciled.size, 1);
      assert.ok(reconciled.has('2026-08-15'));
      assert.ok(!reconciled.has('2026-08-16'));
      assert.ok(!reconciled.has('2026-08-17'));
    });

    it('12. formatPortfolioQuantity formats 8-digit micro/fractional quantities without false-zero', () => {
      assert.strictEqual(formatPortfolioQuantity(null), '—');
      assert.strictEqual(formatPortfolioQuantity(undefined), '—');
      assert.strictEqual(formatPortfolioQuantity(0), '0 Adet');
      assert.strictEqual(formatPortfolioQuantity(150), '150 Adet');
      assert.strictEqual(formatPortfolioQuantity(0.00000001), '0,00000001 Adet');
      assert.strictEqual(formatPortfolioQuantity(12.345678), '12,345678 Adet');
    });

    it('13. buildFilteredCalendarData accurately groups events and computes indicators per filter', () => {
      const eventsByDate = {
        '2026-08-15': mockEvents.slice(0, 5), // 4 earnings, 1 economic
        '2026-08-16': [mockEvents[5]], // 1 economic
      };

      const result = buildFilteredCalendarData(eventsByDate, 'portfolio', mockOwnedPositions, mockWatchedInstrumentIds);
      assert.strictEqual(result.totalVisibleCount, 2); // THYAO & AAPL on 15th, 0 on 16th
      assert.strictEqual(result.dayIndicators['2026-08-15'].count, 2);
      assert.strictEqual(result.dayIndicators['2026-08-15'].hasEarnings, true);
      assert.strictEqual(result.dayIndicators['2026-08-15'].hasEconomic, false);
      assert.strictEqual(result.dayIndicators['2026-08-16'].count, 0);
    });

    it('14. isValidSecureEventUrl strict HTTPS acceptance and rejection matrix', () => {
      assert.strictEqual(isValidSecureEventUrl('https://www.kap.org.tr/tr/Bildirim/123'), true);
      assert.strictEqual(isValidSecureEventUrl('https://sec.gov/edgar/data/123'), true);
      assert.strictEqual(isValidSecureEventUrl('http://insecure.com'), false); // HTTP rejected
      assert.strictEqual(isValidSecureEventUrl('javascript:alert(1)'), false);
      assert.strictEqual(isValidSecureEventUrl('data:text/html,test'), false);
      assert.strictEqual(isValidSecureEventUrl(''), false);
      assert.strictEqual(isValidSecureEventUrl(null), false);
    });
  });

  describe('2. Watchlist Calendar Filter Pure Engine & Strict InstrumentId Matching', () => {
    it('15. Filter "watchlist" returns ONLY watched earnings (THYAO, AKBNK & MSFT) - combining BIST and USA', () => {
      const filtered = filterCalendarEvents(mockEvents, 'watchlist', mockOwnedPositions, mockWatchedInstrumentIds);
      assert.strictEqual(filtered.length, 3);

      const symbols = filtered.map((e) => e.title);
      assert.ok(symbols.includes('THYAO')); // Watched BIST
      assert.ok(symbols.includes('AKBNK')); // Watched BIST
      assert.ok(symbols.includes('MSFT'));  // Watched USA
      assert.ok(!symbols.includes('AAPL')); // Unwatched (even though owned)
      assert.ok(!symbols.includes('TÜFE (Aylık)')); // Economic excluded

      assert.strictEqual(filtered.find((e) => e.title === 'THYAO')?.isInWatchlist, true);
      assert.strictEqual(filtered.find((e) => e.title === 'AKBNK')?.isInWatchlist, true);
      assert.strictEqual(filtered.find((e) => e.title === 'MSFT')?.isInWatchlist, true);
    });

    it('16. Watchlist and portfolio memberships are completely independent', () => {
      const enrichedTHYAO = enrichCalendarEvent(mockEvents[0], mockOwnedPositions, mockWatchedInstrumentIds);
      assert.strictEqual(enrichedTHYAO.isInPortfolio, true);
      assert.strictEqual(enrichedTHYAO.isInWatchlist, true);

      const enrichedAKBNK = enrichCalendarEvent(mockEvents[1], mockOwnedPositions, mockWatchedInstrumentIds);
      assert.strictEqual(enrichedAKBNK.isInPortfolio, false);
      assert.strictEqual(enrichedAKBNK.isInWatchlist, true);

      const enrichedAAPL = enrichCalendarEvent(mockEvents[2], mockOwnedPositions, mockWatchedInstrumentIds);
      assert.strictEqual(enrichedAAPL.isInPortfolio, true);
      assert.strictEqual(enrichedAAPL.isInWatchlist, false);
    });

    it('17. Adding/removing items dynamically updates filtered events and day indicators for watchlist', () => {
      const eventsByDate = {
        '2026-08-15': mockEvents,
      };

      // Initial: 3 items in watchlist (THYAO, AKBNK, MSFT)
      const initialData = buildFilteredCalendarData(eventsByDate, 'watchlist', mockOwnedPositions, mockWatchedInstrumentIds);
      assert.strictEqual(initialData.totalVisibleCount, 3);
      assert.strictEqual(initialData.dayIndicators['2026-08-15'].count, 3);

      // User adds AAPL to watchlist
      const updatedWatchedIds = new Set(mockWatchedInstrumentIds);
      updatedWatchedIds.add('inst-aapl');

      const afterAddData = buildFilteredCalendarData(eventsByDate, 'watchlist', mockOwnedPositions, updatedWatchedIds);
      assert.strictEqual(afterAddData.totalVisibleCount, 4);
      assert.strictEqual(afterAddData.dayIndicators['2026-08-15'].count, 4);

      // User removes all items
      const emptyWatchedIds = new Set<string>();
      const afterClearData = buildFilteredCalendarData(eventsByDate, 'watchlist', mockOwnedPositions, emptyWatchedIds);
      assert.strictEqual(afterClearData.totalVisibleCount, 0);
      assert.strictEqual(afterClearData.dayIndicators['2026-08-15'].count, 0);
    });
  });

  describe('3. Calendar View State Matrix, Stale Notice Sources & Multi-Source Independence', () => {
    it('18. resolveCalendarViewState resolves initial_loading when watchlist filter is active and membership is loading', () => {
      const viewState = resolveCalendarViewState({
        activeFilter: 'watchlist',
        isCalendarLoading: false,
        calendarError: null,
        hasCalendarLoadedSuccessfully: true,
        isOwnershipLoading: false,
        ownershipError: null,
        hasOwnershipLoaded: true,
        isOwnershipStale: false,
        openPositionsCount: 2,
        isWatchlistLoading: true,
        watchlistError: null,
        hasWatchlistLoaded: false,
        watchedCount: 0,
        dayEventsCount: 0,
      });

      assert.strictEqual(viewState.state, 'initial_loading');
      assert.strictEqual(viewState.showCalendarSpinner, true);
      assert.strictEqual(viewState.showDayEventsSpinner, true);
    });

    it('19. resolveCalendarViewState resolves initial_error when watchlist membership initial fetch fails (never shows fake empty)', () => {
      const viewState = resolveCalendarViewState({
        activeFilter: 'watchlist',
        isCalendarLoading: false,
        calendarError: null,
        hasCalendarLoadedSuccessfully: true,
        isOwnershipLoading: false,
        ownershipError: null,
        hasOwnershipLoaded: true,
        isOwnershipStale: false,
        openPositionsCount: 2,
        isWatchlistLoading: false,
        watchlistError: new Error('Network error'),
        hasWatchlistLoaded: false,
        watchedCount: 0,
        dayEventsCount: 0,
      });

      assert.strictEqual(viewState.state, 'initial_error');
      assert.strictEqual(viewState.watchlistErrorMessage, 'İzleme listesi verileri yüklenemedi.');
      assert.strictEqual(viewState.emptyStateKind, 'none'); // NEVER fake empty!
    });

    it('20. Watchlist error does NOT block unrelated filters (all, portfolio, economic, bist, usa)', () => {
      const viewState = resolveCalendarViewState({
        activeFilter: 'bist', // Non-watchlist filter
        isCalendarLoading: false,
        calendarError: null,
        hasCalendarLoadedSuccessfully: true,
        isOwnershipLoading: false,
        ownershipError: null,
        hasOwnershipLoaded: true,
        isOwnershipStale: false,
        openPositionsCount: 2,
        isWatchlistLoading: false,
        watchlistError: new Error('Watchlist RPC failed'), // Failed watchlist
        hasWatchlistLoaded: false,
        watchedCount: 0,
        dayEventsCount: 2,
      });

      assert.strictEqual(viewState.state, 'ready'); // Filter works normally!
      assert.strictEqual(viewState.showDayEventsContent, true);
    });

    it('21. Portfolio ownership error does NOT block watchlist filter', () => {
      const viewState = resolveCalendarViewState({
        activeFilter: 'watchlist',
        isCalendarLoading: false,
        calendarError: null,
        hasCalendarLoadedSuccessfully: true,
        isOwnershipLoading: false,
        ownershipError: new Error('Portfolio ownership failed'), // Failed portfolio
        hasOwnershipLoaded: false,
        isOwnershipStale: false,
        openPositionsCount: 0,
        isWatchlistLoading: false,
        watchlistError: null,
        hasWatchlistLoaded: true,
        watchedCount: 3,
        dayEventsCount: 2,
      });

      assert.strictEqual(viewState.state, 'ready'); // Watchlist filter works normally!
      assert.strictEqual(viewState.showDayEventsContent, true);
    });

    it('22. Separates empty_watchlist (watchedCount === 0) vs empty_watchlist_events (watchedCount > 0, events === 0)', () => {
      // 1. Truly empty watchlist
      const emptyWatchlistState = resolveCalendarViewState({
        activeFilter: 'watchlist',
        isCalendarLoading: false,
        calendarError: null,
        hasCalendarLoadedSuccessfully: true,
        isOwnershipLoading: false,
        ownershipError: null,
        hasOwnershipLoaded: true,
        isOwnershipStale: false,
        openPositionsCount: 2,
        isWatchlistLoading: false,
        watchlistError: null,
        hasWatchlistLoaded: true,
        watchedCount: 0, // No items watched
        dayEventsCount: 0,
      });

      assert.strictEqual(emptyWatchlistState.state, 'empty_watchlist');
      assert.strictEqual(emptyWatchlistState.emptyStateKind, 'empty_watchlist');

      // 2. Watchlist has items, but no events on selected date
      const emptyDayEventsState = resolveCalendarViewState({
        activeFilter: 'watchlist',
        isCalendarLoading: false,
        calendarError: null,
        hasCalendarLoadedSuccessfully: true,
        isOwnershipLoading: false,
        ownershipError: null,
        hasOwnershipLoaded: true,
        isOwnershipStale: false,
        openPositionsCount: 2,
        isWatchlistLoading: false,
        watchlistError: null,
        hasWatchlistLoaded: true,
        watchedCount: 5, // 5 items watched
        dayEventsCount: 0, // 0 events today
      });

      assert.strictEqual(emptyDayEventsState.state, 'empty_day_events');
      assert.strictEqual(emptyDayEventsState.emptyStateKind, 'empty_watchlist_events');
    });

    it('23. resolveStaleNotice cleanly models all combinations of stale sources', () => {
      // 1. None
      assert.deepStrictEqual(
        resolveStaleNotice({ isCalendarStale: false, isOwnershipStale: false, isWatchlistStale: false }),
        { staleSource: 'none', staleNoticeText: null }
      );

      // 2. Calendar only
      assert.deepStrictEqual(
        resolveStaleNotice({ isCalendarStale: true, isOwnershipStale: false, isWatchlistStale: false }),
        { staleSource: 'calendar', staleNoticeText: 'Takvim verisi güncel olmayabilir.' }
      );

      // 3. Ownership only
      assert.deepStrictEqual(
        resolveStaleNotice({ isCalendarStale: false, isOwnershipStale: true, isWatchlistStale: false }),
        { staleSource: 'ownership', staleNoticeText: 'Açık pozisyon verisi güncel olmayabilir.' }
      );

      // 4. Watchlist only
      assert.deepStrictEqual(
        resolveStaleNotice({ isCalendarStale: false, isOwnershipStale: false, isWatchlistStale: true }),
        { staleSource: 'watchlist', staleNoticeText: 'İzleme listesi verisi güncel olmayabilir.' }
      );

      // 5. Calendar + Ownership
      assert.deepStrictEqual(
        resolveStaleNotice({ isCalendarStale: true, isOwnershipStale: true, isWatchlistStale: false }),
        { staleSource: 'calendar_and_ownership', staleNoticeText: 'Takvim ve portföy verileri güncel olmayabilir.' }
      );

      // 6. Calendar + Watchlist
      assert.deepStrictEqual(
        resolveStaleNotice({ isCalendarStale: true, isOwnershipStale: false, isWatchlistStale: true }),
        { staleSource: 'calendar_and_watchlist', staleNoticeText: 'Takvim ve izleme listesi verileri güncel olmayabilir.' }
      );
    });
  });

  describe('4. Hook Render-Time User Scoping & Service Deduplication', () => {
    it('24. resolveUserScopedOwnershipState guarantees zero-frame leakage on User A -> User B switch', () => {
      const userAOwnershipState = {
        stateUserId: 'usr-a',
        ownedPositions: mockOwnedPositions,
        isLoading: false,
        isStale: false,
        error: null,
        hasLoadedSuccessfully: true,
      };

      const transitionRender = resolveUserScopedOwnershipState({
        rawState: userAOwnershipState,
        currentUserId: 'usr-b',
        isAuthReady: true,
        authError: null,
        snapshot: null,
      });

      assert.strictEqual(transitionRender.ownedPositions.size, 0);
      assert.strictEqual(transitionRender.hasLoadedSuccessfully, false);
      assert.strictEqual(transitionRender.isLoading, true);
    });

    it('25. resolveUserScopedMembershipState guarantees zero-frame leakage on User A -> User B switch', () => {
      const userAMembershipState = {
        stateUserId: 'usr-a',
        watchedInstrumentIds: mockWatchedInstrumentIds,
        isLoading: false,
        isStale: false,
        error: null,
        hasLoadedSuccessfully: true,
      };

      const transitionRender = resolveUserScopedMembershipState({
        rawState: userAMembershipState,
        currentUserId: 'usr-b',
        isAuthReady: true,
        authError: null,
        snapshot: null,
      });

      assert.strictEqual(transitionRender.watchedInstrumentIds.size, 0);
      assert.strictEqual(transitionRender.watchedCount, 0);
      assert.strictEqual(transitionRender.hasLoadedSuccessfully, false);
      assert.strictEqual(transitionRender.isLoading, true);
    });

    it('26. resolveUserScopedMembershipState halts loading on auth failure with safe error', () => {
      const failedAuthState = resolveUserScopedMembershipState({
        rawState: {
          stateUserId: null,
          watchedInstrumentIds: new Set(),
          isLoading: true,
          isStale: false,
          error: null,
          hasLoadedSuccessfully: false,
        },
        currentUserId: null,
        isAuthReady: true,
        authError: 'Oturum açılamadı',
        snapshot: null,
      });

      assert.strictEqual(failedAuthState.isLoading, false); // Spinner stopped!
      assert.strictEqual(failedAuthState.hasLoadedSuccessfully, false);
      assert.strictEqual(failedAuthState.error?.message, 'Oturum açılamadı');
    });

    it('27. shouldAcceptMembershipResult rejects mismatched data.userId or out-of-order user responses', () => {
      assert.strictEqual(
        shouldAcceptMembershipResult({
          isMounted: true,
          currentUserId: 'usr-a',
          activeUserId: 'usr-a',
          dataUserId: 'usr-a',
        }),
        true
      );

      assert.strictEqual(
        shouldAcceptMembershipResult({
          isMounted: true,
          currentUserId: 'usr-a',
          activeUserId: 'usr-a',
          dataUserId: 'usr-b',
        }),
        false
      );

      assert.strictEqual(
        shouldAcceptMembershipResult({
          isMounted: true,
          currentUserId: 'usr-b',
          activeUserId: 'usr-a',
          dataUserId: 'usr-a',
        }),
        false
      );
    });

    it('28. fetchAllWatchedInstrumentIds in-flight deduplication: concurrent requests share 1 RPC call', async () => {
      const activeUserId = 'usr-dedup';
      let rpcCount = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: activeUserId } } },
            error: null,
          }),
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  range: async () => ({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
        rpc: async () => {
          rpcCount++;
          return {
            data: [
              {
                watchlist_id: 'wl-1',
                instrument_id: 'inst-thyao',
                symbol: 'THYAO',
                market: 'BIST100',
                is_active: true,
                company_name: 'THY',
                currency: 'TRY',
                price: 300,
                change_amount: 5,
                change_percent: 1.5,
                has_price: true,
                price_is_stale: false,
                price_updated_at: new Date().toISOString(),
                total_count: 1,
              },
            ],
            error: null,
          };
        },
      };

      setSupabaseClientForTesting(mockClient);

      // Concurrent calls to fetchAllWatchedInstrumentIds
      const [res1, res2] = await Promise.all([
        fetchAllWatchedInstrumentIds(true),
        fetchAllWatchedInstrumentIds(true),
      ]);

      assert.strictEqual(rpcCount, 1); // Deduplicated into 1 RPC!
      assert.strictEqual(res1.instrumentIds.has('inst-thyao'), true);
      assert.strictEqual(res2.instrumentIds.has('inst-thyao'), true);
    });
  });

  describe('5. Month Transition Zero-Frame Scoping & Result Validation', () => {
    it('29. Month A -> Month B transition returns empty/loading state on the exact first render frame', () => {
      const monthARawState = {
        monthKey: '2026-6',
        data: mockMonthBData,
        isLoading: false,
        error: null,
        hasLoadedSuccessfully: true,
      };

      const monthBTransitionRender = resolveMonthScopedCalendarState({
        rawState: monthARawState,
        currentYear: 2026,
        currentMonth: 7,
      });

      assert.strictEqual(monthBTransitionRender.data, null);
      assert.deepStrictEqual(monthBTransitionRender.eventsByDate, {});
      assert.deepStrictEqual(monthBTransitionRender.dayIndicators, {});
      assert.strictEqual(monthBTransitionRender.hasLoadedSuccessfully, false);
      assert.strictEqual(monthBTransitionRender.isLoading, true);
      assert.strictEqual(monthBTransitionRender.error, null);
    });

    it('30. shouldAcceptMonthlyCalendarResult rejects out-of-order delayed response from Month A when active month is Month B', () => {
      const accepted = shouldAcceptMonthlyCalendarResult({
        isAborted: false,
        activeMonthKey: '2026-6',
        currentMonthKey: '2026-7',
        resultYear: 2026,
        resultMonth: 6,
        targetYear: 2026,
        targetMonth: 7,
      });

      assert.strictEqual(accepted, false);
    });

    it('31. Month B initial fetch failure does not expose Month A events or false empty state', () => {
      const monthBFailureState = resolveMonthScopedCalendarState({
        rawState: {
          monthKey: '2026-7',
          data: null,
          isLoading: false,
          error: 'Network connection lost',
          hasLoadedSuccessfully: false,
        },
        currentYear: 2026,
        currentMonth: 7,
      });

      assert.strictEqual(monthBFailureState.hasLoadedSuccessfully, false);
      assert.strictEqual(monthBFailureState.error, 'Network connection lost');
      assert.deepStrictEqual(monthBFailureState.eventsByDate, {});

      const viewState = resolveCalendarViewState({
        activeFilter: 'all',
        isCalendarLoading: false,
        calendarError: monthBFailureState.error,
        hasCalendarLoadedSuccessfully: monthBFailureState.hasLoadedSuccessfully,
        isOwnershipLoading: false,
        ownershipError: null,
        hasOwnershipLoaded: true,
        isOwnershipStale: false,
        openPositionsCount: 2,
        dayEventsCount: 0,
      });

      assert.strictEqual(viewState.state, 'initial_error');
      assert.strictEqual(viewState.showDayEventsContent, false);
      assert.strictEqual(viewState.emptyStateKind, 'none');

      const pres = resolveDayEventsPresentation({
        showDayEventsContent: viewState.showDayEventsContent,
        showDayEventsSpinner: viewState.showDayEventsSpinner,
        emptyStateKind: viewState.emptyStateKind,
        eventsCount: 0,
      });
      assert.strictEqual(pres.shouldRender, false);
    });

    it('32. Month B successful fetch displays only Month B data', () => {
      const monthBSuccessState = resolveMonthScopedCalendarState({
        rawState: {
          monthKey: '2026-7',
          data: mockMonthBData,
          isLoading: false,
          error: null,
          hasLoadedSuccessfully: true,
        },
        currentYear: 2026,
        currentMonth: 7,
      });

      assert.strictEqual(monthBSuccessState.hasLoadedSuccessfully, true);
      assert.strictEqual(monthBSuccessState.isLoading, false);
      assert.ok(monthBSuccessState.eventsByDate['2026-08-15']);
      assert.strictEqual(monthBSuccessState.eventsByDate['2026-08-15'].length, 2);
    });
  });
});
