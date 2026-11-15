/**
 * Custom Hook for Monthly Calendar Events
 * 
 * Fetches, caches, and provides earnings and economic calendar events
 * with lifecycle management, unmount cleanup, date selectors, explicit
 * hasLoadedSuccessfully status, and render-time month scoping (zero-frame leakage on month switches).
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  fetchMonthlyCalendarEvents,
  MonthlyCalendarData,
  CalendarEventItem,
  DayIndicator,
} from '@/services/calendar/calendar-service';
import { formatDateKey } from '@/utils/calendar-utils';
import {
  resolveMonthScopedCalendarState,
  shouldAcceptMonthlyCalendarResult,
  type MonthScopedCalendarRawState,
} from '@/utils/calendar-event-filter';
import { createScopedLogger } from '@/utils/logger';

const log = createScopedLogger('useMonthlyCalendar');

export interface UseMonthlyCalendarResult {
  data: MonthlyCalendarData | null;
  dayIndicators: Record<string, DayIndicator>;
  eventsByDate: Record<string, CalendarEventItem[]>;
  isLoading: boolean;
  error: string | null;
  hasLoadedSuccessfully: boolean;
  refetch: () => Promise<void>;
  getEventsForDate: (date: Date) => CalendarEventItem[];
}

export function useMonthlyCalendar(year: number, month: number): UseMonthlyCalendarResult {
  const currentMonthKey = `${year}-${month}`;
  const currentMonthKeyRef = useRef<string>(currentMonthKey);
  currentMonthKeyRef.current = currentMonthKey;

  const [rawState, setRawState] = useState<MonthScopedCalendarRawState>(() => ({
    monthKey: currentMonthKey,
    data: null,
    isLoading: true,
    error: null,
    hasLoadedSuccessfully: false,
  }));

  const abortControllerRef = useRef<AbortController | null>(null);

  // Sync internal state with month change in effect
  useEffect(() => {
    setRawState((prev) => {
      if (prev.monthKey === currentMonthKey) return prev;
      return {
        monthKey: currentMonthKey,
        data: null,
        isLoading: true,
        error: null,
        hasLoadedSuccessfully: false,
      };
    });
  }, [currentMonthKey]);

  const loadData = useCallback(async (forceRefresh = false) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const targetMonthKey = `${year}-${month}`;
    log.debug(`Ay seçildi (${year}-${String(month + 1).padStart(2, '0')})`);

    setRawState((prev) => ({
      ...prev,
      monthKey: targetMonthKey,
      isLoading: true,
      error: null,
    }));

    try {
      const result = await fetchMonthlyCalendarEvents(year, month, {
        forceRefresh,
        signal: controller.signal,
      });

      // Validate result against active target month
      if (
        shouldAcceptMonthlyCalendarResult({
          isAborted: controller.signal.aborted,
          activeMonthKey: targetMonthKey,
          currentMonthKey: currentMonthKeyRef.current,
          resultYear: result.year,
          resultMonth: result.month,
          targetYear: year,
          targetMonth: month,
        })
      ) {
        setRawState({
          monthKey: targetMonthKey,
          data: result,
          hasLoadedSuccessfully: true,
          isLoading: false,
          error: null,
        });
      } else {
        log.warn('Geciken ay takvim cevabı ay uyuşmazlığı nedeniyle reddedildi', {
          targetMonthKey,
          currentMonthKey: currentMonthKeyRef.current,
          resultYear: result.year,
          resultMonth: result.month,
        });
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted && currentMonthKeyRef.current === targetMonthKey) {
        const errorMsg = err instanceof Error ? err.message : 'Takvim verileri yüklenemedi';
        log.warn('Error in useMonthlyCalendar hook', errorMsg);
        setRawState((prev) => ({
          ...prev,
          monthKey: targetMonthKey,
          isLoading: false,
          error: errorMsg,
        }));
      }
    }
  }, [year, month]);

  useEffect(() => {
    loadData(false);

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadData]);

  const refetch = useCallback(async () => {
    await loadData(true);
  }, [loadData]);

  // Compute render-time scoped state
  const scopedState = useMemo(() => {
    return resolveMonthScopedCalendarState({
      rawState,
      currentYear: year,
      currentMonth: month,
    });
  }, [rawState, year, month]);

  const getEventsForDate = useCallback(
    (date: Date): CalendarEventItem[] => {
      const key = formatDateKey(date);
      return scopedState.eventsByDate[key] || [];
    },
    [scopedState.eventsByDate]
  );

  return {
    ...scopedState,
    refetch,
    getEventsForDate,
  };
}
