import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import type { AlertButton } from 'react-native';
import { CalendarFilterChips } from '@/components/calendar/calendar-filter-chips';
import { DayEventsList } from '@/components/calendar/day-events-list';
import { EventDetailModal } from '@/components/calendar/event-detail-modal';
import { MonthlyCalendar } from '@/components/calendar/monthly-calendar';
import { exportEventsToAppleCalendar, isAppleCalendarSupported, openAppleCalendar } from '@/services/calendar/apple-calendar-service';
import { earnings, economic } from './fixtures';

jest.mock('@/services/calendar/apple-calendar-service', () => ({
  exportEventsToAppleCalendar: jest.fn(),
  isAppleCalendarSupported: jest.fn(),
  openAppleCalendar: jest.fn(),
}));

const selectedDate = new Date(2026, 7, 31, 12);

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(isAppleCalendarSupported).mockReturnValue(true);
});

afterEach(() => jest.restoreAllMocks());

it('changes the active calendar filter through an accessible control', async () => {
  const change = jest.fn();
  const view = render(<CalendarFilterChips activeFilter="all" onFilterChange={change} ownedCount={2} watchedCount={1} />);
  fireEvent.press(screen.getByLabelText('İzleme Listesi filtresini seç'));
  await waitFor(() => expect(change).toHaveBeenCalledWith('watchlist'));
  view.rerender(<CalendarFilterChips activeFilter="watchlist" onFilterChange={change} />);
  expect(screen.getByLabelText('İzleme Listesi filtresini seç')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
});

it('selects a normal calendar day and excludes empty days from export selection', async () => {
  const select = jest.fn();
  const toggle = jest.fn();
  const props = { year: 2026, month: 7, onMonthChange: jest.fn(), onSelectDate: select,
    dayIndicators: { '2026-08-17': { count: 2, hasEarnings: true, hasEconomic: true } } };
  const view = render(<MonthlyCalendar {...props} selectedDate={selectedDate} />);
  expect(screen.getByText('Ağustos 2026')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('17'));
  await waitFor(() => expect(select).toHaveBeenCalledWith(new Date(2026, 7, 17)));
  view.rerender(<MonthlyCalendar {...props} isSelectionMode onToggleDayForExport={toggle}
    selectedDaysForExport={new Set(['2026-08-17'])} />);
  fireEvent.press(screen.getByText('18'));
  fireEvent.press(screen.getByText('17'));
  await waitFor(() => expect(toggle).toHaveBeenCalledWith('2026-08-17'));
  expect(toggle).toHaveBeenCalledTimes(1);
});

it('shows relevant loading and empty states and opens an earnings detail', async () => {
  const view = render(<DayEventsList selectedDate={selectedDate} events={[]} isLoading />);
  expect(screen.getByText(/Finansal olaylar yükleniyor/)).toBeOnTheScreen();
  view.rerender(<DayEventsList selectedDate={selectedDate} events={[]}
    activeFilter="portfolio" emptyStateKind="empty_portfolio" />);
  expect(screen.getByText('Portföyünüzde Açık Pozisyon Bulunmuyor')).toBeOnTheScreen();
  view.rerender(<DayEventsList selectedDate={selectedDate} events={[]}
    activeFilter="watchlist" emptyStateKind="empty_watchlist" />);
  expect(screen.getByText('İzleme Listeniz Boş')).toBeOnTheScreen();
  view.rerender(<DayEventsList selectedDate={selectedDate} events={[]} activeFilter="economic" />);
  expect(screen.getByText('Seçili filtreye uygun bildirim yok')).toBeOnTheScreen();
  view.rerender(<DayEventsList selectedDate={selectedDate} events={[earnings, economic]} />);
  expect(screen.getByText('TÜFE')).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('THYAO detaylarını aç'));
  expect(await screen.findByText('Portföydeki Açık Pozisyonunuz')).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Kapat'));
  expect(screen.queryByText('Portföydeki Açık Pozisyonunuz')).toBeNull();
});

it('opens secure sources and reports both calendar export outcomes', async () => {
  const close = jest.fn();
  const canOpen = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const exporter = jest.mocked(exportEventsToAppleCalendar);
  exporter.mockResolvedValueOnce({ success: true, addedCount: 1 }).mockResolvedValueOnce({
    success: false, addedCount: 0, error: 'İzin verilmedi',
  });
  const view = render(<EventDetailModal visible event={earnings} onClose={close} />);
  fireEvent.press(screen.getByText(/Resmi Kaynağı/));
  await waitFor(() => expect(open).toHaveBeenCalledWith(earnings.sourceUrl));
  canOpen.mockResolvedValue(false);
  fireEvent.press(screen.getByText(/Resmi Kaynağı/));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Bağlantı Açılamadı', expect.any(String)));
  fireEvent.press(screen.getByText('Apple Takvime Ekle'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Apple Takvime Eklendi! ', expect.any(String), expect.any(Array)));
  const buttons = jest.mocked(Alert.alert).mock.lastCall?.[2] as AlertButton[];
  buttons[0].onPress?.();
  expect(openAppleCalendar).toHaveBeenCalledWith(new Date(earnings.dateKey));
  fireEvent.press(screen.getByText('Apple Takvime Ekle'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Aktarım Yapılamadı', 'İzin verilmedi'));
  view.rerender(<EventDetailModal visible event={{ ...economic, sourceUrl: 'http://unsafe.example.com' }} onClose={close} />);
  expect(screen.getByText('EKONOMİK GÖSTERGE')).toBeOnTheScreen();
  expect(screen.queryByText(/Resmi Kaynağı/)).toBeNull();
  fireEvent.press(screen.getByLabelText('Kapat'));
  expect(close).toHaveBeenCalledTimes(1);
});

it('explains the empty day differently for active portfolio and watchlist filters', async () => {
  const view = render(<DayEventsList selectedDate={selectedDate} events={[]} activeFilter="portfolio"
    hasOpenPositionsInPortfolio />);
  expect(screen.getByText('Portföyünüzde Bilanço Olayı Yok')).toBeOnTheScreen();
  view.rerender(<DayEventsList selectedDate={selectedDate} events={[]} activeFilter="watchlist"
    hasWatchlistItems />);
  expect(screen.getByText('İzleme Listenizde Takvim Olayı Yok')).toBeOnTheScreen();
  view.rerender(<DayEventsList selectedDate={selectedDate} events={[earnings]} activeFilter="watchlist" />);
  fireEvent.press(screen.getByLabelText('THYAO detaylarını aç'));
  expect(await screen.findAllByText('İZLEME LİSTEMDE')).not.toHaveLength(0);
});
