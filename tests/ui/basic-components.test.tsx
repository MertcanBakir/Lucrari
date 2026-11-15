import { useAppTheme } from '@/context/theme-context';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform, Text } from 'react-native';
import { Collapsible } from '@/components/ui/collapsible';
import { MarketFilterChips } from '@/components/portfolio/market-filter-chips';
import { PortfolioHeader } from '@/components/portfolio/portfolio-header';
import { StaleDataBanner } from '@/components/portfolio/stale-data-banner';
import { WatchlistEmptyCard } from '@/components/watchlist/watchlist-empty-card';

it('shows and hides disclosure content as the user taps the heading', () => {
  render(<Collapsible title="Ayrıntılar"><Text>Ek bilgi</Text></Collapsible>);
  expect(screen.queryByText('Ek bilgi')).toBeNull();
  fireEvent.press(screen.getByText('Ayrıntılar'));
  expect(screen.getByText('Ek bilgi')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Ayrıntılar'));
  expect(screen.queryByText('Ek bilgi')).toBeNull();
});

it('changes portfolio currency and blocks new trades while disabled', () => {
  const toggle = jest.fn();
  const add = jest.fn();
  const view = render(<PortfolioHeader currencyMode="TRY" onToggleCurrency={toggle} onAddTransaction={add} disabled />);
  fireEvent.press(screen.getByText('₺ TRY'));
  expect(toggle).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText('İşlem Ekle'));
  expect(add).not.toHaveBeenCalled();
  view.rerender(<PortfolioHeader currencyMode="USD" onToggleCurrency={toggle} onAddTransaction={add} />);
  expect(screen.getByText('$ USD')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('İşlem Ekle'));
  expect(add).toHaveBeenCalledTimes(1);
});

it('selects a market without changing the meaning of its label', async () => {
  const select = jest.fn();
  render(<MarketFilterChips activeMarket="ALL" onSelectMarket={select} />);
  fireEvent.press(screen.getByText('Kripto'));
  await waitFor(() => expect(select).toHaveBeenCalledWith('CRYPTO'));
});

it('offers a retry on stale data and an add action for an empty watchlist', async () => {
  const refresh = jest.fn();
  const add = jest.fn();
  const view = render(<><StaleDataBanner onRefresh={refresh} /><WatchlistEmptyCard onOpenAddModal={add} /></>);
  fireEvent.press(screen.getByText('Yenile'));
  fireEvent.press(screen.getByLabelText('İzleme Listesi Oluştur'));
  expect(refresh).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
  view.rerender(<StaleDataBanner onRefresh={refresh} isRefreshing />);
  expect(screen.queryByText('Yenile')).toBeNull();
});

it('supports dark-mode controls on web and offers the empty-watchlist action', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'dark' } as ReturnType<typeof useAppTheme>);
  const add = jest.fn();
  const select = jest.fn();
  render(<><Collapsible title="Ayrıntılar"><Text>İçerik</Text></Collapsible>
    <MarketFilterChips activeMarket="CRYPTO" onSelectMarket={select} />
    <WatchlistEmptyCard onOpenAddModal={add} /></>);
  fireEvent.press(screen.getByText('Ayrıntılar'));
  expect(screen.getByText('İçerik')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Tümü'));
  await waitFor(() => expect(select).toHaveBeenCalledWith('ALL'));
  fireEvent.press(screen.getByLabelText('İzleme Listesi Oluştur'));
  expect(add).toHaveBeenCalledTimes(1);
});

afterEach(() => {
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'light' } as ReturnType<typeof useAppTheme>);
  jest.restoreAllMocks();
});
