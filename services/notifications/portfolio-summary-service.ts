import { getSupabaseClient } from '@/services/supabase/client';
import { parseDailyPortfolioTarget } from '@/utils/notification-routing';
import type { DailyPortfolioTarget } from '@/types/notifications';

export interface NotificationPortfolioSummary {
  date: string;
  currency: 'TRY' | 'USD';
  dailyPnl: number | null;
  capturedAt: string | null;
}
const unavailable = () => new Error('Bu günlük özet bulunamadı veya bu hesapla erişilemiyor.');
function amount(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || !Number.isFinite(Number(value))) throw unavailable();
  return Number(value);
}
export async function fetchNotificationPortfolioSummary(target: DailyPortfolioTarget): Promise<NotificationPortfolioSummary> {
  if (!parseDailyPortfolioTarget({ ...target })) throw unavailable();
  const client = getSupabaseClient();
  // Existing snapshot RLS checks the current user's portfolio ownership.
  const { data, error } = await client.from('portfolio_snapshots')
    .select('snapshot_date,base_currency,absolute_pnl_base,valuation_status,calculation_version,captured_at')
    .eq('id', target.snapshot_id).eq('portfolio_id', target.portfolio_id).eq('snapshot_date', target.valuation_date).maybeSingle();
  if (error) throw new Error('Günlük özet yüklenemedi. Tekrar deneyin.');
  if (!data || data.base_currency !== target.currency || data.valuation_status !== 'success' || data.calculation_version !== 2) throw unavailable();
  const previousDate = new Date(`${target.valuation_date}T12:00:00Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const { data: previous, error: previousError } = await client.from('portfolio_snapshots')
    .select('absolute_pnl_base,valuation_status,calculation_version,base_currency')
    .eq('portfolio_id', target.portfolio_id).eq('snapshot_date', previousDate.toISOString().slice(0, 10)).maybeSingle();
  if (previousError) throw new Error('Günlük değişim yüklenemedi. Tekrar deneyin.');
  const dailyPnl = previous && previous.valuation_status === 'success' && previous.calculation_version === 2 && previous.base_currency === target.currency
    ? amount(data.absolute_pnl_base) - amount(previous.absolute_pnl_base) : null;
  return { date: data.snapshot_date, currency: target.currency, dailyPnl, capturedAt: data.captured_at };
}
