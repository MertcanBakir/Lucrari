/**
 * Lucrari — useWatchlistMembership Hook
 * 
 * Lightweight hook providing live watchlist membership (Set<string> of watched instrumentIds)
 * for calendar event filtering, search modal indicators, and cross-screen synchronization.
 * 
 * DESIGN & PERFORMANCE:
 * - Does NOT fetch or manage paginated watchlist items, view-state pagination, or search query state.
 * - Enforces zero-frame render-time user isolation via pure selector `resolveUserScopedMembershipState`.
 * - Shares global in-flight request deduplication and user-scoped TTL cache via `fetchAllWatchedInstrumentIds`.
 * - Subscribes to cross-component pub/sub changes via `subscribeWatchlistChanges` for instant reactive updates.
 * - Handles unauthenticated / auth-error states cleanly without infinite spinners.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/context/auth-context';
import {
  fetchAllWatchedInstrumentIds,
  getWatchlistMembershipSnapshot,
  subscribeWatchlistChanges,
  type WatchlistChangeEvent,
} from '@/services/watchlist/watchlist-service';
import {
  resolveUserScopedMembershipState,
  shouldAcceptMembershipResult,
  type UserScopedMembershipRawState,
} from '@/utils/calendar-event-filter';
import { createScopedLogger } from '@/utils/logger';

const log = createScopedLogger('useWatchlistMembership');

export interface UseWatchlistMembershipReturn {
  watchedInstrumentIds: Set<string>;
  watchedCount: number;
  isLoading: boolean;
  isStale: boolean;
  error: Error | null;
  hasLoadedSuccessfully: boolean;
  refetch: () => Promise<void>;
}

export function useWatchlistMembership(): UseWatchlistMembershipReturn {
  const { userId, isAuthReady, error: authError, retryAuth } = useAuth();

  const currentUserIdRef = useRef<string | null>(userId);
  currentUserIdRef.current = userId;

  const isMountedRef = useRef<boolean>(true);

  // Initialize raw internal state from current user snapshot if present
  const [rawState, setRawState] = useState<UserScopedMembershipRawState>(() => {
    const initialSnapshot = userId && isAuthReady ? getWatchlistMembershipSnapshot(userId) : null;
    return {
      stateUserId: userId,
      watchedInstrumentIds: initialSnapshot?.instrumentIds ?? new Set(),
      isLoading: !initialSnapshot,
      isStale: initialSnapshot?.isStale ?? false,
      error: null,
      hasLoadedSuccessfully: Boolean(initialSnapshot),
    };
  });

  // Reconcile user switch in state lifecycle
  useEffect(() => {
    if (!userId || !isAuthReady) {
      setRawState({
        stateUserId: null,
        watchedInstrumentIds: new Set(),
        isLoading: !isAuthReady,
        isStale: false,
        error: authError ? new Error(authError) : null,
        hasLoadedSuccessfully: false,
      });
      return;
    }

    const userSnapshot = getWatchlistMembershipSnapshot(userId);
    setRawState({
      stateUserId: userId,
      watchedInstrumentIds: userSnapshot?.instrumentIds ?? new Set(),
      isLoading: !userSnapshot,
      isStale: userSnapshot?.isStale ?? false,
      error: null,
      hasLoadedSuccessfully: Boolean(userSnapshot),
    });
  }, [userId, isAuthReady, authError]);

  // Subscribe to module-level watchlist pub/sub notifications
  useEffect(() => {
    isMountedRef.current = true;

    const unsubscribe = subscribeWatchlistChanges((event: WatchlistChangeEvent) => {
      if (!isMountedRef.current) return;
      if (event.userId !== currentUserIdRef.current) {
        log.debug('Farklı kullanıcıya ait izleme listesi bildirimi yok sayıldı', {
          eventUserId: event.userId,
          currentUserId: currentUserIdRef.current,
        });
        return;
      }

      // Check fresh snapshot after mutation or refresh
      const updatedSnapshot = getWatchlistMembershipSnapshot(event.userId);
      if (updatedSnapshot) {
        setRawState({
          stateUserId: updatedSnapshot.userId,
          watchedInstrumentIds: updatedSnapshot.instrumentIds,
          isStale: updatedSnapshot.isStale,
          hasLoadedSuccessfully: true,
          isLoading: false,
          error: null,
        });
      }
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, []);

  const loadData = useCallback(async (forceRefresh = false) => {
    const activeUserId = currentUserIdRef.current;
    if (!isMountedRef.current || !activeUserId || !isAuthReady) return;

    const userSnapshot = getWatchlistMembershipSnapshot(activeUserId);
    if (forceRefresh || !userSnapshot) {
      setRawState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));
    }

    try {
      const data = await fetchAllWatchedInstrumentIds(forceRefresh);

      // Strictly verify all 3 conditions together before accepting data into state
      if (
        shouldAcceptMembershipResult({
          isMounted: isMountedRef.current,
          currentUserId: currentUserIdRef.current,
          activeUserId,
          dataUserId: data.userId,
        })
      ) {
        setRawState({
          stateUserId: data.userId,
          watchedInstrumentIds: data.instrumentIds,
          isStale: data.isStale,
          hasLoadedSuccessfully: true,
          isLoading: false,
          error: null,
        });
      } else {
        log.warn('Async izleme listesi üyelik cevabı kullanıcı uyuşmazlığı nedeniyle reddedildi', {
          activeUserId,
          currentUserId: currentUserIdRef.current,
          dataUserId: data.userId,
        });
      }
    } catch (err: unknown) {
      if (isMountedRef.current && currentUserIdRef.current === activeUserId) {
        const errorObj = err instanceof Error ? err : new Error('İzleme listesi yüklenemedi');
        log.warn('İzleme listesi üyeliği yüklenirken hata', errorObj);
        setRawState((prev) => ({
          ...prev,
          isLoading: false,
          error: errorObj,
        }));
      }
    }
  }, [isAuthReady]);

  useEffect(() => {
    if (userId && isAuthReady) {
      // Automatically refresh stale or expired snapshots on mount/user change
      loadData(false);
    }
  }, [userId, isAuthReady, loadData]);

  const refetch = useCallback(async () => {
    if (!userId && retryAuth) {
      await retryAuth();
    }
    await loadData(true);
  }, [userId, retryAuth, loadData]);

  // Compute render-time user-scoped state
  const currentSnapshot = userId ? getWatchlistMembershipSnapshot(userId) : null;
  const scopedState = useMemo(() => {
    return resolveUserScopedMembershipState({
      rawState,
      currentUserId: userId,
      isAuthReady,
      authError,
      snapshot: currentSnapshot,
    });
  }, [rawState, userId, isAuthReady, authError, currentSnapshot]);

  return {
    ...scopedState,
    refetch,
  };
}
