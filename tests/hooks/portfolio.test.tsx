import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAuth } from '@/context/auth-context';
import { usePortfolio } from '@/hooks/use-portfolio';
import { SEARCH_DEBOUNCE_MS, usePortfolioActivity } from '@/hooks/use-portfolio-activity';
import { ensureAnonymousSession } from '@/services/auth/auth-service';
import { fetchPortfolioActivityPage } from '@/services/portfolio/portfolio-activity-service';
import * as portfolioService from '@/services/portfolio/portfolio-service';
import { activity, date, position } from '../ui/fixtures';
import { deferred } from '../helpers/deferred';

jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/services/auth/auth-service', () => ({ ensureAnonymousSession: jest.fn() }));
jest.mock('@/services/portfolio/portfolio-service', () => ({
  ensureDefaultPortfolio: jest.fn(), fetchPortfolioDataCombined: jest.fn(), subscribePortfolioChanges: jest.fn(),
  setPortfolioCash: jest.fn(), recordTransaction: jest.fn(),
  reverseTransaction: jest.fn(), resetMyInvestments: jest.fn(),
}));
jest.mock('@/services/portfolio/portfolio-activity-service', () => ({
  PORTFOLIO_ACTIVITY_PAGE_SIZE: 20, fetchPortfolioActivityPage: jest.fn(),
}));

const portfolio = jest.mocked(portfolioService);
const fetchActivity = jest.mocked(fetchPortfolioActivityPage);
const makePortfolio = (id: string) => ({ id, name: id } as Awaited<ReturnType<typeof portfolio.ensureDefaultPortfolio>>);
const combined = {
  positions: [position], cash: { tryBalance: 150, usdBalance: 0 }, realizedPnl: { tryPnl: 0, usdPnl: 0 },
  fxRateInfo: { rate: 30, isAvailable: true, isStale: false, rateAt: date },
} as Awaited<ReturnType<typeof portfolio.fetchPortfolioDataCombined>>;
const cursor = { beforeOccurredAt: date, beforeCreatedAt: date, beforeSourceKind: 'TRANSACTION', beforeActivityId: activity.activityId } as const;
const page = { items: [activity], nextCursor: cursor, hasMore: true, isStale: false, timestamp: 1 };
const setUser = (id: string | null) => {
  const user = id ? { id } : null;
  jest.mocked(useAuth).mockReturnValue({ user, isAuthReady: true, error: null } as ReturnType<typeof useAuth>);
  jest.mocked(ensureAnonymousSession).mockResolvedValue({ user, error: null } as Awaited<ReturnType<typeof ensureAnonymousSession>>);
};

beforeEach(() => {
  jest.resetAllMocks();
  setUser('account-a');
  portfolio.subscribePortfolioChanges.mockReturnValue(jest.fn());
  portfolio.ensureDefaultPortfolio.mockResolvedValue(makePortfolio('portfolio-a'));
  portfolio.fetchPortfolioDataCombined.mockResolvedValue(combined);
  fetchActivity.mockResolvedValue(page);
});

afterEach(() => jest.useRealTimers());

it('delegates portfolio writes with the current ID and refreshes on portfolio mutations', async () => {
  const hook = renderHook(() => usePortfolio());
  await waitFor(() => expect(hook.result.current.positions).toEqual([position]));
  expect(hook.result.current.cash?.tryBalance).toBe(150);
  expect(hook.result.current.usdTryRate).toBe(30);
  const order = { instrumentId: position.instrument_id, transactionType: 'BUY', quantity: 1, unitPrice: 100, currency: 'TRY' } as const;
  await act(async () => {
    await hook.result.current.updateCash(150, 0);
    await hook.result.current.addTransaction(order);
  });
  expect(portfolio.setPortfolioCash).toHaveBeenCalledWith({ portfolioId: 'portfolio-a', tryBalance: 150, usdBalance: 0 });
  expect(portfolio.recordTransaction).toHaveBeenCalledWith({ ...order, portfolioId: 'portfolio-a' });
  const reverseTrade = { transactionId: 'transaction-a', reason: 'Duplicate', clientRequestId: 'reverse-trade' };
  const reset = { clientRequestId: 'reset-a' };
  await act(async () => {
    await hook.result.current.reverseTransaction(reverseTrade);
    await hook.result.current.resetInvestments(reset);
  });
  expect(portfolio.reverseTransaction).toHaveBeenCalledWith(reverseTrade);
  expect(portfolio.resetMyInvestments).toHaveBeenCalledWith(reset);
  const publish = portfolio.subscribePortfolioChanges.mock.calls[0][0];
  await act(async () => publish());
  expect(portfolio.fetchPortfolioDataCombined).toHaveBeenLastCalledWith('portfolio-a', { forceRefresh: true });
  portfolio.fetchPortfolioDataCombined.mockRejectedValueOnce(new Error('fetch failed'));
  await act(() => hook.result.current.refreshPortfolio());
  expect(hook.result.current.positions).toEqual([position]);
  expect(hook.result.current.error).toMatch(/İnternet bağlantısı/);
  expect(hook.result.current.isStale).toBe(true);
});

it('ignores a late response from the previous account', async () => {
  const older = deferred<typeof combined>();
  portfolio.fetchPortfolioDataCombined.mockReturnValueOnce(older.promise)
    .mockResolvedValueOnce({ ...combined, positions: [] });
  const hook = renderHook(() => usePortfolio());
  await waitFor(() => expect(portfolio.fetchPortfolioDataCombined).toHaveBeenCalled());
  setUser('account-b');
  portfolio.ensureDefaultPortfolio.mockResolvedValue(makePortfolio('portfolio-b'));
  hook.rerender(undefined);
  await waitFor(() => expect(hook.result.current.portfolio?.id).toBe('portfolio-b'));
  await act(async () => older.resolve(combined));
  expect(hook.result.current.positions).toEqual([]);
  expect(hook.result.current.isLoading).toBe(false);
});

it('does not allow portfolio mutations before a valid portfolio is resolved', async () => {
  setUser(null);
  const hook = renderHook(() => usePortfolio());
  await waitFor(() => expect(hook.result.current.error).toMatch(/oturumu doğrulanamadı/));
  await expect(hook.result.current.updateCash(0, 0)).rejects.toThrow('Aktif portföy');
  await expect(hook.result.current.addTransaction({ instrumentId: position.instrument_id, transactionType: 'BUY',
    quantity: 1, unitPrice: 1, currency: 'TRY' })).rejects.toThrow('Aktif portföy');
});

it('debounces activity search, retries pagination, and preserves stale items after a refresh failure', async () => {
  jest.useFakeTimers();
  const hook = renderHook(() => usePortfolioActivity({ customPortfolioId: activity.portfolioId }));
  await waitFor(() => expect(hook.result.current.items).toEqual([activity]));
  fetchActivity.mockRejectedValueOnce(new Error('page unavailable')).mockResolvedValueOnce({
    ...page, items: [activity, { ...activity, activityId: 'second', compositeKey: 'TRANSACTION:second' }],
    hasMore: false, nextCursor: null,
  });
  await act(() => hook.result.current.loadMore());
  expect(hook.result.current.loadMoreError).toBe('page unavailable');
  expect(fetchActivity).toHaveBeenLastCalledWith(expect.objectContaining({ cursor }));
  await act(() => hook.result.current.retryLoadMore());
  expect(hook.result.current.items.map((item) => item.activityId)).toEqual([activity.activityId, 'second']);
  fetchActivity.mockRejectedValueOnce(new Error('refresh unavailable'));
  await act(() => hook.result.current.refresh());
  expect(hook.result.current.viewState).toBe('stale_data');
  act(() => hook.result.current.setFilter('SELL'));
  await act(async () => {});
  act(() => hook.result.current.setSearchQuery(' THYAO '));
  await act(async () => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
  expect(fetchActivity).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'THYAO', filter: 'SELL' }));
  const publish = portfolio.subscribePortfolioChanges.mock.lastCall?.[0];
  await act(async () => publish?.());
  expect(fetchActivity).toHaveBeenLastCalledWith(expect.objectContaining({ forceRefresh: true, search: 'THYAO' }));
});

it('separates portfolio lookup errors from activity errors and retries each independently', async () => {
  portfolio.ensureDefaultPortfolio.mockRejectedValueOnce('offline');
  fetchActivity.mockRejectedValueOnce(new Error('activity unavailable'));
  const hook = renderHook(() => usePortfolioActivity());
  await waitFor(() => expect(hook.result.current.portfolioResolutionError).toMatch(/Portföy bilgisi/));
  await act(() => hook.result.current.retryPortfolioResolution());
  await waitFor(() => expect(hook.result.current.initialError).toBe('activity unavailable'));
  await act(() => hook.result.current.refresh());
  expect(hook.result.current.items).toEqual([activity]);
  expect(hook.result.current.initialError).toBeNull();
  setUser(null);
  hook.rerender(undefined);
  expect(hook.result.current.items).toEqual([]);
  expect(hook.result.current.portfolioId).toBeNull();
  expect(hook.result.current.viewState).toBe('auth_failed');
});

it.each([['Network unavailable', /İnternet/], ['timeout', /İnternet/], ['JWT expired', /oturumu/],
  ['auth unavailable', /oturumu/], ['oturum yok', /oturumu/], ['session missing', /oturumu/],
  ['unknown failure', /unknown failure/]] as const)('handles an initial portfolio error %s without stale data', async (error, message) => {
  portfolio.fetchPortfolioDataCombined.mockRejectedValueOnce(error);
  const hook = renderHook(() => usePortfolio());
  await waitFor(() => expect(hook.result.current.error).toMatch(message));
  expect(hook.result.current.isStale).toBe(false);
});

it('flags a position price as stale even with a current exchange rate', async () => {
  portfolio.fetchPortfolioDataCombined.mockResolvedValueOnce({
    ...combined, positions: [{ ...position, price_is_stale: true }],
  });
  const hook = renderHook(() => usePortfolio());
  await waitFor(() => expect(hook.result.current.isStale).toBe(true));
  expect(hook.result.current.error).toBeNull();
});

it('does not fetch combined data when a portfolio lookup resolves after unmount', async () => {
  const request = deferred<Awaited<ReturnType<typeof portfolio.ensureDefaultPortfolio>>>();
  portfolio.ensureDefaultPortfolio.mockReturnValueOnce(request.promise);
  const hook = renderHook(() => usePortfolio());
  await waitFor(() => expect(portfolio.ensureDefaultPortfolio).toHaveBeenCalled());
  hook.unmount();
  await act(async () => request.resolve(makePortfolio('unmounted')));
  expect(portfolio.fetchPortfolioDataCombined).not.toHaveBeenCalled();
});

it('reloads positions and valuation after a successful trade notification', async () => {
  const hook = renderHook(() => usePortfolio());
  await waitFor(() => expect(hook.result.current.positions).toEqual([position]));
  const updated = { ...position, quantity: 10, remaining_cost_basis: 920, average_cost: 92, market_value: 1000, unrealized_pnl: 80 };
  portfolio.fetchPortfolioDataCombined.mockResolvedValue({ ...combined, positions: [updated] });
  portfolio.recordTransaction.mockImplementationOnce(async () => {
    const publish = portfolio.subscribePortfolioChanges.mock.calls[0][0];
    publish();
    return { transaction_id: 'trade-a', was_replayed: false, current_quantity: '10', remaining_cost_basis: '920', realized_pnl: '0' };
  });
  await act(async () => {
    await hook.result.current.addTransaction({ instrumentId: position.instrument_id, transactionType: 'BUY', quantity: 2,
      unitPrice: 100, currency: 'TRY', clientRequestId: 'trade-request' });
  });
  await waitFor(() => expect(hook.result.current.positions[0].quantity).toBe(10));
  expect(hook.result.current.stats.positionsMarketValueTry).toBe(1000);
  expect(hook.result.current.stats.totalCostTry).toBe(920);
  expect(portfolio.recordTransaction).toHaveBeenCalledWith(expect.objectContaining({ portfolioId: 'portfolio-a', quantity: 2, clientRequestId: 'trade-request' }));
});
