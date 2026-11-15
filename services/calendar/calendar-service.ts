/**
 * Calendar Data Service
 * 
 * Fetches earnings events and macroeconomic events from Supabase
 * for a specific month with in-memory caching, in-flight request deduplication,
 * and fail-closed error verification preventing partial cache corruption.
 */

import { getSupabaseClient } from '@/services/supabase/client';
import type { EconomicEvent, TradingSession, CountryCode, MarketType } from '@/types/database';
import { formatDateKey } from '@/utils/calendar-utils';
import { createScopedLogger } from '@/utils/logger';
import { createPortfolioOperationError, PortfolioOperationError } from '@/utils/portfolio-errors';

const log = createScopedLogger('CalendarService');

export interface CalendarEventItem {
  id: string;
  type: 'earnings' | 'economic';
  dateKey: string; // YYYY-MM-DD
  timeLabel: string; // e.g. "14:30", "Seans Öncesi", "Kapanış Sonrası", "Gün Boyu"
  title: string; // e.g. "THYAO" or "TÜFE (Aylık)"
  subtitle: string; // e.g. "Türk Hava Yolları • 2026/Q2" or "Türkiye • Temmuz"
  marketOrCountry: string; // "BIST 100 🇹🇷", "NASDAQ 100 🇺🇸", "Türkiye 🇹🇷", "ABD 🇺🇸"
  period?: string | null;
  session?: TradingSession | null;
  country?: CountryCode;
  sourceUrl?: string | null;
  instrumentId: string | null;
  market: MarketType | null;
}

export interface DayIndicator {
  hasEarnings: boolean;
  hasEconomic: boolean;
  count: number;
}

export interface MonthlyCalendarData {
  year: number;
  month: number; // 0-indexed (0 = Jan, 11 = Dec)
  eventsByDate: Record<string, CalendarEventItem[]>;
  dayIndicators: Record<string, DayIndicator>;
}

// Typed Raw Row interface for earnings query mapping without `as any[]`
interface RawEarningsInstrument {
  id?: string;
  symbol?: string;
  company_name?: string;
  market?: MarketType;
}

interface RawEarningsRow {
  id: string;
  market?: MarketType | null;
  earnings_date?: string | null;
  session?: TradingSession | null;
  fiscal_year?: number | null;
  fiscal_period?: string | null;
  source_url?: string | null;
  instrument_id?: string | null;
  instrument?: RawEarningsInstrument | null;
}

// In-memory cache for calendar months: key is "YYYY-MM"
const calendarCache = new Map<string, { data: MonthlyCalendarData; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache TTL

// In-flight promise map for deduplicating concurrent month queries
const inFlightCalendarFetches = new Map<string, Promise<MonthlyCalendarData>>();

/**
 * Maps trading session to Turkish human-readable label
 */
export function formatTradingSession(session?: TradingSession | null): string {
  switch (session) {
    case 'pre_market':
      return 'Seans Öncesi';
    case 'after_hours':
      return 'Kapanış Sonrası';
    case 'time_not_supplied':
    default:
      return 'Gün Boyu';
  }
}

/**
 * Formats ISO timestamp to HH:mm in local time
 */
export function formatEventTime(isoString?: string | null): string {
  if (!isoString) return 'Gün Boyu';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Gün Boyu';
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch {
    return 'Gün Boyu';
  }
}

/**
 * Clears the calendar cache and active in-flight requests (useful for tests and manual refreshes)
 */
export function clearCalendarCache(): void {
  log.debug('Önbellek ve in-flight istekler temizlendi');
  calendarCache.clear();
  inFlightCalendarFetches.clear();
}

/**
 * Fetches both earnings and economic events for a given month from Supabase.
 * - Deduplicates concurrent in-flight requests for the same monthKey.
 * - Enforces fail-closed atomic error checking (prevents caching half-loaded partial data).
 * - Binds AbortSignal directly to Supabase client when provided.
 */
export async function fetchMonthlyCalendarEvents(
  year: number,
  month: number,
  options?: { forceRefresh?: boolean; signal?: AbortSignal }
): Promise<MonthlyCalendarData> {
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

  // 1. Check in-flight promise map (deduplicate concurrent requests for the same month)
  const existingInFlight = inFlightCalendarFetches.get(monthKey);
  if (existingInFlight) {
    log.debug(`Eşzamanlı takvim sorgusu birleştirildi (deduplication: ${monthKey})`);
    return existingInFlight;
  }

  // 2. Check in-memory completed cache
  if (!options?.forceRefresh) {
    const cached = calendarCache.get(monthKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      log.debug(`Önbellek isabeti (${monthKey})`);
      return cached.data;
    }
  }

  log.info(`Takvim verileri sorgulanıyor (${monthKey})`);

  // Calculate start & end boundaries of the month (including padding for timezone safety)
  const startDateStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const endDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const startIsoStr = `${startDateStr}T00:00:00.000Z`;
  const endIsoStr = `${endDateStr}T23:59:59.999Z`;

  const fetchPromise = (async (): Promise<MonthlyCalendarData> => {
    const supabase = getSupabaseClient();

    const eventsByDate: Record<string, CalendarEventItem[]> = {};
    const dayIndicators: Record<string, DayIndicator> = {};

    try {
      // 3. Build queries with explicit foreign key hint and abort signals
      let earningsQuery = supabase
        .from('earnings_events')
        .select(`
          id,
          market,
          earnings_date,
          session,
          fiscal_year,
          fiscal_period,
          source_url,
          instrument_id,
          instrument:instruments!earnings_events_instrument_id_fkey (
            id,
            symbol,
            company_name,
            market
          )
        `)
        .gte('earnings_date', startDateStr)
        .lte('earnings_date', endDateStr)
        .eq('is_active', true)
        .order('earnings_date', { ascending: true });

      if (options?.signal) {
        earningsQuery = earningsQuery.abortSignal(options.signal);
      }

      let economicQuery = supabase
        .from('economic_events')
        .select(`
          id,
          name,
          country,
          reference_period,
          scheduled_at,
          source_url
        `)
        .gte('scheduled_at', startIsoStr)
        .lte('scheduled_at', endIsoStr)
        .eq('is_active', true)
        .order('scheduled_at', { ascending: true });

      if (options?.signal) {
        economicQuery = economicQuery.abortSignal(options.signal);
      }

      const [earningsRes, economicRes] = await Promise.all([earningsQuery, economicQuery]);

      // 4. Strict fail-closed verification: Never accept half-empty corrupted responses
      if (earningsRes.error) {
        log.error('Bilanço verileri sorgulanamadı', { monthKey, error: earningsRes.error.message });
        throw createPortfolioOperationError('Bilanço verileri yüklenemedi', earningsRes.error);
      }

      if (economicRes.error) {
        log.error('Ekonomik göstergeler sorgulanamadı', { monthKey, error: economicRes.error.message });
        throw createPortfolioOperationError('Ekonomik göstergeler yüklenemedi', economicRes.error);
      }

      // 5. Process Earnings Events
      if (earningsRes.data) {
        const rawEarnings = earningsRes.data as unknown as RawEarningsRow[];
        for (const row of rawEarnings) {
          const dateKey = row.earnings_date;
          if (!dateKey) continue;

          const instrument = row.instrument;
          const symbol = instrument?.symbol || 'BIST/NASDAQ';
          const companyName = instrument?.company_name || '';
          const periodStr = row.fiscal_year && row.fiscal_period ? `${row.fiscal_year} ${row.fiscal_period}` : (row.fiscal_period || '');
          const instrumentId = instrument?.id || row.instrument_id || null;
          const market = (instrument?.market || row.market || null) as MarketType | null;

          const item: CalendarEventItem = {
            id: `earnings-${row.id}`,
            type: 'earnings',
            dateKey,
            timeLabel: formatTradingSession(row.session),
            title: symbol,
            subtitle: companyName ? `${companyName} • ${periodStr} Bilanço` : `${periodStr} Bilanço Açıklaması`,
            marketOrCountry: market === 'BIST100' ? 'BIST 100 🇹🇷' : 'NASDAQ 100 🇺🇸',
            period: periodStr,
            session: row.session,
            sourceUrl: row.source_url,
            instrumentId,
            market,
          };

          if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
          eventsByDate[dateKey].push(item);

          if (!dayIndicators[dateKey]) {
            dayIndicators[dateKey] = { hasEarnings: false, hasEconomic: false, count: 0 };
          }
          dayIndicators[dateKey].hasEarnings = true;
          dayIndicators[dateKey].count += 1;
        }
      }

      // 6. Process Economic Events
      if (economicRes.data) {
        for (const row of economicRes.data as EconomicEvent[]) {
          if (!row.scheduled_at) continue;
          const dateObj = new Date(row.scheduled_at);
          const dateKey = formatDateKey(dateObj);

          const countryFlag = row.country === 'TR' ? 'Türkiye 🇹🇷' : row.country === 'US' ? 'ABD 🇺🇸' : row.country;
          const timeLabel = formatEventTime(row.scheduled_at);

          const item: CalendarEventItem = {
            id: `economic-${row.id}`,
            type: 'economic',
            dateKey,
            timeLabel,
            title: row.name,
            subtitle: row.reference_period ? `${countryFlag} • ${row.reference_period} Dönemi` : `${countryFlag} Göstergesi`,
            marketOrCountry: countryFlag,
            period: row.reference_period,
            country: row.country,
            sourceUrl: row.source_url,
            instrumentId: null,
            market: null,
          };

          if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
          eventsByDate[dateKey].push(item);

          if (!dayIndicators[dateKey]) {
            dayIndicators[dateKey] = { hasEarnings: false, hasEconomic: false, count: 0 };
          }
          dayIndicators[dateKey].hasEconomic = true;
          dayIndicators[dateKey].count += 1;
        }
      }

      const totalEventsCount = Object.values(eventsByDate).reduce((sum, arr) => sum + arr.length, 0);
      log.info(`Takvim başarıyla yüklendi (${monthKey})`, {
        olaylar: totalEventsCount,
        günler: Object.keys(eventsByDate).length,
      });

      const result: MonthlyCalendarData = {
        year,
        month,
        eventsByDate,
        dayIndicators,
      };

      // 7. Save to cache ONLY on 100% complete success
      calendarCache.set(monthKey, {
        data: result,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      if (error instanceof PortfolioOperationError) {
        throw error;
      }
      log.warn('Takvim verileri yüklenirken hata oluştu', error);
      throw createPortfolioOperationError('Takvim verileri yüklenemedi', error);
    }
  })();

  inFlightCalendarFetches.set(monthKey, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    if (inFlightCalendarFetches.get(monthKey) === fetchPromise) {
      inFlightCalendarFetches.delete(monthKey);
    }
  }
}
