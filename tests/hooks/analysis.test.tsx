import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/auth-context';
import { useAnalysis } from '@/hooks/use-analysis';
import { useAnalysisConnections } from '@/hooks/use-analysis-connections';
import * as analysisService from '@/services/analysis/analysis-service';
import type { AnalysisCreateInput, AnalysisHistoryResult, AnalysisProvidersResult, AnalysisRecord } from '@/types/analysis';
import { analysis, date, report } from '../ui/fixtures';
import { deferred } from '../helpers/deferred';

let mockFocused = false;
jest.mock('react-native', () => Object.create(jest.requireActual('react-native'), {
  AppState: { value: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) } },
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(),
}));
jest.mock('@/services/analysis/analysis-service', () => {
  const service = jest.requireActual<typeof import('@/services/analysis/analysis-service')>('@/services/analysis/analysis-service');
  return {
    AnalysisApiError: service.AnalysisApiError, isAnalysisApiError: service.isAnalysisApiError,
    isModelNotAllowedError: service.isModelNotAllowedError,
    fetchAnalysisHistory: jest.fn(), fetchAnalysisProviders: jest.fn(), fetchAnalysisReport: jest.fn(),
    fetchAnalysisStatus: jest.fn(), startAnalysis: jest.fn(), fetchAnalysisConnections: jest.fn(),
    createAnalysisConnection: jest.fn(), changeAnalysisConnection: jest.fn(),
  };
});

const service = jest.mocked(analysisService);
const storage = jest.mocked(AsyncStorage);
const running = { ...analysis, status: 'running', stage: 'analysis', finishedAt: null } as const;
const failed = { ...analysis, status: 'failed', errorCode: 'ANALYSIS_SERVER_ERROR' } as const;
const second = { ...analysis, id: 'second-analysis', ticker: 'THYAO' };
const connection = { id: 'connection-a', provider: 'openai', name: null, createdAt: date, verifiedAt: null };
const providers: AnalysisProvidersResult = {
  providers: [{ provider: 'chatgpt', authType: 'personal_chatgpt', models: ['m'], modelOptions: [{ id: 'm', name: 'Model' }] }],
  unavailable: {},
};
const input: AnalysisCreateInput = {
  ticker: 'AAPL', analysisDate: '2026-08-31', analysisHorizon: 'short_1m', language: 'tr',
  analysts: ['market'], authType: 'personal_chatgpt', quickModel: 'm', deepModel: 'm',
};
const historyPage = (items: AnalysisRecord[] = [], offset = 0, hasMore = false): AnalysisHistoryResult => ({
  items, offset, hasMore, limit: 20, totalCount: 2,
});
const setUser = (userId: string | null) => jest.mocked(useAuth).mockReturnValue({
  userId, isAuthReady: true, isAuthenticated: Boolean(userId), retryAuth: jest.fn(),
} as unknown as ReturnType<typeof useAuth>);
const problem = (code: string, status: number, isRetryable: boolean) =>
  new analysisService.AnalysisApiError({ code, status, isRetryable, message: code });

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = false;
  setUser('account-a');
  storage.getItem.mockReset().mockResolvedValue(null);
  service.fetchAnalysisHistory.mockReset().mockResolvedValue(historyPage());
  service.fetchAnalysisProviders.mockReset().mockResolvedValue(providers);
  service.fetchAnalysisStatus.mockReset().mockResolvedValue(analysis);
  service.fetchAnalysisReport.mockReset().mockResolvedValue(report);
  service.startAnalysis.mockReset().mockResolvedValue(running);
  service.fetchAnalysisConnections.mockReset().mockResolvedValue([connection]);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('runs connection changes for the current account and scopes late results on account switch', async () => {
  const pending = deferred<typeof connection[]>();
  service.fetchAnalysisConnections.mockReturnValueOnce(pending.promise);
  const hook = renderHook(({ owner }: { owner: string }) => useAnalysisConnections(owner, true), { initialProps: { owner: 'account-a' } });
  expect(hook.result.current.isLoading).toBe(true);
  await act(() => hook.result.current.refresh());
  expect(service.fetchAnalysisConnections).toHaveBeenCalledTimes(1);
  hook.rerender({ owner: 'account-b' });
  await waitFor(() => expect(hook.result.current.items).toEqual([connection]));
  await act(async () => pending.resolve([{ ...connection, id: 'private' }]));
  expect(hook.result.current.items).toEqual([connection]);
  await act(() => hook.result.current.create('openai', 'Personal', 'test-key'));
  await act(() => hook.result.current.verify(connection.id));
  await act(() => hook.result.current.remove(connection.id));
  expect(service.createAnalysisConnection).toHaveBeenCalledWith('account-b', 'openai', 'Personal', 'test-key');
  expect(service.changeAnalysisConnection).toHaveBeenCalledWith('account-b', connection.id, 'verify');
  expect(service.changeAnalysisConnection).toHaveBeenCalledWith('account-b', connection.id, 'remove');
  service.fetchAnalysisConnections.mockRejectedValueOnce(problem('CONNECTION_NOT_FOUND', 404, false));
  await act(() => hook.result.current.refresh());
  expect(hook.result.current.error).toBe('CONNECTION_NOT_FOUND');
  expect(hook.result.current.items).toEqual([connection]);
});

it('loads catalog and history, retries missing pages and deduplicates results', async () => {
  service.fetchAnalysisHistory.mockResolvedValueOnce(historyPage([analysis], 0, true));
  const hook = renderHook(() => useAnalysis());
  await waitFor(() => expect(hook.result.current.history).toEqual([analysis]));
  expect(hook.result.current.modelSelection?.quickModel).toBe('m');
  service.fetchAnalysisHistory.mockRejectedValueOnce('offline').mockResolvedValueOnce(historyPage([analysis, second], 1));
  await act(() => hook.result.current.loadMoreHistory());
  expect(hook.result.current.loadMoreError).toMatch(/tamamlanamadı/);
  await act(() => hook.result.current.loadMoreHistory());
  expect(service.fetchAnalysisHistory).toHaveBeenLastCalledWith(20, 1);
  expect(hook.result.current.history).toEqual([analysis, second]);
  await act(() => hook.result.current.loadMoreHistory());
  expect(service.fetchAnalysisHistory).toHaveBeenCalledTimes(3);
  service.fetchAnalysisProviders.mockRejectedValueOnce(problem('ACCESS_DENIED', 403, false));
  service.fetchAnalysisHistory.mockRejectedValueOnce(new Error('History unavailable'));
  await act(() => hook.result.current.refreshDashboard());
  expect(hook.result.current.isAccessDenied).toBe(true);
  expect(hook.result.current.historyError).toBe('History unavailable');
  await act(() => hook.result.current.refreshProviders());
  expect(hook.result.current.isAccessDenied).toBe(false);
});

it('blocks duplicate starts and retries with the same idempotency key', async () => {
  const pending = deferred<AnalysisRecord>();
  service.startAnalysis.mockReturnValueOnce(pending.promise);
  const hook = renderHook(() => useAnalysis());
  await waitFor(() => expect(hook.result.current.providers).toEqual(providers));
  let operation!: Promise<boolean>;
  act(() => { operation = hook.result.current.startNewAnalysis(input); });
  expect(hook.result.current.isStarting).toBe(true);
  await act(async () => { expect(await hook.result.current.startNewAnalysis(input)).toBe(false); });
  await act(async () => {
    pending.reject(problem('CAPACITY_FULL', 409, true));
    expect(await operation).toBe(false);
  });
  expect(hook.result.current.canRetryStart).toBe(true);
  await act(async () => { expect(await hook.result.current.retryStart()).toBe(true); });
  expect(service.startAnalysis.mock.calls[0]).toEqual(service.startAnalysis.mock.calls[1]);
  expect(hook.result.current.history).toEqual([running]);
  expect(storage.setItem).toHaveBeenCalledWith('lucrari:active-analysis:account-a', running.id);
  act(() => hook.result.current.clearStartError());
  expect(hook.result.current.startError).toBeNull();
});

it('refreshes revoked models and connections without retrying those requests', async () => {
  const hook = renderHook(() => useAnalysis());
  await waitFor(() => expect(hook.result.current.providers).toEqual(providers));
  service.startAnalysis.mockRejectedValueOnce(problem('MODEL_NOT_ALLOWED', 422, false));
  await act(() => hook.result.current.startNewAnalysis(input).then(() => {}));
  expect(hook.result.current.startError).toMatch(/Model erişiminiz değişti/);
  expect(service.fetchAnalysisProviders).toHaveBeenLastCalledWith({ userId: 'account-a', forceRefresh: true });
  expect(hook.result.current.canRetryStart).toBe(false);
  service.startAnalysis.mockRejectedValueOnce(problem('CONNECTION_NOT_FOUND', 404, false));
  await act(() => hook.result.current.startNewAnalysis(input).then(() => {}));
  expect(service.fetchAnalysisConnections).toHaveBeenCalledWith('account-a');
  expect(hook.result.current.startError).toBe('CONNECTION_NOT_FOUND');
  setUser(null);
  hook.rerender(undefined);
  await act(() => hook.result.current.startNewAnalysis(input).then(() => {}));
  expect(hook.result.current.startError).toMatch(/oturum doğrulanmalıdır/);
});

it('loads reports, retries selected status, and ignores a closed detail request', async () => {
  const hook = renderHook(() => useAnalysis());
  await waitFor(() => expect(hook.result.current.providers).toEqual(providers));
  service.fetchAnalysisReport.mockRejectedValueOnce(new Error('report offline'));
  await act(() => hook.result.current.openAnalysis(analysis));
  expect(hook.result.current.selectedError).toBe('report offline');
  await act(() => hook.result.current.refreshSelected());
  expect(hook.result.current.selectedReport).toBe(report);
  service.fetchAnalysisStatus.mockResolvedValueOnce(failed);
  await act(() => hook.result.current.refreshSelected());
  expect(hook.result.current.selectedReport).toBeNull();
  const next = deferred<AnalysisRecord>();
  service.fetchAnalysisStatus.mockReturnValueOnce(next.promise);
  act(() => { void hook.result.current.openAnalysis(second); });
  act(() => hook.result.current.closeAnalysis());
  await act(async () => next.resolve(second));
  expect(hook.result.current.selectedAnalysis).toBeNull();
});

it('polls selected work only while active, recovers a failed poll, and loads the completed report', async () => {
  jest.useFakeTimers();
  mockFocused = true;
  const hook = renderHook(() => useAnalysis());
  await waitFor(() => expect(hook.result.current.providers).toEqual(providers));
  service.fetchAnalysisStatus.mockResolvedValueOnce(running).mockRejectedValueOnce(new Error('status unavailable'))
    .mockResolvedValueOnce(running).mockResolvedValueOnce(analysis);
  await act(() => hook.result.current.openAnalysis(running));
  await act(async () => jest.advanceTimersByTime(5000));
  expect(hook.result.current.selectedError).toBe('status unavailable');
  await act(async () => jest.advanceTimersByTime(5000));
  expect(hook.result.current.selectedAnalysis).toEqual(running);
  await act(async () => jest.advanceTimersByTime(5000));
  expect(hook.result.current.selectedReport).toBe(report);
  expect(storage.removeItem).toHaveBeenCalledWith('lucrari:active-analysis:account-a');
});

it('resumes a stored analysis without displaying an unrequested report', async () => {
  jest.useFakeTimers();
  mockFocused = true;
  storage.getItem.mockResolvedValue(running.id);
  service.fetchAnalysisStatus.mockResolvedValue(failed);
  const hook = renderHook(() => useAnalysis());
  await waitFor(() => expect(hook.result.current.providers).toEqual(providers));
  await act(async () => jest.advanceTimersByTime(5000));
  expect(hook.result.current.history).toEqual([failed]);
  expect(service.fetchAnalysisReport).not.toHaveBeenCalled();
  expect(storage.removeItem).toHaveBeenCalledWith('lucrari:active-analysis:account-a');
});
