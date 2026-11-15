import { useCallback, useEffect, useRef, useState } from 'react';

import {
  changeAnalysisConnection,
  createAnalysisConnection,
  fetchAnalysisConnections,
  isAnalysisApiError,
} from '@/services/analysis/analysis-service';
import type { AnalysisConnection } from '@/types/analysis';

export function useAnalysisConnections(userId: string | null, isFocused: boolean) {
  const [state, setState] = useState<{
    userId: string;
    items: AnalysisConnection[];
    error: string | null;
  } | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const activeUser = useRef(userId);
  const pending = useRef<{ userId: string } | null>(null);
  activeUser.current = userId;

  const run = useCallback(async (mutation?: (owner: string) => Promise<void>) => {
    if (!userId || activeUser.current !== userId || pending.current?.userId === userId) return;
    const operation = { userId };
    pending.current = operation;
    setPendingUserId(userId);
    try {
      if (mutation) await mutation(userId);
      const items = await fetchAnalysisConnections(userId);
      if (activeUser.current === userId && pending.current === operation) {
        setState({ userId, items, error: null });
      }
    } catch (error) {
      if (activeUser.current === userId && pending.current === operation) {
        const message = isAnalysisApiError(error) ? error.message : 'Bağlantılar güncellenemedi.';
        // A mutation may already have reached the server. Require a fresh list before using it.
        setState((previous) => ({
          userId,
          items: previous?.userId === userId ? previous.items : [],
          error: message,
        }));
      }
    } finally {
      if (pending.current === operation) {
        pending.current = null;
        setPendingUserId(null);
      }
    }
  }, [userId]);

  const refresh = useCallback(() => run(), [run]);
  useEffect(() => {
    if (isFocused) void refresh();
  }, [isFocused, refresh]);

  const scoped = state?.userId === userId ? state : null;
  return {
    items: scoped?.items ?? [],
    error: scoped?.error ?? null,
    isLoading: Boolean(userId && (pendingUserId === userId || !scoped)),
    refresh,
    create: (provider: string, name: string, key: string) =>
      run((owner) => createAnalysisConnection(owner, provider, name, key)),
    verify: (id: string) => run((owner) => changeAnalysisConnection(owner, id, 'verify')),
    remove: (id: string) => run((owner) => changeAnalysisConnection(owner, id, 'remove')),
  };
}
