import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAuth } from '@/context/auth-context';
import { useNotificationPortfolio } from '@/hooks/use-notification-portfolio';
import { fetchNotificationPortfolioSummary } from '@/services/notifications/portfolio-summary-service';
import { deferred } from '../helpers/deferred';
jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/services/notifications/portfolio-summary-service', () => ({ fetchNotificationPortfolioSummary: jest.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
const target = { portfolio_id: id, snapshot_id: id, currency: 'USD', valuation_date: '2026-11-19' };
const summary = { date: '2026-11-19', currency: 'USD' as const, dailyPnl: 0, capturedAt: null };
const auth = (userId: string | null) => jest.mocked(useAuth).mockReturnValue({ userId, isAuthReady: Boolean(userId) } as ReturnType<typeof useAuth>);
beforeEach(() => { jest.clearAllMocks(); auth('a'); jest.mocked(fetchNotificationPortfolioSummary).mockReset().mockResolvedValue(summary); });
it('waits for auth, rejects invalid targets, retries errors and clears old account data', async () => {
  auth(null); const hook = renderHook((p: Record<string, unknown>) => useNotificationPortfolio(p), { initialProps: target as Record<string, unknown> });
  expect(fetchNotificationPortfolioSummary).not.toHaveBeenCalled();
  auth('a'); hook.rerender({}); expect(hook.result.current.error).toMatch(/doğrulanamadı/);
  jest.mocked(fetchNotificationPortfolioSummary).mockRejectedValueOnce(Error('forbidden'));
  hook.rerender(target); await waitFor(() => expect(hook.result.current.error).toMatch(/erişilemiyor/));
  act(() => hook.result.current.retry()); await waitFor(() => expect(hook.result.current.data).toEqual(summary));
  auth('b'); hook.rerender(target); expect(hook.result.current.data).toBeNull();
  await waitFor(() => expect(hook.result.current.data).toEqual(summary));
});
it('ignores late data and late errors after unmount', async () => {
  const pending = deferred<typeof summary>(); jest.mocked(fetchNotificationPortfolioSummary).mockReturnValueOnce(pending.promise);
  const hook = renderHook(() => useNotificationPortfolio(target)); hook.unmount(); await act(async () => pending.resolve(summary));
  const failure = deferred<typeof summary>(); jest.mocked(fetchNotificationPortfolioSummary).mockReturnValueOnce(failure.promise);
  const second = renderHook(() => useNotificationPortfolio(target)); second.unmount(); await act(async () => failure.reject(Error('offline')));
});
