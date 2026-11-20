import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAuth } from '@/context/auth-context';
import { clearPortfolioChartCache, usePortfolioChart } from '@/hooks/use-portfolio-chart';
import { fetchPortfolioChart, refreshPortfolioChartSnapshot } from '@/services/portfolio/portfolio-chart-service';
import { ensureDefaultPortfolio } from '@/services/portfolio/portfolio-service';
import { deferred } from '../helpers/deferred';
import type { ChartQuery, PortfolioChartPoint } from '@/types/portfolio-chart';

jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/services/portfolio/portfolio-service', () => ({ ensureDefaultPortfolio: jest.fn(), subscribePortfolioChanges: jest.fn(() => jest.fn()) }));
jest.mock('@/services/portfolio/portfolio-chart-service', () => ({ fetchPortfolioChart: jest.fn(), refreshPortfolioChartSnapshot: jest.fn() }));
const query: ChartQuery = { range: '1M', market: 'ALL', currency: 'TRY', metric: 'VALUE' };
const points: PortfolioChartPoint[] = [{ date: '2026-11-01', value: 100, calculationVersion: 2, isPartial: false,
  missingFx: false, missingMarketPnl: false, capturedAt: null, sourceCount: 1 }];
const user = (userId: string) => jest.mocked(useAuth).mockReturnValue({ userId, isAuthReady: true } as ReturnType<typeof useAuth>);
beforeEach(() => {
  jest.clearAllMocks(); clearPortfolioChartCache(); user('a');
  jest.mocked(ensureDefaultPortfolio).mockResolvedValue({ id: 'p-a', name: 'Ana Portföy' } as Awaited<ReturnType<typeof ensureDefaultPortfolio>>);
  jest.mocked(refreshPortfolioChartSnapshot).mockResolvedValue(undefined);
  jest.mocked(fetchPortfolioChart).mockResolvedValue(points);
});
it('hides the previous filter immediately and discards late responses across accounts', async () => {
  const pending = deferred<PortfolioChartPoint[]>();
  jest.mocked(fetchPortfolioChart).mockReturnValueOnce(pending.promise);
  const hook = renderHook((props: { q: ChartQuery }) => usePortfolioChart(props.q), { initialProps: { q: query } });
  await waitFor(() => expect(fetchPortfolioChart).toHaveBeenCalledTimes(1));
  user('b');
  hook.rerender({ q: { ...query, currency: 'USD' } });
  expect(hook.result.current.points).toEqual([]);
  await waitFor(() => expect(hook.result.current.points).toEqual(points));
  await act(async () => pending.resolve([{ ...points[0], value: 999 }]));
  expect(hook.result.current.points[0].value).toBe(100);
  hook.rerender({ q: { ...query, market: 'CRYPTO' } });
  expect(hook.result.current.points).toEqual([]);
});
it('retains the exact chart on refresh failure and retries successfully', async () => {
  const hook = renderHook(() => usePortfolioChart(query));
  await waitFor(() => expect(hook.result.current.points).toEqual(points));
  jest.mocked(fetchPortfolioChart).mockRejectedValueOnce(new Error('Network failed'));
  act(() => hook.result.current.refresh());
  await waitFor(() => expect(hook.result.current.isStale).toBe(true));
  expect(hook.result.current.points).toEqual(points);
  act(() => hook.result.current.refresh());
  await waitFor(() => expect(hook.result.current.error).toBeNull());
});
it('shows existing history when the current snapshot cannot be captured', async () => {
  jest.mocked(refreshPortfolioChartSnapshot).mockRejectedValueOnce(new Error('Price missing'));
  const hook = renderHook(() => usePortfolioChart(query));
  await waitFor(() => expect(hook.result.current.points).toEqual(points));
  expect(hook.result.current.isStale).toBe(true);
});
