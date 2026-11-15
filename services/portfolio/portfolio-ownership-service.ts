/**
 * Lucrari — Lightweight Portfolio Ownership Service
 * 
 * Fetches and maintains open positions (quantity > 0) for calendar event filtering
 * without loading heavy portfolio metrics, cash calculations, or historical valuations.
 * Enforces strict user-keyed cache isolation, revision-based mutation race loop protection
 * with fail-closed guarantees, and instrumentId-only indexing.
 */

import { ensureAnonymousSession } from '@/services/auth/auth-service';
import {
  ensureDefaultPortfolio,
  fetchPortfolioPositions,
  subscribePortfolioChanges,
} from './portfolio-service';
import { createScopedLogger } from '@/utils/logger';
import { createPortfolioOperationError, PortfolioOperationError } from '@/utils/portfolio-errors';

const log = createScopedLogger('PortfolioOwnershipService');

export interface OwnedPosition {
  instrumentId: string;
  symbol: string;
  quantity: number;
}

export interface PortfolioOwnershipData {
  userId: string;
  ownedPositions: Map<string, OwnedPosition>;
  portfolioId: string;
  timestamp: number;
  isStale: boolean;
  revision: number;
}

// User-keyed in-memory cache map & TTL
const ownershipCacheByUserId = new Map<string, PortfolioOwnershipData>();
export const OWNERSHIP_CACHE_TTL_MS = 30 * 1000; // 30 seconds

// Atomic revision counter to detect in-flight mutation races
let globalOwnershipRevision = 1;

// In-flight deduplication map keyed by userId
interface InFlightRequest {
  promise: Promise<PortfolioOwnershipData>;
  revision: number;
  token: symbol;
}
const inFlightRequestsByUserId = new Map<string, InFlightRequest>();

// Subscribers for cross-component reactive synchronization
type OwnershipListener = (data: PortfolioOwnershipData) => void;
const ownershipSubscribers = new Set<OwnershipListener>();

export function subscribeOwnershipChanges(listener: OwnershipListener): () => void {
  ownershipSubscribers.add(listener);
  return () => {
    ownershipSubscribers.delete(listener);
  };
}

function notifyOwnershipSubscribers(data: PortfolioOwnershipData): void {
  for (const listener of ownershipSubscribers) {
    try {
      listener(data);
    } catch (err) {
      log.error('Ownership listener hatası', { error: String(err) });
    }
  }
}

// Automatically invalidate cache on portfolio mutations (BUY, SELL, RESET, REVERSAL)
subscribePortfolioChanges(() => {
  globalOwnershipRevision++;
  log.debug('Portföy mutasyonu algılandı, sahiplik revizyonu artırıldı', {
    newRevision: globalOwnershipRevision,
  });

  for (const [userId, cached] of ownershipCacheByUserId.entries()) {
    ownershipCacheByUserId.set(userId, {
      ...cached,
      isStale: true,
      timestamp: 0, // Invalidate TTL
    });
  }

  if (ownershipSubscribers.size > 0) {
    fetchOwnedPositions({ forceRefresh: true }).catch((err) => {
      log.warn('Otomatik sahiplik yenileme hatası', { error: String(err) });
    });
  }
});

/**
 * Clears the ownership cache and in-flight requests.
 * By default preserves active UI subscribers unless clearSubscribers is explicitly true.
 */
export function clearOwnershipCache(options?: { clearSubscribers?: boolean }): void {
  ownershipCacheByUserId.clear();
  inFlightRequestsByUserId.clear();
  if (options?.clearSubscribers) {
    ownershipSubscribers.clear();
  }
}

/**
 * Returns current in-memory cache snapshot for a required userId.
 * Paramaterless reading is strictly prohibited to guarantee user isolation.
 */
export function getOwnershipCacheSnapshot(userId: string): PortfolioOwnershipData | null {
  if (!userId) return null;
  const cached = ownershipCacheByUserId.get(userId);
  if (!cached) return null;
  return cached;
}

export interface FetchOwnedPositionsOptions {
  forceRefresh?: boolean;
}

/**
 * Executes the ownership fetch with bounded revision follow-up loops and fail-closed protection.
 * If a mutation occurs while an RPC request is in-flight, it immediately performs a follow-up
 * query for the latest revision. If mutation conflict persists beyond max attempts, it fails closed
 * by retaining stale cache if present or throwing a safe error (never writing unverified fresh data).
 */
async function executeOwnershipFetch(userId: string): Promise<PortfolioOwnershipData> {
  const maxAttempts = 3;
  let attempts = 0;

  // Query default portfolio once
  const portfolio = await ensureDefaultPortfolio(userId);

  while (attempts < maxAttempts) {
    attempts++;
    const fetchStartRevision = globalOwnershipRevision;

    // Fetch positions via get_portfolio_positions RPC
    const positions = await fetchPortfolioPositions(portfolio.id);

    // Check if a mutation occurred while this RPC was executing
    if (globalOwnershipRevision !== fetchStartRevision) {
      log.warn('Fetch sürerken portföy mutasyonu gerçekleşti, güncel revizyon için follow-up yapılıyor', {
        fetchStartRevision,
        currentRevision: globalOwnershipRevision,
        attempt: attempts,
      });
      continue;
    }

    // Filter open positions where quantity > 0 and index strictly by instrumentId
    const ownedMap = new Map<string, OwnedPosition>();
    for (const pos of positions) {
      const qty = Number(pos.quantity);
      if (Number.isFinite(qty) && qty > 0 && pos.instrument_id) {
        ownedMap.set(pos.instrument_id, {
          instrumentId: pos.instrument_id,
          symbol: pos.symbol,
          quantity: qty,
        });
      }
    }

    // Re-verify revision equality before committing fresh cache
    if (globalOwnershipRevision !== fetchStartRevision) {
      continue;
    }

    const result: PortfolioOwnershipData = {
      userId,
      ownedPositions: ownedMap,
      portfolioId: portfolio.id,
      timestamp: Date.now(),
      isStale: false,
      revision: fetchStartRevision,
    };

    ownershipCacheByUserId.set(userId, result);
    notifyOwnershipSubscribers(result);

    log.info('Açık pozisyon sahiplik haritası başarıyla oluşturuldu', {
      userId,
      açıkPozisyonSayısı: ownedMap.size,
      portfolioId: portfolio.id,
      revision: result.revision,
    });

    return result;
  }

  // Fail-closed fallback: mutation conflict persisted across all attempts
  log.error('Maksimum mutasyon çakışması denemesi aşıldı, fail-closed uygulanıyor', { userId });
  const existingUserCache = ownershipCacheByUserId.get(userId);
  if (existingUserCache) {
    const staleFallback: PortfolioOwnershipData = {
      ...existingUserCache,
      isStale: true,
    };
    ownershipCacheByUserId.set(userId, staleFallback);
    notifyOwnershipSubscribers(staleFallback);
    return staleFallback;
  }

  throw new PortfolioOperationError(
    'Portföy açık pozisyonları doğrulanırken mutasyon çakışması oluştu. Lütfen tekrar deneyiniz.',
    { isRetryable: true }
  );
}

/**
 * Fetches open positions (quantity > 0) for the current authenticated user.
 * - Authenticates user first (strictly user-isolated).
 * - Indexes ONLY by valid instrumentId (no symbol duplicate indexing).
 * - Reconciles in-flight mutation races with real follow-up fetches and fail-closed validation.
 */
export async function fetchOwnedPositions(
  options?: FetchOwnedPositionsOptions
): Promise<PortfolioOwnershipData> {
  const forceRefresh = Boolean(options?.forceRefresh);

  // 1. Ensure authenticated user session first
  const authResult = await ensureAnonymousSession();
  if (!authResult.user || !authResult.user.id) {
    log.error('Oturum doğrulanamadı');
    throw new PortfolioOperationError('Kullanıcı oturumu doğrulanamadı.');
  }

  const userId = authResult.user.id;
  const now = Date.now();

  // 2. Check user-keyed fresh cache
  const cached = ownershipCacheByUserId.get(userId);
  if (!forceRefresh && cached && !cached.isStale && now - cached.timestamp < OWNERSHIP_CACHE_TTL_MS) {
    log.debug('Sahiplik önbellek isabeti', { userId, revision: cached.revision });
    return cached;
  }

  // 3. Check in-flight request deduplication for this specific user
  const existingInFlight = inFlightRequestsByUserId.get(userId);
  if (existingInFlight) {
    log.debug('Eşzamanlı sahiplik isteği birleştirildi (deduplication)', { userId });
    return existingInFlight.promise;
  }

  const currentToken = Symbol(`ownership_fetch_${userId}`);
  const requestRevision = globalOwnershipRevision;

  const fetchPromise = (async (): Promise<PortfolioOwnershipData> => {
    try {
      return await executeOwnershipFetch(userId);
    } catch (error) {
      log.error('Açık pozisyonlar yüklenirken hata oluştu', { userId, error: String(error) });

      // Retain stale cache ONLY if it belongs to the exact same user
      const existingUserCache = ownershipCacheByUserId.get(userId);
      if (existingUserCache) {
        log.warn('Hata nedeniyle önceki başarılı sahiplik verisi stale olarak korunuyor', { userId });
        const staleData: PortfolioOwnershipData = {
          ...existingUserCache,
          isStale: true,
        };
        ownershipCacheByUserId.set(userId, staleData);
        notifyOwnershipSubscribers(staleData);
        return staleData;
      }

      if (error instanceof PortfolioOperationError) {
        throw error;
      }
      throw createPortfolioOperationError('Portföy açık pozisyonları alınamadı', error);
    } finally {
      const active = inFlightRequestsByUserId.get(userId);
      if (active && active.token === currentToken) {
        inFlightRequestsByUserId.delete(userId);
      }
    }
  })();

  inFlightRequestsByUserId.set(userId, {
    promise: fetchPromise,
    revision: requestRevision,
    token: currentToken,
  });

  return fetchPromise;
}
