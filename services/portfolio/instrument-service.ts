/**
 * Lucrari — Instrument Catalog & Price Search Service
 * 
 * Queries Supabase `instruments` joined with `instrument_latest_prices`
 * across all markets: BIST100, NASDAQ100, CRYPTO, TEFAS, FX.
 * 
 * STRICT COMPLIANCE:
 * - NO hardcoded fallback presets or fake prices (no 100 default).
 * - NO fake IDs (inst-*).
 * - Distinguishes between zero search results and query errors.
 * - Accurately reports missing price data as `price: null` and `hasPrice: false`.
 */

import { getSupabaseClient } from '@/services/supabase/client';
import { createScopedLogger } from '@/utils/logger';
import type { MarketType, AssetType, CurrencyCode } from '@/types/database';

const log = createScopedLogger('InstrumentService');

export interface InstrumentWithPrice {
  id: string; // Real Supabase UUID
  symbol: string;
  companyName: string;
  market: MarketType;
  assetType: AssetType;
  currency: CurrencyCode;
  price: number | null;
  changePercent: number | null;
  changeAmount: number | null;
  priceAt: string | null;
  isStale: boolean;
  staleReason: string | null;
  hasPrice: boolean;
}

export interface InstrumentSearchResult {
  items: InstrumentWithPrice[];
  error: string | null;
  isStale: boolean;
  hasMore: boolean;
}

/**
 * Searches instruments in Supabase by symbol or company name with latest price data and pagination.
 * Returns structured search result including error state, items, and pagination flag.
 */
export async function searchInstrumentsDetailed(
  query?: string,
  market?: MarketType | 'ALL',
  limit = 20,
  offset = 0
): Promise<InstrumentSearchResult> {
  const client = getSupabaseClient();

  try {
    let q = (client.from('instruments') as any)
      .select(`
        id,
        symbol,
        company_name,
        market,
        asset_type,
        currency,
        is_active,
        instrument_latest_prices (
          price,
          change_percent,
          change_amount,
          price_at,
          is_stale,
          stale_reason
        )
      `)
      .eq('is_active', true);

    if (market && market !== 'ALL') {
      q = q.eq('market', market);
    }

    const trimmed = query?.trim();
    if (trimmed) {
      q = q.or(`symbol.ilike.%${trimmed}%,company_name.ilike.%${trimmed}%`);
    }

    q = q.order('symbol', { ascending: true }).range(offset, offset + limit - 1);

    const { data, error } = await q;

    if (error) {
      log.warn('instrument.search.failed', {
        message: 'Instrument search failed.',
        context: { market },
        error: error
      });
      return {
        items: [],
        error: 'Piyasa enstrümanları yüklenirken bir hata oluştu.',
        isStale: false,
        hasMore: false,
      };
    }

    if (!data || data.length === 0) {
      return {
        items: [],
        error: null,
        isStale: false,
        hasMore: false,
      };
    }

    const rawList = data as any[];
    const items: InstrumentWithPrice[] = rawList.map((row) => {
      const priceRow = Array.isArray(row.instrument_latest_prices)
        ? row.instrument_latest_prices[0]
        : row.instrument_latest_prices;

      const rawPrice = priceRow?.price;
      const numPrice = Number(rawPrice);
      const hasValidPrice = Number.isFinite(numPrice) && numPrice > 0;

      return {
        id: row.id,
        symbol: row.symbol,
        companyName: row.company_name,
        market: row.market as MarketType,
        assetType: row.asset_type as AssetType,
        currency: row.currency as CurrencyCode,
        price: hasValidPrice ? numPrice : null,
        changePercent: priceRow?.change_percent != null ? Number(priceRow.change_percent) : null,
        changeAmount: priceRow?.change_amount != null ? Number(priceRow.change_amount) : null,
        priceAt: priceRow?.price_at ?? null,
        isStale: Boolean(priceRow?.is_stale),
        staleReason: priceRow?.stale_reason ?? null,
        hasPrice: hasValidPrice,
      };
    });

    return {
      items,
      error: null,
      isStale: items.some((i) => i.isStale),
      hasMore: rawList.length >= limit,
    };
  } catch (error) {
    log.error('instrument.search.exception', {
      message: 'Instrument search exception.',
      error: error
    });
    return {
      items: [],
      error: 'Bağlantı hatası nedeniyle enstrümanlar alınamadı.',
      isStale: false,
      hasMore: false,
    };
  }
}

/**
 * Backwards-compatible instrument search helper returning an array of InstrumentWithPrice.
 */
export async function searchInstruments(
  query?: string,
  market?: MarketType | 'ALL',
  limit = 20,
  offset = 0
): Promise<InstrumentWithPrice[]> {
  const result = await searchInstrumentsDetailed(query, market, limit, offset);
  return result.items;
}
