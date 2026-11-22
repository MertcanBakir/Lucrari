import { useNotificationPreferences } from '@/hooks/use-notification-preferences';
import { useLocalSearchParams } from 'expo-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import HomeScreen from '@/app/(tabs)/index';
import { useMonthlyCalendar } from '@/hooks/use-monthly-calendar';
import { usePortfolioCalendarOwnership } from '@/hooks/use-portfolio-calendar-ownership';
import { useWatchlistMembership } from '@/hooks/use-watchlist-membership';
import { exportEventsToAppleCalendar, isAppleCalendarSupported, openAppleCalendar } from '@/services/calendar/apple-calendar-service';
import { formatDateKey } from '@/utils/calendar-utils';
import { assetId, earnings, economic } from '../ui/fixtures';

jest.mock('@/hooks/use-notification-preferences', () => ({ useNotificationPreferences: jest.fn() }));
jest.mock('expo-router', () => ({ useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock('@/hooks/use-monthly-calendar', () => ({ useMonthlyCalendar: jest.fn() }));
jest.mock('@/hooks/use-portfolio-calendar-ownership', () => ({ usePortfolioCalendarOwnership: jest.fn() }));
jest.mock('@/hooks/use-watchlist-membership', () => ({ useWatchlistMembership: jest.fn() }));
jest.mock('@/components/watchlist/home-watchlist-section', () => ({ HomeWatchlistSection: () => null }));
jest.mock('@/services/calendar/apple-calendar-service', () => ({
  exportEventsToAppleCalendar: jest.fn(), isAppleCalendarSupported: jest.fn(), openAppleCalendar: jest.fn(),
}));
jest.mock('@/components/calendar/monthly-calendar', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    MonthlyCalendar: ({ year, month, selectedDate, isSelectionMode, onMonthChange, onSelectDate, onToggleDayForExport }: {
      year: number; month: number; selectedDate: Date; isSelectionMode: boolean;
      onMonthChange: (year: number, month: number) => void; onSelectDate: (date: Date) => void;
      onToggleDayForExport: (key: string) => void;
    }) => (
      <>
        <Pressable onPress={() => onMonthChange(year, month === 11 ? 0 : month + 1)}><Text>Sonraki ay</Text></Pressable>
        <Pressable onPress={() => {
          if (isSelectionMode) {
            const key = [selectedDate.getFullYear(), String(selectedDate.getMonth() + 1).padStart(2, '0'),
              String(selectedDate.getDate()).padStart(2, '0')].join('-');
            onToggleDayForExport(key);
          } else {
            onSelectDate(new Date(year, month, 1));
          }
        }}><Text>Etkinlik günü</Text></Pressable>
      </>
    ),
  };
});

const today = new Date();
const first = new Date(today.getFullYear(), today.getMonth(), 1);
const key = formatDateKey(today);
const firstKey = formatDateKey(first);
const calendar = {
  data: null, dayIndicators: {}, eventsByDate: { [key]: [{ ...earnings, dateKey: key }, { ...economic, dateKey: key }] },
  isLoading: false, error: null, hasLoadedSuccessfully: true, refetch: jest.fn(), getEventsForDate: jest.fn(),
};
const position = { instrumentId: assetId, symbol: 'THYAO', quantity: 8 };
const ownership = {
  ownedPositions: new Map([[assetId, position]]), isLoading: false, isStale: false,
  error: null, hasLoadedSuccessfully: true, refetch: jest.fn(),
};
const watchlist = {
  watchedInstrumentIds: new Set([assetId]), watchedCount: 1, isLoading: false,
  isStale: false, error: null, hasLoadedSuccessfully: true, refetch: jest.fn(),
};
const choose = async (label: string) => {
  fireEvent.press(screen.getByLabelText(label + ' filtresini seç'));
  await waitFor(() => expect(screen.getByLabelText(label + ' filtresini seç'))
    .toHaveProp('accessibilityState', expect.objectContaining({ selected: true })));
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useNotificationPreferences).mockReturnValue({ preferences: { timezone: 'Europe/Istanbul' }, loading: false, error: null, reload: jest.fn() } as unknown as ReturnType<typeof useNotificationPreferences>);
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  jest.mocked(useMonthlyCalendar).mockReturnValue(calendar);
  jest.mocked(usePortfolioCalendarOwnership).mockReturnValue(ownership);
  jest.mocked(useWatchlistMembership).mockReturnValue(watchlist);
  jest.mocked(isAppleCalendarSupported).mockReturnValue(true);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('selects date and filters events by portfolio or watchlist ownership', async () => {
  render(<HomeScreen />);
  expect(screen.getByText('TÜFE')).toBeOnTheScreen();
  await choose('Portföyüm');
  expect(screen.getByText('THYAO')).toBeOnTheScreen();
  expect(screen.queryByText('TÜFE')).toBeNull();
  await choose('İzleme Listesi');
  expect(screen.getByText('THYAO')).toBeOnTheScreen();
  await choose('Tümü');
  fireEvent.press(screen.getByText('Etkinlik günü'));
  expect(screen.getByText(new Date(firstKey + 'T12:00:00').toLocaleDateString('tr-TR', {
    day: 'numeric', month: 'long', year: 'numeric', weekday: 'long',
  }))).toBeOnTheScreen();
});

it('retries each failed source only from its corresponding filter', async () => {
  jest.mocked(useMonthlyCalendar).mockReturnValue({ ...calendar, error: 'Calendar down', hasLoadedSuccessfully: false });
  const view = render(<HomeScreen />);
  expect(screen.getByText('Takvim verileri yüklenirken bir hata oluştu.')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Tekrar Dene'));
  expect(calendar.refetch).toHaveBeenCalledTimes(1);
  jest.mocked(useMonthlyCalendar).mockReturnValue(calendar);
  jest.mocked(usePortfolioCalendarOwnership).mockReturnValue({ ...ownership, error: new Error('Portfolio down'), hasLoadedSuccessfully: false });
  view.rerender(<HomeScreen />);
  await choose('Portföyüm');
  fireEvent.press(screen.getByText('Tekrar Dene'));
  expect(ownership.refetch).toHaveBeenCalledTimes(1);
  jest.mocked(useWatchlistMembership).mockReturnValue({ ...watchlist, error: new Error('Watchlist down'), hasLoadedSuccessfully: false });
  view.rerender(<HomeScreen />);
  await choose('İzleme Listesi');
  fireEvent.press(screen.getByText('Tekrar Dene'));
  expect(watchlist.refetch).toHaveBeenCalledTimes(1);
});

it('refreshes the combined stale sources for both private calendar filters', async () => {
  jest.mocked(useMonthlyCalendar).mockReturnValue({ ...calendar, error: 'Calendar old' });
  jest.mocked(usePortfolioCalendarOwnership).mockReturnValue({ ...ownership, isStale: true });
  jest.mocked(useWatchlistMembership).mockReturnValue({ ...watchlist, isStale: true });
  render(<HomeScreen />);
  await choose('Portföyüm');
  fireEvent.press(screen.getByText('Yenile'));
  expect(calendar.refetch).toHaveBeenCalledTimes(1);
  expect(ownership.refetch).toHaveBeenCalledTimes(1);
  await choose('İzleme Listesi');
  fireEvent.press(screen.getByText('Yenile'));
  expect(calendar.refetch).toHaveBeenCalledTimes(2);
  expect(watchlist.refetch).toHaveBeenCalledTimes(1);
});

it('selects, clears, and exports filtered calendar events with retry feedback', async () => {
  const exporter = jest.mocked(exportEventsToAppleCalendar).mockResolvedValueOnce({
    success: false, addedCount: 0, error: 'Takvim izni yok',
  }).mockResolvedValueOnce({ success: true, addedCount: 2 });
  render(<HomeScreen />);
  fireEvent.press(screen.getByText('Apple Takvime Aktar'));
  expect(await screen.findByText(/Toplam 2 finansal olay/)).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Seçimi Temizle'));
  expect(await screen.findByText('Gün Seçin')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Etkinlik günü'));
  expect(screen.getByText(/Toplam 2 finansal olay/)).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Etkinlik günü'));
  fireEvent.press(screen.getByText(/Tüm Ayı Seç/));
  fireEvent.press(await screen.findByText(/Takvime Ekle \(2\)/));
  await waitFor(() => expect(Alert.alert).toHaveBeenLastCalledWith('Aktarım Tamamlanamadı', 'Takvim izni yok'));
  fireEvent.press(await screen.findByText(/Takvime Ekle \(2\)/));
  await waitFor(() => expect(Alert.alert).toHaveBeenLastCalledWith('Apple Takvime Eklendi! ', expect.any(String), expect.any(Array)));
  expect(exporter).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ id: earnings.id }), expect.objectContaining({ id: economic.id }),
  ]));
  const [open, close] = jest.mocked(Alert.alert).mock.lastCall?.[2] ?? [];
  act(() => open.onPress?.());
  expect(openAppleCalendar).toHaveBeenCalled();
  act(() => close.onPress?.());
  expect(screen.getByText('Apple Takvime Aktar')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Apple Takvime Aktar'));
  fireEvent.press(await screen.findByText('Sonraki ay'));
  expect(screen.getByText('Gün Seçin')).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Aktarım modunu kapat'));
  expect(await screen.findByText('Apple Takvime Aktar')).toBeOnTheScreen();
});

it('does not offer calendar export on unsupported platforms and refreshes only stale calendar data', async () => {
  jest.mocked(isAppleCalendarSupported).mockReturnValue(false);
  jest.mocked(useMonthlyCalendar).mockReturnValue({ ...calendar, error: 'Calendar last good copy' });
  render(<HomeScreen />);
  expect(screen.queryByText('Apple Takvime Aktar')).toBeNull();
  fireEvent.press(screen.getByText('Yenile'));
  expect(calendar.refetch).toHaveBeenCalledTimes(1);
  expect(ownership.refetch).not.toHaveBeenCalled();
  expect(watchlist.refetch).not.toHaveBeenCalled();
});

it('refreshes only the active private filter when its data becomes stale', async () => {
  jest.mocked(usePortfolioCalendarOwnership).mockReturnValue({ ...ownership, isStale: true });
  jest.mocked(useWatchlistMembership).mockReturnValue({ ...watchlist, isStale: true });
  render(<HomeScreen />);
  await choose('Portföyüm');
  fireEvent.press(screen.getByText('Yenile'));
  expect(ownership.refetch).toHaveBeenCalledTimes(1);
  expect(watchlist.refetch).not.toHaveBeenCalled();
  await choose('İzleme Listesi');
  fireEvent.press(screen.getByText('Yenile'));
  expect(watchlist.refetch).toHaveBeenCalledTimes(1);
  expect(calendar.refetch).not.toHaveBeenCalled();
});

it('opens the notification date and loads full portfolio earnings or macro data rather than capped payload IDs', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ date: key, filter: 'portfolio', notification: 'one' });
  const view = render(<HomeScreen />);
  await waitFor(() => expect(screen.queryByText('TÜFE')).toBeNull());
  expect(screen.getByText('THYAO')).toBeOnTheScreen();
  jest.mocked(useLocalSearchParams).mockReturnValue({ date: key, filter: 'economic', notification: 'two' });
  view.rerender(<HomeScreen />);
  await waitFor(() => expect(screen.getByText('TÜFE')).toBeOnTheScreen());
  expect(screen.queryByText('THYAO')).toBeNull();
});
it('opens the exact company earnings event and handles missing events', async () => {
  const eventId = '11111111-1111-4111-8111-111111111111';
  jest.mocked(useMonthlyCalendar).mockReturnValue({ ...calendar, eventsByDate: { [key]: [{ ...earnings, id: `earnings-${eventId}`, dateKey: key }, { ...economic, dateKey: key }] } });
  jest.mocked(useLocalSearchParams).mockReturnValue({ date: key, filter: 'earnings', instrument: assetId, event: eventId });
  const view = render(<HomeScreen />);
  await waitFor(() => expect(screen.getByText('THYAO')).toBeOnTheScreen());
  jest.mocked(useLocalSearchParams).mockReturnValue({ date: key, filter: 'earnings', instrument: assetId, event: '99999999-9999-4999-8999-999999999999' });
  view.rerender(<HomeScreen />);
  await waitFor(() => expect(screen.queryByText('THYAO')).toBeNull());
  await choose('Tümü');
  expect(screen.getByText('THYAO')).toBeOnTheScreen();
  expect(screen.getByText('TÜFE')).toBeOnTheScreen();
});

it('uses notification timezone and retries a failed preference lookup without showing a local-day substitute', async () => {
  const reload = jest.fn();
  jest.mocked(useNotificationPreferences).mockReturnValue({ preferences: null, loading: false, error: 'Saat dilimi yüklenemedi', reload } as unknown as ReturnType<typeof useNotificationPreferences>);
  jest.mocked(useLocalSearchParams).mockReturnValue({ date: key, filter: 'economic', notification: 'notice' });
  const view = render(<HomeScreen />);
  expect(screen.queryByText('TÜFE')).toBeNull();
  fireEvent.press(screen.getByText('Tekrar Dene'));
  expect(reload).toHaveBeenCalled();
  jest.mocked(useNotificationPreferences).mockReturnValue({ preferences: { timezone: 'UTC' }, loading: false, error: null, reload } as unknown as ReturnType<typeof useNotificationPreferences>);
  view.rerender(<HomeScreen />);
  expect(useMonthlyCalendar).toHaveBeenLastCalledWith(today.getFullYear(), today.getMonth(), 'UTC');
  await waitFor(() => expect(screen.getByText('TÜFE')).toBeOnTheScreen());
});

it('opens a watchlist notification without requiring a portfolio and loads the full watchlist day', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ date: key, filter: 'watchlist', notification: 'watchlist-notice' });
  jest.mocked(usePortfolioCalendarOwnership).mockReturnValue({ ...ownership, ownedPositions: new Map() });
  jest.mocked(useMonthlyCalendar).mockReturnValue({ ...calendar, eventsByDate: { [key]: [
    { ...earnings, dateKey: key }, { ...earnings, id: 'other-earnings', instrumentId: '22222222-2222-4222-8222-222222222222', title: 'BIMAS', dateKey: key },
  ] } });
  render(<HomeScreen />);
  await waitFor(() => expect(screen.getByLabelText('İzleme Listesi filtresini seç')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true })));
  expect(screen.getByText('THYAO')).toBeOnTheScreen(); expect(screen.queryByText('BIMAS')).toBeNull();
});
it('focuses the reminded economic event and lets the user return to the full calendar', async () => {
  const eventId = '11111111-1111-4111-8111-111111111111';
  jest.mocked(useLocalSearchParams).mockReturnValue({ date: key, filter: 'economic', economicEvent: eventId, notification: 'economic-notice' });
  jest.mocked(useMonthlyCalendar).mockReturnValue({ ...calendar, eventsByDate: { [key]: [
    { ...economic, id: `economic-${eventId}`, dateKey: key }, { ...economic, id: 'economic-other', title: 'PMI', dateKey: key },
  ] } });
  render(<HomeScreen />);
  await waitFor(() => expect(screen.getByText('TÜFE')).toBeOnTheScreen());
  expect(screen.queryByText('PMI')).toBeNull();
  await choose('Tümü'); expect(screen.getByText('PMI')).toBeOnTheScreen();
});
