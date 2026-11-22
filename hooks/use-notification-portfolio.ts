import { useEffect, useState } from 'react';
import { useAuth } from '@/context/auth-context';
import { fetchNotificationPortfolioSummary, type NotificationPortfolioSummary } from '@/services/notifications/portfolio-summary-service';
import { parseDailyPortfolioTarget } from '@/utils/notification-routing';

export function useNotificationPortfolio(params: Record<string, unknown>) {
  const { userId, isAuthReady } = useAuth();
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([userId, params.portfolio_id, params.snapshot_id, params.currency, params.valuation_date]);
  const [state, setState] = useState<{ key: string; data: NotificationPortfolioSummary | null; error: string | null; loading: boolean }>({ key, data: null, error: null, loading: true });
  const target = parseDailyPortfolioTarget(params);
  const { portfolio_id, snapshot_id, currency, valuation_date } = target ?? {};
  useEffect(() => {
    let active = true;
    setState({ key, data: null, error: null, loading: true });
    if (!isAuthReady || !userId) return;
    if (!portfolio_id || !snapshot_id || !currency || !valuation_date) {
      setState({ key, data: null, error: 'Bildirim bilgileri doğrulanamadı.', loading: false });
      return;
    }
    fetchNotificationPortfolioSummary({ portfolio_id, snapshot_id, currency, valuation_date }).then(data => {
      if (active) setState({ key, data, error: null, loading: false });
    }).catch(() => {
      if (active) setState({ key, data: null, error: 'Günlük özet yüklenemedi veya bu hesapla erişilemiyor.', loading: false });
    });
    return () => { active = false; };
  }, [key, isAuthReady, userId, portfolio_id, snapshot_id, currency, valuation_date, revision]);
  const visible = state.key === key ? state : { data: null, error: null, loading: true };
  return { data: visible.data, error: visible.error, loading: visible.loading, retry: () => setRevision(value => value + 1) };
}
