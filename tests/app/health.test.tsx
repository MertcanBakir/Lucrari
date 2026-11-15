import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import SupabaseHealthScreen from '@/app/supabase-health';
import SystemHealthScreen from '@/app/system-health';
import { useSupabaseHealth } from '@/hooks/use-supabase-health';
import { useSystemHealth } from '@/hooks/use-system-health';
import { evaluateOverallHealth, groupJobsIntoSections, normalizeSystemHealthResponse } from '@/utils/system-health-formatters';
import { date } from '../ui/fixtures';

const mockBack = jest.fn();
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock('@/hooks/use-supabase-health', () => ({ useSupabaseHealth: jest.fn() }));
jest.mock('@/hooks/use-system-health', () => ({ useSystemHealth: jest.fn() }));

const refetch = jest.fn().mockResolvedValue(undefined);
beforeEach(() => jest.clearAllMocks());

it('refreshes and navigates back from Supabase diagnostics', async () => {
  const state = { report: null, isLoading: true, isRefetching: false, error: null, lastChecked: null, refetch };
  const useHealth = jest.mocked(useSupabaseHealth).mockReturnValue(state);
  const view = render(<SupabaseHealthScreen />);
  fireEvent.press(screen.getByLabelText('Bağlantıyı Yenile'));
  await waitFor(() => expect(refetch).toHaveBeenCalled());
  fireEvent.press(screen.getByLabelText('Geri Dön'));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  useHealth.mockReturnValue({ ...state, isRefetching: true });
  view.rerender(<SupabaseHealthScreen />);
  expect(screen.getByLabelText('Bağlantıyı Yenile')).toBeDisabled();
});

it('switches system health from initial loading to error, retries and renders real job sections', async () => {
  const state = {
    report: null, isLoading: true, isRefreshing: false, isStale: false, error: null, refetch, lastChecked: 0,
  };
  const useHealth = jest.mocked(useSystemHealth).mockReturnValue(state);
  const view = render(<SystemHealthScreen />);
  expect(screen.getByText(/Sistem durumu kontrol ediliyor/)).toBeOnTheScreen();
  useHealth.mockReturnValue({ ...state, isLoading: false, error: 'Connection unavailable' });
  view.rerender(<SystemHealthScreen />);
  expect(screen.getByText('Connection unavailable')).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Tekrar Dene'));
  await waitFor(() => expect(refetch).toHaveBeenCalledWith(true));
  const items = normalizeSystemHealthResponse([]).items.slice(0, 1);
  const overall = evaluateOverallHealth(items, date);
  const sections = groupJobsIntoSections(items);
  useHealth.mockReturnValue({
    ...state, isLoading: false, report: { items, overall, sections, checkedAt: date, isStale: false, isIncomplete: true },
  });
  view.rerender(<SystemHealthScreen />);
  expect(screen.getByText(items[0].displayName)).toBeOnTheScreen();
  expect(screen.getByText(sections[0].title.toUpperCase())).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Geri Dön'));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
});

it('shows an empty health report and prevents duplicate refreshes while retrying on web', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  jest.mocked(useColorScheme).mockReturnValue('dark');
  const state = { report: null, isLoading: false, isRefreshing: false, isStale: false,
    error: 'unavailable', refetch, lastChecked: 0 };
  const useHealth = jest.mocked(useSystemHealth).mockReturnValue(state);
  const view = render(<SystemHealthScreen />);
  fireEvent.press(screen.getByLabelText('Geri Dön'));
  fireEvent.press(screen.getByLabelText('Durumu Yenile'));
  await waitFor(() => expect(refetch).toHaveBeenCalledWith(true));
  expect(mockBack).toHaveBeenCalledTimes(1);

  useHealth.mockReturnValue({ ...state, isRefreshing: true });
  view.rerender(<SystemHealthScreen />);
  expect(screen.getByLabelText('Tekrar Dene')).toBeDisabled();
  expect(screen.getByLabelText('Durumu Yenile')).toBeDisabled();
  useHealth.mockReturnValue({ ...state, error: null });
  view.rerender(<SystemHealthScreen />);
  expect(screen.getByText(/Listelenecek servis durumu bulunamadı/)).toBeOnTheScreen();
});

afterEach(() => jest.restoreAllMocks());
