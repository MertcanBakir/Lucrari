import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Native from 'react-native';
import { useAuth } from '@/context/auth-context';
import { useAppTheme } from '@/context/theme-context';
import { deferred } from '../helpers/deferred';
import { Colors } from '@/constants/theme';
import { useAnalysisHealth } from '@/hooks/use-analysis-health';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useColorScheme as useWebColorScheme } from '@/hooks/use-color-scheme.web';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useSupabaseHealth } from '@/hooks/use-supabase-health';
import { useSystemHealth } from '@/hooks/use-system-health';
import { checkAnalysisHealth } from '@/services/analysis/analysis-service';
import * as supabaseHealth from '@/services/supabase/health';
import * as systemHealth from '@/services/system-health/system-health-service';
import { evaluateOverallHealth } from '@/utils/system-health-formatters';
import { date } from '../ui/fixtures';

let mockFocused = true;
let mockFocusCallback: (() => void) | undefined;
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
  useFocusEffect: (callback: () => void) => { mockFocusCallback = callback; },
}));
jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/services/analysis/analysis-service', () => ({ checkAnalysisHealth: jest.fn() }));
jest.mock('@/services/supabase/health', () => ({
  checkSupabaseHealth: jest.fn(), getSupabaseHealthCacheSnapshot: jest.fn(), subscribeSupabaseHealth: jest.fn(),
}));
jest.mock('@/services/system-health/system-health-service', () => ({
  fetchSystemHealth: jest.fn(), getSystemHealthCacheSnapshot: jest.fn(), subscribeSystemHealth: jest.fn(),
}));

const backend = jest.mocked(supabaseHealth);
const system = jest.mocked(systemHealth);
const report = {
  overallStatus: 'healthy' as const, supabaseUrl: 'https://example.com', isConfigured: true,
  checks: [], averageLatencyMs: 25, timestamp: date, errorMessage: null,
};
const systemReport = {
  items: [], sections: [], isStale: false, isIncomplete: false,
  checkedAt: date, overall: evaluateOverallHealth([], date),
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'light' } as ReturnType<typeof useAppTheme>);
  mockFocused = true;
  backend.subscribeSupabaseHealth.mockReturnValue(jest.fn());
  system.subscribeSystemHealth.mockReturnValue(jest.fn());
  jest.mocked(useAuth).mockReturnValue({ isAuthReady: true, isAuthenticated: true } as ReturnType<typeof useAuth>);
});

afterEach(() => jest.restoreAllMocks());

it('uses theme values and hydrates the browser color scheme', () => {
  jest.spyOn(Native, 'useColorScheme').mockReturnValue('dark');
  const { result } = renderHook(() => ({
    native: useColorScheme(), web: useWebColorScheme(), fallback: useThemeColor({}, 'text'),
    override: useThemeColor({ light: '#123456' }, 'text'),
  }));
  expect(result.current).toEqual({ native: 'light', web: 'dark', fallback: Colors.light.text, override: '#123456' });
});

it('checks Agent health only when focused and discards an obsolete request', async () => {
  let finish: (value: boolean) => void = () => {};
  const request = new Promise<boolean>((resolve) => { finish = resolve; });
  const health = jest.mocked(checkAnalysisHealth).mockReturnValueOnce(request).mockRejectedValueOnce('offline');
  const hook = renderHook(() => useAnalysisHealth());
  const signal = health.mock.calls[0][0];
  expect(hook.result.current).toBe('checking');
  mockFocused = false;
  hook.rerender(undefined);
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(true));
  expect(hook.result.current).toBe('checking');
  mockFocused = true;
  hook.rerender(undefined);
  await waitFor(() => expect(hook.result.current).toBe('unreachable'));
});

it('loads a Supabase report and keeps it during a failed manual refresh', async () => {
  const unsubscribe = jest.fn();
  backend.subscribeSupabaseHealth.mockReturnValue(unsubscribe);
  backend.checkSupabaseHealth.mockResolvedValueOnce(report).mockRejectedValueOnce('offline');
  const hook = renderHook(() => useSupabaseHealth());
  expect(hook.result.current.isLoading).toBe(true);
  await waitFor(() => expect(hook.result.current.report).toBe(report));
  await act(() => hook.result.current.refetch());
  expect(backend.checkSupabaseHealth).toHaveBeenLastCalledWith({ forceRefresh: true });
  expect(hook.result.current.error?.message).toMatch(/Bilinmeyen/);
  expect(hook.result.current.report).toBe(report);
  const publish = backend.subscribeSupabaseHealth.mock.calls[0][0];
  act(() => publish({ ...report, averageLatencyMs: 50 }));
  expect(hook.result.current.report?.averageLatencyMs).toBe(50);
  hook.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('refreshes system health, preserves stale data, and updates from a subscription', async () => {
  const unsubscribe = jest.fn();
  system.subscribeSystemHealth.mockReturnValue(unsubscribe);
  system.fetchSystemHealth.mockResolvedValueOnce(systemReport).mockRejectedValueOnce(new Error('offline'));
  const hook = renderHook(() => useSystemHealth());
  await waitFor(() => expect(hook.result.current.report).toBe(systemReport));
  await act(() => hook.result.current.refetch());
  expect(system.fetchSystemHealth).toHaveBeenLastCalledWith({ forceRefresh: true });
  expect(hook.result.current).toMatchObject({ isStale: true, error: 'offline', report: systemReport });
  const publish = system.subscribeSystemHealth.mock.calls[0][0];
  act(() => publish(systemReport));
  expect(hook.result.current).toMatchObject({ isStale: false, error: null });
  hook.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('refreshes an old system snapshot on focus once authentication is ready', async () => {
  const auth = jest.mocked(useAuth);
  auth.mockReturnValue({ isAuthReady: false } as ReturnType<typeof useAuth>);
  system.getSystemHealthCacheSnapshot.mockReturnValue({ report: systemReport, timestamp: 1 });
  system.fetchSystemHealth.mockResolvedValue(systemReport);
  const hook = renderHook(() => useSystemHealth());
  act(() => mockFocusCallback?.());
  expect(system.fetchSystemHealth).not.toHaveBeenCalled();
  auth.mockReturnValue({ isAuthReady: true } as ReturnType<typeof useAuth>);
  hook.rerender(undefined);
  act(() => mockFocusCallback?.());
  await waitFor(() => expect(hook.result.current.lastChecked).toBeGreaterThan(1));
});

it('starts Supabase health from cache and ignores a late refresh after unmount', async () => {
  const pending = deferred<typeof report>();
  backend.getSupabaseHealthCacheSnapshot.mockReturnValue({ report, timestamp: 1 });
  backend.checkSupabaseHealth.mockReturnValueOnce(pending.promise);
  const hook = renderHook(() => useSupabaseHealth());
  expect(hook.result.current).toMatchObject({ report, isLoading: false, lastChecked: new Date(date) });
  expect(backend.checkSupabaseHealth).not.toHaveBeenCalled();
  let refreshing: Promise<void>;
  act(() => { refreshing = hook.result.current.refetch(); });
  expect(hook.result.current.isRefetching).toBe(true);
  hook.unmount();
  act(() => backend.subscribeSupabaseHealth.mock.calls[0][0]({ ...report, averageLatencyMs: 10 }));
  await act(async () => {
    pending.resolve({ ...report, averageLatencyMs: 10 });
    await refreshing;
  });
  expect(hook.result.current.report).toBe(report);
});

it('respects disabled automatic checks and surfaces a manual Error', async () => {
  backend.checkSupabaseHealth.mockRejectedValueOnce(new Error('database unavailable'));
  const hook = renderHook(() => useSupabaseHealth({ autoCheck: false }));
  expect(hook.result.current.isLoading).toBe(false);
  expect(backend.checkSupabaseHealth).not.toHaveBeenCalled();
  await act(() => hook.result.current.refetch());
  expect(hook.result.current.error?.message).toBe('database unavailable');
});

it('ignores rejected health requests after unmount', async () => {
  const pending = deferred<typeof report>();
  backend.checkSupabaseHealth.mockReturnValueOnce(pending.promise);
  const hook = renderHook(() => useSupabaseHealth());
  hook.unmount();
  await act(async () => pending.reject(new Error('late failure')));
  expect(hook.result.current.error).toBeNull();
});

it('leaves a stale system snapshot timestamp unchanged and handles disabled auto-fetch', async () => {
  system.getSystemHealthCacheSnapshot.mockReturnValue({ report: systemReport, timestamp: 7 });
  system.fetchSystemHealth.mockResolvedValueOnce({ ...systemReport, isStale: true });
  const hook = renderHook(() => useSystemHealth({ autoFetch: false }));
  act(() => mockFocusCallback?.());
  expect(system.fetchSystemHealth).not.toHaveBeenCalled();
  await act(() => hook.result.current.refetch(false));
  expect(system.fetchSystemHealth).toHaveBeenCalledWith({ forceRefresh: false });
  expect(hook.result.current).toMatchObject({ lastChecked: 7, isStale: true });
});

it('discards obsolete system health errors after a newer refresh succeeds', async () => {
  const request = deferred<typeof systemReport>();
  system.fetchSystemHealth.mockReturnValueOnce(request.promise).mockResolvedValueOnce(systemReport);
  const hook = renderHook(() => useSystemHealth());
  await act(() => hook.result.current.refetch());
  await act(async () => request.reject('late failure'));
  expect(hook.result.current).toMatchObject({ error: null, report: systemReport });
});

it('reports an initial system health failure without marking nonexistent data stale', async () => {
  system.fetchSystemHealth.mockRejectedValueOnce('offline');
  const hook = renderHook(() => useSystemHealth());
  await waitFor(() => expect(hook.result.current.error).toBe('Sistem durumu bilgisi alınamadı.'));
  expect(hook.result.current.isStale).toBe(false);
});
