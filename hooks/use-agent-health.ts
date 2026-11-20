import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/context/auth-context';
import { checkAnalysisHealth, fetchAgentHealth, isAnalysisApiError } from '@/services/analysis/analysis-service';
import type { AgentHealthReport } from '@/types/agent-health';

export type AgentHealthState = 'checking' | 'online' | 'unreachable' | 'forbidden' | 'unauthorized' | 'error';

export function useAgentHealth(monitor = false) {
  const { userId, isAuthReady } = useAuth();
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [snapshot, setSnapshot] = useState<{
    userId: string | null;
    status: AgentHealthState;
    report: AgentHealthReport | null;
    checkedAt: Date;
    message: string | null;
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const current = useRef<AbortController | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  const refresh = useCallback(async () => {
    if (!focused || !active || !isAuthReady || current.current) return;
    const controller = new AbortController();
    current.current = controller;
    setIsRefreshing(true);
    let status: AgentHealthState = 'online';
    let report: AgentHealthReport | null = null;
    let message: string | null = null;
    try {
      if (userId) {
        report = await fetchAgentHealth(userId, controller.signal);
      } else {
        const online = await checkAnalysisHealth(controller.signal);
        status = online ? 'unauthorized' : 'unreachable';
      }
    } catch (error) {
      if (isAnalysisApiError(error)) {
        if (error.status === 403) status = 'forbidden';
        else if (error.status === 401 || error.code === 'ANALYSIS_AUTH_REQUIRED') status = 'unauthorized';
        else if (error.code === 'ANALYSIS_NETWORK_ERROR' || error.code === 'ANALYSIS_TIMEOUT') status = 'unreachable';
        else status = 'error';
        message = error.message;
      } else {
        status = 'error';
        message = 'Agent sağlık yanıtı okunamadı.';
      }
    } finally {
      if (!controller.signal.aborted) {
        setSnapshot({ userId, status, report, checkedAt: new Date(), message });
        setIsRefreshing(false);
        current.current = null;
      }
    }
  }, [focused, active, isAuthReady, userId]);

  useEffect(() => {
    setSnapshot(null);
    setIsRefreshing(false);
    void refresh();
    const timer = monitor && focused && active && isAuthReady
      ? setInterval(() => { void refresh(); }, 12_000)
      : undefined;
    return () => {
      clearInterval(timer);
      current.current?.abort();
      current.current = null;
    };
  }, [refresh, monitor, focused, active, isAuthReady]);

  const visible = snapshot?.userId === userId && focused && active ? snapshot : null;
  return {
    status: (visible?.status ?? 'checking') as AgentHealthState,
    report: visible?.report ?? null,
    checkedAt: visible?.checkedAt ?? null,
    message: visible?.message ?? null,
    isRefreshing,
    refresh,
  };
}
