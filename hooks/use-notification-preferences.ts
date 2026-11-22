import { haptics } from '@/services/feedback/haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/auth-context';
import { getNotificationPreferences, setNotificationPreferences, notificationError } from '@/services/notifications/preferences-service';
import type { NotificationPreferences } from '@/types/notifications';

export function useNotificationPreferences(enabled = true) {
  const { userId, isAuthReady } = useAuth();
  const [state, setState] = useState<{ owner: string | null; preferences: NotificationPreferences | null; loading: boolean; error: string | null }>({
    owner: null, preferences: null, loading: true, error: null,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const savingRef = useRef(false);
  const alive = useRef(true);
  const owner = useRef(userId);
  owner.current = userId;
  const load = useCallback(async () => {
    const revision = ++generation.current;
    setSaved(false);
    setState({ owner: userId, preferences: null, loading: true, error: null });
    if (!enabled || !isAuthReady || !userId) return;
    try {
      const preferences = await getNotificationPreferences();
      if (alive.current && revision === generation.current) setState({ owner: userId, preferences, loading: false, error: null });
    } catch (error) {
      if (alive.current && revision === generation.current) setState({ owner: userId, preferences: null, loading: false, error: notificationError(error).message });
    }
  }, [userId, isAuthReady, enabled]);
  const invalidate = useCallback(() => { alive.current = false; generation.current++; }, []);
  useEffect(() => {
    alive.current = true;
    void load();
    return invalidate;
  }, [load, invalidate]);
  const update = (preferences: NotificationPreferences) => {
    setSaved(false);
    setState({ owner: userId, preferences, loading: false, error: null });
  };
  const save = async () => {
    if (!userId || state.owner !== userId || !state.preferences || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    try {
      await setNotificationPreferences(state.preferences);
      if (alive.current && owner.current === userId) {
        void haptics.notificationAsync(haptics.NotificationFeedbackType.Success);
        setSaved(true);
        setState(current => ({ ...current, error: null }));
      }
    } catch (error) {
      if (alive.current && owner.current === userId) {
        void haptics.notificationAsync(haptics.NotificationFeedbackType.Error);
        setState(current => ({ ...current, error: notificationError(error).message }));
      }
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };
  return { preferences: state.owner === userId ? state.preferences : null,
    loading: state.owner !== userId || state.loading, error: state.owner === userId ? state.error : null,
    saving, saved, update, save, reload: load, authenticated: isAuthReady && Boolean(userId) };
}
