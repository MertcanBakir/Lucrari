import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAuth } from '@/context/auth-context';
import { useWatchlist } from '@/hooks/use-watchlist';
import * as watchlistService from '@/services/watchlist/watchlist-service';
import { createWatchlistPageOutOfBoundsError } from '@/utils/watchlist-errors';
import { assetId, watched } from '../ui/fixtures';
import { deferred } from '../helpers/deferred';

jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/services/watchlist/watchlist-service', () => ({
  fetchWatchlistPage: jest.fn(), fetchAllWatchedInstrumentIds: jest.fn(), setWatchlistItem: jest.fn(),
  getWatchlistPageSnapshot: jest.fn(), getWatchlistMembershipSnapshot: jest.fn(),
  subscribeWatchlistChanges: jest.fn(), isInstrumentMutationPending: jest.fn(),
}));

const service = jest.mocked(watchlistService);
const retryAuth = jest.fn();
const setUser = (userId: string | null) => jest.mocked(useAuth).mockReturnValue({
  userId, isAuthReady: true, error: null, retryAuth,
} as unknown as ReturnType<typeof useAuth>);
const makePage = (offset = 0, userId = 'account-a') => ({
  userId, items: [watched], totalCount: 41, limit: 20, offset, timestamp: 1, isStale: false,
});
const membership = { userId: 'account-a', instrumentIds: new Set([assetId]), isStale: false, timestamp: 1 };

beforeEach(() => {
  jest.resetAllMocks();
  setUser('account-a');
  service.getWatchlistPageSnapshot.mockImplementation((_userId, _limit, offset) =>
    offset === 0 ? makePage() : null);
  service.getWatchlistMembershipSnapshot.mockReturnValue(membership);
  service.subscribeWatchlistChanges.mockReturnValue(jest.fn());
  service.fetchWatchlistPage.mockImplementation(async (options) => makePage(options?.offset));
  service.fetchAllWatchedInstrumentIds.mockResolvedValue(membership);
});

it('retains the committed page during a failure and retries the exact requested offset', async () => {
  const hook = renderHook(() => useWatchlist());
  await waitFor(() => expect(hook.result.current.viewState.state).toBe('ready'));
  service.fetchWatchlistPage.mockRejectedValueOnce(new Error('network'));
  await act(() => hook.result.current.nextPage());
  expect(hook.result.current.pageIndex).toBe(0);
  expect(hook.result.current.items).toEqual([watched]);
  expect(hook.result.current.viewState.state).toBe('page_error');
  await act(() => hook.result.current.retryPage());
  expect(service.fetchWatchlistPage).toHaveBeenLastCalledWith({ limit: 20, offset: 20, forceRefresh: true });
  expect(hook.result.current.pageIndex).toBe(1);
  await act(() => hook.result.current.prevPage());
  expect(hook.result.current.pageIndex).toBe(0);
  await act(() => hook.result.current.goToPage(2));
  act(() => hook.result.current.expand());
  expect(hook.result.current.isExpanded).toBe(true);
  await act(async () => hook.result.current.collapse());
  expect(hook.result.current.isExpanded).toBe(false);
  expect(hook.result.current.pageIndex).toBe(0);
});

it('moves to a valid page when the requested page is out of bounds or has become empty', async () => {
  const hook = renderHook(() => useWatchlist());
  await waitFor(() => expect(hook.result.current.viewState.state).toBe('ready'));
  service.fetchWatchlistPage.mockRejectedValueOnce(createWatchlistPageOutOfBoundsError(40));
  await act(() => hook.result.current.goToPage(2));
  expect(hook.result.current.pageIndex).toBe(1);
  service.fetchWatchlistPage.mockResolvedValueOnce({ ...makePage(40), items: [], totalCount: 22 });
  await act(() => hook.result.current.goToPage(2));
  expect(hook.result.current.pageIndex).toBe(1);
  expect(service.fetchWatchlistPage).toHaveBeenLastCalledWith({ limit: 20, offset: 20, forceRefresh: false });
});

it('tracks pending mutations and reconciles additions and removals across pages', async () => {
  const request = deferred<Awaited<ReturnType<typeof service.setWatchlistItem>>>();
  service.setWatchlistItem.mockReturnValueOnce(request.promise);
  const hook = renderHook(() => useWatchlist());
  await waitFor(() => expect(hook.result.current.viewState.state).toBe('ready'));
  await act(() => hook.result.current.nextPage());
  let mutation: ReturnType<typeof hook.result.current.toggleWatchlistItem> | undefined;
  act(() => { mutation = hook.result.current.toggleWatchlistItem('new-instrument', true); });
  expect(hook.result.current.pendingInstrumentIds.has('new-instrument')).toBe(true);
  await act(async () => {
    request.resolve({ instrumentId: 'new-instrument', isWatched: true, wasChanged: true, watchlistId: 'new-item' });
    await mutation;
  });
  expect(hook.result.current.watchedInstrumentIds.has('new-instrument')).toBe(true);
  expect(hook.result.current.pendingInstrumentIds.size).toBe(0);
  expect(hook.result.current.pageIndex).toBe(0);
  await act(() => hook.result.current.nextPage());
  service.setWatchlistItem.mockResolvedValueOnce({ instrumentId: assetId, isWatched: false, wasChanged: true, watchlistId: null });
  await act(() => hook.result.current.toggleWatchlistItem(assetId, false));
  expect(hook.result.current.watchedInstrumentIds.has(assetId)).toBe(false);
  expect(service.fetchWatchlistPage).toHaveBeenLastCalledWith({ limit: 20, offset: 0, forceRefresh: true });
  service.setWatchlistItem.mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    expect(await hook.result.current.toggleWatchlistItem(assetId, true)).toMatchObject({ success: false });
  });
  expect(hook.result.current.pendingInstrumentIds.size).toBe(0);
});

it('applies only relevant subscription changes and retries membership and auth failures', async () => {
  const hook = renderHook(() => useWatchlist());
  await waitFor(() => expect(hook.result.current.viewState.state).toBe('ready'));
  const publish = service.subscribeWatchlistChanges.mock.calls[0][0];
  const mutation = { instrumentId: 'new-instrument', isWatched: true };
  act(() => publish({ userId: 'other-account', mutation } as Parameters<typeof publish>[0]));
  expect(hook.result.current.watchedInstrumentIds.has('new-instrument')).toBe(false);
  act(() => publish({
    userId: 'account-a', mutation, refreshedPage: { ...makePage(), isStale: true },
  } as Parameters<typeof publish>[0]));
  expect(hook.result.current.isStale).toBe(true);
  expect(hook.result.current.watchedInstrumentIds.has('new-instrument')).toBe(true);
  act(() => publish({
    userId: 'account-a', mutation: { ...mutation, isWatched: false },
  } as Parameters<typeof publish>[0]));
  expect(hook.result.current.watchedInstrumentIds.has('new-instrument')).toBe(false);
  service.fetchAllWatchedInstrumentIds.mockRejectedValueOnce(new Error('membership offline'));
  await act(async () => { await expect(hook.result.current.loadMembership()).rejects.toThrow('membership offline'); });
  expect(hook.result.current.membershipError).toMatch(/üyelik bilgisi/);
  await act(() => hook.result.current.loadMembership(true).then(() => {}));
  expect(hook.result.current.membershipError).toBeNull();
  setUser(null);
  hook.rerender(undefined);
  expect(hook.result.current.items).toEqual([]);
  expect((await hook.result.current.loadMembership()).instrumentIds.size).toBe(0);
  expect(await hook.result.current.toggleWatchlistItem(assetId, true)).toMatchObject({ success: false });
  await act(() => hook.result.current.refetch());
  expect(retryAuth).toHaveBeenCalledTimes(1);
});
