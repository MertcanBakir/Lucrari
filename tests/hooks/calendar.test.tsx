import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAuth } from '@/context/auth-context';
import { useMonthlyCalendar } from '@/hooks/use-monthly-calendar';
import { usePortfolioCalendarOwnership } from '@/hooks/use-portfolio-calendar-ownership';
import { useWatchlistMembership } from '@/hooks/use-watchlist-membership';
import { fetchMonthlyCalendarEvents } from '@/services/calendar/calendar-service';
import * as portfolio from '@/services/portfolio/portfolio-ownership-service';
import * as watchlist from '@/services/watchlist/watchlist-service';
import { assetId, earnings } from '../ui/fixtures';
import { deferred } from '../helpers/deferred';

jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/services/calendar/calendar-service', () => ({ fetchMonthlyCalendarEvents: jest.fn() }));
jest.mock('@/services/portfolio/portfolio-ownership-service', () => ({
  fetchOwnedPositions: jest.fn(), getOwnershipCacheSnapshot: jest.fn(), subscribeOwnershipChanges: jest.fn(),
}));
jest.mock('@/services/watchlist/watchlist-service', () => ({
  fetchAllWatchedInstrumentIds: jest.fn(), getWatchlistMembershipSnapshot: jest.fn(),
  subscribeWatchlistChanges: jest.fn(),
}));

const auth = jest.mocked(useAuth);
const owned = jest.mocked(portfolio);
const watched = jest.mocked(watchlist);
const loadCalendar = jest.mocked(fetchMonthlyCalendarEvents);
const retryAuth = jest.fn().mockResolvedValue(undefined);
const makeOwnership = (userId: string, id = assetId) => ({
  userId, ownedPositions: new Map([[id, { instrumentId: id, symbol: 'THYAO', quantity: 8 }]]), isStale: false, timestamp: 1, portfolioId: 'portfolio', revision: 1,
});
const makeMembership = (userId: string, id = assetId) => ({
  userId, instrumentIds: new Set([id]), isStale: false, timestamp: 1,
});
const setAuth = (userId: string | null, error: string | null = null) => auth.mockReturnValue({
  isAuthReady: true, userId, error, retryAuth,
} as unknown as ReturnType<typeof useAuth>);

beforeEach(() => {
  jest.clearAllMocks();
  owned.getOwnershipCacheSnapshot.mockReturnValue(null);
  watched.getWatchlistMembershipSnapshot.mockReturnValue(null);
  owned.subscribeOwnershipChanges.mockReturnValue(jest.fn());
  watched.subscribeWatchlistChanges.mockReturnValue(jest.fn());
  setAuth('account-a');
});

it('cancels an old month request, reads visible-day events and retries a failed refresh', async () => {
  const august = { year: 2026, month: 7, eventsByDate: { [earnings.dateKey]: [earnings] }, dayIndicators: {} };
  const july = deferred<typeof august>();
  loadCalendar.mockReturnValueOnce(july.promise).mockResolvedValueOnce(august)
    .mockRejectedValueOnce(new Error('calendar offline')).mockResolvedValueOnce(august);
  const { result, rerender, unmount } = renderHook(({ month }: { month: number }) => useMonthlyCalendar(2026, month), {
    initialProps: { month: 6 },
  });
  expect(result.current.isLoading).toBe(true);
  const firstSignal = loadCalendar.mock.calls[0][2]?.signal;
  rerender({ month: 7 });
  expect(firstSignal?.aborted).toBe(true);
  await act(async () => july.resolve({ ...august, month: 6, eventsByDate: {} }));
  expect(result.current.getEventsForDate(new Date(2026, 7, 31))).toEqual([earnings]);
  expect(result.current.getEventsForDate(new Date(2026, 7, 30))).toEqual([]);
  await act(() => result.current.refetch());
  expect(result.current.error).toBe('calendar offline');
  expect(result.current.hasLoadedSuccessfully).toBe(true);
  await act(() => result.current.refetch());
  expect(loadCalendar).toHaveBeenLastCalledWith(2026, 7, expect.objectContaining({ forceRefresh: true }));
  expect(result.current.error).toBeNull();
  const lastSignal = loadCalendar.mock.lastCall?.[2]?.signal;
  unmount();
  expect(lastSignal?.aborted).toBe(true);
});

it('isolates account changes and late snapshots in both calendar filter hooks', async () => {
  const oldOwnership = deferred<ReturnType<typeof makeOwnership>>();
  const oldMembership = deferred<ReturnType<typeof makeMembership>>();
  const unsubscribeOwnership = jest.fn();
  const unsubscribeMembership = jest.fn();
  owned.subscribeOwnershipChanges.mockReturnValue(unsubscribeOwnership);
  watched.subscribeWatchlistChanges.mockReturnValue(unsubscribeMembership);
  owned.fetchOwnedPositions.mockReturnValueOnce(oldOwnership.promise)
    .mockResolvedValueOnce(makeOwnership('account-b', 'current-asset'));
  watched.fetchAllWatchedInstrumentIds.mockReturnValueOnce(oldMembership.promise)
    .mockResolvedValueOnce(makeMembership('account-b', 'current-asset'));
  const hook = renderHook(() => ({ ownership: usePortfolioCalendarOwnership(), membership: useWatchlistMembership() }));
  setAuth('account-b');
  hook.rerender(undefined);
  await waitFor(() => expect(hook.result.current.membership.watchedCount).toBe(1));
  await act(async () => {
    oldOwnership.resolve(makeOwnership('account-a'));
    oldMembership.resolve(makeMembership('account-a'));
  });
  expect([...hook.result.current.ownership.ownedPositions.keys()]).toEqual(['current-asset']);
  expect(hook.result.current.membership.watchedInstrumentIds).toEqual(new Set(['current-asset']));
  const publishOwnership = owned.subscribeOwnershipChanges.mock.calls[0][0];
  const publishMembership = watched.subscribeWatchlistChanges.mock.calls[0][0];
  act(() => {
    publishOwnership(makeOwnership('account-a'));
    publishMembership({ userId: 'account-a' } as Parameters<typeof publishMembership>[0]);
  });
  expect(hook.result.current.ownership.ownedPositions.has(assetId)).toBe(false);
  watched.getWatchlistMembershipSnapshot.mockImplementation((id) =>
    id === 'account-b' ? makeMembership(id, 'new-asset') : null);
  act(() => {
    publishOwnership(makeOwnership('account-b', 'new-asset'));
    publishMembership({ userId: 'account-b' } as Parameters<typeof publishMembership>[0]);
  });
  expect(hook.result.current.ownership.ownedPositions.has('new-asset')).toBe(true);
  expect(hook.result.current.membership.watchedInstrumentIds).toEqual(new Set(['new-asset']));
  hook.unmount();
  expect(unsubscribeOwnership).toHaveBeenCalledTimes(1);
  expect(unsubscribeMembership).toHaveBeenCalledTimes(1);
});

it('reports load failures and requests authentication before a signed-out retry', async () => {
  owned.fetchOwnedPositions.mockRejectedValueOnce(new Error('positions offline'));
  watched.fetchAllWatchedInstrumentIds.mockRejectedValueOnce('offline');
  const hook = renderHook(() => ({ ownership: usePortfolioCalendarOwnership(), membership: useWatchlistMembership() }));
  await waitFor(() => expect(hook.result.current.ownership.error?.message).toBe('positions offline'));
  expect(hook.result.current.membership.error?.message).toBe('İzleme listesi yüklenemedi');
  setAuth(null, 'Session expired');
  hook.rerender(undefined);
  await act(() => hook.result.current.ownership.refetch());
  await act(() => hook.result.current.membership.refetch());
  expect(retryAuth).toHaveBeenCalledTimes(2);
  expect(hook.result.current.membership.watchedCount).toBe(0);
});

it('shows cached calendar membership and keeps refresh errors scoped to the active account', async () => {
  owned.getOwnershipCacheSnapshot.mockReturnValue({ ...makeOwnership('account-a'), timestamp: Date.now() });
  watched.getWatchlistMembershipSnapshot.mockReturnValue({ ...makeMembership('account-a'), timestamp: Date.now() });
  owned.fetchOwnedPositions.mockResolvedValueOnce(makeOwnership('account-a')).mockRejectedValueOnce('offline');
  watched.fetchAllWatchedInstrumentIds.mockResolvedValueOnce(makeMembership('account-a')).mockRejectedValueOnce(new Error('offline'));
  const hook = renderHook(() => ({ ownership: usePortfolioCalendarOwnership(), membership: useWatchlistMembership() }));
  expect(hook.result.current.ownership.ownedPositions.has(assetId)).toBe(true);
  expect(hook.result.current.membership.watchedInstrumentIds.has(assetId)).toBe(true);
  await waitFor(() => expect(watched.fetchAllWatchedInstrumentIds).toHaveBeenCalledWith(false));
  expect(owned.fetchOwnedPositions).toHaveBeenCalledWith({ forceRefresh: false });
  await act(async () => {
    await Promise.all([hook.result.current.ownership.refetch(), hook.result.current.membership.refetch()]);
  });
  expect(hook.result.current.ownership.error?.message).toBe('Açık pozisyonlar yüklenemedi');
  expect(hook.result.current.membership.error?.message).toBe('offline');
});

it('ignores account data notifications when no corresponding membership snapshot exists', async () => {
  owned.fetchOwnedPositions.mockResolvedValueOnce(makeOwnership('account-a'));
  watched.fetchAllWatchedInstrumentIds.mockResolvedValueOnce(makeMembership('account-a'));
  const hook = renderHook(() => useWatchlistMembership());
  await waitFor(() => expect(hook.result.current.watchedCount).toBe(1));
  const publish = watched.subscribeWatchlistChanges.mock.calls[0][0];
  act(() => publish({ userId: 'account-a' } as Parameters<typeof publish>[0]));
  expect(hook.result.current.watchedCount).toBe(1);
  hook.unmount();
  act(() => publish({ userId: 'account-a' } as Parameters<typeof publish>[0]));
  expect(hook.result.current.watchedCount).toBe(1);
});

it('keeps a new month active when a superseded request fails and normalizes non-Error failures', async () => {
  const august = { year: 2026, month: 7, eventsByDate: {}, dayIndicators: {} };
  const older = deferred<typeof august>();
  loadCalendar.mockReturnValueOnce(older.promise).mockResolvedValueOnce(august).mockRejectedValueOnce('offline');
  const hook = renderHook(({ month }: { month: number }) => useMonthlyCalendar(2026, month), { initialProps: { month: 6 } });
  hook.rerender({ month: 7 });
  await act(async () => older.reject(new Error('obsolete')));
  expect(hook.result.current.error).toBeNull();
  await act(() => hook.result.current.refetch());
  expect(hook.result.current.error).toBe('Takvim verileri yüklenemedi');
});
