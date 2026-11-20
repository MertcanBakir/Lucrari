import { logger, createScopedLogger } from '@/utils/logger';

const log = createScopedLogger('TestScope');

beforeEach(() => {
  logger.clearLogs();
  logger.setSilent(true);
  logger.setMinLevel('debug');
});

afterEach(() => {
  logger.setSilent(false);
  logger.setMinLevel('info');
  jest.restoreAllMocks();
});

it('stores the common schema and preserves false, zero, null, nested objects and long values', () => {
  const longValue = 'diagnostic-detail-'.repeat(10);
  log.info('system.initialized', {
    message: 'System initialized.',
    context: { ready: false, count: 0, absent: null, nested: { longValue, cacheKey: 'cache-1', authType: 'api_key', isAnonymous: false } },
  });
  expect(logger.getRecentLogs()).toEqual([{
    timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    level: 'info', scope: 'TestScope', event: 'system.initialized', message: 'System initialized.',
    context: { ready: false, count: 0, absent: null, nested: { longValue, cacheKey: 'cache-1', authType: 'api_key', isAnonymous: false } },
    error: null,
  }]);
});

it('redacts complete credentials and personal fields without retaining prefixes', () => {
  log.warn('security.checked', {
    message: 'Security check.',
    context: {
      apiKey: 'private-credential', access_token: 'private-access', password: 'private-password',
      nested: { authorization: 'private-header', currentUserId: 'private-user', email: 'private-email', phone: 'private-phone' },
      data: { unknown: 'raw-payload' }, params: { notes: 'private-notes' },
      isAuthenticated: true, requestId: 'request-1',
    },
  });
  const serialized = logger.exportLogs();
  expect(serialized).not.toMatch(/private-|raw-payload/);
  expect(logger.getRecentLogs()[0].context).toMatchObject({
    apiKey: '[REDACTED]', access_token: '[REDACTED]', password: '[REDACTED]',
    isAuthenticated: true, requestId: 'request-1',
  });
});

it('sanitizes messages, context strings and normalized error message, code and stack before every output', () => {
  logger.setSilent(false);
  const output = jest.spyOn(console, 'error').mockImplementation(() => {});
  const secret = 'Bearer private-bearer email@example.test password=hunter2 sb_secret_12345 sk-abc123 eyJhbGci.testpayload.testsignature';
  const error = Object.assign(new Error(secret), { code: 'NETWORK_FAILED', stack: secret });
  log.error('request.failed', {
    message: secret,
    context: { description: secret, endpoint: 'https://admin:secret@example.test/path?apikey=private-query' },
    error,
  });
  const serialized = logger.exportLogs() + JSON.stringify(output.mock.calls);
  for (const sensitive of ['private-bearer', 'email@example.test', 'hunter2', 'sb_secret_12345', 'sk-abc123', 'eyJhbGci', 'admin:secret', 'private-query']) {
    expect(serialized).not.toContain(sensitive);
  }
  expect(logger.getRecentLogs()[0].error).toMatchObject({ name: 'Error', code: 'NETWORK_FAILED' });
  expect(output).toHaveBeenCalledTimes(1);
});

it.each(['offline', 0, false, { message: 'denied', code: 'DENIED' }, {}])('normalizes thrown values %p', (error) => {
  log.warn('request.failed', { message: 'Request failed.', error });
  expect(logger.getRecentLogs()[0].error).toEqual({
    name: 'Error', message: typeof error === 'object' && 'message' in error ? error.message : String(error),
    code: typeof error === 'object' && 'code' in error ? error.code : null, stack: null,
  });
});

it('handles cycles, deep graphs, repeated references, arrays, bigint and unsupported values', () => {
  const circular: Record<string, unknown> = { amount: 0 };
  circular.self = circular;
  let deep: Record<string, unknown> = {};
  const graph = deep;
  for (let index = 0; index < 12; index++) {
    deep.child = {};
    deep = deep.child as Record<string, unknown>;
  }
  const shared = { value: 42 };
  const sanitized = logger.sanitize({
    circular, graph, values: [BigInt(1), () => {}, Symbol('unsupported'), null],
    first: shared, second: shared,
  });
  expect(sanitized).toMatchObject({
    circular: { amount: 0, self: '[Circular]' },
    values: ['1', '[Unsupported]', '[Unsupported]', null], first: shared, second: shared,
  });
  expect(JSON.stringify(sanitized)).toContain('[MaxDepth]');
  expect(logger.sanitize(undefined)).toBeUndefined();
});

it('filters console severity while retaining the diagnostic buffer and supports every level', () => {
  logger.setSilent(false);
  logger.setMinLevel('warn');
  const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
  const info = jest.spyOn(console, 'info').mockImplementation(() => {});
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  const options = { message: 'Diagnostic event.', context: { ready: false, count: 0 } };
  log.debug('test.debug', options);
  log.info('test.info', options);
  log.warn('test.warn', options);
  log.error('test.error', options);
  expect(debug).not.toHaveBeenCalled();
  expect(info).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toContain('"ready":false,"count":0');
  expect(logger.getRecentLogs()).toHaveLength(4);
  logger.setMinLevel('debug');
  log.debug('test.debug', options);
  log.info('test.info', options);
  expect(debug).toHaveBeenCalledTimes(1);
  expect(info).toHaveBeenCalledTimes(1);
});

it('bounds the buffer, exports JSON and prevents callers from mutating stored records', () => {
  for (let index = 0; index < 120; index++) {
    log.info('test.buffered', { message: 'Buffer test.', context: { index } });
  }
  expect(logger.getRecentLogs(200)).toHaveLength(100);
  expect(logger.getRecentLogs(1)[0].context.index).toBe(119);
  const snapshot = logger.getRecentLogs();
  snapshot[0].context.index = -1;
  expect(logger.getRecentLogs()[0].context.index).toBe(70);
  expect(JSON.parse(logger.exportLogs())).toHaveLength(100);
  for (const invalid of [0, -1, NaN, Infinity]) expect(logger.getRecentLogs(invalid)).toEqual([]);
  expect(logger.getRecentLogs(1.9)).toHaveLength(1);
  logger.clearLogs();
  expect(logger.exportLogs()).toBe('[]');
});
