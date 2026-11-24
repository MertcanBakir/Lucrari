import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useAuth } from '@/context/auth-context';
import { useRemoteDiagnostics } from '@/hooks/use-remote-diagnostics';
import { logger } from '@/utils/logger';
import { getSupabaseClient } from '@/services/supabase/client';

jest.mock('react-native/Libraries/AppState/AppState', () => ({ __esModule: true, default: { currentState: 'active', addEventListener: jest.fn() } }));
jest.mock('@react-native-async-storage/async-storage', () => {
  let data: string | null = null;
  return { __esModule: true, default: { getItem: jest.fn(async () => data), setItem: jest.fn(async (_: string, v: string) => { data = v; }) } };
});
jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/services/supabase/client', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0' } } }));
const rpc = jest.fn();
const session = jest.fn();
const original = process.env.EXPO_PUBLIC_DIAGNOSTICS_ENABLED;
beforeAll(() => { process.env.EXPO_PUBLIC_DIAGNOSTICS_ENABLED = 'true'; });
// Expo replaces public env expressions at bundle time. Set before importing the hook in this test file.
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  jest.mocked(useAuth).mockReturnValue({ userId: 'owner', isAuthReady: true } as never);
  session.mockResolvedValue({ data: { session: { user: { id: 'owner' } } }, error: null });
  rpc.mockReturnValue({ abortSignal: jest.fn().mockResolvedValue({ error: null }) });
  jest.mocked(getSupabaseClient).mockReturnValue({ auth: { getSession: session }, rpc } as never);
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  logger.setSilent(true);
});
afterEach(() => { logger.setSilent(false); jest.restoreAllMocks(); jest.useRealTimers(); });
afterAll(() => { if (original === undefined) delete process.env.EXPO_PUBLIC_DIAGNOSTICS_ENABLED; else process.env.EXPO_PUBLIC_DIAGNOSTICS_ENABLED = original; });
it('sends selected log metadata once and cleans up listeners', async () => {
  const hook = renderHook(useRemoteDiagnostics); await act(async () => {});
  act(() => logger.warn('AnalysisService', 'analysis.request.failed', { message: 'private', context: { status: 503 } }));
  await act(async () => {});
  await act(async () => jest.advanceTimersByTime(5000));
  expect(rpc).toHaveBeenCalledWith('submit_mobile_diagnostics', expect.objectContaining({ p_expected_user: 'owner', p_entries: [expect.objectContaining({ event: 'analysis.request.failed', status: 503, environment: 'preview' })] }));
  expect(JSON.stringify(rpc.mock.calls)).not.toContain('private');
  hook.unmount();
});
it('does not send when session belongs to another account', async () => {
  session.mockResolvedValue({ data: { session: { user: { id: 'other' } } }, error: null });
  const hook = renderHook(useRemoteDiagnostics); await act(async () => {});
  act(() => logger.warn('AnalysisService', 'analysis.request.failed', { message: 'private' }));
  await act(async () => {}); await act(async () => jest.advanceTimersByTime(5000));
  expect(rpc).not.toHaveBeenCalled(); hook.unmount();
});
it('does nothing when preview diagnostics are disabled', async () => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS_ENABLED = 'false';
  const hook = renderHook(useRemoteDiagnostics); await act(async () => {});
  expect(getSupabaseClient).not.toHaveBeenCalled(); hook.unmount();
  process.env.EXPO_PUBLIC_DIAGNOSTICS_ENABLED = 'true';
});
