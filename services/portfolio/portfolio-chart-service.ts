import { subscribePortfolioChanges } from './portfolio-service';
import { getSupabaseClient } from '@/services/supabase/client';
import { createPortfolioOperationError } from '@/utils/portfolio-errors';
import type { ChartQuery, PortfolioChartPoint } from '@/types/portfolio-chart';

export function normalizeChartPoints(rows: unknown): PortfolioChartPoint[] {
  if (!Array.isArray(rows) || rows.length > 600) throw createPortfolioOperationError('Grafik verisi doğrulanamadı.');
  let previous = '';
  return rows.map(row => {
    const parsedDate = typeof row?.snapshot_date === 'string' ? new Date(`${row.snapshot_date}T12:00:00Z`) : null;
    const validDate = typeof row?.snapshot_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.snapshot_date) &&
      parsedDate !== null && Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === row.snapshot_date;
    if (!validDate || row.snapshot_date <= previous ||
      (row.value !== null && (typeof row.value !== 'number' || !Number.isFinite(row.value))) ||
      !Number.isInteger(row.calculation_version) || row.calculation_version < 1 ||
      !Number.isInteger(row.source_count) || row.source_count < rows.length ||
      ['is_partial', 'missing_fx', 'missing_market_pnl'].some(key => typeof row[key] !== 'boolean') ||
      (row.captured_at !== null && (typeof row.captured_at !== 'string' || !Number.isFinite(Date.parse(row.captured_at))))) {
      throw createPortfolioOperationError('Grafik verisi doğrulanamadı.');
    }
    previous = row.snapshot_date;
    return { date: row.snapshot_date, value: row.value, calculationVersion: row.calculation_version,
      isPartial: row.is_partial, missingFx: row.missing_fx, missingMarketPnl: row.missing_market_pnl,
      capturedAt: row.captured_at, sourceCount: row.source_count };
  });
}

export async function fetchPortfolioChart(portfolioId: string, query: ChartQuery): Promise<PortfolioChartPoint[]> {
  const { data, error } = await getSupabaseClient().rpc('get_portfolio_chart', {
    p_portfolio_id: portfolioId, p_range: query.range, p_market: query.market,
    p_currency: query.currency, p_metric: query.metric,
  });
  if (error) throw createPortfolioOperationError('Grafik yüklenemedi', error);
  return normalizeChartPoints(data);
}

const captured = new Map<string, number>();
const inFlightCaptures = new Map<string, Promise<void>>();
let captureRevision = 0;
subscribePortfolioChanges(() => { captureRevision++; captured.clear(); inFlightCaptures.clear(); });

export async function refreshPortfolioChartSnapshot(portfolioId: string, force = false): Promise<void> {
  if (!force && Date.now() - (captured.get(portfolioId) ?? 0) < 60_000) return;
  const existing = inFlightCaptures.get(portfolioId);
  if (existing) return existing;
  const revision = captureRevision;
  const task = (async () => {
    const { error } = await getSupabaseClient().rpc('refresh_portfolio_chart', { p_portfolio_id: portfolioId });
    if (error) throw createPortfolioOperationError('Güncel portföy değeri kaydedilemedi', error);
    if (revision === captureRevision) {
      if (captured.size >= 24) captured.delete(captured.keys().next().value!);
      captured.set(portfolioId, Date.now());
    }
  })();
  inFlightCaptures.set(portfolioId, task);
  try { await task; } finally { if (inFlightCaptures.get(portfolioId) === task) inFlightCaptures.delete(portfolioId); }
}
