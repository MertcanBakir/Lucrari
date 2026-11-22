import { isValidUUID } from '@/utils/validation';
import type { DailyPortfolioTarget } from '@/types/notifications';

export function isNotificationDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseDailyPortfolioTarget(data: Record<string, unknown>): DailyPortfolioTarget | null {
  if (!isValidUUID(data.portfolio_id) || !isValidUUID(data.snapshot_id) ||
      !isNotificationDate(data.valuation_date) || (data.currency !== 'TRY' && data.currency !== 'USD')) return null;
  return { portfolio_id: data.portfolio_id, snapshot_id: data.snapshot_id,
    currency: data.currency as 'TRY' | 'USD', valuation_date: data.valuation_date };
}

// Payloads supply identifiers, never arbitrary URLs or permission to access data.
export function notificationDestination(raw: unknown) {
  const fallback = { pathname: '/(tabs)' as const };
  if (!raw || typeof raw !== 'object') return fallback;
  const data = raw as Record<string, unknown>;
  if (data.schema_version !== 1 || !isValidUUID(data.notification_id) || !isNotificationDate(data.event_date)) return fallback;
  const common = { date: data.event_date, notification: data.notification_id };
  switch (data.type) {
    case 'earnings_morning':
      return { pathname: '/(tabs)' as const, params: { ...common, filter: 'portfolio' } };
    case 'watchlist_earnings':
      return { pathname: '/(tabs)' as const, params: { ...common, filter: 'watchlist' } };
    case 'earnings_today':
    case 'earnings_tomorrow':
      return { pathname: '/(tabs)' as const, params: { ...common, filter: 'earnings' } };
    case 'economic_reminder':
      if (!isValidUUID(data.event_id) || typeof data.scheduled_at !== 'string' ||
          !Number.isFinite(Date.parse(data.scheduled_at)) || ![180, 60, 15].includes(data.minutes_before as number)) return fallback;
      return { pathname: '/(tabs)' as const, params: { ...common, filter: 'economic', economicEvent: data.event_id } };
    case 'macro_morning':
      return { pathname: '/(tabs)' as const, params: { ...common, filter: 'economic' } };
    case 'earnings_midday':
      if (!isValidUUID(data.instrument_id) || !isValidUUID(data.event_id)) return fallback;
      return { pathname: '/(tabs)' as const, params: { ...common, filter: 'earnings',
        instrument: data.instrument_id, event: data.event_id } };
    case 'daily_portfolio': {
      const target = parseDailyPortfolioTarget(data);
      return target ? { pathname: '/notification-portfolio' as const, params: { ...target } } : fallback;
    }
    default:
      return fallback;
  }
}
