import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '@/context/auth-context';
import { useServerManagement, SERVER_TRANSITION_TIMEOUT_MS } from '@/hooks/use-server-management';
import { checkAnalysisHealth, fetchAgentHealth } from '@/services/analysis/analysis-service';
import { requestServerManagement, ServerManagementError } from '@/services/analysis/server-management-service';
import { deferred } from '../helpers/deferred';

jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true, default: { currentState: 'active', addEventListener: jest.fn() },
}));
let mockFocused = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/services/analysis/analysis-service', () => ({ ...jest.requireActual('@/services/analysis/analysis-service'), checkAnalysisHealth: jest.fn(), fetchAgentHealth: jest.fn() }));
jest.mock('@/services/analysis/server-management-service', () => ({ ...jest.requireActual('@/services/analysis/server-management-service'), requestServerManagement: jest.fn() }));
const load = jest.mocked(requestServerManagement);
const health = jest.mocked(checkAnalysisHealth);
let appChange: (state: AppStateStatus) => void;
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockFocused = true;
  jest.mocked(useAuth).mockReturnValue({ userId: 'owner', isAuthReady: true } as never);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appChange = listener; return { remove: jest.fn() };
  });
  jest.mocked(fetchAgentHealth).mockReset().mockResolvedValue({ resources: null });
  load.mockReset().mockResolvedValue('stopped'); health.mockReset().mockResolvedValue(true);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
it('waits for a session and does not call management when signed out', async () => {
  jest.mocked(useAuth).mockReturnValue({ userId: null, isAuthReady: true } as never);
  renderHook(useServerManagement);
  await act(async () => {}); expect(load).not.toHaveBeenCalled();
});
it('starts once, polls pending then running until health passes, then stops polling', async () => {
  const hook = renderHook(useServerManagement); await act(async () => {});
  load.mockResolvedValueOnce('pending').mockResolvedValue('running');
  await act(async () => { void hook.result.current.changeState('start'); void hook.result.current.changeState('start'); });
  expect(load.mock.calls.filter(c => c[0] === 'start')).toHaveLength(1);
  health.mockResolvedValueOnce(false).mockResolvedValue(true);
  await act(async () => jest.advanceTimersByTime(5000));
  expect(hook.result.current.apiReady).toBe(false);
  await act(async () => jest.advanceTimersByTime(5000));
  expect(hook.result.current.apiReady).toBe(true);
  const count = load.mock.calls.length;
  await act(async () => jest.advanceTimersByTime(30000)); expect(load).toHaveBeenCalledTimes(count);
});
it('retains last EC2 state on failure and requires refresh before another action', async () => {
  load.mockResolvedValue('running');
  const hook = renderHook(useServerManagement); await act(async () => {});
  load.mockRejectedValueOnce(new ServerManagementError('Bekleyen veya çalışan analiz var. Sunucu durdurulmadı.', 409));
  await act(async () => hook.result.current.changeState('stop'));
  expect(hook.result.current.state).toBe('running'); expect(hook.result.current.error).toContain('Sunucu durdurulmadı');
  const count = load.mock.calls.length;
  await act(async () => hook.result.current.changeState('stop')); expect(load).toHaveBeenCalledTimes(count);
  await act(async () => hook.result.current.refresh()); expect(hook.result.current.error).toBeNull();
});
it.each([401, 403, 503])('handles %s and retry', async status => {
  load.mockRejectedValueOnce(new ServerManagementError('failure', status));
  const hook = renderHook(useServerManagement); await act(async () => {});
  expect(hook.result.current.denied).toBe(status === 403);
  await act(async () => hook.result.current.refresh()); expect(hook.result.current.state).toBe('stopped');
});
it('bounds transitions and cleans up on blur/background/account change', async () => {
  load.mockResolvedValue('pending');
  const hook = renderHook(useServerManagement); await act(async () => {});
  await act(async () => jest.advanceTimersByTime(SERVER_TRANSITION_TIMEOUT_MS));
  expect(hook.result.current.error).toContain('Geçiş');
  const count = load.mock.calls.length;
  await act(async () => jest.advanceTimersByTime(10000)); expect(load).toHaveBeenCalledTimes(count);
  await act(async () => hook.result.current.refresh());
  act(() => appChange('background'));
  await act(async () => jest.advanceTimersByTime(10000)); expect(load).toHaveBeenCalledTimes(count + 1);
  await act(async () => appChange('active'));
  mockFocused = false; hook.rerender(undefined);
  const count2 = load.mock.calls.length;
  await act(async () => jest.advanceTimersByTime(10000)); expect(load).toHaveBeenCalledTimes(count2);
  hook.unmount();
});
it('discards stale account responses and aborts unfinished work', async () => {
  const pending = deferred<'running'>(); load.mockReturnValueOnce(pending.promise);
  const hook = renderHook(useServerManagement);
  const signal = load.mock.calls[0][2];
  jest.mocked(useAuth).mockReturnValue({ userId: 'other', isAuthReady: true } as never);
  await act(async () => hook.rerender(undefined));
  await act(async () => pending.resolve('running'));
  expect(signal?.aborted).toBe(true); expect(hook.result.current.state).toBe('stopped');
});
it('handles failed health and generic management errors', async () => {
  load.mockResolvedValueOnce('running'); health.mockRejectedValue(new Error('network'));
  const hook = renderHook(useServerManagement); await act(async () => {});
  expect(hook.result.current.apiReady).toBe(false);
  load.mockRejectedValueOnce(new Error('unknown'));
  await act(async () => hook.result.current.refresh()); expect(hook.result.current.error).toContain('alınamadı');
});

it('tracks stopping to stopped without calling the analysis host', async () => {
  load.mockResolvedValueOnce('running');
  const hook = renderHook(useServerManagement); await act(async () => {});
  health.mockClear();
  load.mockResolvedValueOnce('stopping').mockResolvedValue('stopped');
  await act(async () => hook.result.current.changeState('stop'));
  expect(hook.result.current.state).toBe('stopping');
  await act(async () => jest.advanceTimersByTime(5000));
  expect(hook.result.current.state).toBe('stopped'); expect(health).not.toHaveBeenCalled();
});
it('keeps forbidden controls hidden after subsequent network failure', async () => {
  load.mockRejectedValueOnce(new ServerManagementError('Forbidden', 403));
  const hook = renderHook(useServerManagement); await act(async () => {});
  load.mockRejectedValueOnce(new ServerManagementError('Network'));
  await act(async () => hook.result.current.refresh());
  expect(hook.result.current.denied).toBe(true);
});
it('ignores a stale confirmation callback after screen blur', async () => {
  load.mockResolvedValue('running');
  const hook = renderHook(useServerManagement); await act(async () => {});
  const stop = hook.result.current.changeState;
  mockFocused = false; hook.rerender(undefined);
  await act(async () => stop('stop'));
  expect(load.mock.calls.filter(c => c[0] === 'stop')).toHaveLength(0);
});
it('preserves the verified state after foreground refresh fails', async () => {
  const hook = renderHook(useServerManagement); await act(async () => {});
  act(() => appChange('background'));
  load.mockRejectedValueOnce(new ServerManagementError('Unavailable', 503));
  await act(async () => appChange('active'));
  expect(hook.result.current.state).toBe('stopped');
  expect(hook.result.current.error).toBe('Unavailable');
});
it('starts a fresh bounded readiness window when a healthy API later becomes unreachable', async () => {
  load.mockResolvedValue('running');
  const hook = renderHook(() => useServerManagement(true));
  await act(async () => {});
  expect(hook.result.current.apiReady).toBe(true);
  jest.setSystemTime(Date.now() + 10 * 60_000);
  jest.mocked(fetchAgentHealth).mockRejectedValue(new Error('offline'));
  await act(async () => jest.advanceTimersByTime(12_000));
  expect(hook.result.current.state).toBe('running');
  expect(hook.result.current.apiMessage).toBe('API’ye henüz ulaşılamıyor');
  expect(hook.result.current.error).toBeNull();
  await act(async () => jest.advanceTimersByTime(5000));
  expect(fetchAgentHealth).toHaveBeenCalledTimes(3);
});
