import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/context/auth-context';
import { checkAnalysisHealth, fetchAgentHealth, isAnalysisApiError } from '@/services/analysis/analysis-service';
import type { AgentHealthReport } from '@/types/agent-health';
import { requestServerManagement, ServerManagementError, type ServerAction, type ServerState } from '@/services/analysis/server-management-service';

export const SERVER_TRANSITION_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 5_000;
export type ApiHealthState = 'checking' | 'online' | 'unreachable' | 'forbidden' | 'unauthorized' | 'error';
type Snapshot = { userId: string; state: ServerState | null; apiReady: boolean; error: string | null; denied: boolean;
  managementErrorStatus: number | null; report: AgentHealthReport | null; healthStatus: ApiHealthState; apiMessage: string | null; checkedAt: Date | null };
const emptyHealth = { managementErrorStatus: null, report: null, healthStatus: 'checking' as ApiHealthState, apiMessage: null, checkedAt: null };

export function useServerManagement(monitor = false) {
  const { userId, isAuthReady } = useAuth();
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef(0);
  const lifecycle = useRef({ userId, enabled: false });
  lifecycle.current = { userId, enabled: focused && active && isAuthReady };
  const visible = snapshot?.userId === userId ? snapshot : null;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  const request = useCallback(async (action: ServerAction = 'status') => {
    if (!userId || !isAuthReady || !focused || !active || lifecycle.current.userId !== userId || !lifecycle.current.enabled || current.current) return;
    if (timer.current) clearTimeout(timer.current);
    const controller = new AbortController();
    current.current = controller;
    setBusy(true);
    try {
      const state = await requestServerManagement(action, userId, controller.signal);
      if (controller.signal.aborted) return;
      // EC2 truth gates every health request; health failures never change EC2 state.
      setSnapshot(previous => previous?.userId === userId && previous.state === 'running' && state === 'running'
        ? { ...previous, error: null, denied: false, managementErrorStatus: null }
        : { userId, state, apiReady: false, error: null, denied: false, ...emptyHealth });
      let apiReady = false;
      let report: AgentHealthReport | null = null;
      let healthStatus: ApiHealthState = 'checking';
      let apiMessage: string | null = null;
      if (state === 'running') {
        try {
          if (monitor) {
            report = await fetchAgentHealth(userId, controller.signal);
            apiReady = true;
          } else {
            apiReady = await checkAnalysisHealth(controller.signal);
          }
          healthStatus = apiReady ? 'online' : 'unreachable';
        } catch (error) {
          healthStatus = isAnalysisApiError(error) && error.status === 403 ? 'forbidden'
            : isAnalysisApiError(error) && (error.status === 401 || error.code === 'ANALYSIS_AUTH_REQUIRED') ? 'unauthorized'
            : 'unreachable';
          // Resource permissions do not determine public API availability.
          if (monitor && !controller.signal.aborted && (healthStatus === 'forbidden' || healthStatus === 'unauthorized')) {
            apiReady = await checkAnalysisHealth(controller.signal).catch(() => false);
          }
        }
        if (!apiReady) apiMessage = 'API’ye henüz ulaşılamıyor';
      }
      if (controller.signal.aborted) return;
      const transitioning = state === 'pending' || state === 'stopping' || (state === 'running' && !apiReady);
      if (transitioning && deadline.current === 0) deadline.current = Date.now() + SERVER_TRANSITION_TIMEOUT_MS;
      if (!transitioning) deadline.current = 0;
      const expired = transitioning && Date.now() >= deadline.current;
      setSnapshot({ userId, state, apiReady, report, managementErrorStatus: null, healthStatus, apiMessage, checkedAt: new Date(), denied: false,
        error: expired ? 'Geçiş henüz tamamlanmadı. Durumu yeniden kontrol edin.' : null });
      if (transitioning && !expired) {
        timer.current = setTimeout(() => { void request('status'); }, POLL_MS);
      } else if (monitor && state === 'running' && apiReady) {
        timer.current = setTimeout(() => { void request('status'); }, 12_000);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const denied = error instanceof ServerManagementError && error.status === 403;
      setSnapshot(previous => ({
        ...emptyHealth, managementErrorStatus: error instanceof ServerManagementError ? error.status : null,
        userId, state: previous?.userId === userId ? previous.state : null,
        apiReady: false, denied: denied || (previous?.userId === userId && previous.denied),
        error: error instanceof ServerManagementError ? error.message : 'Sunucu durumu alınamadı. Yeniden deneyin.',
      }));
    } finally {
      if (current.current === controller) { current.current = null; setBusy(false); }
    }
  }, [userId, isAuthReady, focused, active, monitor]);

  const refresh = useCallback(() => {
    deadline.current = Date.now() + SERVER_TRANSITION_TIMEOUT_MS;
    return request('status');
  }, [request]);

  const changeState = useCallback((action: 'start' | 'stop') => {
    // A synchronous in-flight guard prevents double taps before React rerenders.
    if (current.current || !visible || visible.denied || visible.error ||
        (action === 'start' ? visible.state !== 'stopped' : visible.state !== 'running')) return;
    deadline.current = Date.now() + SERVER_TRANSITION_TIMEOUT_MS;
    return request(action);
  }, [request, visible]);

  useEffect(() => {
    setSnapshot(previous => previous?.userId === userId ? previous : null);
    setBusy(false);
    void refresh();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      current.current?.abort();
      current.current = null;
    };
  }, [refresh, userId]);

  return { state: visible?.state ?? null, apiReady: visible?.apiReady ?? false,
    error: visible?.error ?? null, denied: visible?.denied ?? false,
    managementErrorStatus: visible?.managementErrorStatus ?? null,
    report: visible?.report ?? null, healthStatus: visible?.healthStatus ?? 'checking',
    apiMessage: visible?.apiMessage ?? null, checkedAt: visible?.checkedAt ?? null,
    hasSession: !!userId && isAuthReady, busy, refresh, changeState };
}
