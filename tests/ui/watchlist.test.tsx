import { useAppTheme } from '@/context/theme-context';
import { deferred } from '../helpers/deferred';
import { FlatList, Platform } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { HomeWatchlistSection } from '@/components/watchlist/home-watchlist-section';
import { WatchlistRow } from '@/components/watchlist/watchlist-row';
import { WatchlistSearchModal } from '@/components/watchlist/watchlist-search-modal';
import { useWatchlist } from '@/hooks/use-watchlist';
import { searchInstrumentsDetailed } from '@/services/portfolio/instrument-service';
import { resolveWatchlistViewState } from '@/utils/watchlist-view-state';
import { assetId, date, watched } from './fixtures';

jest.mock('@/hooks/use-watchlist', () => ({ useWatchlist: jest.fn() }));
jest.mock('@/services/portfolio/instrument-service', () => ({ searchInstrumentsDetailed: jest.fn() }));

const result = {
  id: assetId, symbol: watched.symbol, companyName: watched.companyName, market: watched.market,
  assetType: watched.assetType, currency: watched.currency, price: watched.price, hasPrice: true,
  isStale: false, staleReason: null, changePercent: 5, changeAmount: 5, priceAt: date,
};
const search = jest.mocked(searchInstrumentsDetailed);
const membership = {
  userId: 'test-user', instrumentIds: new Set([assetId]), isStale: false, timestamp: 1,
};
const status = {
  isAuthReady: true, userId: membership.userId, authError: null, isLoading: false, isPageLoading: false,
  error: null, hasLoadedSuccessfully: true, totalCount: 42, itemsCount: 1, isStale: false,
  pendingInstrumentIdsCount: 0,
};

function watchlistState() {
  return {
    items: [watched], allItemsOnPage: [watched], totalCount: 42, pageIndex: 1, pageSize: 20, totalPages: 3,
    isExpanded: true, isLoading: false, isPageLoading: false, isStale: false, error: null,
    hasLoadedSuccessfully: true, viewState: resolveWatchlistViewState(status),
    watchedInstrumentIds: membership.instrumentIds, isMembershipLoading: false, isMembershipStale: false,
    membershipError: null, pendingInstrumentIds: new Set<string>(), expand: jest.fn(), collapse: jest.fn(),
    goToPage: jest.fn(), nextPage: jest.fn(), prevPage: jest.fn(), refetch: jest.fn(), retryPage: jest.fn(),
    toggleWatchlistItem: jest.fn().mockResolvedValue({ success: true }), loadMembership: jest.fn().mockResolvedValue(membership),
  };
}

beforeEach(() => search.mockReset().mockResolvedValue({ items: [result], error: null, isStale: false, hasMore: false }));

it('displays a watched price and reports removal by instrument ID', async () => {
  const remove = jest.fn();
  const dismiss = jest.fn();
  const view = render(<WatchlistRow item={watched} onRemove={remove} />);
  expect(screen.getByText(/100,00/)).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('THYAO varlığını izleme listesinden çıkar'));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(assetId));
  view.rerender(<WatchlistRow item={{ ...watched, price: null, hasPrice: false, changePercent: null,
    changeAmount: null, priceIsStale: true }} isAnyRowOpen onRemove={remove} onDismissOpenRows={dismiss} isPendingMutation />);
  expect(screen.getByText('—')).toBeOnTheScreen();
  expect(screen.getByLabelText('THYAO varlığını izleme listesinden çıkar')).toBeDisabled();
  fireEvent.press(screen.getByText('THYAO'));
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it('moves between pages, collapses the list, and passes a row removal to the watchlist hook', async () => {
  const state = watchlistState();
  state.toggleWatchlistItem.mockResolvedValue({ success: false, error: 'İşlem başarısız' });
  jest.mocked(useWatchlist).mockReturnValue(state);
  render(<HomeWatchlistSection />);
  fireEvent.press(screen.getByLabelText('Önceki 20 varlık'));
  await waitFor(() => expect(state.prevPage).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByLabelText('Sonraki 20 varlık'));
  await waitFor(() => expect(state.nextPage).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByLabelText('Listeyi Daralt'));
  await waitFor(() => expect(state.collapse).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByLabelText('THYAO varlığını izleme listesinden çıkar'));
  expect(await screen.findByText('İşlem başarısız')).toBeOnTheScreen();
  expect(state.toggleWatchlistItem).toHaveBeenCalledWith(assetId, false);
  fireEvent.press(screen.getByLabelText('Hata uyarısını kapat'));
  expect(screen.queryByText('İşlem başarısız')).toBeNull();
});

it('shows loading, initial error, stale data, and page retry without losing the list', async () => {
  const state = watchlistState();
  const hook = jest.mocked(useWatchlist);
  hook.mockReturnValue({ ...state, viewState: resolveWatchlistViewState({
    ...status, isLoading: true, hasLoadedSuccessfully: false,
  }) });
  const view = render(<HomeWatchlistSection />);
  expect(screen.getByText(/İzleme listesi yükleniyor/)).toBeOnTheScreen();
  hook.mockReturnValue({ ...state, viewState: resolveWatchlistViewState({
    ...status, error: 'offline', hasLoadedSuccessfully: false,
  }) });
  view.rerender(<HomeWatchlistSection />);
  fireEvent.press(screen.getByLabelText('Tekrar Dene'));
  expect(state.refetch).toHaveBeenCalled();
  hook.mockReturnValue({ ...state, viewState: resolveWatchlistViewState({ ...status, isStale: true }) });
  view.rerender(<HomeWatchlistSection />);
  expect(screen.getByText('THYAO')).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Yenile'));
  expect(state.refetch).toHaveBeenCalledTimes(2);
  hook.mockReturnValue({ ...state, viewState: resolveWatchlistViewState({ ...status, error: 'offline' }) });
  view.rerender(<HomeWatchlistSection />);
  fireEvent.press(screen.getByLabelText('Tekrar Dene'));
  expect(state.retryPage).toHaveBeenCalled();
  expect(screen.getByText('THYAO')).toBeOnTheScreen();
});

it('searches by symbol and adds or removes the returned watchlist instrument', async () => {
  const toggle = jest.fn().mockResolvedValue({ success: false, error: 'Tekrar deneyin' });
  const close = jest.fn();
  const load = jest.fn().mockResolvedValue(membership);
  const props = { visible: true, onClose: close, onToggleWatchlist: toggle, onLoadMembership: load };
  const view = render(<WatchlistSearchModal {...props} watchedInstrumentIds={new Set()} />);
  const add = await screen.findByLabelText('THYAO izlemeye ekle');
  fireEvent.press(add);
  expect(await screen.findByText('Tekrar deneyin')).toBeOnTheScreen();
  expect(toggle).toHaveBeenCalledWith(assetId, true);
  fireEvent.press(screen.getByLabelText('Hata uyarısını kapat'));
  expect(screen.queryByText('Tekrar deneyin')).toBeNull();
  fireEvent.changeText(screen.getByPlaceholderText('Sembol veya şirket adı ara...'), 'THY');
  await waitFor(() => expect(search).toHaveBeenCalledWith('THY', 'ALL', expect.any(Number), 0));
  toggle.mockResolvedValue({ success: true });
  view.rerender(<WatchlistSearchModal {...props} watchedInstrumentIds={membership.instrumentIds} />);
  fireEvent.press(await screen.findByLabelText('THYAO izlemeden çıkar'));
  await waitFor(() => expect(toggle).toHaveBeenLastCalledWith(assetId, false));
  fireEvent.press(screen.getByLabelText('Arama modalını kapat'));
  expect(close).toHaveBeenCalledTimes(1);
});

it('offers retry for failed instrument queries and disables changes when membership is stale', async () => {
  search.mockResolvedValueOnce({ items: [], error: 'Arama çevrimdışı', isStale: false, hasMore: false });
  const load = jest.fn().mockResolvedValue(membership);
  render(<WatchlistSearchModal visible watchedInstrumentIds={new Set()} isMembershipStale
    onClose={jest.fn()} onToggleWatchlist={jest.fn()} onLoadMembership={load} />);
  expect(await screen.findByText('Arama çevrimdışı')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Tekrar Dene'));
  expect(await screen.findByLabelText('THYAO izlemeye ekle')).toBeDisabled();
  fireEvent.press(screen.getByText('Yenile'));
  expect(load).toHaveBeenLastCalledWith(true);
});

it('opens the search modal from the watchlist and restores the list when dismissed', async () => {
  const state = watchlistState();
  jest.mocked(useWatchlist).mockReturnValue({ ...state, isExpanded: false });
  render(<HomeWatchlistSection />);
  fireEvent.press(screen.getByLabelText('Tümünü Gör'));
  await waitFor(() => expect(state.expand).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByLabelText('Varlık Ekle'));
  expect(await screen.findByPlaceholderText('Sembol veya şirket adı ara...')).toBeOnTheScreen();
  await waitFor(() => expect(state.loadMembership).toHaveBeenCalled());
  fireEvent.press(screen.getByLabelText('Arama modalını kapat'));
  await waitFor(() => expect(screen.queryByPlaceholderText('Sembol veya şirket adı ara...')).toBeNull());
  expect(screen.getByText('THYAO')).toBeOnTheScreen();
});

it('applies the selected search market and shows an empty result', async () => {
  search.mockImplementation(async (_query, market) => ({
    items: market === 'ALL' ? [result] : [], error: null, isStale: false, hasMore: false,
  }));
  render(<WatchlistSearchModal visible watchedInstrumentIds={new Set()}
    onClose={jest.fn()} onToggleWatchlist={jest.fn()} onLoadMembership={jest.fn().mockResolvedValue(membership)} />);
  expect(await screen.findByLabelText('THYAO izlemeye ekle')).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Kripto kategorisi'));
  expect(await screen.findByText('Sonuç Bulunamadı')).toBeOnTheScreen();
  expect(search).toHaveBeenLastCalledWith('', 'CRYPTO', 20, 0);
});

it('shows stale, inactive, neutral and decreasing prices without implying unavailable data is zero', () => {
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'dark' } as ReturnType<typeof useAppTheme>);
  const remove = jest.fn();
  const view = render(<WatchlistRow item={{ ...watched, isActive: false, priceIsStale: true, changePercent: -2 }} onRemove={remove} />);
  expect(screen.getByText('Artık aktif olarak fiyatlanmıyor')).toBeOnTheScreen();
  expect(screen.getByText('Fiyat güncel olmayabilir')).toBeOnTheScreen();
  view.rerender(<WatchlistRow item={{ ...watched, changePercent: null, changeAmount: 0 }} onRemove={remove} />);
  expect(screen.getByText('—')).toBeOnTheScreen();
  view.rerender(<WatchlistRow item={{ ...watched, changePercent: -2 }} onRemove={remove} />);
  expect(screen.getByText(/-%2/)).toBeOnTheScreen();
});

it('paginates watchlist search, deduplicates load-more and displays unavailable prices', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'dark' } as ReturnType<typeof useAppTheme>);
  type SearchResult = Awaited<ReturnType<typeof searchInstrumentsDetailed>>;
  const first = deferred<SearchResult>();
  const next = deferred<SearchResult>();
  search.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
  const load = jest.fn().mockResolvedValue(membership);
  const toggle = jest.fn().mockResolvedValue({ success: true });
  const props = { visible: true, onClose: jest.fn(), onToggleWatchlist: toggle, onLoadMembership: load,
    watchedInstrumentIds: new Set([assetId]) };
  const view = render(<WatchlistSearchModal {...props} />);
  expect(await screen.findByText('Varlıklar aranıyor...')).toBeOnTheScreen();
  await act(async () => first.resolve({ items: [result], error: null, isStale: false, hasMore: true }));
  const list = view.UNSAFE_getByType(FlatList);
  fireEvent(list, 'endReached', { distanceFromEnd: 0 });
  fireEvent(list, 'endReached', { distanceFromEnd: 0 });
  expect(search).toHaveBeenCalledTimes(2);
  const second = { ...result, id: 'second', symbol: 'XYZ', price: null, hasPrice: false, changePercent: null };
  const third = { ...result, id: 'third', symbol: 'DOWN', changePercent: -2 };
  await act(async () => next.resolve({ items: [second, third], error: null, isStale: false, hasMore: false }));
  expect(screen.getByText('XYZ')).toBeOnTheScreen();
  expect(screen.getByText('—')).toBeOnTheScreen();
  expect(screen.getByText(/-%2/)).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('XYZ izlemeye ekle'));
  await waitFor(() => expect(toggle).toHaveBeenCalledWith('second', true));
  view.rerender(<WatchlistSearchModal {...props} pendingInstrumentIds={new Set([assetId])} isMembershipLoading />);
  expect(screen.getByLabelText('THYAO izlemeden çıkar')).toBeDisabled();
});

afterEach(() => {
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'light' } as ReturnType<typeof useAppTheme>);
  jest.restoreAllMocks();
});
