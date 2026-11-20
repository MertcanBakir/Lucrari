/**
 * Supabase Health Check Service
 * 
 * Performs end-to-end connectivity, auth, and database diagnostics
 * with precise latency measurement, module-level in-flight deduplication,
 * memory caching, and pub/sub state synchronization across screens.
 */

import { validateSupabaseConfig, getSupabaseConfig, maskKey } from './config';
import { getSupabaseClient } from './client';
import type { SupabaseHealthReport, ServiceCheckItem, HealthStatus } from '@/types/health';
import { createScopedLogger } from '@/utils/logger';

const log = createScopedLogger('SupabaseHealth');

// In-memory cache & TTL
let cachedHealthReport: { report: SupabaseHealthReport; timestamp: number } | null = null;
export const SUPABASE_HEALTH_CACHE_TTL_MS = 30000; // 30 seconds

// In-flight promise for concurrent request deduplication
let inFlightHealthCheck: Promise<SupabaseHealthReport> | null = null;
let inFlightToken: symbol | null = null;

// Subscribers for cross-screen state synchronization (Menu <-> Detail)
type SupabaseHealthListener = (report: SupabaseHealthReport) => void;
const subscribers = new Set<SupabaseHealthListener>();

export interface CheckSupabaseHealthOptions {
  forceRefresh?: boolean;
}

/**
 * Subscribes a listener to Supabase health cache updates.
 * Returns an unsubscribe function.
 */
export function subscribeSupabaseHealth(listener: SupabaseHealthListener): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

function notifySubscribers(report: SupabaseHealthReport): void {
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
export function getSupabaseHealthCacheSnapshot(): { report: SupabaseHealthReport; timestamp: number } | null {
  return cachedHealthReport;
}

/**
 * Clears the in-memory Supabase health cache (useful for testing).
 */
export function clearSupabaseHealthCache(): void {
  cachedHealthReport = null;
  inFlightHealthCheck = null;
  inFlightToken = null;
  subscribers.clear();
}

/**
 * Executes full health check suite against the Supabase backend with caching & deduplication.
 */
export async function checkSupabaseHealth(
  options?: CheckSupabaseHealthOptions
): Promise<SupabaseHealthReport> {
  const now = Date.now();
  const forceRefresh = Boolean(options?.forceRefresh);

  // Return fresh cache if within TTL and not forced
  if (!forceRefresh && cachedHealthReport && now - cachedHealthReport.timestamp < SUPABASE_HEALTH_CACHE_TTL_MS) {
    return cachedHealthReport.report;
  }

  // Deduplicate concurrent in-flight requests
  if (inFlightHealthCheck) {
    return inFlightHealthCheck;
  }

  const currentToken = Symbol('supabase_health_fetch');
  inFlightToken = currentToken;

  inFlightHealthCheck = (async (): Promise<SupabaseHealthReport> => {
    try {
      const timestamp = new Date().toISOString();
      log.debug('supabase.health.started', {
        message: 'Supabase health started.'
      });
      const configValidation = validateSupabaseConfig();
      const checks: ServiceCheckItem[] = [];
      const latencies: number[] = [];

      // 1. Config Check
      if (!configValidation.isValid) {
        checks.push({
          id: 'config',
          name: 'Ortam Konfigürasyonu',
          category: 'config',
          status: 'fail',
          latencyMs: null,
          message: configValidation.errors.join(' ') || 'Supabase URL veya Anon Key eksik.',
          details: {
            errors: configValidation.errors,
            warnings: configValidation.warnings,
          },
        });

        const unconfiguredReport: SupabaseHealthReport = {
          overallStatus: 'unconfigured',
          supabaseUrl: configValidation.url,
          isConfigured: false,
          checks,
          averageLatencyMs: null,
          timestamp,
          errorMessage: 'Supabase ortam değişkenleri yapılandırılmamış.',
        };

        cachedHealthReport = {
          report: unconfiguredReport,
          timestamp: Date.now(),
        };
        notifySubscribers(unconfiguredReport);

        return unconfiguredReport;
      }

      checks.push({
        id: 'config',
        name: 'Ortam Konfigürasyonu',
        category: 'config',
        status: configValidation.warnings.length > 0 ? 'warn' : 'pass',
        latencyMs: null,
        message: configValidation.warnings.length > 0
          ? `Konfigürasyon geçerli (Uyarılar: ${configValidation.warnings.join(', ')})`
          : 'URL ve Anon Key başarıyla doğrulandı.',
        details: {
          url: configValidation.url,
          maskedKey: maskKey(configValidation.anonKey),
          warnings: configValidation.warnings,
        },
      });

      const { url, anonKey } = getSupabaseConfig();
      const client = getSupabaseClient();

      // 2. Gateway / Network Ping Check
      try {
        const startGateway = performance.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const pingResponse = await fetch(`${url}/auth/v1/health`, {
          method: 'GET',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const gatewayLatency = Math.round(performance.now() - startGateway);
        latencies.push(gatewayLatency);

        if (pingResponse.ok || pingResponse.status === 200) {
          checks.push({
            id: 'gateway',
            name: 'Supabase Gateway & Ağ',
            category: 'gateway',
            status: gatewayLatency > 1500 ? 'warn' : 'pass',
            latencyMs: gatewayLatency,
            message: `Supabase Cloud sunucularına ağ erişimi aktif (${gatewayLatency} ms).`,
            details: { httpStatus: pingResponse.status },
          });
        } else if (pingResponse.status === 401) {
          checks.push({
            id: 'gateway',
            name: 'Supabase Gateway & Ağ',
            category: 'gateway',
            status: 'fail',
            latencyMs: gatewayLatency,
            message: 'Yetkilendirme hatası (401 Unauthorized): Anon Key geçersiz olabilir.',
            details: { httpStatus: pingResponse.status },
          });
        } else {
          checks.push({
            id: 'gateway',
            name: 'Supabase Gateway & Ağ',
            category: 'gateway',
            status: 'warn',
            latencyMs: gatewayLatency,
            message: `HTTP Yanıt Kodu: ${pingResponse.status}`,
            details: { httpStatus: pingResponse.status },
          });
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Bilinmeyen ağ hatası';
        checks.push({
          id: 'gateway',
          name: 'Supabase Gateway',
          category: 'gateway',
          status: 'fail',
          latencyMs: null,
          message: `Ağ bağlantısı kurulamadı: ${errorMsg}`,
        });
      }

      // 3. REST / PostgREST Schema Check
      try {
        const startRest = performance.now();
        const { data: providersData, error } = await client
          .from('data_providers')
          .select('code, name, is_active')
          .limit(1);

        const restLatency = Math.round(performance.now() - startRest);
        latencies.push(restLatency);

        if (!error) {
          const firstRow = providersData && providersData.length > 0 ? providersData[0] : null;
          const recordInfo = firstRow ? ` (${(firstRow as { code: string }).code} doğrulandı)` : '';
          checks.push({
            id: 'rest_db',
            name: 'PostgREST Veritabanı Servisi',
            category: 'rest',
            status: restLatency > 1200 ? 'warn' : 'pass',
            latencyMs: restLatency,
            message: `PostgREST bağlantısı aktif ve data_providers tablosu sorgulanabilir${recordInfo} (${restLatency} ms).`,
          });
        } else if (error.code === '42P01' || error.message.includes('does not exist')) {
          checks.push({
            id: 'rest_db',
            name: 'PostgREST Veritabanı Servisi',
            category: 'rest',
            status: 'pass',
            latencyMs: restLatency,
            message: `PostgREST servisi aktif (${restLatency} ms, data_providers tablosu henüz oluşturulmamış).`,
            details: { hint: error.message },
          });
        } else if (error.code === 'PGRST301' || error.message.includes('JWT') || error.message.includes('permission denied')) {
          checks.push({
            id: 'rest_db',
            name: 'PostgREST Veritabanı Servisi',
            category: 'rest',
            status: 'warn',
            latencyMs: restLatency,
            message: `PostgREST yanıt verdi fakat RLS izin kuralı devrede: ${error.message}`,
            details: { code: error.code },
          });
        } else {
          checks.push({
            id: 'rest_db',
            name: 'PostgREST Veritabanı Servisi',
            category: 'rest',
            status: 'warn',
            latencyMs: restLatency,
            message: `PostgREST yanıt verdi (${error.message})`,
            details: { code: error.code },
          });
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Sorgu yürütülemedi';
        checks.push({
          id: 'rest_db',
          name: 'PostgREST Veritabanı Servisi',
          category: 'rest',
          status: 'fail',
          latencyMs: null,
          message: `Veritabanı sorgu hatası: ${errorMsg}`,
        });
      }

      // 4. Auth Service Check
      try {
        const startAuth = performance.now();
        const { data: authData, error: authError } = await client.auth.getSession();
        const authLatency = Math.round(performance.now() - startAuth);
        latencies.push(authLatency);

        if (authError) {
          checks.push({
            id: 'auth',
            name: 'Supabase Auth Servisi',
            category: 'auth',
            status: 'warn',
            latencyMs: authLatency,
            message: `Auth servisi hata bildirdi: ${authError.message}`,
          });
        } else {
          checks.push({
            id: 'auth',
            name: 'Supabase Auth Servisi',
            category: 'auth',
            status: authLatency > 1200 ? 'warn' : 'pass',
            latencyMs: authLatency,
            message: authData.session
              ? `Auth aktif (Mevcut kullanıcı: ${authData.session.user.email || 'Anonim'})`
              : `Auth servisi aktif ve hazır (${authLatency} ms, aktif oturum yok).`,
          });
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Auth servisine ulaşılamadı';
        checks.push({
          id: 'auth',
          name: 'Supabase Auth Servisi',
          category: 'auth',
          status: 'fail',
          latencyMs: null,
          message: `Auth servisi kontrol edilemedi: ${errorMsg}`,
        });
      }

      // Compute Overall Status
      const hasFail = checks.some((c) => c.status === 'fail');
      const hasWarn = checks.some((c) => c.status === 'warn');

      let overallStatus: HealthStatus = 'healthy';
      if (hasFail) {
        overallStatus = 'unhealthy';
      } else if (hasWarn) {
        overallStatus = 'degraded';
      }

      const averageLatencyMs =
        latencies.length > 0
          ? Math.round(latencies.reduce((sum, val) => sum + val, 0) / latencies.length)
          : null;

      const report: SupabaseHealthReport = {
        overallStatus,
        supabaseUrl: url,
        isConfigured: true,
        checks,
        averageLatencyMs,
        timestamp,
        errorMessage: hasFail ? 'Bazı servis kontrolleri başarısız oldu.' : null,
      };

      cachedHealthReport = {
        report,
        timestamp: Date.now(),
      };
      notifySubscribers(report);

      log.debug('supabase.health.completed', {
        message: 'Supabase health completed.',
        context: { status: overallStatus, latencyMs: averageLatencyMs }
      });

      return report;
    } finally {
      if (inFlightToken === currentToken) {
        inFlightHealthCheck = null;
        inFlightToken = null;
      }
    }
  })();

  return inFlightHealthCheck;
}
