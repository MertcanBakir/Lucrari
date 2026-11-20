/**
 * useSupabaseHealth Hook
 * 
 * Manages Supabase health checking lifecycle, state, and auto-refresh logic.
 * Subscribes to shared module-level Supabase health cache updates for multi-screen sync.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  checkSupabaseHealth,
  getSupabaseHealthCacheSnapshot,
  subscribeSupabaseHealth,
} from '@/services/supabase/health';
import type { SupabaseHealthReport } from '@/types/health';
import { createScopedLogger } from '@/utils/logger';

const log = createScopedLogger('useSupabaseHealth');

export interface UseSupabaseHealthOptions {
  autoCheck?: boolean;
}

export interface UseSupabaseHealthReturn {
  report: SupabaseHealthReport | null;
  isLoading: boolean;
  isRefetching: boolean;
  error: Error | null;
  lastChecked: Date | null;
  refetch: () => Promise<void>;
}

export function useSupabaseHealth(options: UseSupabaseHealthOptions = {}): UseSupabaseHealthReturn {
  const { autoCheck = true } = options;

  const snapshot = getSupabaseHealthCacheSnapshot();
  const [report, setReport] = useState<SupabaseHealthReport | null>(snapshot?.report ?? null);
  const [isLoading, setIsLoading] = useState<boolean>(!snapshot && autoCheck);
  const [isRefetching, setIsRefetching] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(
    snapshot?.report?.timestamp ? new Date(snapshot.report.timestamp) : null
  );

  const isMountedRef = useRef<boolean>(true);

  // Subscribe to module-level cache updates across screens (Menu <-> Detail)
  useEffect(() => {
    const unsubscribe = subscribeSupabaseHealth((newReport) => {
      if (isMountedRef.current) {
        setReport(newReport);
        setLastChecked(new Date(newReport.timestamp));
        setIsLoading(false);
        setIsRefetching(false);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const runCheck = useCallback(async (isManualRefetch = false) => {
    if (isManualRefetch) {
      log.debug('supabase.health.refresh.requested', {
        message: 'Supabase health refresh requested.'
      });
      setIsRefetching(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const result = await checkSupabaseHealth({ forceRefresh: isManualRefetch });
      if (isMountedRef.current) {
        setReport(result);
        setLastChecked(new Date(result.timestamp));
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        const errorObj = err instanceof Error ? err : new Error('Bilinmeyen bir sağlık kontrolü hatası');
        log.warn('supabase.health.refresh.failed', {
          message: 'Supabase health refresh failed.',
          error: errorObj
        });
        setError(errorObj);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setIsRefetching(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    if (autoCheck && !getSupabaseHealthCacheSnapshot()) {
      runCheck(false);
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [autoCheck, runCheck]);

  const refetch = useCallback(async () => {
    await runCheck(true);
  }, [runCheck]);

  return {
    report,
    isLoading,
    isRefetching,
    error,
    lastChecked,
    refetch,
  };
}
