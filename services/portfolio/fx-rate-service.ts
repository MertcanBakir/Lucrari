/**
 * Lucrari — Live USD/TRY Foreign Exchange Rate Service
 * 
 * Fetches the real-time USD/TRY reference rate from Supabase (`instruments` joined with `instrument_latest_prices`).
 * No hardcoded fallback rates are permitted.
 * Includes in-flight request deduplication with generation-safe cleanup and lifecycle cache.
 */

import { getSupabaseClient } from '@/services/supabase/client';
import { createScopedLogger } from '@/utils/logger';

const log = createScopedLogger('FxRateService');

export interface FxRateInfo {
  rate: number | null;
  rateAt: string | null;
  isStale: boolean;
  staleReason: string | null;
  isAvailable: boolean;
  source: 'database' | 'cache' | 'none';
}

let inFlightFxFetch: Promise<FxRateInfo> | null = null;
let lastKnownFxRateInfo: FxRateInfo | null = null;

/**
 * Resets the in-memory FX rate cache and in-flight promise (primarily for unit testing).
 */
export function clearFxRateCache(): void {
  inFlightFxFetch = null;
  lastKnownFxRateInfo = null;
}

/**
 * Fetches the live USD/TRY exchange rate from Supabase.
 * 
 * Target: `instruments` table where market='FX' and symbol='USDTRY',
 * joined with `instrument_latest_prices`.
 * 
 * Dedup Policy: If an in-flight fetch is currently ongoing, it is always shared
 * across all callers (even with forceRefresh) to prevent duplicate in-flight network queries.
 */
export async function fetchUsdTryRate(_options?: { forceRefresh?: boolean }): Promise<FxRateInfo> {
  if (inFlightFxFetch) {
    log.debug('Eşzamanlı USD/TRY kur isteği birleştirildi (deduplication)');
    return inFlightFxFetch;
  }

  const fetchPromise = (async (): Promise<FxRateInfo> => {
    const client = getSupabaseClient();

    try {
      const { data, error } = await (client.from('instruments') as any)
        .select(`
          id,
          symbol,
          market,
          instrument_latest_prices (
            price,
            price_at,
            is_stale,
            stale_reason
          )
        `)
        .eq('market', 'FX')
        .eq('symbol', 'USDTRY')
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        log.warn('USD/TRY kuru Supabase sorgusundan alınamadı', { error: error.message });
        if (lastKnownFxRateInfo && lastKnownFxRateInfo.rate !== null) {
          return {
            ...lastKnownFxRateInfo,
            isStale: true,
            staleReason: 'Ağ hatası nedeniyle son bilinen kur kullanılıyor',
            source: 'cache',
          };
        }
        return {
          rate: null,
          rateAt: null,
          isStale: false,
          staleReason: 'Kur verisi alınamadı',
          isAvailable: false,
          source: 'none',
        };
      }

      if (!data) {
        log.warn('USDTRY enstrüman kaydı instruments tablosunda bulunamadı');
        if (lastKnownFxRateInfo && lastKnownFxRateInfo.rate !== null) {
          return {
            ...lastKnownFxRateInfo,
            isStale: true,
            staleReason: 'USDTRY kaydı bulunamadı',
            source: 'cache',
          };
        }
        return {
          rate: null,
          rateAt: null,
          isStale: false,
          staleReason: 'USDTRY enstrümanı tanımlı değil',
          isAvailable: false,
          source: 'none',
        };
      }

      const priceRow = Array.isArray(data.instrument_latest_prices)
        ? data.instrument_latest_prices[0]
        : data.instrument_latest_prices;

      const rawPrice = priceRow?.price;
      const numPrice = Number(rawPrice);

      if (!Number.isFinite(numPrice) || numPrice <= 0) {
        log.warn('USDTRY için geçerli pozitif bir fiyat bulunamadı', { rawPrice });
        if (lastKnownFxRateInfo && lastKnownFxRateInfo.rate !== null) {
          return {
            ...lastKnownFxRateInfo,
            isStale: true,
            staleReason: 'Güncel fiyat geçersiz, son bilinen kur kullanılıyor',
            source: 'cache',
          };
        }
        return {
          rate: null,
          rateAt: null,
          isStale: false,
          staleReason: 'Geçerli fiyat bulunamadı',
          isAvailable: false,
          source: 'none',
        };
      }

      const result: FxRateInfo = {
        rate: numPrice,
        rateAt: priceRow?.price_at ?? null,
        isStale: Boolean(priceRow?.is_stale),
        staleReason: priceRow?.stale_reason ?? null,
        isAvailable: true,
        source: 'database',
      };

      lastKnownFxRateInfo = result;
      log.info('Canlı USD/TRY kuru başarıyla alındı', { rate: numPrice, isStale: result.isStale });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('fetchUsdTryRate istisnası', { error: msg });

      if (lastKnownFxRateInfo && lastKnownFxRateInfo.rate !== null) {
        return {
          ...lastKnownFxRateInfo,
          isStale: true,
          staleReason: 'Bağlantı hatası',
          source: 'cache',
        };
      }

      return {
        rate: null,
        rateAt: null,
        isStale: false,
        staleReason: 'İstisna oluştu',
        isAvailable: false,
        source: 'none',
      };
    }
  })();

  inFlightFxFetch = fetchPromise;

  try {
    return await fetchPromise;
  } finally {
    if (inFlightFxFetch === fetchPromise) {
      inFlightFxFetch = null;
    }
  }
}
