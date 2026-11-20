import { normalizeChartPoints, fetchPortfolioChart } from '@/services/portfolio/portfolio-chart-service';
import { getSupabaseClient } from '@/services/supabase/client';
import { buildChartGeometry, closestChartIndex } from '@/utils/portfolio-chart';
import type { PortfolioChartPoint } from '@/types/portfolio-chart';

jest.mock('@/services/portfolio/portfolio-service', () => ({ subscribePortfolioChanges: jest.fn() }));
jest.mock('@/services/supabase/client', () => ({ getSupabaseClient: jest.fn() }));
const raw = { snapshot_date: '2026-11-01', value: 100, calculation_version: 2, is_partial: false,
  missing_fx: false, missing_market_pnl: false, captured_at: null, source_count: 1 };
const point = (date: string, value: number | null): PortfolioChartPoint => ({ date, value, calculationVersion: 2,
  isPartial: false, missingFx: false, missingMarketPnl: false, capturedAt: null, sourceCount: 3 });

it('keeps missing values distinct from zero and rejects malformed or unordered history', () => {
  expect(normalizeChartPoints([{ ...raw, value: null }])[0].value).toBeNull();
  expect(normalizeChartPoints([{ ...raw, value: 0 }])[0].value).toBe(0);
  for (const changed of [{ value: NaN }, { value: '100' }, { snapshot_date: '2026-02-30' },
    { snapshot_date: '2026-99-01' }, { is_partial: 'false' }, { source_count: 0 }]) {
    expect(() => normalizeChartPoints([{ ...raw, ...changed }])).toThrow(/doğrulanamadı/);
  }
  expect(() => normalizeChartPoints([{ ...raw, source_count: 2 }, { ...raw, source_count: 2 }])).toThrow();
});

it('passes exact chart filters and preserves negative profit', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: [{ ...raw, value: -20 }], error: null });
  jest.mocked(getSupabaseClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getSupabaseClient>);
  expect((await fetchPortfolioChart('portfolio-a', { range: '1M', market: 'BIST100', currency: 'USD', metric: 'PNL' }))[0].value).toBe(-20);
  expect(rpc).toHaveBeenCalledWith('get_portfolio_chart', { p_portfolio_id: 'portfolio-a', p_range: '1M', p_market: 'BIST100', p_currency: 'USD', p_metric: 'PNL' });
  rpc.mockResolvedValue({ data: null, error: { message: 'Network failed' } });
  await expect(fetchPortfolioChart('portfolio-a', { range: 'ALL', market: 'ALL', currency: 'TRY', metric: 'VALUE' })).rejects.toThrow(/Grafik/);
});

it('splits missing days, spaces by date and handles flat, single-point and negative plots', () => {
  const points = [point('2026-11-01', 100), point('2026-11-02', null), point('2026-11-04', 100)];
  const geometry = buildChartGeometry(points, 324, 200, false)!;
  expect(geometry.path.match(/M/g)).toHaveLength(2);
  expect(geometry.coordinates[1].x).toBe(112);
  expect(geometry.coordinates[1].y).toBeNull();
  expect(geometry.maximum).toBeGreaterThan(100);
  expect(geometry.minimum).toBeLessThan(100);
  expect(buildChartGeometry([point('2026-11-01', 0)], 300, 200, true)?.coordinates[0].x).toBe(150);
  expect(buildChartGeometry([point('2026-11-01', -50)], 300, 200, true)?.maximum).toBeGreaterThan(0);
  expect(buildChartGeometry([point('2026-11-01', null)], 300, 200, false)).toBeNull();
  expect(closestChartIndex([12, 112, 312], 130)).toBe(1);
  expect(closestChartIndex([], 0)).toBe(-1);
});
