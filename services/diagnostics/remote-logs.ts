import { generateUUID } from '@/utils/uuid';
import type { LogEntry } from '@/utils/logger';

type RemoteEntry = { id: string; timestamp: string; level: 'info' | 'warn' | 'error'; event: string; status: number | null; code: string | null };
type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
type Send = (items: RemoteEntry[], userId: string) => Promise<void>;
const KEY = 'lucrari.diagnostics.queue.v1';
const EVENTS = new Set([
  'analysis.report.invalid',
  'analysis.report.loading',
  'analysis.request.failed',
  'analysis.request.retry',
  'analysis.start.accepted',
  'auth.anonymous.failed',
  'auth.anonymous.invalid',
  'auth.bootstrap.exception',
  'auth.bootstrap.failed',
  'auth.session.lookup.failed',
  'auth.session.read.failed',
  'auth.signout.failed',
  'auth.subscription.failed',
  'auth.user.read.failed',
  'calendar.earnings.failed',
  'calendar.economic.failed',
  'calendar.event.failed',
  'calendar.load.failed',
  'calendar.lookup.failed',
  'calendar.native.unavailable',
  'calendar.permission.failed',
  'calendar.response.discarded',
  'fx.instrument.missing',
  'fx.load.failed',
  'fx.price.invalid',
  'fx.query.failed',
  'instrument.search.exception',
  'instrument.search.failed',
  'notification.device.registration.failed',
  'notification.response.read.failed',
  'portfolio.activity.network.failed',
  'portfolio.activity.next.failed',
  'portfolio.activity.owner.failed',
  'portfolio.activity.page.failed',
  'portfolio.activity.rpc.failed',
  'portfolio.default.conflict',
  'portfolio.default.create.failed',
  'portfolio.default.failed',
  'portfolio.default.lookup.failed',
  'portfolio.default.refetch.failed',
  'portfolio.listener.failed',
  'portfolio.load.failed',
  'portfolio.ownership.cache.stale',
  'portfolio.ownership.listener.failed',
  'portfolio.ownership.load.failed',
  'portfolio.ownership.refresh.failed',
  'portfolio.ownership.response.discarded',
  'portfolio.ownership.revision.exhausted',
  'portfolio.ownership.revision.retry',
  'portfolio.ownership.session.missing',
  'portfolio.positions.failed',
  'portfolio.positions.rpc.failed',
  'portfolio.reset.failed',
  'portfolio.reset.rpc.failed',
  'portfolio.transaction.failed',
  'portfolio.transaction.reverse.failed',
  'portfolio.transaction.reverse.rpc.failed',
  'portfolio.transaction.rpc.failed',
  'server.management.failed',
  'supabase.health.refresh.failed',
  'system.health.cache.stale',
  'system.health.failed',
  'system.health.rpc.failed',
  'system.health.session.failed',
  'watchlist.listener.failed',
  'watchlist.membership.cache.stale',
  'watchlist.membership.failed',
  'watchlist.membership.load.failed',
  'watchlist.membership.response.discarded',
  'watchlist.membership.revision.exhausted',
  'watchlist.mutation.failed',
  'watchlist.mutation.invalid',
  'watchlist.mutation.rpc.failed',
  'watchlist.page.failed',
  'watchlist.page.invalid',
  'watchlist.page.revision.exhausted',
  'watchlist.page.rpc.failed',
  'watchlist.session.missing',
]);
export function toRemoteEntry(entry: LogEntry): RemoteEntry | null {
  if (entry.level === 'debug' || !EVENTS.has(entry.event)) return null;
  const status = entry.context.status;
  const code = entry.error?.code;
  const safeCode = ['notification_auth_required', 'notification_invalid_device', 'notification_device_conflict', 'notification_invalid_preferences'].includes(code ?? '') ? code : null;
  return { id: generateUUID(), timestamp: entry.timestamp, level: entry.level, event: entry.event,
    status: typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null, code: safeCode ?? null };
}
export class RemoteLogQueue {
  private userId: string | null = null;
  private items: RemoteEntry[] = [];
  private serial: Promise<void> = Promise.resolve();
  constructor(private storage: Storage, private send: Send) {}
  private run(action: () => Promise<void>): Promise<void> {
    const next = this.serial.then(action); this.serial = next.catch(() => {}); return next;
  }
  private save() { return this.storage.setItem(KEY, JSON.stringify({ userId: this.userId, items: this.items })); }
  activate(userId: string | null): Promise<void> {
    return this.run(async () => {
      const previous = await this.storage.getItem(KEY);
      let parsed: { userId?: unknown; items?: unknown } | null = null;
      try { parsed = previous ? JSON.parse(previous) : null; } catch { /* discard corrupt queue */ }
      this.userId = userId;
      this.items = userId && parsed?.userId === userId && Array.isArray(parsed.items) ? parsed.items.slice(-100) : [];
      await this.save();
    });
  }
  enqueue(entry: LogEntry): Promise<void> {
    const item = toRemoteEntry(entry);
    if (!item) return Promise.resolve();
    return this.run(async () => {
      if (!this.userId) return;
      this.items.push(item); this.items = this.items.slice(-100); await this.save();
    });
  }
  flush(): Promise<void> {
    return this.run(async () => {
      if (!this.userId) return;
      while (this.items.length) {
        const batch = this.items.slice(0, 20);
        try { await this.send(batch, this.userId); } catch { return; }
        this.items.splice(0, batch.length); await this.save();
      }
    });
  }
}
