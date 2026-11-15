import {
  checkSupabaseHealth,
  clearSupabaseHealthCache,
  getSupabaseHealthCacheSnapshot,
  subscribeSupabaseHealth,
  SUPABASE_HEALTH_CACHE_TTL_MS,
} from '@/services/supabase/health';
import { getSupabaseClient } from '@/services/supabase/client';
import { getSupabaseConfig, validateSupabaseConfig } from '@/services/supabase/config';
import { deferred } from './helpers/deferred';

jest.mock('@/services/supabase/config', () => ({
  ...jest.requireActual('@/services/supabase/config'),
  getSupabaseConfig: jest.fn(),
  validateSupabaseConfig: jest.fn(),
}));
jest.mock('@/services/supabase/client', () => ({ getSupabaseClient: jest.fn() }));

const endpoint = 'https://health-test.supabase.co';
const key = 'sb_publishable_123456789012345';
const select = jest.fn();
const getSession = jest.fn();
const configuration = {
  isValid: true, url: endpoint, anonKey: key, keyType: 'publishable' as const, errors: [], warnings: [],
};
let fetchHealth: jest.SpiedFunction<typeof fetch>;

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(validateSupabaseConfig).mockReturnValue(configuration);
  jest.mocked(getSupabaseConfig).mockReturnValue({ url: endpoint, anonKey: key, isConfigured: true });
  jest.mocked(getSupabaseClient).mockReturnValue({
    from: () => ({ select: () => ({ limit: select }) }),
    auth: { getSession },
  } as unknown as ReturnType<typeof getSupabaseClient>);
  select.mockResolvedValue({ data: [{ code: 'test' }], error: null });
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  fetchHealth = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  clearSupabaseHealthCache();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  clearSupabaseHealthCache();
});

it('reports invalid configuration before attempting network or database access', async () => {
  jest.mocked(validateSupabaseConfig).mockReturnValue({
    ...configuration, isValid: false, url: null, errors: ['missing URL'],
  });
  const report = await checkSupabaseHealth();
  expect(report).toMatchObject({ overallStatus: 'unconfigured', isConfigured: false, averageLatencyMs: null });
  expect(report.checks).toEqual([expect.objectContaining({ id: 'config', status: 'fail' })]);
  expect(getSupabaseHealthCacheSnapshot()?.report).toBe(report);
  expect(fetchHealth).not.toHaveBeenCalled();
  expect(getSupabaseClient).not.toHaveBeenCalled();
});

it('deduplicates concurrent checks, serves fresh cache, and refreshes after TTL or on demand', async () => {
  const gateway = deferred<Response>();
  fetchHealth.mockReturnValueOnce(gateway.promise);
  const brokenSubscriber = subscribeSupabaseHealth(() => { throw new Error('subscriber failure'); });
  const listener = jest.fn();
  const unsubscribe = subscribeSupabaseHealth(listener);
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);

  const first = checkSupabaseHealth();
  const second = checkSupabaseHealth({ forceRefresh: true });
  gateway.resolve(new Response(null, { status: 200 }));
  const report = await first;
  expect(await second).toBe(report);
  expect(await checkSupabaseHealth()).toBe(report);
  expect(fetchHealth).toHaveBeenCalledTimes(1);
  expect(fetchHealth).toHaveBeenCalledWith(`${endpoint}/auth/v1/health`, expect.objectContaining({
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }));
  expect(report.overallStatus).toBe('healthy');
  expect(report.checks.map(({ id, status }) => [id, status])).toEqual([
    ['config', 'pass'], ['gateway', 'pass'], ['rest_db', 'pass'], ['auth', 'pass'],
  ]);
  expect(listener).toHaveBeenCalledWith(report);

  unsubscribe();
  brokenSubscriber();
  now.mockReturnValue(1000 + SUPABASE_HEALTH_CACHE_TTL_MS);
  expect(await checkSupabaseHealth()).not.toBe(report);
  await checkSupabaseHealth({ forceRefresh: true });
  expect(fetchHealth).toHaveBeenCalledTimes(3);
  expect(listener).toHaveBeenCalledTimes(1);
});

it.each([
  [401, '42P01', 'auth error', 'unhealthy', ['fail', 'pass', 'warn']],
  [503, 'PGRST301', null, 'degraded', ['warn', 'warn', 'pass']],
  [200, 'OTHER', null, 'degraded', ['pass', 'warn', 'pass']],
] as const)('classifies gateway %i and database %s', async (http, dbCode, authError, overall, statuses) => {
  fetchHealth.mockResolvedValue(new Response(null, { status: http }));
  select.mockResolvedValue({ data: null, error: { code: dbCode, message: 'database response' } });
  getSession.mockResolvedValue({
    data: { session: { user: { email: 'tester@example.test' } } },
    error: authError ? { message: authError } : null,
  });
  const report = await checkSupabaseHealth();
  expect(report.checks[0].status).toBe('pass');
  expect(report.overallStatus).toBe(overall);
  expect(report.checks.slice(1).map(({ status }) => status)).toEqual(statuses);
});

it('reports thrown gateway, database and auth failures together', async () => {
  jest.useFakeTimers();
  fetchHealth.mockRejectedValue(new Error('gateway offline'));
  select.mockRejectedValue('database offline');
  getSession.mockRejectedValue(new Error('auth offline'));
  const report = await checkSupabaseHealth();
  expect(report).toMatchObject({ overallStatus: 'unhealthy', averageLatencyMs: null });
  expect(report.checks.slice(1).map(({ status, latencyMs }) => [status, latencyMs]))
    .toEqual([['fail', null], ['fail', null], ['fail', null]]);
  expect(report.checks[1].message).toContain('gateway offline');
  expect(report.checks[3].message).toContain('auth offline');
});

it('warns on slow responses and configuration warnings without exposing credentials', async () => {
  jest.mocked(validateSupabaseConfig).mockReturnValue({ ...configuration, warnings: ['legacy key'] });
  jest.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(2000)
    .mockReturnValueOnce(2000).mockReturnValueOnce(3300)
    .mockReturnValueOnce(3300).mockReturnValueOnce(4700);
  select.mockResolvedValueOnce({ data: [], error: null });
  getSession.mockResolvedValueOnce({ data: { session: { user: {} } }, error: null });
  const report = await checkSupabaseHealth();
  expect(report.overallStatus).toBe('degraded');
  expect(report.checks.map(({ status }) => status)).toEqual(['warn', 'warn', 'warn', 'warn']);
  expect(JSON.stringify(report)).not.toContain(key);
  expect(report.checks[3].message).toContain('Anonim');
});

it.each([
  ['table does not exist', 'pass'],
  ['JWT expired', 'warn'],
  ['permission denied', 'warn'],
] as const)('interprets PostgREST fallback message %s', async (message, expected) => {
  select.mockResolvedValueOnce({ data: null, error: { code: 'OTHER', message } });
  expect((await checkSupabaseHealth()).checks[2].status).toBe(expected);
});

it('uses diagnostic fallback text when low-level errors have no standard shape', async () => {
  jest.useFakeTimers();
  fetchHealth.mockRejectedValueOnce('gateway down');
  select.mockRejectedValueOnce(new Error('query down'));
  getSession.mockRejectedValueOnce('auth down');
  const report = await checkSupabaseHealth();
  expect(report.checks[1].message).toContain('Bilinmeyen ağ hatası');
  expect(report.checks[2].message).toContain('query down');
  expect(report.checks[3].message).toContain('Auth servisine ulaşılamadı');
  jest.mocked(validateSupabaseConfig).mockReturnValue({ ...configuration, isValid: false, errors: [] });
  const unconfigured = await checkSupabaseHealth({ forceRefresh: true });
  expect(unconfigured.checks[0].message).toContain('Anon Key eksik');
});
