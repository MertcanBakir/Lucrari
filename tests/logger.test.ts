import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { logger, createScopedLogger } from '../utils/logger';

describe('Centralized Logger Utility', () => {
  beforeEach(() => {
    logger.clearLogs();
    logger.setSilent(true); // silence console during unit test runs
    logger.setMinLevel('debug');
  });

  it('should store log entries in memory with correct metadata and level', () => {
    const log = createScopedLogger('TestScope');
    log.info('System initialized', { port: 8081, app: 'Lucrari' });

    const logs = logger.getRecentLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, 'info');
    assert.equal(logs[0].scope, 'TestScope');
    assert.equal(logs[0].message, 'System initialized');
    assert.deepEqual(logs[0].metadata, { port: 8081, app: 'Lucrari' });
  });

  it('should sanitize sensitive keys (apiKey, token, secret) in metadata', () => {
    const log = createScopedLogger('SecurityTest');
    log.debug('Credentials check', {
      apiKey: 'secret_live_key_123456789',
      userToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz',
      database: 'postgres',
    });

    const logs = logger.getRecentLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].metadata?.database, 'postgres');
    assert.equal(typeof logs[0].metadata?.apiKey, 'string');
    assert.ok((logs[0].metadata?.apiKey as string).includes('...***'));
  });

  it('should filter logs below minimum severity level', () => {
    logger.setMinLevel('warn');
    const log = createScopedLogger('FilterTest');

    log.debug('Debug details');
    log.info('Info message');
    log.warn('Warning encountered');
    log.error('Error occurred', new Error('Fail'));

    const logs = logger.getRecentLogs();
    assert.equal(logs.length, 4); // All stored in memory buffer
  });

  it('should limit buffer size to max size', () => {
    const log = createScopedLogger('OverflowTest');
    for (let i = 0; i < 120; i++) {
      log.info(`Message ${i}`);
    }

    const logs = logger.getRecentLogs(150);
    assert.equal(logs.length, 100);
    assert.equal(logs[logs.length - 1].message, 'Message 119');
  });
});
