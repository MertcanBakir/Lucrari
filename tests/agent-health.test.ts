import { fetchAgentHealth, AnalysisApiError } from '@/services/analysis/analysis-service';
import { setSupabaseClientForTesting, resetSupabaseClientForTesting } from '@/services/supabase/client';
import { formatHostUptime, formatResourceBytes, normalizeAgentHealth } from '@/utils/agent-health';
import { hostHealthPayload } from './ui/agent-health-fixtures';

const originalUrl = process.env.EXPO_PUBLIC_ANALYSIS_API_URL;
const getSession = jest.fn();
const refreshSession = jest.fn();
let request: jest.SpiedFunction<typeof fetch>;

beforeEach(() => {
  process.env.EXPO_PUBLIC_ANALYSIS_API_URL = 'https://192.0.2.10';
  getSession.mockResolvedValue({ data: { session: { access_token: 'current', user: { id: 'owner' } } }, error: null });
  refreshSession.mockResolvedValue({ data: { session: { access_token: 'renewed', user: { id: 'owner' } } }, error: null });
  setSupabaseClientForTesting({ auth: { getSession, refreshSession } });
  request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(hostHealthPayload)));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  resetSupabaseClientForTesting();
  if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_ANALYSIS_API_URL;
  else process.env.EXPO_PUBLIC_ANALYSIS_API_URL = originalUrl;
});

it('requests uncached resources with the current owner session and refreshes once on 401', async () => {
  request.mockResolvedValueOnce(new Response('{}', { status: 401 }));
  const report = await fetchAgentHealth('owner');
  expect(report.resources).toMatchObject({ scope: 'host', cpu: { usedPercent: 32.5 }, memory: { usedBytes: 2147483648 } });
  expect(request).toHaveBeenNthCalledWith(1, 'https://192.0.2.10/healthz', expect.objectContaining({
    cache: 'no-store', headers: expect.objectContaining({ Accept: 'application/json', Authorization: 'Bearer current' }),
  }));
  expect(request).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({
    headers: expect.objectContaining({ Accept: 'application/json', Authorization: 'Bearer renewed' }),
  }));
  expect(refreshSession).toHaveBeenCalledTimes(1);
});

it.each([401, 403, 503])('surfaces HTTP %i without treating old resources as a new measurement', async (status) => {
  request.mockResolvedValue(new Response('{}', { status }));
  await expect(fetchAgentHealth('owner')).rejects.toMatchObject({ status });
  expect(refreshSession).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
});

it('refuses another account session and cancels before fetching an already aborted request', async () => {
  await expect(fetchAgentHealth('other-user')).rejects.toMatchObject({ code: 'ANALYSIS_AUTH_REQUIRED' });
  const controller = new AbortController();
  controller.abort();
  await expect(fetchAgentHealth('owner', controller.signal)).rejects.toBeInstanceOf(AnalysisApiError);
  expect(request).not.toHaveBeenCalled();
});

it.each([
  [null, 50, 'unknown'], [89.9, 84.9, 'ok'], [90, 50, 'warning'],
  [98, 50, 'critical'], [32, 85, 'warning'], [32, 95, 'critical'],
  [null, 90, 'warning'], [99, null, 'critical'], [101, NaN, 'unknown'],
] as const)('classifies CPU %s and memory %s as %s', (cpu, memory, expected) => {
  const raw = { ...hostHealthPayload, resources: { ...hostHealthPayload.resources,
    cpu: { used_percent: cpu }, memory: { used_percent: memory },
  } };
  const resources = normalizeAgentHealth(raw).resources!;
  expect(resources.status).toBe(expected);
  expect(resources.cpu.logicalCores).toBeNull();
  expect(resources.memory.totalBytes).toBeNull();
});

it('keeps public liveness distinct from resources and rejects malformed liveness', () => {
  expect(normalizeAgentHealth({ status: 'ok' })).toEqual({ resources: null });
  expect(normalizeAgentHealth({ status: 'ok', resources: { scope: 'container' } })).toEqual({ resources: null });
  for (const raw of [null, [], 'ok', { status: 'failed' }]) {
    expect(() => normalizeAgentHealth(raw)).toThrow();
  }
  const report = normalizeAgentHealth({ ...hostHealthPayload, resources: {
    ...hostHealthPayload.resources, scope: 'system', sampled_at: 'invalid', cpu: null, memory: [],
    uptime_seconds: -1,
  } });
  expect(report.resources).toMatchObject({ scope: 'system', sampledAt: null, status: 'unknown', uptimeSeconds: null });
  expect(formatResourceBytes(null)).toBe('—');
  expect(formatResourceBytes(2147483648)).toBe('2 GiB');
  expect(formatHostUptime(null)).toBe('—');
  expect(formatHostUptime(90061)).toBe('1 gün 1 saat 1 dakika');
});
