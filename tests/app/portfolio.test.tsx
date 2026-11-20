import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import InvestmentsScreen from '@/app/(tabs)/investments';
import PortfolioActivityScreen from '@/app/portfolio-activity';
import { useAuth } from '@/context/auth-context';
import { usePortfolio } from '@/hooks/use-portfolio';
import { usePortfolioActivity } from '@/hooks/use-portfolio-activity';
import { calculatePortfolioStats } from '@/utils/financial-math';
import { activity, position } from '../ui/fixtures';

const mockChartPush = jest.fn();
let mockFocus: (() => void) | undefined;
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockChartPush }),
  useFocusEffect: (callback: () => void) => { mockFocus = callback; },
}));
jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/hooks/use-portfolio', () => ({ usePortfolio: jest.fn() }));
jest.mock('@/hooks/use-portfolio-activity', () => ({ usePortfolioActivity: jest.fn() }));
jest.mock('@/services/portfolio/instrument-service', () => ({
  searchInstrumentsDetailed: jest.fn().mockResolvedValue({ items: [], error: null, isStale: false, hasMore: false }),
}));

const positions = [position];
const cash = { tryBalance: 5000, usdBalance: 0 };
function makePortfolio() {
  return {
    portfolio: { id: 'p1', name: 'Ana Portföy' } as NonNullable<ReturnType<typeof usePortfolio>['portfolio']>,
    positions, stats: calculatePortfolioStats(positions, cash, null), allocationItems: [],
    usdTryRate: 30,
    isLoading: false, isRefreshing: false, isStale: false, error: null,
    lastFetchedTimestamp: 1, refreshPortfolio: jest.fn().mockResolvedValue(undefined), updateCash: jest.fn().mockResolvedValue(undefined),
    addTransaction: jest.fn().mockResolvedValue(undefined),
    cash, fxRateInfo: null, reverseTransaction: jest.fn(), resetInvestments: jest.fn(),
  } satisfies ReturnType<typeof usePortfolio>;
}
function makeActivity() {
  return {
    items: [activity], sections: [{ title: 'Bugün', dateKey: '2026-08-31', data: [activity] }], activeFilter: 'ALL',
    searchQuery: '', debouncedSearch: '', hasMore: true, isLoadingInitial: false, isRefreshing: false, isLoadingMore: false,
    isStale: false, initialError: null, loadMoreError: null, isResolvingPortfolio: false, portfolioResolutionError: null,
    viewState: 'ready', portfolioId: 'p1', portfolioName: 'Ana Portföy', setFilter: jest.fn(), setSearchQuery: jest.fn(),
    refresh: jest.fn(), loadMore: jest.fn(), retryLoadMore: jest.fn(), retryAuth: jest.fn(), retryPortfolioResolution: jest.fn(),
  } satisfies ReturnType<typeof usePortfolioActivity>;
}
const setUser = (userId: string) => jest.mocked(useAuth).mockReturnValue({ userId } as ReturnType<typeof useAuth>);

beforeEach(() => setUser('owner-a'));

it('shows investment loading, initial error, and stale cached positions at the right times', async () => {
  const ready = makePortfolio();
  const hook = jest.mocked(usePortfolio).mockReturnValue({ ...ready, isLoading: true, lastFetchedTimestamp: 0 });
  const view = render(<InvestmentsScreen />);
  expect(screen.getByText(/Portföy verileri yükleniyor/)).toBeOnTheScreen();
  hook.mockReturnValue({ ...ready, lastFetchedTimestamp: 0, error: 'Bağlantı yok' });
  view.rerender(<InvestmentsScreen />);
  expect(screen.getByText('Bağlantı yok')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Tekrar Dene'));
  expect(ready.refreshPortfolio).toHaveBeenCalledTimes(1);
  hook.mockReturnValue({ ...ready, isStale: true });
  view.rerender(<InvestmentsScreen />);
  expect(screen.getByText('THYAO')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Yenile'));
  expect(ready.refreshPortfolio).toHaveBeenCalledTimes(2);
  act(() => mockFocus?.());
  expect(ready.refreshPortfolio).toHaveBeenCalledTimes(3);
});

it('filters holdings, changes display currency, and submits a trade from holding details', async () => {
  const state = makePortfolio();
  jest.mocked(usePortfolio).mockReturnValue(state);
  render(<InvestmentsScreen />);
  fireEvent.press(screen.getByText('Kripto'));
  expect(await screen.findByText('Açık Pozisyon Bulunmuyor')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Tümü'));
  await screen.findByText('THYAO');
  await act(async () => fireEvent.press(screen.getByText('₺ TRY')));
  expect(await screen.findByText('$ USD')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Günlük Değişim'));
  expect(await screen.findByText('Açık Pozisyon Kâr / Zarar')).toBeOnTheScreen();
  fireEvent.press(await screen.findByText('THYAO'));
  fireEvent.press(await screen.findByText('- Satış Yap'));
  fireEvent.changeText(await screen.findByLabelText('Adet'), '2');
  fireEvent.press(await screen.findByText(/Satış İşlemini Kaydet/));
  await waitFor(() => expect(state.addTransaction).toHaveBeenCalledWith(expect.objectContaining({
    instrumentId: position.instrument_id, transactionType: 'SELL', quantity: 2,
  })));
});

it('closes the previous account detail when the next account cannot load', async () => {
  const state = makePortfolio();
  const hook = jest.mocked(usePortfolio).mockReturnValue(state);
  const view = render(<InvestmentsScreen />);
  fireEvent.press(screen.getByText('THYAO'));
  expect(await screen.findByText('Ortalama Maliyet')).toBeOnTheScreen();
  setUser('owner-b');
  hook.mockReturnValue({ ...state, portfolio: null, positions: [],
    lastFetchedTimestamp: 0, error: 'Yeni portföy yüklenemedi' });
  view.rerender(<InvestmentsScreen />);
  expect(screen.getByText('Yeni portföy yüklenemedi')).toBeOnTheScreen();
  expect(screen.queryByText('THYAO')).toBeNull();
  expect(screen.queryByText('Ortalama Maliyet')).toBeNull();
});

it('opens the optional cash editor and saves manual balances', async () => {
  const state = makePortfolio();
  jest.mocked(usePortfolio).mockReturnValue(state);
  render(<InvestmentsScreen />);
  fireEvent.press(screen.getByLabelText('Nakit tutarını düzenle'));
  const inputs = await screen.findAllByPlaceholderText('0');
  fireEvent.changeText(inputs[0], '23');
  fireEvent.press(screen.getByText('Bakiyeleri Kaydet'));
  await waitFor(() => expect(state.updateCash).toHaveBeenCalledWith(23, 0));
});

it('chooses the proper action for each activity load failure and presents item details', async () => {
  const state = makeActivity();
  const hook = jest.mocked(usePortfolioActivity).mockReturnValue({ ...state, viewState: 'initial_loading' });
  const view = render(<PortfolioActivityScreen />);
  expect(screen.getByText(/Portföy hareketleri yükleniyor/)).toBeOnTheScreen();
  hook.mockReturnValue({ ...state, viewState: 'auth_failed' });
  view.rerender(<PortfolioActivityScreen />);
  fireEvent.press(screen.getByLabelText('Tekrar dene'));
  expect(state.retryAuth).toHaveBeenCalledTimes(1);
  hook.mockReturnValue({ ...state, viewState: 'initial_error', portfolioResolutionError: 'Portföy yok' });
  view.rerender(<PortfolioActivityScreen />);
  fireEvent.press(screen.getByLabelText('Tekrar dene'));
  expect(state.retryPortfolioResolution).toHaveBeenCalledTimes(1);
  hook.mockReturnValue({ ...state, viewState: 'initial_error', initialError: 'Hareket yok' });
  view.rerender(<PortfolioActivityScreen />);
  fireEvent.press(screen.getByLabelText('Tekrar dene'));
  expect(state.refresh).toHaveBeenCalledTimes(1);
  hook.mockReturnValue({ ...state, isStale: true });
  view.rerender(<PortfolioActivityScreen />);
  fireEvent.press(screen.getByLabelText(/Varlık Alışı, THYAO/));
  expect(await screen.findByText('İlk alım')).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Tamam'));
  await waitFor(() => expect(screen.queryByText('İlk alım')).toBeNull());
});

it('opens the portfolio chart from the summary icon with the selected currency', () => {
  jest.mocked(usePortfolio).mockReturnValue(makePortfolio());
  render(<InvestmentsScreen />);
  fireEvent.press(screen.getByLabelText('Portföy grafiğini aç'));
  expect(mockChartPush).toHaveBeenCalledWith({ pathname: '/portfolio-chart', params: { currency: 'TRY', market: 'ALL' } });
});
