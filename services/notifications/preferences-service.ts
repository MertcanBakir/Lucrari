import { getSupabaseClient } from '@/services/supabase/client';
import type { NotificationPreferences } from '@/types/notifications';

const messages: Record<string, string> = {
  notification_auth_required: 'Bildirimler için oturumun yeniden yüklenmesi gerekiyor.',
  notification_invalid_device: 'Cihaz bildirim kaydı doğrulanamadı.',
  notification_device_conflict: 'Bu cihaz başka bir hesaba kayıtlı. Önce eski hesaptan çıkış yapın.',
  notification_invalid_preferences: 'Bildirim tercihlerini kontrol edip tekrar deneyin.',
};
class NotificationOperationError extends Error {}
export function notificationError(error: unknown): Error {
  if (error instanceof NotificationOperationError) return error;
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  const code = Object.keys(messages).find(key => message.includes(key));
  // Do not propagate raw provider errors: they can contain push tokens.
  return new NotificationOperationError(code ? messages[code] : 'Bildirim işlemi tamamlanamadı. Bağlantınızı kontrol edip tekrar deneyin.');
}

export function parseNotificationPreferences(raw: unknown): NotificationPreferences {
  if (!raw || typeof raw !== 'object') throw notificationError(null);
  const p = raw as NotificationPreferences;
  if (typeof p.timezone !== 'string' || !p.timezone ||
      ['earnings_morning', 'earnings_midday', 'daily_portfolio', 'watchlist_earnings', 'economic_reminders', 'earnings_today', 'earnings_tomorrow'].some(key => typeof (raw as Record<string, unknown>)[key] !== 'boolean') ||
      !Array.isArray(p.countries) || p.countries.some(country => !['TR', 'US'].includes(country)) ||
      !Number.isInteger(p.min_importance) || p.min_importance < 1 || p.min_importance > 3) throw notificationError(null);
  try { new Intl.DateTimeFormat('en', { timeZone: p.timezone }); } catch { throw notificationError({ message: 'notification_invalid_preferences' }); }
  return { timezone: p.timezone, earnings_morning: p.earnings_morning, watchlist_earnings: p.watchlist_earnings,
    economic_reminders: p.economic_reminders, earnings_today: p.earnings_today, earnings_tomorrow: p.earnings_tomorrow,
    earnings_midday: p.earnings_midday, daily_portfolio: p.daily_portfolio,
    countries: [...new Set(p.countries)], min_importance: p.min_importance };
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const { data, error } = await getSupabaseClient().rpc('get_notification_preferences_v2');
    if (error) throw error;
    return parseNotificationPreferences(data);
  } catch (error) { throw notificationError(error); }
}
export async function setNotificationPreferences(preferences: NotificationPreferences): Promise<void> {
  const p = parseNotificationPreferences(preferences);
  try {
    const { error } = await getSupabaseClient().rpc('set_notification_preferences_v2', {
      p_timezone: p.timezone, p_earnings_morning: p.earnings_morning, p_watchlist_earnings: p.watchlist_earnings,
      p_economic_reminders: p.economic_reminders, p_earnings_today: p.earnings_today, p_earnings_tomorrow: p.earnings_tomorrow,
      p_earnings_midday: p.earnings_midday, p_daily_portfolio: p.daily_portfolio,
      p_countries: p.countries, p_min_importance: p.min_importance,
    });
    if (error) throw error;
  } catch (error) { throw notificationError(error); }
}
