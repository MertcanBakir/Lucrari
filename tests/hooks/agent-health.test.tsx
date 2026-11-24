import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '@/context/auth-context';
import { useAgentHealth } from '@/hooks/use-agent-health';
import { AnalysisApiError, checkAnalysisHealth, fetchAgentHealth } from '@/services/analysis/analysis-service';
import { requestServerManagement } from '@/services/analysis/server-management-service';
import { normalizeAgentHealth } from '@/utils/agent-health';
import { hostHealthPayload } from '../ui/agent-health-fixtures';
import { deferred } from '../helpers/deferred';

jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: { currentState: 'active', addEventListener: jest.fn() },
}));

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/services/analysis/analysis-service', () => ({
  ...jest.requireActual('@/services/analysis/analysis-service'),
  fetchAgentHealth: jest.fn(), checkAnalysisHealth: jest.fn(),
}));

jest.mock('@/services/analysis/server-management-service', () => ({ ...jest.requireActual('@/services/analysis/server-management-service'), requestServerManagement: jest.fn() }));
const load = jest.mocked(fetchAgentHealth);
const report = normalizeAgentHealth(hostHealthPayload);
let changeAppState: (state: AppStateStatus) => void;
const remove = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockFocused = true;
  jest.replaceProperty(AppState, 'currentState', 'active');
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    changeAppState = listener;
    return { remove };
  });
  jest.mocked(useAuth).mockReturnValue({ userId: 'owner', isAuthReady: true } as ReturnType<typeof useAuth>);
  jest.mocked(requestServerManagement).mockReset().mockResolvedValue('running');
  jest.mocked(checkAnalysisHealth).mockReset().mockResolvedValue(true);
  load.mockReset().mockResolvedValue(report);
});

afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it('polls only while the detail screen is focused and foregrounded and cleans up', async () => {
  const hook = renderHook(() => useAgentHealth(true));
  await act(async () => {});
  expect(hook.result.current.report).toBe(report);
  await act(async () => jest.advanceTimersByTime(12_000));
  expect(load).toHaveBeenCalledTimes(2);
  act(() => changeAppState('background'));
  await act(async () => jest.advanceTimersByTime(24_000));
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => changeAppState('active'));
  expect(load).toHaveBeenCalledTimes(3);
  mockFocused = false;
  hook.rerender(undefined);
  await act(async () => jest.advanceTimersByTime(12_000));
  expect(load).toHaveBeenCalledTimes(3);
  hook.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

it('discards another account pending response', async () => {
  const pending = deferred<typeof report>();
  load.mockReturnValueOnce(pending.promise);
  const hook = renderHook(() => useAgentHealth(true));
  await act(async () => {});
  const firstSignal = load.mock.calls[0][1];
  jest.mocked(useAuth).mockReturnValue({ userId: 'other', isAuthReady: true } as ReturnType<typeof useAuth>);
  await act(async () => hook.rerender(undefined));
  expect(firstSignal?.aborted).toBe(true);
  await act(async () => pending.resolve({ resources: null }));
  expect(hook.result.current.report).toBe(report);
});

it.each([
  [403, 'FORBIDDEN', 'forbidden'], [401, 'UNAUTHORIZED', 'unauthorized'],
  [null, 'ANALYSIS_AUTH_REQUIRED', 'unauthorized'], [null, 'ANALYSIS_NETWORK_ERROR', 'unreachable'],
  [null, 'ANALYSIS_TIMEOUT', 'unreachable'], [429, 'RATE_LIMITED', 'unreachable'],
] as const)('clears old measurements on %s %s', async (status, code, expected) => {
  const hook = renderHook(() => useAgentHealth(true));
  await act(async () => {});
  load.mockRejectedValueOnce(new AnalysisApiError({ message: 'safe message', status, code, isRetryable: false }));
  await act(() => hook.result.current.refresh());
  expect(hook.result.current.status).toBe(expected);
  expect(hook.result.current.report).toBeNull();
});

it('handles malformed replies and avoids overlapping requests', async () => {
  const pending = deferred<typeof report>();
  load.mockReturnValueOnce(pending.promise);
  const hook = renderHook(() => useAgentHealth(true));
  await act(async () => {});
  await act(async () => {
    jest.advanceTimersByTime(24_000);
    await hook.result.current.refresh();
  });
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error('invalid contract')));
  expect(hook.result.current).toMatchObject({ status: 'unreachable', report: null });
});

it('never contacts management or health when signed out', async () => {
  jest.mocked(useAuth).mockReturnValue({ userId: null, isAuthReady: false } as ReturnType<typeof useAuth>);
  const hook = renderHook(() => useAgentHealth());
  jest.mocked(useAuth).mockReturnValue({ userId: null, isAuthReady: true } as ReturnType<typeof useAuth>);
  await act(async () => hook.rerender(undefined));
  expect(hook.result.current.status).toBe('unauthorized');
  expect(load).not.toHaveBeenCalled();
  expect(checkAnalysisHealth).not.toHaveBeenCalled();
  expect(requestServerManagement).not.toHaveBeenCalled();
});

it.each(['stopped', 'pending', 'stopping'] as const)('never calls either health endpoint when EC2 is %s', async state => {
  jest.mocked(requestServerManagement).mockResolvedValue(state);
  const hook = renderHook(() => useAgentHealth(true));
  await act(async () => {});
  await act(async () => jest.advanceTimersByTime(24_000));
  expect(hook.result.current.status).toBe(state);
  expect(load).not.toHaveBeenCalled(); expect(checkAnalysisHealth).not.toHaveBeenCalled();
  await act(async () => hook.result.current.refresh());
  expect(load).not.toHaveBeenCalled(); expect(checkAnalysisHealth).not.toHaveBeenCalled();
});

it('checks menu liveness once after running is verified, without resource polling', async () => {
  renderHook(() => useAgentHealth()); await act(async () => {});
  expect(checkAnalysisHealth).toHaveBeenCalledTimes(1); expect(load).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(24_000));
  expect(checkAnalysisHealth).toHaveBeenCalledTimes(1);
});

it('stops resource polling when the next management check confirms stopped', async () => {
  const hook = renderHook(() => useAgentHealth(true)); await act(async () => {});
  jest.mocked(requestServerManagement).mockResolvedValue('stopped');
  await act(async () => jest.advanceTimersByTime(12_000));
  expect(hook.result.current.status).toBe('stopped'); expect(hook.result.current.report).toBeNull();
  await act(async () => jest.advanceTimersByTime(120_000)); expect(load).toHaveBeenCalledTimes(1);
});
