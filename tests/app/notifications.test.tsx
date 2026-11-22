import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import NotificationSettingsScreen from '@/app/notification-settings';
import NotificationPortfolioScreen from '@/app/notification-portfolio';
import { useNotificationPreferences } from '@/hooks/use-notification-preferences';
import { useNotificationDevice } from '@/hooks/use-notifications';
import { useNotificationPortfolio } from '@/hooks/use-notification-portfolio';
import { useAppTheme } from '@/context/theme-context';
import { formatCurrency } from '@/utils/financial-formatters';
import type { NotificationDeviceStatus } from '@/types/notifications';

jest.mock('@/hooks/use-notification-preferences', () => ({ useNotificationPreferences: jest.fn() }));
jest.mock('@/hooks/use-notifications', () => ({ useNotificationDevice: jest.fn() }));
jest.mock('@/hooks/use-notification-portfolio', () => ({ useNotificationPortfolio: jest.fn() }));
const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }), useLocalSearchParams: () => ({}) }));
const p = { timezone: 'Europe/Istanbul', earnings_morning: true, watchlist_earnings: true, economic_reminders: true, earnings_today: true, earnings_tomorrow: true, earnings_midday: true, daily_portfolio: true, countries: ['TR', 'US'] as ('TR' | 'US')[], min_importance: 1 };
const state = { preferences: p, loading: false, error: null, saving: false, saved: false, update: jest.fn(), save: jest.fn(), reload: jest.fn(), authenticated: true };
const device = { status: 'registered' as NotificationDeviceStatus, retry: jest.fn() };
const portfolio = { data: { date: '2026-11-19', currency: 'USD' as const, dailyPnl: 20, capturedAt: '2026-11-20T00:00:00Z' }, loading: false, error: null, retry: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useNotificationPreferences).mockReturnValue(state);
  jest.mocked(useNotificationDevice).mockReturnValue(device);
  jest.mocked(useNotificationPortfolio).mockReturnValue(portfolio);
});
it('edits notification preferences, countries and importance while keeping timezone hidden', () => {
  render(<NotificationSettingsScreen />);
  expect(screen.getByText('PORTFÖY BİLDİRİMLERİ')).toBeOnTheScreen();
  expect(screen.getByText('GENEL BİLDİRİMLER')).toBeOnTheScreen();
  expect(screen.getAllByRole('switch')).toHaveLength(9);
  for (const [label, field] of [['Sabah portföy bilançoları', 'earnings_morning'], ['Takip listesi bilançoları', 'watchlist_earnings'], ['Ekonomik olay hatırlatmaları', 'economic_reminders'], ['Bugünün bilançoları', 'earnings_today'], ['Yarının bilançoları', 'earnings_tomorrow'], ['Şirket bazlı bilanço hatırlatmaları', 'earnings_midday'], ['Günlük portföy özeti', 'daily_portfolio']]) {
    fireEvent(screen.getByLabelText(label), 'valueChange', false);
    expect(state.update).toHaveBeenLastCalledWith({ ...p, [field]: false });
  }
  expect(screen.queryByLabelText('Saat dilimi')).toBeNull();
  expect(screen.queryByText('Europe/Istanbul')).toBeNull();
  expect(screen.getByText('TAKVİM & BÖLGE')).toBeOnTheScreen();
  fireEvent(screen.getByLabelText('TR'), 'valueChange', false); expect(state.update).toHaveBeenLastCalledWith({ ...p, countries: ['US'] });
  fireEvent(screen.getByLabelText('US'), 'valueChange', false); expect(state.update).toHaveBeenLastCalledWith({ ...p, countries: ['TR'] });
  fireEvent.press(screen.getByLabelText('Minimum önem 3')); expect(state.update).toHaveBeenLastCalledWith({ ...p, min_importance: 3 });
  fireEvent.press(screen.getByText('Tercihleri kaydet')); expect(state.save).toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Geri Dön' })); expect(mockBack).toHaveBeenCalled();
});
it('adds countries and displays saved and saving states', () => {
  jest.mocked(useNotificationPreferences).mockReturnValue({ ...state, preferences: { ...p, countries: [] }, saved: true });
  const view = render(<NotificationSettingsScreen />);
  fireEvent(screen.getByLabelText('TR'), 'valueChange', true); expect(state.update).toHaveBeenLastCalledWith({ ...p, countries: ['TR'] });
  expect(screen.getByText('Tercihler kaydedildi.')).toBeOnTheScreen();
  jest.mocked(useNotificationPreferences).mockReturnValue({ ...state, saving: true }); view.rerender(<NotificationSettingsScreen />);
  expect(screen.getByText('Kaydediliyor…')).toBeOnTheScreen();
});
it.each(['denied', 'error', 'loading', 'unsupported'] as const)('shows device status %s without claiming registration', async status => {
  jest.mocked(useNotificationDevice).mockReturnValue({ ...device, status });
  const open = jest.spyOn(Linking, 'openSettings').mockRejectedValueOnce(Error('unavailable'));
  render(<NotificationSettingsScreen />);
  if (status === 'denied') { fireEvent.press(screen.getByText('Telefon ayarlarını aç')); expect(open).toHaveBeenCalled(); }
  if (status === 'denied' || status === 'error') { fireEvent.press(screen.getByText('Cihaz kaydını tekrar dene')); expect(device.retry).toHaveBeenCalled(); }
  expect(screen.queryByText('Bu cihaz bildirimlere kayıtlı.')).toBeNull();
  await Promise.resolve(); open.mockRestore();
});
it('shows loading, auth and load failure states with retry', () => {
  jest.mocked(useNotificationPreferences).mockReturnValue({ ...state, preferences: null, loading: true });
  const view = render(<NotificationSettingsScreen />); expect(screen.getByLabelText('Tercihler yükleniyor')).toBeOnTheScreen();
  jest.mocked(useNotificationPreferences).mockReturnValue({ ...state, preferences: null, authenticated: false }); view.rerender(<NotificationSettingsScreen />);
  expect(screen.getByText(/oturum bekleniyor/)).toBeOnTheScreen();
  jest.mocked(useNotificationPreferences).mockReturnValue({ ...state, preferences: null, error: 'Bağlantı yok' }); view.rerender(<NotificationSettingsScreen />);
  fireEvent.press(screen.getByText('Tekrar dene')); expect(state.reload).toHaveBeenCalled();
});
it.each([20, -10, null, 0])('shows historical daily PNL %j with missing value distinct from zero', dailyPnl => {
  jest.mocked(useNotificationPortfolio).mockReturnValue({ ...portfolio, data: { ...portfolio.data, dailyPnl } });
  render(<NotificationPortfolioScreen />);
  expect(screen.getByText('Değerleme günü: 2026-11-19')).toBeOnTheScreen();
  expect(screen.queryByText('PORTFÖY DEĞERİ')).toBeNull();
  expect(screen.queryByText(formatCurrency(1000, 'USD'))).toBeNull();
  expect(screen.getByText(formatCurrency(dailyPnl, 'USD'))).toBeOnTheScreen();
  if (dailyPnl === null) expect(screen.getByText(/önceki gün verisi/)).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Geri Dön' })); expect(mockBack).toHaveBeenCalled();
});
it('supports dark mode and portfolio loading and failure', () => {
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'dark' } as ReturnType<typeof useAppTheme>);
  jest.mocked(useNotificationPortfolio).mockReturnValue({ ...portfolio, data: null, loading: true });
  const view = render(<NotificationPortfolioScreen />); expect(screen.getByLabelText('Günlük özet yükleniyor')).toBeOnTheScreen();
  jest.mocked(useNotificationPortfolio).mockReturnValue({ ...portfolio, data: null, error: 'Erişilemiyor' }); view.rerender(<NotificationPortfolioScreen />);
  fireEvent.press(screen.getByText('Tekrar dene')); expect(portfolio.retry).toHaveBeenCalled();
});

it('exposes selected importance and disables saving controls accessibly', () => {
  jest.mocked(useNotificationPreferences).mockReturnValue({ ...state, saving: true, preferences: { ...p, min_importance: 2 } });
  render(<NotificationSettingsScreen />);
  expect(screen.getByLabelText('Minimum önem 2')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true, disabled: true }));
  expect(screen.getByLabelText('Minimum önem 1')).toHaveProp('accessibilityState', expect.objectContaining({ selected: false, disabled: true }));
  expect(screen.queryByLabelText('Saat dilimi')).toBeNull();
  expect(screen.getByRole('button', { name: 'Kaydediliyor…' })).toHaveProp('accessibilityState', expect.objectContaining({ disabled: true, busy: true }));
  fireEvent.press(screen.getByRole('button', { name: 'Kaydediliyor…' }));
  expect(state.save).not.toHaveBeenCalled();
});

it('keeps v2 switches visible after a failed save and never claims success', () => {
  jest.mocked(useNotificationPreferences).mockReturnValue({ ...state, preferences: { ...p, earnings_today: false, watchlist_earnings: false },
    error: 'Tercihler kaydedilemedi.', saved: false });
  render(<NotificationSettingsScreen />);
  expect(screen.getByText('Tercihler kaydedilemedi.')).toBeOnTheScreen();
  expect(screen.queryByText('Tercihler kaydedildi.')).toBeNull();
  expect(screen.getByLabelText('Bugünün bilançoları')).toHaveProp('value', false);
  expect(screen.getByLabelText('Takip listesi bilançoları')).toHaveProp('value', false);
  fireEvent.press(screen.getByText('Tercihleri kaydet')); expect(state.save).toHaveBeenCalledTimes(1);
});
