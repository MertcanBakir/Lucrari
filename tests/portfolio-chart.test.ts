import { subscribePortfolioChanges } from '@/services/portfolio/portfolio-service';
import { deferred } from './helpers/deferred';
import { normalizeChartPoints, fetchPortfolioChart, refreshPortfolioChartSnapshot } from '@/services/portfolio/portfolio-chart-service';
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

it.each([
  null, {}, Array(601).fill(raw), [null],
  [{ ...raw, snapshot_date: 123 }], [{ ...raw, snapshot_date: 'not-a-date' }],
  [{ ...raw, calculation_version: 0 }], [{ ...raw, calculation_version: 1.5 }],
  [{ ...raw, source_count: 1.5 }], [{ ...raw, missing_fx: null }],
  [{ ...raw, missing_market_pnl: 'false' }], [{ ...raw, captured_at: 123 }],
  [{ ...raw, captured_at: 'invalid' }], [{ ...raw, value: Infinity }],
])('rejects unsupported chart history %p', (rows) => {
  expect(() => normalizeChartPoints(rows)).toThrow(/doğrulanamadı/);
});

it('accepts ordered history with timestamps, zero and unavailable valuations', () => {
  expect(normalizeChartPoints([
    { ...raw, source_count: 2, value: 0, captured_at: '2026-11-01T12:00:00Z' },
    { ...raw, source_count: 2, snapshot_date: '2026-11-02', value: null },
  ])).toEqual([
    expect.objectContaining({ date: '2026-11-01', value: 0, capturedAt: '2026-11-01T12:00:00Z' }),
    expect.objectContaining({ date: '2026-11-02', value: null }),
  ]);
});

describe('chart snapshot refresh lifecycle', () => {
  const rpc = jest.fn();
  const invalidate = jest.mocked(subscribePortfolioChanges).mock.calls[0][0];

  beforeEach(() => {
    invalidate();
    rpc.mockReset().mockResolvedValue({ error: null });
    jest.mocked(getSupabaseClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getSupabaseClient>);
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });
  afterEach(() => jest.restoreAllMocks());

  it('shares in-flight captures, respects TTL and allows explicit forced refreshes', async () => {
    const pending = deferred<{ error: null }>();
    rpc.mockReturnValueOnce(pending.promise);
    const first = refreshPortfolioChartSnapshot('portfolio');
    const second = refreshPortfolioChartSnapshot('portfolio', true);
    expect(rpc).toHaveBeenCalledTimes(1);
    pending.resolve({ error: null });
    await Promise.all([first, second]);
    await refreshPortfolioChartSnapshot('portfolio');
    expect(rpc).toHaveBeenCalledTimes(1);
    await refreshPortfolioChartSnapshot('portfolio', true);
    expect(rpc).toHaveBeenCalledTimes(2);
    jest.mocked(Date.now).mockReturnValue(1_060_000);
    await refreshPortfolioChartSnapshot('portfolio');
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenLastCalledWith('refresh_portfolio_chart', { p_portfolio_id: 'portfolio' });
  });

  it('releases failed captures and does not cache an obsolete revision', async () => {
    rpc.mockResolvedValueOnce({ error: { message: 'offline' } });
    await expect(refreshPortfolioChartSnapshot('portfolio')).rejects.toThrow(/kaydedilemedi/);
    const old = deferred<{ error: null }>();
    const current = deferred<{ error: null }>();
    rpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const first = refreshPortfolioChartSnapshot('portfolio');
    invalidate();
    const second = refreshPortfolioChartSnapshot('portfolio');
    old.resolve({ error: null });
    await first;
    const shared = refreshPortfolioChartSnapshot('portfolio', true);
    expect(rpc).toHaveBeenCalledTimes(3);
    current.resolve({ error: null });
    await Promise.all([second, shared]);
    await refreshPortfolioChartSnapshot('portfolio');
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('bounds the captured portfolio cache and refreshes evicted entries', async () => {
    for (let index = 0; index < 25; index++) await refreshPortfolioChartSnapshot(`portfolio-${index}`);
    await refreshPortfolioChartSnapshot('portfolio-24');
    expect(rpc).toHaveBeenCalledTimes(25);
    await refreshPortfolioChartSnapshot('portfolio-0');
    expect(rpc).toHaveBeenCalledTimes(26);
  });
});
