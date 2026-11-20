/**
 * Lucrari — Watchlist Service
 * 
 * Manages paginated user watchlist retrieval, complete membership set queries (100 per page batching),
 * deterministic "Last Intent Wins" mutation queue, in-flight deduplication, user-scoped TTL caching,
 * and cross-component pub/sub sync.
 * 
 * STRICT COMPLIANCE:
 * - NO direct queries to `user_watchlist_items` or `earnings_events`.
 * - NO portfolio mutation RPCs.
 * - Strongly typed Supabase RPC calls through Database interface (NO `(client as any).rpc`).
 * - NO fake prices, fallback prices (like 100), or mock instruments.
 */

import { getSupabaseClient } from '@/services/supabase/client';
import { ensureAnonymousSession } from '@/services/auth/auth-service';
import { createScopedLogger } from '@/utils/logger';
import {
  normalizeWatchlistPage,
  normalizeSetWatchlistItemRpcResult,
  type WatchlistPageResult,
  type WatchlistMembershipResult,
  type SetWatchlistItemResult,
} from '@/types/watchlist';
import {
  WatchlistOperationError,
  createWatchlistOperationError,
  createWatchlistPageOutOfBoundsError,
  isWatchlistPageOutOfRangeError,
  formatWatchlistRpcError,
} from '@/utils/watchlist-errors';
import {
  enqueueWatchlistMutation,
  isMutationPendingForInstrument,
  clearMutationQueue,
} from '@/utils/watchlist-mutation-queue';

const log = createScopedLogger('WatchlistService');

export const WATCHLIST_CACHE_TTL_MS = 30 * 1000; // 30 seconds

// User-scoped page cache: Map<`${userId}_${limit}_${offset}`, WatchlistPageResult>
const pageCacheByUserId = new Map<string, WatchlistPageResult>();

// User-scoped membership set cache: Map<userId, WatchlistMembershipResult>
const membershipCacheByUserId = new Map<string, WatchlistMembershipResult>();

// User-scoped membership revision counter: Map<userId, number>
const membershipRevisionByUserId = new Map<string, number>();

export function getMembershipRevision(userId: string): number {
  return membershipRevisionByUserId.get(userId) ?? 0;
}

export function bumpMembershipRevision(userId: string): number {
  const next = (membershipRevisionByUserId.get(userId) ?? 0) + 1;
  membershipRevisionByUserId.set(userId, next);
  return next;
}

// In-flight request deduplication map for pages
interface InFlightPageRequest {
  promise: Promise<WatchlistPageResult>;
  token: symbol;
}
const inFlightPageRequests = new Map<string, InFlightPageRequest>();

// In-flight request deduplication for membership set
interface InFlightMembershipRequest {
  promise: Promise<WatchlistMembershipResult>;
  token: symbol;
}
const inFlightMembershipRequests = new Map<string, InFlightMembershipRequest>();

export const MAX_MEMBERSHIP_ATTEMPTS = 3;

// Pub/Sub synchronization
export interface WatchlistChangeEvent {
  userId: string;
  mutation?: {
    instrumentId: string;
    isWatched: boolean;
  };
  refreshedPage?: WatchlistPageResult;
}

type WatchlistListener = (event: WatchlistChangeEvent) => void;
const watchlistSubscribers = new Set<WatchlistListener>();

export function subscribeWatchlistChanges(listener: WatchlistListener): () => void {
  watchlistSubscribers.add(listener);
  return () => {
    watchlistSubscribers.delete(listener);
  };
}

function notifyWatchlistSubscribers(event: WatchlistChangeEvent): void {
  for (const listener of watchlistSubscribers) {
    try {
      listener(event);
    } catch (err) {
      log.error('Watchlist listener execution failed', { error: String(err) });
    }
  }
}

/**
 * Invalidates all page caches for a specific user.
 */
export function invalidateUserPageCaches(userId: string): void {
  for (const key of pageCacheByUserId.keys()) {
    if (key.startsWith(`${userId}_`)) {
      pageCacheByUserId.delete(key);
    }
  }
}

/**
 * Clears all in-memory caches, queues, revisions, and in-flight tracking.
 */
export function clearWatchlistCache(options?: { clearSubscribers?: boolean }): void {
  pageCacheByUserId.clear();
  membershipCacheByUserId.clear();
  membershipRevisionByUserId.clear();
  inFlightPageRequests.clear();
  inFlightMembershipRequests.clear();
  clearMutationQueue();
  if (options?.clearSubscribers) {
    watchlistSubscribers.clear();
  }
}

/**
 * Retrieves in-memory snapshot for a specific user and page if present.
 */
export function getWatchlistPageSnapshot(
  userId: string,
  limit: number,
  offset: number
): WatchlistPageResult | null {
  if (!userId) return null;
  const key = `${userId}_${limit}_${offset}`;
  return pageCacheByUserId.get(key) || null;
}

/**
 * Retrieves in-memory membership set snapshot for a specific user if present.
 */
export function getWatchlistMembershipSnapshot(userId: string): WatchlistMembershipResult | null {
  if (!userId) return null;
  const cached = membershipCacheByUserId.get(userId);
  if (!cached) return null;
  return {
    userId: cached.userId,
    instrumentIds: new Set(cached.instrumentIds),
    isStale: cached.isStale,
    timestamp: cached.timestamp,
  };
}

export interface FetchWatchlistPageOptions {
  limit?: number;
  offset?: number;
  forceRefresh?: boolean;
}

/**
 * Fetches a paginated slice of the authenticated user's watchlist via `get_my_watchlist` RPC.
 */
export async function fetchWatchlistPage(
  options?: FetchWatchlistPageOptions
): Promise<WatchlistPageResult> {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;
  const forceRefresh = Boolean(options?.forceRefresh);

  // 1. Ensure authenticated user
  const authResult = await ensureAnonymousSession();
  if (!authResult.user || !authResult.user.id) {
    log.error('Watchlist oturum doğrulanamadı');
    throw new WatchlistOperationError('İzleme listesini görüntülemek için oturum açılması gerekmektedir.');
  }

  const userId = authResult.user.id;
  const cacheKey = `${userId}_${limit}_${offset}`;
  const now = Date.now();

  // 2. Check fresh cache
  const cached = pageCacheByUserId.get(cacheKey);
  if (!forceRefresh && cached && !cached.isStale && now - cached.timestamp < WATCHLIST_CACHE_TTL_MS) {
    log.debug('Watchlist sayfa önbellek isabeti', { userId, limit, offset });
    return cached;
  }

  // 3. Deduplicate in-flight request
  const existingInFlight = inFlightPageRequests.get(cacheKey);
  if (existingInFlight) {
    log.debug('Eşzamanlı watchlist sayfa isteği birleştirildi', { userId, limit, offset });
    return existingInFlight.promise;
  }

  const currentToken = Symbol(`watchlist_page_${cacheKey}`);

  const fetchPromise = (async (): Promise<WatchlistPageResult> => {
    const client = getSupabaseClient();

    try {
      const { data, error } = await client.rpc('get_my_watchlist', {
        p_limit: limit,
        p_offset: offset,
      });

      if (error) {
        log.warn('get_my_watchlist RPC hatası', { error: error.message, userId, limit, offset });
        throw createWatchlistOperationError(formatWatchlistRpcError(error), error);
      }

      if (Array.isArray(data) && data.length === 0 && offset > 0) {
        throw createWatchlistPageOutOfBoundsError(offset);
      }

      const normalized = normalizeWatchlistPage(data, limit, offset, userId);
      if (!normalized) {
        log.error('get_my_watchlist RPC cevabı sözleşmeye uymuyor', { data, userId, limit, offset });
        throw createWatchlistOperationError('İzleme listesi yanıtı doğrulanamadı.');
      }

      pageCacheByUserId.set(cacheKey, normalized);
      notifyWatchlistSubscribers({ userId, refreshedPage: normalized });

      log.info('Watchlist sayfası başarıyla yüklendi', {
        userId,
        limit,
        offset,
        totalCount: normalized.totalCount,
        loadedCount: normalized.items.length,
      });

      return normalized;
    } catch (err) {
      // Out of range errors MUST bypass stale fallback and be propagated directly
      if (isWatchlistPageOutOfRangeError(err)) {
        pageCacheByUserId.delete(cacheKey);
        throw err;
      }

      log.error('Watchlist sayfası alınırken hata oluştu', { userId, limit, offset, error: String(err) });

      // Retain previous page as stale if available for the exact same user
      if (cached) {
        const staleFallback: WatchlistPageResult = {
          ...cached,
          isStale: true,
        };
        pageCacheByUserId.set(cacheKey, staleFallback);
        notifyWatchlistSubscribers({ userId, refreshedPage: staleFallback });
        return staleFallback;
      }

      if (err instanceof WatchlistOperationError) {
        throw err;
      }
      throw createWatchlistOperationError(formatWatchlistRpcError(err), err);
    } finally {
      const active = inFlightPageRequests.get(cacheKey);
      if (active && active.token === currentToken) {
        inFlightPageRequests.delete(cacheKey);
      }
    }
  })();

  inFlightPageRequests.set(cacheKey, {
    promise: fetchPromise,
    token: currentToken,
  });

  return fetchPromise;
}

/**
 * Helper that performs a complete paginated query (starting from offset = 0, batchSize = 100, max 50 pages)
 * to collect all instrument IDs for a given user.
 * Validates array structure, expectedTotalCount drift across pages, duplicate instrument IDs,
 * short page matching, and consumed row counts fail-closed.
 */
async function collectWatchedInstrumentIdsBatch(userId: string): Promise<Set<string>> {
  const client = getSupabaseClient();
  const resultSet = new Set<string>();
  const batchSize = 100;
  let offset = 0;
  const maxIterations = 50;
  let iteration = 0;
  let isCompleted = false;
  let expectedTotalCount: number | null = null;

  while (iteration < maxIterations) {
    iteration++;
    const { data, error } = await client.rpc('get_my_watchlist', {
      p_limit: batchSize,
      p_offset: offset,
    });

    if (error) {
      throw createWatchlistOperationError(formatWatchlistRpcError(error), error);
    }

    if (!data || !Array.isArray(data)) {
      throw createWatchlistOperationError('Üyelik verisi dizi biçiminde alınamadı.');
    }

    if (data.length === 0) {
      if (expectedTotalCount !== null && offset < expectedTotalCount) {
        throw createWatchlistOperationError('Beklenen toplam kayıt sayısına ulaşılmadan boş sayfa döndü.');
      }
      isCompleted = true;
      break;
    }

    for (const row of data) {
      if (!row || typeof row !== 'object') {
        throw createWatchlistOperationError('Geçersiz üyelik kaydı tespit edildi.');
      }

      const rawId = typeof row.instrument_id === 'string' ? row.instrument_id.trim() : '';
      if (!rawId) {
        throw createWatchlistOperationError('Boş veya geçersiz enstrüman kimliği tespit edildi.');
      }

      if (
        typeof row.total_count !== 'number' ||
        !Number.isInteger(row.total_count) ||
        row.total_count < 0
      ) {
        throw createWatchlistOperationError('Geçersiz toplam kayıt sayısı tespit edildi.');
      }

      // Global single expectedTotalCount check across all batches and all rows
      if (expectedTotalCount === null) {
        expectedTotalCount = row.total_count;
      } else if (row.total_count !== expectedTotalCount) {
        throw createWatchlistOperationError('Sayfalar arası toplam kayıt sayısı tutarsızlığı (drift) tespit edildi.');
      }

      // Cross-batch duplicate check
      if (resultSet.has(rawId)) {
        throw createWatchlistOperationError('Sayfalar arasında mükerrer enstrüman kimliği tespit edildi.');
      }

      resultSet.add(rawId);
    }

    offset += data.length;

    // Short page validation: a page shorter than batchSize MUST equal the remainder to expectedTotalCount
    if (data.length < batchSize) {
      if (expectedTotalCount !== null && offset !== expectedTotalCount) {
        throw createWatchlistOperationError('Kısa sayfa beklenen toplam sayıyla uyuşmuyor.');
      }
      isCompleted = true;
      break;
    }

    if (expectedTotalCount !== null && offset >= expectedTotalCount) {
      isCompleted = true;
      break;
    }
  }

  if (!isCompleted && iteration >= maxIterations) {
    throw createWatchlistOperationError('Maksimum üyelik sorgulama sınırına ulaşıldı.');
  }

  // Final integrity assertion
  if (expectedTotalCount !== null) {
    if (offset !== expectedTotalCount || resultSet.size !== expectedTotalCount) {
      throw createWatchlistOperationError('Tüketilen satır veya tekil enstrüman sayısı beklenen toplam ile eşleşmiyor.');
    }
  }

  return resultSet;
}

/**
 * Batches 100 items per call to construct a complete Set<instrumentId> of all watched instruments.
 * Bounded with max 50 loop iterations (up to 5000 items) to guarantee termination.
 * Automatically validates against monotonic user membership revisions to avoid race conditions
 * where a stale in-flight batch fetch or mid-pagination drift could overwrite a newer mutation.
 * Returns structured WatchlistMembershipResult with explicit isStale modeling.
 */
export async function fetchAllWatchedInstrumentIds(forceRefresh = false): Promise<WatchlistMembershipResult> {
  const authResult = await ensureAnonymousSession();
  if (!authResult.user || !authResult.user.id) {
    throw new WatchlistOperationError('İzleme listesini görüntülemek için oturum açılması gerekmektedir.');
  }

  const userId = authResult.user.id;
  const now = Date.now();

  const cached = membershipCacheByUserId.get(userId);
  if (!forceRefresh && cached && !cached.isStale && now - cached.timestamp < WATCHLIST_CACHE_TTL_MS) {
    return {
      userId: cached.userId,
      instrumentIds: new Set(cached.instrumentIds),
      isStale: false,
      timestamp: cached.timestamp,
    };
  }

  const existingInFlight = inFlightMembershipRequests.get(userId);
  if (existingInFlight) {
    return existingInFlight.promise;
  }

  const currentToken = Symbol(`watchlist_membership_${userId}`);

  const fetchPromise = (async (): Promise<WatchlistMembershipResult> => {
    let attempt = 0;

    try {
      while (attempt < MAX_MEMBERSHIP_ATTEMPTS) {
        attempt++;
        const startRevision = getMembershipRevision(userId);

        try {
          // Attempt a full batch collection from offset = 0
          const resultSet = await collectWatchedInstrumentIdsBatch(userId);

          // Revision validation after complete batch collection
          const endRevision = getMembershipRevision(userId);
          if (startRevision !== endRevision) {
            log.info('Üyelik sorgusu tamamlandığında mutasyon gerçekleşti (revision mismatch), yeniden deneniyor', {
              userId,
              attempt,
              startRevision,
              endRevision,
            });

            if (attempt < MAX_MEMBERSHIP_ATTEMPTS) {
              continue; // Rerun full batch from scratch with offset = 0!
            }

            // Reached max attempts due to continuous mutations
            const existingCached = membershipCacheByUserId.get(userId);
            if (existingCached) {
              log.warn('Maksimum üyelik deneme sayısına ulaşıldı, mevcut önbellek stale olarak korunuyor', { userId });
              const staleCached: WatchlistMembershipResult = {
                userId: existingCached.userId,
                instrumentIds: new Set(existingCached.instrumentIds),
                isStale: true,
                timestamp: existingCached.timestamp,
              };
              membershipCacheByUserId.set(userId, staleCached);
              return staleCached;
            }

            throw createWatchlistOperationError('İzleme listesi güncellenirken çakışma oluştu. Lütfen tekrar deneyiniz.');
          }

          // Verified revision match - save fresh cache
          const finalResult: WatchlistMembershipResult = {
            userId,
            instrumentIds: resultSet,
            isStale: false,
            timestamp: Date.now(),
          };

          membershipCacheByUserId.set(userId, finalResult);
          notifyWatchlistSubscribers({ userId });
          return {
            userId: finalResult.userId,
            instrumentIds: new Set(finalResult.instrumentIds),
            isStale: false,
            timestamp: finalResult.timestamp,
          };
        } catch (attemptErr) {
          // Error occurred during batch collection (e.g. total_count drift, short-page mismatch, early empty)
          const currentRevision = getMembershipRevision(userId);
          if (currentRevision !== startRevision) {
            log.info('Sayfalama sırasında mutasyon kaynaklı tutarsızlık/hata oluştu (revision changed), yeni deneme başlatılıyor', {
              userId,
              attempt,
              startRevision,
              currentRevision,
              error: String(attemptErr),
            });

            if (attempt < MAX_MEMBERSHIP_ATTEMPTS) {
              continue; // Rerun full batch from scratch with offset = 0!
            }

            // Reached max attempts due to continuous mutations
            const existingCached = membershipCacheByUserId.get(userId);
            if (existingCached) {
              log.warn('Maksimum üyelik deneme sayısına ulaşıldı, mevcut önbellek stale olarak korunuyor', { userId });
              const staleCached: WatchlistMembershipResult = {
                userId: existingCached.userId,
                instrumentIds: new Set(existingCached.instrumentIds),
                isStale: true,
                timestamp: existingCached.timestamp,
              };
              membershipCacheByUserId.set(userId, staleCached);
              return staleCached;
            }

            throw createWatchlistOperationError('İzleme listesi güncellenirken çakışma oluştu. Lütfen tekrar deneyiniz.');
          }

          // Revision did NOT change - this is a genuine RPC/contract error!
          // Do NOT retry! Rethrow immediately to fail-closed outer handler.
          throw attemptErr;
        }
      }

      throw createWatchlistOperationError('İzleme listesi üyelik sorgusu tamamlanamadı.');
    } catch (err) {
      const existingCached = membershipCacheByUserId.get(userId);
      if (existingCached) {
        log.warn('Üyelik yenilemesi başarısız oldu, eski üyelik stale olarak dönülüyor', { userId, error: String(err) });
        const staleCached: WatchlistMembershipResult = {
          userId: existingCached.userId,
          instrumentIds: new Set(existingCached.instrumentIds),
          isStale: true,
          timestamp: existingCached.timestamp,
        };
        membershipCacheByUserId.set(userId, staleCached);
        return staleCached;
      }
      if (err instanceof WatchlistOperationError) {
        throw err;
      }
      throw createWatchlistOperationError(formatWatchlistRpcError(err), err);
    } finally {
      const active = inFlightMembershipRequests.get(userId);
      if (active && active.token === currentToken) {
        inFlightMembershipRequests.delete(userId);
      }
    }
  })();

  inFlightMembershipRequests.set(userId, {
    promise: fetchPromise,
    token: currentToken,
  });

  return fetchPromise;
}

/**
 * Adds or removes an instrument from the user's watchlist via `set_my_watchlist_item` RPC.
 * Guaranteed "Last Intent Wins" queueing, user isolation, and strict single-row array validation.
 */
export async function setWatchlistItem(
  instrumentId: string,
  isWatched: boolean
): Promise<SetWatchlistItemResult> {
  if (!instrumentId || typeof instrumentId !== 'string') {
    throw new WatchlistOperationError('Geçerli bir varlık/enstrüman seçilmelidir.');
  }

  // 1. Authenticate user first
  const authResult = await ensureAnonymousSession();
  if (!authResult.user || !authResult.user.id) {
    throw new WatchlistOperationError('İzleme listesini düzenlemek için oturum açılması gerekmektedir.');
  }

  const userId = authResult.user.id;

  // 2. Delegate to deterministic mutation intent queue
  return enqueueWatchlistMutation(
    userId,
    instrumentId,
    isWatched,
    async (intentToRun: boolean): Promise<SetWatchlistItemResult> => {
      const client = getSupabaseClient();

      const { data, error } = await client.rpc('set_my_watchlist_item', {
        p_instrument_id: instrumentId,
        p_is_watched: intentToRun,
      });

      if (error) {
        log.error('set_my_watchlist_item RPC hatası', { error: error.message, instrumentId, isWatched: intentToRun, userId });
        throw createWatchlistOperationError(formatWatchlistRpcError(error), error);
      }

      const normalized = normalizeSetWatchlistItemRpcResult(data, instrumentId, intentToRun);
      if (!normalized) {
        log.error('set_my_watchlist_item RPC cevabı sözleşmeye uymuyor', { data, instrumentId, isWatched: intentToRun, userId });
        throw createWatchlistOperationError('İzleme listesi yanıtı doğrulanamadı.');
      }

      // Update in-memory membership set for this user only (immutable update preserving stale state)
      const currentMembership = membershipCacheByUserId.get(userId);
      if (currentMembership) {
        const nextSet = new Set(currentMembership.instrumentIds);
        if (intentToRun) {
          nextSet.add(instrumentId);
        } else {
          nextSet.delete(instrumentId);
        }
        membershipCacheByUserId.set(userId, {
          userId,
          instrumentIds: nextSet,
          isStale: currentMembership.isStale,
          timestamp: currentMembership.timestamp,
        });
      }

      // Monotonically bump membership revision for this user
      bumpMembershipRevision(userId);

      // Invalidate page caches for this user
      invalidateUserPageCaches(userId);

      // Notify all active listeners
      notifyWatchlistSubscribers({
        userId,
        mutation: {
          instrumentId,
          isWatched: intentToRun,
        },
      });

      log.info('İzleme listesi öğesi başarıyla güncellendi', {
        userId,
        instrumentId,
        isWatched: intentToRun,
        wasChanged: normalized.wasChanged,
      });

      return normalized;
    }
  );
}

/**
 * Checks if an instrument is currently in the middle of a mutation for a given user.
 */
export function isInstrumentMutationPending(userId: string, instrumentId: string): boolean {
  return isMutationPendingForInstrument(userId, instrumentId);
}
