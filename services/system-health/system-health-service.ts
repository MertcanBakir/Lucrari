/**
 * Lucrari — System Health Data Service
 * 
 * Fetches mobile system health diagnostics via `get_mobile_system_health` RPC
 * with module-level in-flight request deduplication, memory caching,
 * pub/sub state synchronization, and stale cache retention on background failures.
 */

import { getSupabaseClient } from '@/services/supabase/client';
import { ensureAnonymousSession } from '@/services/auth/auth-service';
import { createScopedLogger } from '@/utils/logger';
import {
  normalizeSystemHealthResponse,
  evaluateOverallHealth,
  groupJobsIntoSections,
} from '@/utils/system-health-formatters';
import type { SystemHealthReport } from '@/types/system-health';

const log = createScopedLogger('SystemHealthService');

// In-memory cache
let cachedReport: { report: SystemHealthReport; timestamp: number } | null = null;
export const SYSTEM_HEALTH_CACHE_TTL_MS = 30000; // 30 seconds

// In-flight promise for concurrent request deduplication
let inFlightFetch: Promise<SystemHealthReport> | null = null;
let inFlightToken: symbol | null = null;

// Subscribers for cross-screen state synchronization (Menu <-> Detail)
type HealthListener = (report: SystemHealthReport) => void;
const subscribers = new Set<HealthListener>();

export interface FetchSystemHealthOptions {
  forceRefresh?: boolean;
}

/**
 * Subscribes a listener to system health cache updates.
 * Returns an unsubscribe function.
 */
export function subscribeSystemHealth(listener: HealthListener): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

function notifySubscribers(report: SystemHealthReport): void {
  for (const listener of subscribers) {
    try {
      listener(report);
    } catch {
      // Ignore subscriber errors
    }
  }
}

/**
 * Returns current in-memory cache snapshot without triggering a network request.
 */
export function getSystemHealthCacheSnapshot(): { report: SystemHealthReport; timestamp: number } | null {
  return cachedReport;
}

/**
 * Clears the in-memory system health cache (useful for testing or manual hard resets).
 */
export function clearSystemHealthCache(): void {
  cachedReport = null;
  inFlightFetch = null;
  inFlightToken = null;
  subscribers.clear();
}

/**
 * Fetches system health report with in-flight deduplication and caching.
 * Always throws safe, user-friendly error messages with zero internal leakage.
 */
export async function fetchSystemHealth(
  options?: FetchSystemHealthOptions
): Promise<SystemHealthReport> {
  const now = Date.now();
  const forceRefresh = Boolean(options?.forceRefresh);

  // Return fresh cache if within TTL and not forced
  if (!forceRefresh && cachedReport && now - cachedReport.timestamp < SYSTEM_HEALTH_CACHE_TTL_MS) {
    return cachedReport.report;
  }

  // Deduplicate concurrent in-flight requests
  if (inFlightFetch) {
    return inFlightFetch;
  }

  const currentToken = Symbol('system_health_fetch');
  inFlightToken = currentToken;

  inFlightFetch = (async (): Promise<SystemHealthReport> => {
    try {
      // 1. Ensure authenticated user session exists before calling RPC
      const authResult = await ensureAnonymousSession();
      if (!authResult.user) {
        log.warn('system.health.session.failed', {
          message: 'System health session failed.',
          error: authResult.error
        });
        throw new Error('Oturum doğrulanamadı. Lütfen tekrar deneyin.');
      }

      const client = getSupabaseClient();

      // 2. Invoke get_mobile_system_health RPC
      const { data, error } = await client.rpc('get_mobile_system_health');

      if (error) {
        log.error('system.health.rpc.failed', {
          message: 'System health rpc failed.',
          error
        });

        // Retain stale cached report in snapshot and notify subscribers
        if (cachedReport) {
          log.warn('system.health.cache.stale', {
            message: 'System health cache stale.'
          });
          const staleReport: SystemHealthReport = {
            ...cachedReport.report,
            isStale: true,
          };
          cachedReport = {
            report: staleReport,
            timestamp: cachedReport.timestamp, // Preserve original fetch timestamp
          };
          notifySubscribers(staleReport);
          return staleReport;
        }

        throw new Error('Sistem durumu bilgisi alınamadı.');
      }

      // 3. Normalize against expected catalog allowlist (throws if not array)
      const { items, isIncomplete, checkedAt } = normalizeSystemHealthResponse(data);
      const overall = evaluateOverallHealth(items, checkedAt);
      const sections = groupJobsIntoSections(items);

      const report: SystemHealthReport = {
        items,
        sections,
        overall,
        checkedAt,
        isStale: false,
        isIncomplete,
      };

      // 4. Update in-memory cache with new timestamp and notify subscribers
      cachedReport = {
        report,
        timestamp: Date.now(),
      };
      notifySubscribers(report);

      log.debug('system.health.loaded', {
        message: 'System health loaded.',
        context: { totalJobs: items.length, overallStatus: overall.status, failedCount: overall.failedCount, overdueCount: overall.overdueCount, unknownCount: overall.unknownCount, isIncomplete }
      });

      return report;
    } catch (err) {
      const isKnownAuthError = err instanceof Error && err.message === 'Oturum doğrulanamadı. Lütfen tekrar deneyin.';
      const safeErrorMessage = isKnownAuthError
        ? 'Oturum doğrulanamadı. Lütfen tekrar deneyin.'
        : 'Sistem durumu bilgisi alınamadı.';

      log.error('system.health.failed', {
        message: 'System health failed.',
        error: err
      });

      if (cachedReport) {
        const staleReport: SystemHealthReport = {
          ...cachedReport.report,
          isStale: true,
        };
        cachedReport = {
          report: staleReport,
          timestamp: cachedReport.timestamp, // Preserve original fetch timestamp
        };
        notifySubscribers(staleReport);
        return staleReport;
      }

      throw new Error(safeErrorMessage);
    } finally {
      // Generation-safe in-flight cleanup using unique token
      if (inFlightToken === currentToken) {
        inFlightFetch = null;
        inFlightToken = null;
      }
    }
  })();

  return inFlightFetch;
}
