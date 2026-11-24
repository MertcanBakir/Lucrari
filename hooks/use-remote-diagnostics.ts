import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useAuth } from '@/context/auth-context';
import { RemoteLogQueue } from '@/services/diagnostics/remote-logs';
import { getSupabaseClient } from '@/services/supabase/client';
import { logger } from '@/utils/logger';

const diagnosticsEnabled = () => process.env.EXPO_PUBLIC_DIAGNOSTICS_ENABLED === 'true';
const queue = new RemoteLogQueue(AsyncStorage, async (items, userId) => {
  const client = getSupabaseClient();
  const session = await client.auth.getSession();
  if (session.error || session.data.session?.user.id !== userId) throw new Error('session changed');
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';
  const entries = items.map(item => ({ ...item, platform, appVersion, environment: 'preview' }));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const { error } = await client.rpc('submit_mobile_diagnostics', { p_entries: entries, p_expected_user: userId }).abortSignal(controller.signal);
    if (error) throw error;
  } finally { clearTimeout(timeout); }
});

export function useRemoteDiagnostics() {
  const { userId, isAuthReady } = useAuth();
  useEffect(() => {
    if (!diagnosticsEnabled()) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let foreground = AppState.currentState === 'active';
    const schedule = () => {
      if (!active || !foreground || timer) return;
      timer = setTimeout(() => { timer = null; void queue.flush().catch(() => {}); }, 5000);
    };
    void queue.activate(isAuthReady ? userId : null).then(() => { if (active) schedule(); }).catch(() => {});
    const unsubscribe = logger.subscribe(entry => { void queue.enqueue(entry).then(schedule).catch(() => {}); });
    const interval = setInterval(schedule, 30_000);
    const appState = AppState.addEventListener('change', state => {
      foreground = state === 'active';
      if (foreground) schedule();
      else if (timer) { clearTimeout(timer); timer = null; }
    });
    return () => { active = false; unsubscribe(); appState.remove(); clearInterval(interval); if (timer) clearTimeout(timer); };
  }, [userId, isAuthReady]);
}
