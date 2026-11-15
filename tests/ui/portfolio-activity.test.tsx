import { useAppTheme } from '@/context/theme-context';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { PortfolioActivityDetailModal } from '@/components/portfolio-activity/portfolio-activity-detail-modal';
import { PortfolioActivityEmptyView } from '@/components/portfolio-activity/portfolio-activity-empty-view';
import { PortfolioActivityFooter } from '@/components/portfolio-activity/portfolio-activity-footer';
import { PortfolioActivityHeader } from '@/components/portfolio-activity/portfolio-activity-header';
import { PortfolioActivityItemCard } from '@/components/portfolio-activity/portfolio-activity-item-card';
import { PortfolioActivitySectionHeader } from '@/components/portfolio-activity/portfolio-activity-section-header';
import { activity, date } from './fixtures';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));

it('distinguishes an empty history from a filter with no matches', () => {
  const view = render(<PortfolioActivityEmptyView />);
  expect(screen.getByText('Henüz Portföy Hareketi Yok')).toBeOnTheScreen();
  view.rerender(<PortfolioActivityEmptyView isFiltered />);
  expect(screen.getByText('Bu Filtrede Hareket Bulunamadı')).toBeOnTheScreen();
});

it('switches from loading to a pagination error and retries on request', () => {
  const retry = jest.fn();
  const view = render(<PortfolioActivityFooter isLoadingMore />);
  expect(screen.getByText(/Daha fazla hareket yükleniyor/)).toBeOnTheScreen();
  view.rerender(<PortfolioActivityFooter isLoadingMore={false} loadMoreError="offline" onRetry={retry} />);
  fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
  expect(retry).toHaveBeenCalledTimes(1);
  view.rerender(<PortfolioActivityFooter isLoadingMore={false} />);
  expect(screen.queryByText(/Sonraki sayfa/)).toBeNull();
});

it('forwards search, clear, filter, and back interactions', async () => {
  const onSearchChange = jest.fn();
  const onSelectFilter = jest.fn();
  const view = render(<PortfolioActivityHeader portfolioName="Deneme Portföyü" searchQuery="THY"
    onSearchChange={onSearchChange} activeFilter="ALL" onSelectFilter={onSelectFilter} />);
  expect(screen.getByText(/Deneme Portföyü/)).toBeOnTheScreen();
  fireEvent.changeText(screen.getByPlaceholderText('Sembol veya şirket ara...'), 'THYAO');
  expect(onSearchChange).toHaveBeenLastCalledWith('THYAO');
  fireEvent.press(screen.getByLabelText('Aramayı temizle'));
  await waitFor(() => expect(onSearchChange).toHaveBeenLastCalledWith(''));
  fireEvent.press(screen.getByText('Alış'));
  await waitFor(() => expect(onSelectFilter).toHaveBeenCalledWith('BUY'));
  fireEvent.press(screen.getByLabelText('Geri dön'));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  view.rerender(<PortfolioActivityHeader searchQuery="" onSearchChange={onSearchChange}
    activeFilter="ALL" onSelectFilter={onSelectFilter} disabled />);
  expect(screen.queryByLabelText('Aramayı temizle')).toBeNull();
});

it('opens a selected trade and marks a reversed cash movement', async () => {
  const select = jest.fn();
  const view = render(<PortfolioActivityItemCard item={activity} onPress={select} />);
  fireEvent.press(screen.getByRole('button', { name: /Varlık Alışı, THYAO/ }));
  await waitFor(() => expect(select).toHaveBeenCalledWith(activity));
  const cash = { ...activity, sourceKind: 'CASH_FLOW', activityType: 'WITHDRAWAL',
    symbol: null, companyName: null, quantity: null, unitPrice: null, isReversed: true, reversedAt: date } as const;
  view.rerender(<PortfolioActivityItemCard item={cash} onPress={select} />);
  expect(screen.getByRole('button', { name: /Para Çekme.*Geri Alındı/ })).toBeOnTheScreen();
  expect(screen.queryByText('THYAO')).toBeNull();
});

it('shows trade fields and reversal reason in the activity detail', async () => {
  const close = jest.fn();
  const view = render(<PortfolioActivityDetailModal visible item={null} onClose={close} />);
  expect(screen.queryByText('THYAO')).toBeNull();
  view.rerender(<PortfolioActivityDetailModal visible onClose={close}
    item={{ ...activity, isReversed: true, reversedAt: date, reversalReason: 'Yanlış kayıt' }} />);
  expect(screen.getByText('THYAO')).toBeOnTheScreen();
  expect(screen.getByText('İlk alım')).toBeOnTheScreen();
  expect(screen.getByText(/Yanlış kayıt/)).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Tamam'));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});

it('shows the section label with a count when available', () => {
  const view = render(<PortfolioActivitySectionHeader title="Bugün" count={3} />);
  expect(screen.getByText('Bugün')).toBeOnTheScreen();
  expect(screen.getByText(/3/)).toBeOnTheScreen();
  view.rerender(<PortfolioActivitySectionHeader title="Bugün" />);
  expect(screen.queryByText(/3/)).toBeNull();
});

afterEach(() => {
  jest.mocked(useAppTheme).mockClear();
  jest.restoreAllMocks();
});

it.each([
  ['BUY', 'Varlık Alışı'],
  ['SELL', 'Varlık Satışı'],
  ['DEPOSIT', 'Para Yatırma'],
  ['WITHDRAWAL', 'Para Çekme'],
] as const)('shows the correct %s record and optional fields in dark mode', async (activityType, label) => {
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'dark' } as ReturnType<typeof useAppTheme>);
  jest.replaceProperty(Platform, 'OS', 'web');
  const close = jest.fn();
  const isCash = activityType === 'DEPOSIT' || activityType === 'WITHDRAWAL';
  const item = {
    ...activity, activityType, sourceKind: isCash ? 'CASH_FLOW' as const : 'TRANSACTION' as const,
    companyName: null, market: null, notes: null, symbol: isCash ? null : 'THYAO',
  };
  const view = render(<><PortfolioActivityDetailModal item={item} visible onClose={close} />
    <PortfolioActivityItemCard item={item} onPress={jest.fn()} /></>);
  expect(screen.getByText(`${label} Detayı`)).toBeOnTheScreen();
  expect(screen.queryByText('Şirket')).toBeNull();
  expect(screen.queryByText('Açıklama / Not')).toBeNull();
  if (isCash) expect(screen.queryByText('Birim Fiyat')).toBeNull();
  else expect(screen.getByText('Birim Fiyat')).toBeOnTheScreen();
  view.rerender(<><PortfolioActivityDetailModal item={{ ...item, isReversed: true }} visible onClose={close} />
    <PortfolioActivityItemCard item={item} onPress={jest.fn()} /></>);
  expect(screen.getByText('Bu İşlem Geri Alınmıştır')).toBeOnTheScreen();
  expect(screen.queryByText(/Geri Alınma:/)).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Tamam' }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});
