/**
 * Lucrari — Portfolio Activity Service
 * 
 * Production service layer for querying historical portfolio activity with:
 * - Keyset 4-part cursor pagination (`occurred_at`, `created_at`, `source_kind`, `activity_id`).
 * - Fail-closed normalization for TRANSACTION vs CASH_FLOW records.
 * - In-flight query deduplication with composite cache keys (including limit).
 * - Reactive global portfolio mutation listener (`subscribePortfolioChanges`).
 * - Monotonic portfolio revision tracking and bounded race retry loop (`MAX_ACTIVITY_FETCH_ATTEMPTS = 3`).
 * - Stale cache persistence upon background transport errors.
 * - 1-to-1 backend PostgreSQL error code localization.
 */

import { getSupabaseClient } from '@/services/supabase/client';
import { ensureAnonymousSession } from '@/services/auth/auth-service';
import { subscribePortfolioChanges } from '@/services/portfolio/portfolio-service';
import {
  createPortfolioOperationError,
  isRetryablePortfolioTransportError,
} from '@/utils/portfolio-errors';
import { isValidUUID, isValidIsoTimestampWithTimezone } from '@/utils/validation';
import { createScopedLogger } from '@/utils/logger';
import type {
  PortfolioActivityItem,
  PortfolioActivityCursor,
  PortfolioActivityPageResult,
  PortfolioActivityFilter,
  ActivitySourceKind,
  ActivityType,
} from '@/types/portfolio-activity';
import type {
  MarketType,
  CurrencyCode,
  PortfolioActivityRpcItem,
} from '@/types/database';

const log = createScopedLogger('PortfolioActivityService');

export const PORTFOLIO_ACTIVITY_PAGE_SIZE = 20;
export const MAX_ACTIVITY_FETCH_ATTEMPTS = 3;
export const ACTIVITY_CACHE_TTL_MS = 60_000; // 1 minute fresh TTL

const VALID_MARKETS = new Set<MarketType>(['BIST100', 'NASDAQ100', 'CRYPTO', 'TEFAS', 'FX']);
const VALID_CURRENCIES = new Set<CurrencyCode>(['TRY', 'USD']);

// In-memory cache structures
const activityCacheByKey = new Map<string, PortfolioActivityPageResult>();
const inFlightActivityRequests = new Map<string, Promise<PortfolioActivityPageResult>>();

let globalPortfolioActivityRevision = 0;
const activityRevisionByPortfolioId = new Map<string, number>();

/**
 * Returns current monotonic revision for a portfolio.
 */
export function getPortfolioActivityRevision(portfolioId: string): number {
  return (activityRevisionByPortfolioId.get(portfolioId) || 0) + globalPortfolioActivityRevision;
}

/**
 * Increments monotonic revision for a portfolio.
 */
export function bumpPortfolioActivityRevision(portfolioId: string): number {
  const current = activityRevisionByPortfolioId.get(portfolioId) || 0;
  const next = current + 1;
  activityRevisionByPortfolioId.set(portfolioId, next);
  return next + globalPortfolioActivityRevision;
}

/**
 * Clears all portfolio activity cache and in-flight promises.
 */
export function clearPortfolioActivityCache(): void {
  activityCacheByKey.clear();
  inFlightActivityRequests.clear();
  activityRevisionByPortfolioId.clear();
  globalPortfolioActivityRevision = 0;
  log.debug('Tüm portföy hareketleri önbelleği temizlendi');
}

/**
 * Invalidates all caches for a specific portfolio.
 */
export function invalidatePortfolioActivityCache(portfolioId: string): void {
  bumpPortfolioActivityRevision(portfolioId);
  for (const key of activityCacheByKey.keys()) {
    if (key.includes(`:${portfolioId}:`)) {
      activityCacheByKey.delete(key);
    }
  }
  log.debug('Portföy hareketleri önbelleği geçersiz kılındı', { portfolioId });
}

// Auto-subscribe to global portfolio mutations to invalidate activity caches
subscribePortfolioChanges(() => {
  log.info('Portföy mutasyon bildirimi alındı, hareketler önbelleği geçersiz kılındı');
  globalPortfolioActivityRevision++;
  activityCacheByKey.clear();
});

/**
 * Builds deterministic in-flight and cache key incorporating limit.
 */
export function buildActivityCacheKey(
  userId: string,
  portfolioId: string,
  limit: number,
  filter: PortfolioActivityFilter,
  search: string | null,
  cursor: PortfolioActivityCursor | null
): string {
  const normSearch = (search || '').trim().toLowerCase();
  const cursorKey = cursor
    ? `${cursor.beforeOccurredAt}_${cursor.beforeCreatedAt}_${cursor.beforeSourceKind}_${cursor.beforeActivityId}`
    : 'page1';
  return `${userId}:${portfolioId}:${limit}:${filter}:${normSearch}:${cursorKey}`;
}

/**
 * Extracts normalized error text from any Error object or Supabase RPC error response.
 */
function extractErrorString(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;

  const parts: string[] = [];

  if (typeof error === 'object') {
    const errObj = error as Record<string, unknown>;
    if (typeof errObj.code === 'string') parts.push(errObj.code);
    if (typeof errObj.message === 'string') parts.push(errObj.message);
    if (typeof errObj.details === 'string') parts.push(errObj.details);
    if (typeof errObj.hint === 'string') parts.push(errObj.hint);

    if (errObj.cause) {
      parts.push(extractErrorString(errObj.cause));
    }
    if (errObj.originalError) {
      parts.push(extractErrorString(errObj.originalError));
    }
  }

  return parts.join(' ').trim();
}

/**
 * Formats backend RPC error into safe, localized Turkish messages without leaking technical SQL details.
 * 1-to-1 matches production migration exception codes.
 */
export function formatPortfolioActivityRpcError(error: unknown): string {
  const combined = extractErrorString(error).toLowerCase();

  // 1-to-1 Production Migration Error Codes
  if (combined.includes('portfolio_activity_authentication_required')) {
    return 'Portföy hareketlerini görüntülemek için oturum açılması gerekmektedir.';
  }
  if (combined.includes('portfolio_activity_portfolio_required')) {
    return 'Geçerli bir portföy seçilmelidir.';
  }
  if (combined.includes('portfolio_activity_not_found_or_access_denied')) {
    return 'Portföy bulunamadı veya bu portföye erişim yetkiniz yok.';
  }
  if (combined.includes('portfolio_activity_limit_out_of_range')) {
    return 'Geçersiz sayfa boyutu belirtildi (1-100 arasında olmalıdır).';
  }
  if (combined.includes('portfolio_activity_invalid_filter')) {
    return 'Geçersiz hareket filtresi seçildi.';
  }
  if (combined.includes('portfolio_activity_search_too_long')) {
    return 'Arama metni çok uzun (en fazla 100 karakter olabilir).';
  }
  if (combined.includes('portfolio_activity_incomplete_cursor')) {
    return 'Sayfalama imleci eksik veya geçersiz.';
  }
  if (combined.includes('portfolio_activity_invalid_cursor_source')) {
    return 'Geçersiz sayfalama kaynak türü.';
  }

  // Permission / RLS errors
  if (combined.includes('42501') || combined.includes('permission denied')) {
    return 'Portföy bulunamadı veya bu portföye erişim yetkiniz yok.';
  }

  // Auth / session expiration
  if (combined.includes('jwt') || combined.includes('token expired') || combined.includes('not authenticated')) {
    return 'Portföy hareketlerini görüntülemek için oturum açılması gerekmektedir.';
  }

  // Transport / Network errors
  if (isRetryablePortfolioTransportError(error) || combined.includes('network') || combined.includes('fetch failed')) {
    return 'İnternet bağlantınızı kontrol edip tekrar deneyiniz.';
  }

  return 'Portföy hareketleri yüklenirken bir hata oluştu. Lütfen tekrar deneyiniz.';
}

/**
 * Normalizes and strictly validates a single raw RPC row.
 * Throws PortfolioOperationError fail-closed if any integrity constraint is violated.
 */
export function normalizePortfolioActivityRow(row: unknown): PortfolioActivityItem {
  if (!row || typeof row !== 'object') {
    throw createPortfolioOperationError('Geçersiz hareket kaydı formatı.');
  }

  const raw = row as Record<string, unknown>;

  // 1. UUID validations
  const activityId = typeof raw.activity_id === 'string' ? raw.activity_id.trim() : '';
  const portfolioId = typeof raw.portfolio_id === 'string' ? raw.portfolio_id.trim() : '';

  if (!isValidUUID(activityId)) {
    throw createPortfolioOperationError('Geçersiz hareket kimliği (activity_id).');
  }
  if (!isValidUUID(portfolioId)) {
    throw createPortfolioOperationError('Geçersiz portföy kimliği (portfolio_id).');
  }

  // 2. Enum validations
  const sourceKind = raw.source_kind as ActivitySourceKind;
  if (sourceKind !== 'TRANSACTION' && sourceKind !== 'CASH_FLOW') {
    throw createPortfolioOperationError('Geçersiz hareket kaynak türü (source_kind).');
  }

  const activityType = raw.activity_type as ActivityType;
  if (!['BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL'].includes(activityType)) {
    throw createPortfolioOperationError('Geçersiz hareket işlem türü (activity_type).');
  }

  // Consistency check: Transaction must be BUY/SELL, CashFlow must be DEPOSIT/WITHDRAWAL
  if (sourceKind === 'TRANSACTION' && !['BUY', 'SELL'].includes(activityType)) {
    throw createPortfolioOperationError('İşlem türü ve kaynak türü uyuşmazlığı tespit edildi.');
  }
  if (sourceKind === 'CASH_FLOW' && !['DEPOSIT', 'WITHDRAWAL'].includes(activityType)) {
    throw createPortfolioOperationError('Nakit türü ve kaynak türü uyuşmazlığı tespit edildi.');
  }

  // 3. Timestamp validations (Must be valid ISO-8601 with timezone offset)
  if (!isValidIsoTimestampWithTimezone(raw.occurred_at)) {
    throw createPortfolioOperationError('Geçersiz işlem tarihi (occurred_at).');
  }
  if (!isValidIsoTimestampWithTimezone(raw.created_at)) {
    throw createPortfolioOperationError('Geçersiz oluşturulma tarihi (created_at).');
  }
  const occurredAt = (raw.occurred_at as string).trim();
  const createdAt = (raw.created_at as string).trim();

  // 4. Financial amounts validation (strictly finite numbers > 0, NO Number(...) silent casting)
  if (typeof raw.gross_amount !== 'number' || !Number.isFinite(raw.gross_amount) || raw.gross_amount <= 0) {
    throw createPortfolioOperationError('Geçersiz brüt işlem tutarı (gross_amount).');
  }
  const grossAmount = raw.gross_amount;

  if (typeof raw.currency !== 'string' || !VALID_CURRENCIES.has(raw.currency as CurrencyCode)) {
    throw createPortfolioOperationError('Geçersiz para birimi (currency).');
  }
  const currency = raw.currency as CurrencyCode;

  // 5. Reversal fields (strictly boolean, no Boolean(...) coercion)
  if (typeof raw.is_reversed !== 'boolean') {
    throw createPortfolioOperationError('Geçersiz geri alınma durumu (is_reversed).');
  }
  const isReversed = raw.is_reversed;
  let reversedAt: string | null = null;
  let reversalReason: string | null = null;

  if (isReversed) {
    if (!isValidIsoTimestampWithTimezone(raw.reversed_at)) {
      throw createPortfolioOperationError('Geri alınmış işlem için geçerli geri alınma tarihi zorunludur.');
    }
    reversedAt = (raw.reversed_at as string).trim();
    if (raw.reversal_reason !== null && raw.reversal_reason !== undefined) {
      if (typeof raw.reversal_reason !== 'string') {
        throw createPortfolioOperationError('Geçersiz geri alma nedeni.');
      }
      reversalReason = raw.reversal_reason.trim() || null;
    }
  } else {
    // If not reversed, reversed_at and reversal_reason MUST be null or undefined
    if (raw.reversed_at !== null && raw.reversed_at !== undefined) {
      throw createPortfolioOperationError('Geri alınmamış işlemde geri alınma tarihi bulunamaz.');
    }
    if (raw.reversal_reason !== null && raw.reversal_reason !== undefined) {
      throw createPortfolioOperationError('Geri alınmamış işlemde geri alma nedeni bulunamaz.');
    }
  }

  // 6. Source-specific field validation
  let instrumentId: string | null = null;
  let symbol: string | null = null;
  let companyName: string | null = null;
  let market: MarketType | null = null;
  let quantity: number | null = null;
  let unitPrice: number | null = null;

  if (sourceKind === 'TRANSACTION') {
    if (!isValidUUID(raw.instrument_id)) {
      throw createPortfolioOperationError('İşlem kaydında geçerli instrument_id zorunludur.');
    }
    instrumentId = (raw.instrument_id as string).trim();

    if (typeof raw.symbol !== 'string' || !raw.symbol.trim()) {
      throw createPortfolioOperationError('İşlem kaydında sembol zorunludur.');
    }
    symbol = raw.symbol.trim();

    if (typeof raw.company_name !== 'string' || !raw.company_name.trim()) {
      throw createPortfolioOperationError('İşlem kaydında şirket adı zorunludur.');
    }
    companyName = raw.company_name.trim();

    if (typeof raw.market !== 'string' || !VALID_MARKETS.has(raw.market as MarketType)) {
      throw createPortfolioOperationError('İşlem kaydında geçerli piyasa (market) zorunludur.');
    }
    market = raw.market as MarketType;

    if (typeof raw.quantity !== 'number' || !Number.isFinite(raw.quantity) || raw.quantity <= 0) {
      throw createPortfolioOperationError('İşlem kaydında pozitif adet (quantity) zorunludur.');
    }
    quantity = raw.quantity;

    if (typeof raw.unit_price !== 'number' || !Number.isFinite(raw.unit_price) || raw.unit_price <= 0) {
      throw createPortfolioOperationError('İşlem kaydında pozitif birim fiyat (unit_price) zorunludur.');
    }
    unitPrice = raw.unit_price;
  } else {
    // For CASH_FLOW, instrument fields MUST BE STRICTLY NULL or UNDEFINED (Fail-Closed contract)
    if (
      (raw.instrument_id !== null && raw.instrument_id !== undefined) ||
      (raw.symbol !== null && raw.symbol !== undefined) ||
      (raw.company_name !== null && raw.company_name !== undefined) ||
      (raw.market !== null && raw.market !== undefined) ||
      (raw.quantity !== null && raw.quantity !== undefined) ||
      (raw.unit_price !== null && raw.unit_price !== undefined)
    ) {
      throw createPortfolioOperationError('Nakit akışı satırında enstrüman alanları dolu olamaz.');
    }
  }

  let notes: string | null = null;
  if (raw.notes !== null && raw.notes !== undefined) {
    if (typeof raw.notes !== 'string') {
      throw createPortfolioOperationError('Geçersiz not alanı.');
    }
    notes = raw.notes.trim() || null;
  }

  const compositeKey = `${sourceKind}:${activityId}`;

  return {
    activityId,
    sourceKind,
    activityType,
    portfolioId,
    instrumentId,
    symbol,
    companyName,
    market,
    quantity,
    unitPrice,
    grossAmount,
    currency,
    occurredAt,
    createdAt,
    notes,
    isReversed,
    reversedAt,
    reversalReason,
    compositeKey,
  };
}

/**
 * Validates deterministic descending sort order:
 * occurred_at DESC, created_at DESC, source_kind DESC, activity_id DESC
 */
function isStrictlySortedDescending(a: PortfolioActivityItem, b: PortfolioActivityItem): boolean {
  const timeA = new Date(a.occurredAt).getTime();
  const timeB = new Date(b.occurredAt).getTime();
  if (timeA !== timeB) return timeA > timeB;

  const createA = new Date(a.createdAt).getTime();
  const createB = new Date(b.createdAt).getTime();
  if (createA !== createB) return createA > createB;

  if (a.sourceKind !== b.sourceKind) {
    return a.sourceKind.localeCompare(b.sourceKind) > 0;
  }

  return a.activityId.localeCompare(b.activityId) >= 0;
}

/**
 * Normalizes an entire page array returned by `get_my_portfolio_activity`.
 * Asserts row count limits, uniqueness, uniform `has_more`, matching portfolio_id,
 * and deterministic descending sort order.
 */
export function normalizePortfolioActivityPage(
  data: unknown[],
  portfolioId: string,
  limit: number = PORTFOLIO_ACTIVITY_PAGE_SIZE
): { items: PortfolioActivityItem[]; hasMore: boolean; nextCursor: PortfolioActivityCursor | null } {
  if (!Array.isArray(data)) {
    throw createPortfolioOperationError('Hareket listesi dizi formatında alınamadı.');
  }

  if (data.length > limit) {
    throw createPortfolioOperationError(`Dönen satır sayısı istenen limit (${limit}) değerini aştı.`);
  }

  if (data.length === 0) {
    return {
      items: [],
      hasMore: false,
      nextCursor: null,
    };
  }

  let pageHasMore: boolean | null = null;
  const items: PortfolioActivityItem[] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < data.length; i++) {
    const rawRow = data[i];
    if (!rawRow || typeof rawRow !== 'object') {
      throw createPortfolioOperationError('Geçersiz satır yapısı.');
    }
    const raw = rawRow as Partial<PortfolioActivityRpcItem>;

    if (typeof raw.has_more !== 'boolean') {
      throw createPortfolioOperationError('Eksik veya geçersiz has_more alanı.');
    }

    if (pageHasMore === null) {
      pageHasMore = raw.has_more;
    } else if (raw.has_more !== pageHasMore) {
      throw createPortfolioOperationError('Sayfadaki satırlar arasında tutarsız has_more değeri tespit edildi.');
    }

    const item = normalizePortfolioActivityRow(rawRow);
    if (item.portfolioId !== portfolioId) {
      throw createPortfolioOperationError('Portföy kimliği uyuşmazlığı tespit edildi.');
    }

    if (seenKeys.has(item.compositeKey)) {
      throw createPortfolioOperationError('Sayfa içinde mükerrer hareket kaydı tespit edildi.');
    }
    seenKeys.add(item.compositeKey);

    if (items.length > 0) {
      const prevItem = items[items.length - 1];
      if (!isStrictlySortedDescending(prevItem, item)) {
        throw createPortfolioOperationError('RPC yanıtında sıralama kurallarına uymayan satırlar tespit edildi.');
      }
    }

    items.push(item);
  }

  const hasMore = Boolean(pageHasMore);
  let nextCursor: PortfolioActivityCursor | null = null;

  if (hasMore && items.length > 0) {
    const lastItem = items[items.length - 1];
    nextCursor = {
      beforeOccurredAt: lastItem.occurredAt,
      beforeCreatedAt: lastItem.createdAt,
      beforeSourceKind: lastItem.sourceKind,
      beforeActivityId: lastItem.activityId,
    };
  }

  return {
    items,
    hasMore,
    nextCursor,
  };
}

export interface FetchPortfolioActivityParams {
  portfolioId: string;
  limit?: number;
  filter?: PortfolioActivityFilter;
  search?: string | null;
  cursor?: PortfolioActivityCursor | null;
  forceRefresh?: boolean;
}

/**
 * Fetches a page of portfolio activity records with:
 * - Strict authentication verification.
 * - In-flight deduplication incorporating limit.
 * - Strict retry decision: ONLY retries on revision mismatch during fetch (max 3 attempts).
 * - Deterministic domain/auth/normalization errors fail on 1st RPC.
 * - Transport error falls back to exact-query stale cache if available.
 * - Revision storm fail-closed fallback to stale cache or safe error.
 */
export async function fetchPortfolioActivityPage(
  params: FetchPortfolioActivityParams
): Promise<PortfolioActivityPageResult> {
  const {
    portfolioId,
    limit = PORTFOLIO_ACTIVITY_PAGE_SIZE,
    filter = 'ALL',
    search = null,
    cursor = null,
    forceRefresh = false,
  } = params;

  if (!portfolioId || !isValidUUID(portfolioId)) {
    throw createPortfolioOperationError('Geçerli bir portföy seçilmelidir.');
  }

  const authResult = await ensureAnonymousSession();
  if (authResult.error || !authResult.user?.id) {
    throw createPortfolioOperationError(
      'Portföy hareketlerini görüntülemek için oturum açılması gerekmektedir.'
    );
  }
  const userId = authResult.user.id;

  // Register portfolio revision tracking
  if (!activityRevisionByPortfolioId.has(portfolioId)) {
    activityRevisionByPortfolioId.set(portfolioId, 0);
  }

  const sanitizedSearch = search && search.trim().length > 0 ? search.trim() : null;
  const cacheKey = buildActivityCacheKey(userId, portfolioId, limit, filter, sanitizedSearch, cursor);

  // 1. In-memory cache hit (if not force-refresh)
  if (!forceRefresh) {
    const cached = activityCacheByKey.get(cacheKey);
    if (cached) {
      const isExpired = Date.now() - cached.timestamp > ACTIVITY_CACHE_TTL_MS;
      if (!isExpired || cached.isStale) {
        log.debug('Önbellekten hareketler döndürülüyor', { cacheKey, isStale: cached.isStale });
        return cached;
      }
    }
  }

  // 2. In-flight request deduplication
  const existingInFlight = inFlightActivityRequests.get(cacheKey);
  if (existingInFlight) {
    log.debug('Devam eden istek bekleniyor', { cacheKey });
    return existingInFlight;
  }

  // 3. Execution pipeline with revision mismatch retry
  const fetchPromise = (async (): Promise<PortfolioActivityPageResult> => {
    let attempt = 0;

    while (attempt < MAX_ACTIVITY_FETCH_ATTEMPTS) {
      attempt++;
      const startRevision = getPortfolioActivityRevision(portfolioId);

      let data: unknown;
      let rpcError: unknown;

      try {
        const client = getSupabaseClient();

        log.debug('RPC get_my_portfolio_activity çağrılıyor', {
          attempt,
          portfolioId,
          limit,
          filter,
          search: sanitizedSearch,
          cursor,
        });

        const response = await client.rpc('get_my_portfolio_activity', {
          p_portfolio_id: portfolioId,
          p_limit: limit,
          p_filter: filter,
          p_search: sanitizedSearch,
          p_before_occurred_at: cursor?.beforeOccurredAt ?? null,
          p_before_created_at: cursor?.beforeCreatedAt ?? null,
          p_before_source_kind: cursor?.beforeSourceKind ?? null,
          p_before_activity_id: cursor?.beforeActivityId ?? null,
        });

        data = response.data;
        rpcError = response.error;
      } catch (networkErr) {
        // Transport/fetch error at network layer -> do NOT loop 3 times
        log.warn('Ağ seviyesinde hata oluştu', { attempt, error: String(networkErr) });

        const cached = activityCacheByKey.get(cacheKey);
        if (cached) {
          log.info('Ağ hatası sonrası mevcut cache stale olarak kaydediliyor', { cacheKey });
          const updatedStale: PortfolioActivityPageResult = {
            ...cached,
            isStale: true,
          };
          activityCacheByKey.set(cacheKey, updatedStale);
          return updatedStale;
        }

        throw createPortfolioOperationError(
          formatPortfolioActivityRpcError(networkErr),
          networkErr,
          { userMessageIsFinal: true }
        );
      }

      // Check PostgreSQL / domain RPC error
      if (rpcError) {
        log.warn('RPC get_my_portfolio_activity hatası', { error: rpcError, attempt });

        // Transport error check for Supabase client error response
        if (isRetryablePortfolioTransportError(rpcError)) {
          const cached = activityCacheByKey.get(cacheKey);
          if (cached) {
            log.info('Taşıma hatası sonrası mevcut cache stale olarak kaydediliyor', { cacheKey });
            const updatedStale: PortfolioActivityPageResult = {
              ...cached,
              isStale: true,
            };
            activityCacheByKey.set(cacheKey, updatedStale);
            return updatedStale;
          }
        }

        // Deterministic domain/auth/parameter errors fail immediately on 1st RPC without stale fallback
        throw createPortfolioOperationError(
          formatPortfolioActivityRpcError(rpcError),
          rpcError,
          { userMessageIsFinal: true }
        );
      }

      // Check revision change during this fetch attempt
      const endRevision = getPortfolioActivityRevision(portfolioId);
      if (startRevision !== endRevision) {
        log.info('Hareket sorgusu sırasında mutasyon gerçekleşti (revision mismatch)', {
          portfolioId,
          attempt,
          startRevision,
          endRevision,
        });

        if (attempt < MAX_ACTIVITY_FETCH_ATTEMPTS) {
          continue; // Automatic retry from offset/cursor for next attempt
        }

        // Exhausted max revision attempts (Revision storm)
        const cached = activityCacheByKey.get(cacheKey);
        if (cached) {
          log.info('Revision fırtınası sonrası mevcut cache stale olarak kaydediliyor', { cacheKey });
          const updatedStale: PortfolioActivityPageResult = {
            ...cached,
            isStale: true,
          };
          activityCacheByKey.set(cacheKey, updatedStale);
          return updatedStale;
        }

        throw createPortfolioOperationError(
          'Portföy hareketleri sorgulanırken işlem çakışması oluştu. Lütfen tekrar deneyiniz.',
          null,
          { userMessageIsFinal: true }
        );
      }

      // Revision is clean & matched. Normalize page (Fail-closed on normalization errors)
      const { items, hasMore, nextCursor } = normalizePortfolioActivityPage(
        data as unknown[],
        portfolioId,
        limit
      );

      const result: PortfolioActivityPageResult = {
        items,
        hasMore,
        nextCursor,
        timestamp: Date.now(),
        isStale: false,
      };

      activityCacheByKey.set(cacheKey, result);
      return result;
    }

    // Exhausted loop fallback
    const fallbackCache = activityCacheByKey.get(cacheKey);
    if (fallbackCache) {
      const updatedStale: PortfolioActivityPageResult = {
        ...fallbackCache,
        isStale: true,
      };
      activityCacheByKey.set(cacheKey, updatedStale);
      return updatedStale;
    }

    throw createPortfolioOperationError(
      'Portföy hareketleri yüklenirken işlem çakışması oluştu. Lütfen tekrar deneyiniz.'
    );
  })();

  inFlightActivityRequests.set(cacheKey, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    if (inFlightActivityRequests.get(cacheKey) === fetchPromise) {
      inFlightActivityRequests.delete(cacheKey);
    }
  }
}
