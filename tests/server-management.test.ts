import { getSupabaseClient } from '@/services/supabase/client';
import { getServerManagementUrl, requestServerManagement } from '@/services/analysis/server-management-service';

jest.mock('@/services/supabase/client', () => ({ getSupabaseClient: jest.fn() }));
const session = jest.fn();
const fetchMock = jest.fn();
const originalFetch = global.fetch;
const originalUrl = process.env.EXPO_PUBLIC_SERVER_MANAGEMENT_API_URL;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_SERVER_MANAGEMENT_API_URL = 'https://management.example.com/';
  jest.mocked(getSupabaseClient).mockReturnValue({ auth: { getSession: session } } as never);
  session.mockResolvedValue({ data: { session: { user: { id: 'owner' }, access_token: 'private-token' } } });
  global.fetch = fetchMock;
});
afterAll(() => { global.fetch = originalFetch; if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_SERVER_MANAGEMENT_API_URL; else process.env.EXPO_PUBLIC_SERVER_MANAGEMENT_API_URL = originalUrl; });
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
it.each(['status', 'start', 'stop'] as const)('sends authenticated %s only to management with no body', async action => {
  fetchMock.mockResolvedValue(reply(action === 'status' ? 200 : 202, { state: 'pending' }));
  await expect(requestServerManagement(action, 'owner')).resolves.toBe('pending');
  expect(fetchMock).toHaveBeenCalledWith(`https://management.example.com/${action}`, expect.objectContaining({
    method: action === 'status' ? 'GET' : 'POST', cache: 'no-store', headers: { Accept: 'application/json', Authorization: 'Bearer private-token' },
  }));
  expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
});
it.each([401, 403, 503])('handles %s without mutation retry', async status => {
  fetchMock.mockResolvedValue(reply(status, {}));
  await expect(requestServerManagement('stop', 'owner')).rejects.toMatchObject({ status });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('preserves active-analysis stop refusal message', async () => {
  fetchMock.mockResolvedValue(reply(409, { error: { code: 'ANALYSIS_ACTIVE' } }));
  await expect(requestServerManagement('stop', 'owner')).rejects.toThrow('Bekleyen veya çalışan analiz var. Sunucu durdurulmadı.');
});
it('rejects absent/mismatched sessions without calling AWS', async () => {
  await expect(requestServerManagement('start', 'other')).rejects.toMatchObject({ status: 401 });
  session.mockResolvedValue({ data: { session: null } });
  await expect(requestServerManagement('status', 'owner')).rejects.toMatchObject({ status: 401 });
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each([null, {}, { state: 'terminated' }])('rejects invalid response %j', async body => {
  fetchMock.mockResolvedValue(reply(200, body));
  await expect(requestServerManagement('status', 'owner')).rejects.toThrow('beklenmeyen');
});
it('maps network errors and aborts before fetch', async () => {
  fetchMock.mockRejectedValue(new Error('network'));
  await expect(requestServerManagement('status', 'owner')).rejects.toThrow('erişilemiyor');
  const controller = new AbortController(); controller.abort();
  await expect(requestServerManagement('start', 'owner', controller.signal)).rejects.toThrow('erişilemiyor');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it.each([undefined, 'http://example.com', 'https://user:pass@example.com', 'https://example.com?token=x'])('rejects unsafe configuration %s', value => {
  if (value === undefined) delete process.env.EXPO_PUBLIC_SERVER_MANAGEMENT_API_URL;
  else process.env.EXPO_PUBLIC_SERVER_MANAGEMENT_API_URL = value;
  expect(getServerManagementUrl).toThrow();
});

it('aborts in-flight requests on timeout and caller cancellation', async () => {
  jest.useFakeTimers();
  try {
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const timeout = expect(requestServerManagement('status', 'owner')).rejects.toThrow('erişilemiyor');
    await Promise.resolve(); await Promise.resolve();
    jest.advanceTimersByTime(15000); await timeout;
    const controller = new AbortController();
    const cancelled = expect(requestServerManagement('status', 'owner', controller.signal)).rejects.toThrow('erişilemiyor');
    await Promise.resolve(); await Promise.resolve();
    controller.abort(); await cancelled;
  } finally { jest.useRealTimers(); }
});
