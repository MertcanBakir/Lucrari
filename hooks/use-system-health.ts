/**
 * Lucrari — System Health Reactive Hook
 * 
 * Custom hook for accessing system health state with lifecycle management,
 * pub/sub cross-screen synchronization, focus re-fetching, and pull-to-refresh.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/auth-context';
import {
  fetchSystemHealth,
  subscribeSystemHealth,
  getSystemHealthCacheSnapshot,
} from '@/services/system-health/system-health-service';
import { shouldRefreshOnFocus } from '@/utils/focus-refresh';
import type { SystemHealthReport } from '@/types/system-health';

export interface UseSystemHealthOptions {
  autoFetch?: boolean;
}

export interface UseSystemHealthResult {
  report: SystemHealthReport | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  error: string | null;
  refetch: (forceRefresh?: boolean) => Promise<void>;
  lastChecked: number;
}

export function useSystemHealth(options?: UseSystemHealthOptions): UseSystemHealthResult {
  const autoFetch = options?.autoFetch ?? true;
  const { isAuthReady, isAuthenticated } = useAuth();

  const initialSnapshot = getSystemHealthCacheSnapshot();
  const [report, setReport] = useState<SystemHealthReport | null>(initialSnapshot?.report ?? null);
  const [isLoading, setIsLoading] = useState<boolean>(autoFetch && !initialSnapshot);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isStale, setIsStale] = useState<boolean>(initialSnapshot?.report.isStale ?? false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<number>(initialSnapshot?.timestamp ?? 0);

  const isMountedRef = useRef<boolean>(true);
  const reportRef = useRef<SystemHealthReport | null>(report);
  const requestIdRef = useRef<number>(0);
  const lastFetchedTimestampRef = useRef<number>(initialSnapshot?.timestamp ?? 0);

  // Keep reportRef in sync
  useEffect(() => {
    reportRef.current = report;
  }, [report]);

  // Subscribe to service cache updates across screens (Menu <-> Detail)
  useEffect(() => {
    isMountedRef.current = true;

    const unsubscribe = subscribeSystemHealth((updatedReport) => {
      if (isMountedRef.current) {
        setReport(updatedReport);
        setIsStale(updatedReport.isStale);
        if (!updatedReport.isStale) {
          setError(null);
          lastFetchedTimestampRef.current = Date.now();
          setLastChecked(Date.now());
        }
      }
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, []);

  const loadData = useCallback(
    async (isManualRefresh = false, forceNetwork = false) => {
      const currentRequestId = ++requestIdRef.current;

      if (isManualRefresh) {
        setIsRefreshing(true);
      } else if (!reportRef.current) {
        setIsLoading(true);
      }

      try {
        const result = await fetchSystemHealth({ forceRefresh: forceNetwork });

        if (!isMountedRef.current || currentRequestId !== requestIdRef.current) {
          return;
        }

        setReport(result);
        setIsStale(result.isStale);
        setError(null);

        // Only advance the successful fetch timestamp if result is fresh
        if (!result.isStale) {
          lastFetchedTimestampRef.current = Date.now();
          setLastChecked(Date.now());
        }
      } catch (err) {
        if (!isMountedRef.current || currentRequestId !== requestIdRef.current) {
          return;
        }

        const msg = err instanceof Error ? err.message : 'Sistem durumu bilgisi alınamadı.';
        setError(msg);

        // If we already have a report, retain it and flag as stale
        if (reportRef.current) {
          setIsStale(true);
        }
      } finally {
        if (isMountedRef.current && currentRequestId === requestIdRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [] // No dependency on report state
  );

  // Initial load when auth is ready
  useEffect(() => {
    if (autoFetch && isAuthReady) {
      loadData(false, false);
    }
  }, [autoFetch, isAuthReady, isAuthenticated, loadData]);

  // Screen focus re-fetch if cache is stale
  useFocusEffect(
    useCallback(() => {
      if (
        autoFetch &&
        isAuthReady &&
        shouldRefreshOnFocus({
          isLoading,
          isRefreshing,
          error,
          lastFetchedTimestamp: lastFetchedTimestampRef.current,
        })
      ) {
        loadData(false, false);
      }
    }, [autoFetch, isAuthReady, isLoading, isRefreshing, error, loadData])
  );

  const refetch = useCallback(
    async (forceRefresh = true) => {
      await loadData(true, forceRefresh);
    },
    [loadData]
  );

  return {
    report,
    isLoading,
    isRefreshing,
    isStale,
    error,
    refetch,
    lastChecked,
  };
}
