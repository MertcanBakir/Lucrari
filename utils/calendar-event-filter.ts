/**
 * Lucrari — Calendar Event Filter Pure Engine
 * 
 * Pure, deterministic functions for filtering calendar events, reconciling export selections,
 * formatting fractional portfolio quantities up to 8 decimals, validating secure HTTPS URLs,
 * separating calendar vs ownership vs watchlist stale sources, resolving render-time user/month isolation states,
 * and resolving unambiguous calendar view states.
 */

import type {
  CalendarEventItem,
  DayIndicator,
  MonthlyCalendarData,
} from '@/services/calendar/calendar-service';
import type { OwnedPosition } from '@/services/portfolio/portfolio-ownership-service';

export type CalendarFilter =
  | 'all'
  | 'portfolio'
  | 'watchlist'
  | 'earnings'
  | 'economic'
  | 'bist'
  | 'usa';

export interface CalendarFilterOption {
  id: CalendarFilter;
  label: string;
  shortLabel: string;
  description: string;
}

export const CALENDAR_FILTER_OPTIONS: readonly CalendarFilterOption[] = [
  { id: 'all', label: 'Tümü', shortLabel: 'Tümü', description: 'Tüm şirket bilançoları ve ekonomik olaylar' },
  { id: 'portfolio', label: 'Portföyüm', shortLabel: 'Portföy', description: 'Yalnızca portföyünüzde bulunan hisselerin bilançoları' },
  { id: 'watchlist', label: 'İzleme Listesi', shortLabel: 'İzleme', description: 'İzleme listenizdeki şirketlerin bilanço açıklamaları' },
  { id: 'earnings', label: 'Şirketler', shortLabel: 'Şirketler', description: 'Tüm şirket bilanço açıklamaları' },
  { id: 'economic', label: 'Ekonomik', shortLabel: 'Ekonomik', description: 'Yalnızca makroekonomik göstergeler' },
  { id: 'bist', label: 'BIST', shortLabel: 'BIST', description: 'Borsa İstanbul (BIST 100) bilançoları' },
  { id: 'usa', label: 'ABD', shortLabel: 'ABD', description: 'Amerikan Borsaları (NASDAQ 100) bilançoları' },
] as const;

export interface CalendarEventViewModel extends CalendarEventItem {
  isInPortfolio: boolean;
  portfolioQuantity: number | null;
  isInWatchlist: boolean;
}

/**
 * Enriches a raw CalendarEventItem with portfolio ownership and watchlist membership statuses.
 * STRICT RULE: Only matches by exact instrumentId. Missing or unmatched instrumentId
 * is NEVER considered in portfolio or watchlist regardless of symbol.
 * Economic events are NEVER considered in portfolio or watchlist.
 */
export function enrichCalendarEvent(
  event: CalendarEventItem,
  ownedPositions: ReadonlyMap<string, OwnedPosition>,
  watchedInstrumentIds?: ReadonlySet<string>
): CalendarEventViewModel {
  if (event.type !== 'earnings' || !event.instrumentId) {
    return {
      ...event,
      isInPortfolio: false,
      portfolioQuantity: null,
      isInWatchlist: false,
    };
  }

  const matchedPosition = ownedPositions.get(event.instrumentId);
  const isInPortfolio = Boolean(matchedPosition && matchedPosition.quantity > 0);
  const portfolioQuantity = isInPortfolio ? (matchedPosition?.quantity ?? null) : null;
  const isInWatchlist = Boolean(watchedInstrumentIds && watchedInstrumentIds.has(event.instrumentId));

  return {
    ...event,
    isInPortfolio,
    portfolioQuantity,
    isInWatchlist,
  };
}

/**
 * Evaluates whether an individual event matches the active calendar filter.
 * 
 * Rules:
 * - 'all': All events.
 * - 'portfolio': ONLY earnings events for owned positions (quantity > 0). Economic events are NEVER included.
 * - 'watchlist': ONLY earnings events for watched instruments in user watchlist. Economic events are NEVER included.
 * - 'earnings': All earnings events.
 * - 'economic': Only economic events.
 * - 'bist': Only earnings events where market === 'BIST100'. Economic events are NEVER included.
 * - 'usa': Only earnings events where market === 'NASDAQ100'. Economic events are NEVER included.
 */
export function matchesCalendarFilter(
  event: CalendarEventViewModel,
  filter: CalendarFilter
): boolean {
  switch (filter) {
    case 'all':
      return true;

    case 'portfolio':
      // Economic events are NEVER in portfolio
      return event.type === 'earnings' && event.isInPortfolio === true;

    case 'watchlist':
      // Economic events are NEVER in watchlist
      return event.type === 'earnings' && event.isInWatchlist === true;

    case 'earnings':
      return event.type === 'earnings';

    case 'economic':
      return event.type === 'economic';

    case 'bist':
      return event.type === 'earnings' && event.market === 'BIST100';

    case 'usa':
      return event.type === 'earnings' && event.market === 'NASDAQ100';

    default:
      return true;
  }
}

/**
 * Pure function to filter an array of CalendarEventItem objects according to filter mode.
 * Returns enriched CalendarEventViewModel items.
 */
export function filterCalendarEvents(
  events: CalendarEventItem[],
  filter: CalendarFilter,
  ownedPositions: ReadonlyMap<string, OwnedPosition>,
  watchedInstrumentIds?: ReadonlySet<string>
): CalendarEventViewModel[] {
  if (!events || events.length === 0) {
    return [];
  }

  const result: CalendarEventViewModel[] = [];

  for (const raw of events) {
    const enriched = enrichCalendarEvent(raw, ownedPositions, watchedInstrumentIds);
    if (matchesCalendarFilter(enriched, filter)) {
      result.push(enriched);
    }
  }

  return result;
}

export interface FilteredCalendarDataResult {
  eventsByDate: Record<string, CalendarEventViewModel[]>;
  dayIndicators: Record<string, DayIndicator>;
  totalVisibleCount: number;
}

/**
 * Pure function to build filtered monthly calendar data and accurately recalculated day indicators.
 * Ensures day dots and event counters reflect ONLY the events visible under the active filter.
 */
export function buildFilteredCalendarData(
  eventsByDate: Record<string, CalendarEventItem[]>,
  filter: CalendarFilter,
  ownedPositions: ReadonlyMap<string, OwnedPosition>,
  watchedInstrumentIds?: ReadonlySet<string>
): FilteredCalendarDataResult {
  const filteredEventsByDate: Record<string, CalendarEventViewModel[]> = {};
  const filteredDayIndicators: Record<string, DayIndicator> = {};
  let totalVisibleCount = 0;

  const dateKeys = Object.keys(eventsByDate);

  for (const dateKey of dateKeys) {
    const rawList = eventsByDate[dateKey] || [];
    const filteredList = filterCalendarEvents(rawList, filter, ownedPositions, watchedInstrumentIds);

    filteredEventsByDate[dateKey] = filteredList;

    const count = filteredList.length;
    totalVisibleCount += count;

    const hasEarnings = filteredList.some((e) => e.type === 'earnings');
    const hasEconomic = filteredList.some((e) => e.type === 'economic');

    filteredDayIndicators[dateKey] = {
      count,
      hasEarnings,
      hasEconomic,
    };
  }

  return {
    eventsByDate: filteredEventsByDate,
    dayIndicators: filteredDayIndicators,
    totalVisibleCount,
  };
}

/**
 * Pure helper to reconcile selected export dates with the active filter.
 * Retains only dates that have at least 1 visible event under the current day indicators.
 */
export function reconcileExportSelection(
  selectedDates: ReadonlySet<string>,
  dayIndicators: Record<string, DayIndicator>
): Set<string> {
  const reconciled = new Set<string>();
  for (const dateKey of selectedDates) {
    const indicator = dayIndicators[dateKey];
    if (indicator && indicator.count > 0) {
      reconciled.add(dateKey);
    }
  }
  return reconciled;
}

/**
 * Formats a portfolio owned quantity in Turkish locale (tr-TR) supporting up to 8 fraction digits.
 * Guaranteed never to format a positive micro quantity as "0 Adet".
 */
export function formatPortfolioQuantity(quantity: number | null | undefined): string {
  if (quantity === null || quantity === undefined || typeof quantity !== 'number' || !Number.isFinite(quantity)) {
    return '—';
  }
  if (quantity <= 0) {
    return '0 Adet';
  }

  const formatted = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  }).format(quantity);

  return `${formatted} Adet`;
}

/**
 * Pure validator for event source URLs.
 * Strictly accepts only valid HTTPS URLs with a valid hostname.
 * Strictly rejects HTTP, javascript:, data:, file:, empty hosts, and URLs with embedded credentials.
 */
export function isValidSecureEventUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;

  try {
    const parsed = new URL(trimmed);
    // 1. Strict HTTPS protocol ONLY
    if (parsed.protocol !== 'https:') {
      return false;
    }
    // 2. Hostname must be non-empty and have at least one dot (e.g. kap.org.tr, sec.gov)
    if (!parsed.hostname || parsed.hostname.length < 3 || !parsed.hostname.includes('.')) {
      return false;
    }
    // 3. Reject credentials in URL
    if (parsed.username || parsed.password) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export type CalendarViewState =
  | 'initial_loading'
  | 'initial_error'
  | 'stale_data'
  | 'empty_portfolio'
  | 'empty_watchlist'
  | 'empty_day_events'
  | 'ready';

export type StaleNoticeSource =
  | 'none'
  | 'ownership'
  | 'calendar'
  | 'watchlist'
  | 'calendar_and_ownership'
  | 'calendar_and_watchlist'
  | 'both'; // legacy alias for calendar_and_ownership

export interface ResolveStaleNoticeParams {
  isCalendarStale: boolean;
  isOwnershipStale: boolean;
  isWatchlistStale: boolean;
}

/**
 * Pure helper resolving structured stale source and user-friendly localized text without rigid combinatorial sprawl.
 */
export function resolveStaleNotice(params: ResolveStaleNoticeParams): {
  staleSource: StaleNoticeSource;
  staleNoticeText: string | null;
} {
  const { isCalendarStale, isOwnershipStale, isWatchlistStale } = params;

  if (isCalendarStale && isOwnershipStale) {
    return {
      staleSource: 'calendar_and_ownership',
      staleNoticeText: 'Takvim ve portföy verileri güncel olmayabilir.',
    };
  }
  if (isCalendarStale && isWatchlistStale) {
    return {
      staleSource: 'calendar_and_watchlist',
      staleNoticeText: 'Takvim ve izleme listesi verileri güncel olmayabilir.',
    };
  }
  if (isOwnershipStale) {
    return {
      staleSource: 'ownership',
      staleNoticeText: 'Açık pozisyon verisi güncel olmayabilir.',
    };
  }
  if (isWatchlistStale) {
    return {
      staleSource: 'watchlist',
      staleNoticeText: 'İzleme listesi verisi güncel olmayabilir.',
    };
  }
  if (isCalendarStale) {
    return {
      staleSource: 'calendar',
      staleNoticeText: 'Takvim verisi güncel olmayabilir.',
    };
  }

  return {
    staleSource: 'none',
    staleNoticeText: null,
  };
}

export interface ResolveCalendarViewStateParams {
  activeFilter: CalendarFilter;
  isCalendarLoading: boolean;
  calendarError: string | Error | null;
  hasCalendarLoadedSuccessfully: boolean;
  isOwnershipLoading: boolean;
  ownershipError: string | Error | null;
  hasOwnershipLoaded: boolean;
  isOwnershipStale: boolean;
  openPositionsCount: number;
  isWatchlistLoading?: boolean;
  watchlistError?: string | Error | null;
  hasWatchlistLoaded?: boolean;
  isWatchlistStale?: boolean;
  watchedCount?: number;
  dayEventsCount: number;
}

export interface CalendarViewStateResolution {
  state: CalendarViewState;
  showCalendarSpinner: boolean;
  showDayEventsSpinner: boolean;
  calendarErrorMessage: string | null;
  ownershipErrorMessage: string | null;
  watchlistErrorMessage: string | null;
  staleSource: StaleNoticeSource;
  staleNoticeText: string | null;
  showDayEventsContent: boolean;
  emptyStateKind: 'none' | 'empty_portfolio' | 'empty_watchlist' | 'empty_day_events' | 'empty_watchlist_events' | 'empty_filter';
}

/**
 * Pure state resolver evaluating loading, error, stale, and empty states in strict priority order:
 * 1. Initial Loading
 * 2. Initial Error (prevents displaying false "empty portfolio", "empty watchlist", or "no events" during errors)
 * 3. Stale Data (retains data with specific ownership/watchlist/calendar warning if background refresh failed)
 * 4. Successfully Loaded True Empty Portfolio or True Empty Watchlist
 * 5. Data exists (or non-membership filter) but no events on selected day
 * 6. Normal Ready State
 */
export function resolveCalendarViewState(
  params: ResolveCalendarViewStateParams
): CalendarViewStateResolution {
  const {
    activeFilter,
    isCalendarLoading,
    calendarError,
    hasCalendarLoadedSuccessfully,
    isOwnershipLoading,
    ownershipError,
    hasOwnershipLoaded,
    isOwnershipStale,
    openPositionsCount,
    isWatchlistLoading = false,
    watchlistError = null,
    hasWatchlistLoaded = false,
    isWatchlistStale = false,
    watchedCount = 0,
    dayEventsCount,
  } = params;

  // 1. Initial Loading State
  const isInitialCalendarLoading = isCalendarLoading && !hasCalendarLoadedSuccessfully;
  const isInitialOwnershipLoading = activeFilter === 'portfolio' && isOwnershipLoading && !hasOwnershipLoaded;
  const isInitialWatchlistLoading = activeFilter === 'watchlist' && isWatchlistLoading && !hasWatchlistLoaded;

  if (isInitialCalendarLoading || isInitialOwnershipLoading || isInitialWatchlistLoading) {
    return {
      state: 'initial_loading',
      showCalendarSpinner: true,
      showDayEventsSpinner: true,
      calendarErrorMessage: null,
      ownershipErrorMessage: null,
      watchlistErrorMessage: null,
      staleSource: 'none',
      staleNoticeText: null,
      showDayEventsContent: false,
      emptyStateKind: 'none',
    };
  }

  // 2. Initial Error State
  const isInitialCalendarError = Boolean(calendarError && !hasCalendarLoadedSuccessfully);
  const isInitialOwnershipError = Boolean(activeFilter === 'portfolio' && ownershipError && !hasOwnershipLoaded);
  const isInitialWatchlistError = Boolean(activeFilter === 'watchlist' && watchlistError && !hasWatchlistLoaded);

  if (isInitialCalendarError || isInitialOwnershipError || isInitialWatchlistError) {
    return {
      state: 'initial_error',
      showCalendarSpinner: false,
      showDayEventsSpinner: false,
      calendarErrorMessage: isInitialCalendarError ? 'Takvim verileri yüklenirken bir hata oluştu.' : null,
      ownershipErrorMessage: isInitialOwnershipError ? 'Portföy açık pozisyonları yüklenemedi.' : null,
      watchlistErrorMessage: isInitialWatchlistError ? 'İzleme listesi verileri yüklenemedi.' : null,
      staleSource: 'none',
      staleNoticeText: null,
      showDayEventsContent: false,
      emptyStateKind: 'none',
    };
  }

  // 3. Stale Data Determination (Separate Ownership vs Watchlist vs Calendar)
  const isOwnershipStaleEffective = Boolean(activeFilter === 'portfolio' && isOwnershipStale && hasOwnershipLoaded);
  const isWatchlistStaleEffective = Boolean(activeFilter === 'watchlist' && isWatchlistStale && hasWatchlistLoaded);
  const isCalendarStaleEffective = Boolean(calendarError && hasCalendarLoadedSuccessfully);

  const { staleSource, staleNoticeText } = resolveStaleNotice({
    isCalendarStale: isCalendarStaleEffective,
    isOwnershipStale: isOwnershipStaleEffective,
    isWatchlistStale: isWatchlistStaleEffective,
  });

  const isStale = staleSource !== 'none';

  // 4. Successfully loaded truly empty portfolio
  if (activeFilter === 'portfolio' && hasOwnershipLoaded && openPositionsCount === 0) {
    return {
      state: isStale ? 'stale_data' : 'empty_portfolio',
      showCalendarSpinner: false,
      showDayEventsSpinner: false,
      calendarErrorMessage: null,
      ownershipErrorMessage: null,
      watchlistErrorMessage: null,
      staleSource,
      staleNoticeText,
      showDayEventsContent: true,
      emptyStateKind: 'empty_portfolio',
    };
  }

  // 4b. Successfully loaded truly empty watchlist
  if (activeFilter === 'watchlist' && hasWatchlistLoaded && watchedCount === 0) {
    return {
      state: isStale ? 'stale_data' : 'empty_watchlist',
      showCalendarSpinner: false,
      showDayEventsSpinner: false,
      calendarErrorMessage: null,
      ownershipErrorMessage: null,
      watchlistErrorMessage: null,
      staleSource,
      staleNoticeText,
      showDayEventsContent: true,
      emptyStateKind: 'empty_watchlist',
    };
  }

  // 5. Open positions / watchlist items exist (or non-membership filter), but no events on the selected date
  if (dayEventsCount === 0) {
    let emptyKind: 'empty_portfolio' | 'empty_watchlist' | 'empty_day_events' | 'empty_watchlist_events' | 'empty_filter';
    if (activeFilter === 'portfolio') {
      emptyKind = 'empty_day_events';
    } else if (activeFilter === 'watchlist') {
      emptyKind = 'empty_watchlist_events';
    } else {
      emptyKind = 'empty_filter';
    }

    return {
      state: isStale ? 'stale_data' : 'empty_day_events',
      showCalendarSpinner: false,
      showDayEventsSpinner: false,
      calendarErrorMessage: null,
      ownershipErrorMessage: null,
      watchlistErrorMessage: null,
      staleSource,
      staleNoticeText,
      showDayEventsContent: true,
      emptyStateKind: emptyKind,
    };
  }

  // 6. Normal Ready State
  return {
    state: isStale ? 'stale_data' : 'ready',
    showCalendarSpinner: false,
    showDayEventsSpinner: false,
    calendarErrorMessage: null,
    ownershipErrorMessage: null,
    watchlistErrorMessage: null,
    staleSource,
    staleNoticeText,
    showDayEventsContent: true,
    emptyStateKind: 'none',
  };
}

export interface DayEventsPresentationResult {
  shouldRender: boolean;
  showSpinner: boolean;
  emptyStateKind: 'none' | 'empty_portfolio' | 'empty_watchlist' | 'empty_day_events' | 'empty_watchlist_events' | 'empty_filter';
  eventsCount: number;
}

/**
 * Pure presenter helper for DayEventsList rendering logic.
 */
export function resolveDayEventsPresentation(params: {
  showDayEventsContent: boolean;
  showDayEventsSpinner: boolean;
  emptyStateKind: 'none' | 'empty_portfolio' | 'empty_watchlist' | 'empty_day_events' | 'empty_watchlist_events' | 'empty_filter';
  eventsCount: number;
}): DayEventsPresentationResult {
  const { showDayEventsContent, showDayEventsSpinner, emptyStateKind, eventsCount } = params;

  if (!showDayEventsContent && !showDayEventsSpinner) {
    return {
      shouldRender: false,
      showSpinner: false,
      emptyStateKind: 'none',
      eventsCount: 0,
    };
  }

  return {
    shouldRender: true,
    showSpinner: showDayEventsSpinner,
    emptyStateKind,
    eventsCount,
  };
}

export interface UserScopedOwnershipRawState {
  stateUserId: string | null;
  ownedPositions: Map<string, OwnedPosition>;
  isLoading: boolean;
  isStale: boolean;
  error: Error | null;
  hasLoadedSuccessfully: boolean;
}

export interface ResolveUserScopedOwnershipParams {
  rawState: UserScopedOwnershipRawState;
  currentUserId: string | null;
  isAuthReady: boolean;
  authError: string | null;
  snapshot: { ownedPositions: Map<string, OwnedPosition>; isStale: boolean } | null;
}

/**
 * Pure selector that computes the effective ownership state on every render frame.
 * Guarantees that if the context userId switches from User A to User B, User A's data
 * is NEVER exposed on the transition render frame, even before useEffect runs.
 */
export function resolveUserScopedOwnershipState(
  params: ResolveUserScopedOwnershipParams
): {
  ownedPositions: Map<string, OwnedPosition>;
  isLoading: boolean;
  isStale: boolean;
  error: Error | null;
  hasLoadedSuccessfully: boolean;
} {
  const { rawState, currentUserId, isAuthReady, authError, snapshot } = params;

  // 1. Auth not ready yet -> Loading state
  if (!isAuthReady) {
    return {
      ownedPositions: new Map(),
      isLoading: true,
      isStale: false,
      error: null,
      hasLoadedSuccessfully: false,
    };
  }

  // 2. Auth ready but no user -> Controlled error state (stops spinner immediately)
  if (!currentUserId) {
    return {
      ownedPositions: new Map(),
      isLoading: false,
      isStale: false,
      error: authError ? new Error(authError) : new Error('Kullanıcı oturumu doğrulanamadı.'),
      hasLoadedSuccessfully: false,
    };
  }

  // 3. User changed and rawState belongs to a previous/different user -> Use current user's snapshot or clean state
  if (rawState.stateUserId !== currentUserId) {
    if (snapshot) {
      return {
        ownedPositions: snapshot.ownedPositions,
        isLoading: false,
        isStale: snapshot.isStale,
        error: null,
        hasLoadedSuccessfully: true,
      };
    }
    return {
      ownedPositions: new Map(),
      isLoading: true,
      isStale: false,
      error: null,
      hasLoadedSuccessfully: false,
    };
  }

  // 4. Raw state belongs to current user
  return {
    ownedPositions: rawState.ownedPositions,
    isLoading: rawState.isLoading,
    isStale: rawState.isStale,
    error: rawState.error,
    hasLoadedSuccessfully: rawState.hasLoadedSuccessfully,
  };
}

/**
 * Pure helper validating whether an async ownership fetch result can be accepted into hook state.
 */
export function shouldAcceptOwnershipResult(params: {
  isMounted: boolean;
  currentUserId: string | null;
  activeUserId: string;
  dataUserId: string;
}): boolean {
  const { isMounted, currentUserId, activeUserId, dataUserId } = params;
  return isMounted && currentUserId === activeUserId && dataUserId === activeUserId;
}

export interface UserScopedMembershipRawState {
  stateUserId: string | null;
  watchedInstrumentIds: Set<string>;
  isLoading: boolean;
  isStale: boolean;
  error: Error | null;
  hasLoadedSuccessfully: boolean;
}

export interface ResolveUserScopedMembershipParams {
  rawState: UserScopedMembershipRawState;
  currentUserId: string | null;
  isAuthReady: boolean;
  authError: string | null;
  snapshot: { instrumentIds: Set<string>; isStale: boolean } | null;
}

/**
 * Pure selector that computes the effective watchlist membership state on every render frame.
 * Guarantees zero-frame leakage across user transitions (User A -> User B).
 */
export function resolveUserScopedMembershipState(
  params: ResolveUserScopedMembershipParams
): {
  watchedInstrumentIds: Set<string>;
  watchedCount: number;
  isLoading: boolean;
  isStale: boolean;
  error: Error | null;
  hasLoadedSuccessfully: boolean;
} {
  const { rawState, currentUserId, isAuthReady, authError, snapshot } = params;

  // 1. Auth not ready yet -> Loading state
  if (!isAuthReady) {
    return {
      watchedInstrumentIds: new Set(),
      watchedCount: 0,
      isLoading: true,
      isStale: false,
      error: null,
      hasLoadedSuccessfully: false,
    };
  }

  // 2. Auth ready but no user -> Controlled error state (stops spinner immediately)
  if (!currentUserId) {
    return {
      watchedInstrumentIds: new Set(),
      watchedCount: 0,
      isLoading: false,
      isStale: false,
      error: authError ? new Error(authError) : new Error('Kullanıcı oturumu doğrulanamadı.'),
      hasLoadedSuccessfully: false,
    };
  }

  // 3. User changed and rawState belongs to a previous/different user -> Use current user's snapshot or clean state
  if (rawState.stateUserId !== currentUserId) {
    if (snapshot) {
      return {
        watchedInstrumentIds: snapshot.instrumentIds,
        watchedCount: snapshot.instrumentIds.size,
        isLoading: false,
        isStale: snapshot.isStale,
        error: null,
        hasLoadedSuccessfully: true,
      };
    }
    return {
      watchedInstrumentIds: new Set(),
      watchedCount: 0,
      isLoading: true,
      isStale: false,
      error: null,
      hasLoadedSuccessfully: false,
    };
  }

  // 4. Raw state belongs to current user
  return {
    watchedInstrumentIds: rawState.watchedInstrumentIds,
    watchedCount: rawState.watchedInstrumentIds.size,
    isLoading: rawState.isLoading,
    isStale: rawState.isStale,
    error: rawState.error,
    hasLoadedSuccessfully: rawState.hasLoadedSuccessfully,
  };
}

/**
 * Pure helper validating whether an async membership fetch result can be accepted into hook state.
 */
export function shouldAcceptMembershipResult(params: {
  isMounted: boolean;
  currentUserId: string | null;
  activeUserId: string;
  dataUserId: string;
}): boolean {
  const { isMounted, currentUserId, activeUserId, dataUserId } = params;
  return isMounted && currentUserId === activeUserId && dataUserId === activeUserId;
}

export interface MonthScopedCalendarRawState {
  monthKey: string; // Format: `${year}-${month}` (0-indexed month)
  data: MonthlyCalendarData | null;
  isLoading: boolean;
  error: string | null;
  hasLoadedSuccessfully: boolean;
}

export interface ResolveMonthScopedCalendarParams {
  rawState: MonthScopedCalendarRawState;
  currentYear: number;
  currentMonth: number;
}

/**
 * Pure selector that computes the effective monthly calendar state on every render frame.
 * Guarantees zero-frame leakage across month transitions (Month A -> Month B), ensuring
 * that Month A's data, indicators, and hasLoadedSuccessfully status are never exposed for Month B.
 */
export function resolveMonthScopedCalendarState(
  params: ResolveMonthScopedCalendarParams
): {
  data: MonthlyCalendarData | null;
  dayIndicators: Record<string, DayIndicator>;
  eventsByDate: Record<string, CalendarEventItem[]>;
  isLoading: boolean;
  error: string | null;
  hasLoadedSuccessfully: boolean;
} {
  const { rawState, currentYear, currentMonth } = params;
  const expectedKey = `${currentYear}-${currentMonth}`;

  // If internal rawState belongs to another month/year, return clean loading state on that render frame
  if (rawState.monthKey !== expectedKey) {
    return {
      data: null,
      dayIndicators: {},
      eventsByDate: {},
      isLoading: true,
      error: null,
      hasLoadedSuccessfully: false,
    };
  }

  return {
    data: rawState.data,
    dayIndicators: rawState.data?.dayIndicators || {},
    eventsByDate: rawState.data?.eventsByDate || {},
    isLoading: rawState.isLoading,
    error: rawState.error,
    hasLoadedSuccessfully: rawState.hasLoadedSuccessfully,
  };
}

/**
 * Pure helper validating whether an async monthly calendar result can be accepted into hook state.
 */
export function shouldAcceptMonthlyCalendarResult(params: {
  isAborted: boolean;
  activeMonthKey: string;
  currentMonthKey: string;
  resultYear: number;
  resultMonth: number;
  targetYear: number;
  targetMonth: number;
}): boolean {
  const {
    isAborted,
    activeMonthKey,
    currentMonthKey,
    resultYear,
    resultMonth,
    targetYear,
    targetMonth,
  } = params;

  return (
    !isAborted &&
    activeMonthKey === currentMonthKey &&
    resultYear === targetYear &&
    resultMonth === targetMonth
  );
}
