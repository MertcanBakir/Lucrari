import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/auth-context';
import { ensureDefaultPortfolio, subscribePortfolioChanges } from '@/services/portfolio/portfolio-service';
import { fetchPortfolioChart, refreshPortfolioChartSnapshot } from '@/services/portfolio/portfolio-chart-service';
import { formatPortfolioRpcError } from '@/utils/portfolio-errors';
import type { ChartQuery, PortfolioChartPoint } from '@/types/portfolio-chart';

const cache = new Map<string, { points: PortfolioChartPoint[]; timestamp: number; name: string }>();
const TTL = 60_000;
// Mutations invalidate cached history, including resets. No personal data is shared between accounts.
subscribePortfolioChanges(() => cache.clear());
export function clearPortfolioChartCache() { cache.clear(); }

export function usePortfolioChart(query: ChartQuery) {
  const { userId, isAuthReady } = useAuth();
  const key = JSON.stringify([userId, query.range, query.market, query.currency, query.metric]);
  const [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);
  const lastAttempt = useRef(0);
  const [state, setState] = useState<{ key: string; points: PortfolioChartPoint[]; name: string; loading: boolean; error: string | null }>(
    { key: '', points: [], name: '', loading: true, error: null });
  const refresh = useCallback(() => setAttempt(n => n + 1), []);
  useEffect(() => subscribePortfolioChanges(refresh), [refresh]);
  useEffect(() => {
    const request = ++sequence.current;
    let active = true;
    if (!isAuthReady || !userId) return;
    const force = attempt !== lastAttempt.current;
    lastAttempt.current = attempt;
    const cached = cache.get(key);
    if (!force && cached && Date.now() - cached.timestamp < TTL) {
      setState({ key, points: cached.points, name: cached.name, loading: false, error: null });
      return;
    }
    setState(previous => ({ key, points: previous.key === key ? previous.points : [], name: '', loading: true, error: null }));
    void (async () => {
      try {
        const portfolio = await ensureDefaultPortfolio(userId);
        if (!active || request !== sequence.current) return;
        let captureError: string | null = null;
        try { await refreshPortfolioChartSnapshot(portfolio.id, force); }
        catch (error) { captureError = formatPortfolioRpcError(error); }
        if (!active || request !== sequence.current) return;
        const points = await fetchPortfolioChart(portfolio.id, query);
        if (!active || request !== sequence.current) return;
        if (cache.size >= 24) cache.delete(cache.keys().next().value!);
        if (!captureError) cache.set(key, { points, timestamp: Date.now(), name: portfolio.name });
        setState({ key, points, name: portfolio.name, loading: false, error: captureError });
      } catch (error) {
        if (!active || request !== sequence.current) return;
        setState(previous => ({ ...previous, key, loading: false, error: formatPortfolioRpcError(error) }));
      }
    })();
    return () => { active = false; };
    // The serialized key contains every query field; query object identity is intentionally ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, userId, isAuthReady, attempt]);
  const matches = state.key === key;
  return { points: matches ? state.points : [], name: matches ? state.name : '',
    isLoading: !isAuthReady || (Boolean(userId) && (!matches || state.loading)),
    error: isAuthReady && !userId ? 'Portföy grafiği için oturumunuz doğrulanamadı.' : matches ? state.error : null,
    refresh, isStale: matches && Boolean(state.error) && state.points.length > 0 };
}
