/**
 * Lucrari — usePortfolioCalendarOwnership Hook
 * 
 * Lightweight hook providing live owned position lookup for calendar event filtering.
 * Enforces render-time user isolation (zero-frame leakage on user switches), validates
 * async result data.userId, handles auth failure without infinite spinners, and automatically
 * refreshes stale/TTL-expired snapshots.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/context/auth-context';
import {
  fetchOwnedPositions,
  getOwnershipCacheSnapshot,
  subscribeOwnershipChanges,
  type OwnedPosition,
} from '@/services/portfolio/portfolio-ownership-service';
import {
  resolveUserScopedOwnershipState,
  shouldAcceptOwnershipResult,
  type UserScopedOwnershipRawState,
} from '@/utils/calendar-event-filter';
import { createScopedLogger } from '@/utils/logger';

const log = createScopedLogger('usePortfolioCalendarOwnership');

export interface UsePortfolioCalendarOwnershipReturn {
  ownedPositions: Map<string, OwnedPosition>;
  isLoading: boolean;
  isStale: boolean;
  error: Error | null;
  hasLoadedSuccessfully: boolean;
  refetch: () => Promise<void>;
}

export function usePortfolioCalendarOwnership(): UsePortfolioCalendarOwnershipReturn {
  const { userId, isAuthReady, error: authError, retryAuth } = useAuth();

  const currentUserIdRef = useRef<string | null>(userId);
  currentUserIdRef.current = userId;

  const isMountedRef = useRef<boolean>(true);

  // Initialize raw internal state
  const [rawState, setRawState] = useState<UserScopedOwnershipRawState>(() => {
    const initialSnapshot = userId && isAuthReady ? getOwnershipCacheSnapshot(userId) : null;
    return {
      stateUserId: userId,
      ownedPositions: initialSnapshot?.ownedPositions ?? new Map(),
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
        ownedPositions: new Map(),
        isLoading: !isAuthReady,
        isStale: false,
        error: authError ? new Error(authError) : null,
        hasLoadedSuccessfully: false,
      });
      return;
    }

    const userSnapshot = getOwnershipCacheSnapshot(userId);
    setRawState({
      stateUserId: userId,
      ownedPositions: userSnapshot?.ownedPositions ?? new Map(),
      isLoading: !userSnapshot,
      isStale: userSnapshot?.isStale ?? false,
      error: null,
      hasLoadedSuccessfully: Boolean(userSnapshot),
    });
  }, [userId, isAuthReady, authError]);

  // Subscribe to module-level ownership cache updates and accept ONLY current userId notifications
  useEffect(() => {
    isMountedRef.current = true;

    const unsubscribe = subscribeOwnershipChanges((data) => {
      if (!isMountedRef.current) return;
      if (data.userId !== currentUserIdRef.current) {
        log.debug('portfolio.ownership.notification.discarded', {
          message: 'Portfolio ownership notification discarded.',
          context: { dataUserId: data.userId, currentUserId: currentUserIdRef.current }
        });
        return;
      }

      setRawState({
        stateUserId: data.userId,
        ownedPositions: data.ownedPositions,
        isStale: data.isStale,
        hasLoadedSuccessfully: true,
        isLoading: false,
        error: null,
      });
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, []);

  const loadData = useCallback(async (forceRefresh = false) => {
    const activeUserId = currentUserIdRef.current;
    if (!isMountedRef.current || !activeUserId || !isAuthReady) return;

    const userSnapshot = getOwnershipCacheSnapshot(activeUserId);
    if (forceRefresh || !userSnapshot) {
      setRawState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));
    }

    try {
      const data = await fetchOwnedPositions({ forceRefresh });

      // Strictly verify all 3 conditions together before accepting data into state
      if (
        shouldAcceptOwnershipResult({
          isMounted: isMountedRef.current,
          currentUserId: currentUserIdRef.current,
          activeUserId,
          dataUserId: data.userId,
        })
      ) {
        setRawState({
          stateUserId: data.userId,
          ownedPositions: data.ownedPositions,
          isStale: data.isStale,
          hasLoadedSuccessfully: true,
          isLoading: false,
          error: null,
        });
      } else {
        log.warn('portfolio.ownership.response.discarded', {
          message: 'Portfolio ownership response discarded.',
          context: { activeUserId, currentUserId: currentUserIdRef.current, dataUserId: data.userId }
        });
      }
    } catch (err: unknown) {
      if (isMountedRef.current && currentUserIdRef.current === activeUserId) {
        const errorObj = err instanceof Error ? err : new Error('Açık pozisyonlar yüklenemedi');
        log.warn('portfolio.ownership.load.failed', {
          message: 'Portfolio ownership load failed.',
          error: errorObj
        });
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
  const currentSnapshot = userId ? getOwnershipCacheSnapshot(userId) : null;
  const scopedState = useMemo(() => {
    return resolveUserScopedOwnershipState({
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
