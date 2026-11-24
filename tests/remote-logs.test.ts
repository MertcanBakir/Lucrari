import { RemoteLogQueue, toRemoteEntry } from '@/services/diagnostics/remote-logs';
import type { LogEntry } from '@/utils/logger';

const entry: LogEntry = { timestamp: '2026-11-24T00:00:00.000Z', level: 'warn', scope: 'AnalysisService', event: 'analysis.request.failed', message: 'secret@example.com', context: { status: 503, token: 'secret', amount: 123 }, error: null };
let stored = '';
const storage = { getItem: jest.fn(async () => stored || null), setItem: jest.fn(async (_key: string, value: string) => { stored = value; }) };
const send = jest.fn();
beforeEach(() => { stored = ''; jest.clearAllMocks(); send.mockResolvedValue(undefined); });
it('only persists allowed metadata and rejects debug or arbitrary user text', () => {
  expect(toRemoteEntry(entry)).toEqual(expect.objectContaining({ event: 'analysis.request.failed', level: 'warn', status: 503 }));
  expect(JSON.stringify(toRemoteEntry(entry))).not.toMatch(/secret|123|example/);
  expect(toRemoteEntry({ ...entry, level: 'debug' })).toBeNull();
  expect(toRemoteEntry({ ...entry, event: 'user.secret' })).toBeNull();
});
it('bounds a durable queue and sends batches after failure', async () => {
  send.mockRejectedValueOnce(new Error('offline'));
  const q = new RemoteLogQueue(storage, send);
  await q.activate('owner');
  for (let i = 0; i < 105; i++) await q.enqueue(entry);
  expect(JSON.parse(stored).items).toHaveLength(100);
  await q.flush(); expect(JSON.parse(stored).items).toHaveLength(100);
  await q.flush(); expect(JSON.parse(stored).items).toHaveLength(0);
});
it('does not send old account logs under a new session', async () => {
  const q = new RemoteLogQueue(storage, send);
  await q.activate('owner'); await q.enqueue(entry);
  await q.activate('other'); await q.flush();
  expect(send).not.toHaveBeenCalled(); expect(JSON.parse(stored).items).toHaveLength(0);
});
it('preserves only known notification error codes', () => {
  const failed = { ...entry, event: 'notification.device.registration.failed', error: { name: 'Error', message: 'private', stack: 'private', code: 'notification_device_conflict' } };
  expect(toRemoteEntry(failed)?.code).toBe('notification_device_conflict');
  expect(toRemoteEntry({ ...failed, error: { ...failed.error, code: 'private-code' } })?.code).toBeNull();
});
