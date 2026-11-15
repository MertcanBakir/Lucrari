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
  initializePortfolioCashAccounts: jest.fn(), recordTransaction: jest.fn(), recordCashFlow: jest.fn(),
  reverseTransaction: jest.fn(), reverseCashFlow: jest.fn(), resetMyInvestments: jest.fn(),
}));
jest.mock('@/services/portfolio/portfolio-activity-service', () => ({
  PORTFOLIO_ACTIVITY_PAGE_SIZE: 20, fetchPortfolioActivityPage: jest.fn(),
}));

const portfolio = jest.mocked(portfolioService);
const fetchActivity = jest.mocked(fetchPortfolioActivityPage);
const makePortfolio = (id: string) => ({ id, name: id } as Awaited<ReturnType<typeof portfolio.ensureDefaultPortfolio>>);
const combined = {
  positions: [position], cashState: { portfolioId: 'portfolio-a', isInitialized: true,
    balances: [{ currency: 'TRY', currentBalance: 150, openingBalance: 150, initializedAt: date },
      { currency: 'USD', currentBalance: 0, openingBalance: 0, initializedAt: date }] },
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
  expect(hook.result.current.availableCashTry).toBe(150);
  expect(hook.result.current.usdTryRate).toBe(30);
  const order = { instrumentId: position.instrument_id, transactionType: 'BUY', quantity: 1, unitPrice: 100, currency: 'TRY' } as const;
  const flow = { flowType: 'DEPOSIT', amount: 15, currency: 'TRY' } as const;
  await act(async () => {
    await hook.result.current.initializeCashAccounts(150, 0, 'setup-intent');
    await hook.result.current.addTransaction(order);
    await hook.result.current.addCashFlow(flow);
  });
  expect(portfolio.initializePortfolioCashAccounts).toHaveBeenCalledWith(expect.objectContaining({ portfolioId: 'portfolio-a', clientRequestId: 'setup-intent' }));
  expect(portfolio.recordTransaction).toHaveBeenCalledWith({ ...order, portfolioId: 'portfolio-a' });
  expect(portfolio.recordCashFlow).toHaveBeenCalledWith({ ...flow, portfolioId: 'portfolio-a' });
  const reverseTrade = { transactionId: 'transaction-a', reason: 'Duplicate', clientRequestId: 'reverse-trade' };
  const reverseFlow = { cashFlowId: 'cash-a', reason: 'Duplicate', clientRequestId: 'reverse-cash' };
  const reset = { clientRequestId: 'reset-a' };
  await act(async () => {
    await hook.result.current.reverseTransaction(reverseTrade);
    await hook.result.current.reverseCashFlow(reverseFlow);
    await hook.result.current.resetInvestments(reset);
  });
  expect(portfolio.reverseTransaction).toHaveBeenCalledWith(reverseTrade);
  expect(portfolio.reverseCashFlow).toHaveBeenCalledWith(reverseFlow);
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
  await expect(hook.result.current.initializeCashAccounts(0, 0)).rejects.toThrow('Aktif portföy');
  await expect(hook.result.current.addCashFlow({ flowType: 'DEPOSIT', amount: 1, currency: 'TRY' })).rejects.toThrow('Aktif portföy');
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
