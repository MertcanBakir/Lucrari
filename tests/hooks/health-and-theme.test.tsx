import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Native from 'react-native';
import { useAuth } from '@/context/auth-context';
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
