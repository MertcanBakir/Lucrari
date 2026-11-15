import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/context/auth-context';
import { useAnalysisConnections } from '@/hooks/use-analysis-connections';
import {
  fetchAnalysisHistory,
  fetchAnalysisProviders,
  fetchAnalysisReport,
  fetchAnalysisStatus,
  isAnalysisApiError,
  isModelNotAllowedError,
  startAnalysis,
} from '@/services/analysis/analysis-service';
import type {
  AnalysisCreateInput,
  AnalysisHistoryResult,
  AnalysisModelSelection,
  AnalysisProvidersResult,
  AnalysisRecord,
  AnalysisReport,
  AnalysisStartIntent,
} from '@/types/analysis';
import {
  findActiveAnalysisToTrack,
  getAnalysisModelCatalogError,
  isAnalysisActive,
  isAnalysisSuccessful,
  isAnalysisTerminal,
  resolveDefaultModels,
} from '@/utils/analysis';
import { createScopedLogger } from '@/utils/logger';
import { generateUUID } from '@/utils/uuid';

const log = createScopedLogger('useAnalysis');
const HISTORY_PAGE_SIZE = 20;
const ACTIVE_ANALYSIS_KEY_PREFIX = 'lucrari:active-analysis:';
const FIRST_POLL_DELAY_MS = 2_500;
const POLL_INTERVAL_MS = 5_000;

function safeMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Analiz işlemi tamamlanamadı. Lütfen tekrar deneyin.';
}

function mergeHistoryItem(items: AnalysisRecord[], incoming: AnalysisRecord): AnalysisRecord[] {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index === -1) return [incoming, ...items];
  const next = [...items];
  next[index] = incoming;
  return next;
}

export interface UseAnalysisResult {
  userId: string | null;
  connections: ReturnType<typeof useAnalysisConnections>;
  isAuthReady: boolean;
  isAuthenticated: boolean;
  retryAuth: () => Promise<void>;
  providers: AnalysisProvidersResult | null;
  modelSelection: AnalysisModelSelection | null;
  isProvidersLoading: boolean;
  providersError: string | null;
  isAccessDenied: boolean;
  history: AnalysisRecord[];
  historyTotalCount: number | null;
  isHistoryLoading: boolean;
  isHistoryRefreshing: boolean;
  historyError: string | null;
  hasMoreHistory: boolean;
  isLoadingMore: boolean;
  loadMoreError: string | null;
  selectedAnalysis: AnalysisRecord | null;
  selectedReport: AnalysisReport | null;
  isSelectedLoading: boolean;
  selectedError: string | null;
  isStarting: boolean;
  startError: string | null;
  canRetryStart: boolean;
  refreshDashboard: () => Promise<void>;
  refreshProviders: () => Promise<void>;
  loadMoreHistory: () => Promise<void>;
  openAnalysis: (record: AnalysisRecord) => Promise<void>;
  closeAnalysis: () => void;
  refreshSelected: () => Promise<void>;
  startNewAnalysis: (input: AnalysisCreateInput) => Promise<boolean>;
  retryStart: () => Promise<boolean>;
  clearStartError: () => void;
}

export function useAnalysis(): UseAnalysisResult {
  const { userId, isAuthReady, isAuthenticated, retryAuth } = useAuth();
  const isFocused = useIsFocused();
  const connections = useAnalysisConnections(isAuthReady && isAuthenticated ? userId : null, isFocused);
  const refreshConnections = connections.refresh;

  const [providers, setProviders] = useState<AnalysisProvidersResult | null>(null);
  const [providersUserId, setProvidersUserId] = useState<string | null>(null);
  const [isProvidersLoading, setIsProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [isAccessDenied, setIsAccessDenied] = useState(false);

  const [history, setHistory] = useState<AnalysisRecord[]>([]);
  const [historyTotalCount, setHistoryTotalCount] = useState<number | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isHistoryRefreshing, setIsHistoryRefreshing] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisRecord | null>(null);
  const [selectedReport, setSelectedReport] = useState<AnalysisReport | null>(null);
  const [isSelectedLoading, setIsSelectedLoading] = useState(false);
  const [selectedError, setSelectedError] = useState<string | null>(null);
  const [trackedAnalysisId, setTrackedAnalysisId] = useState<string | null>(null);

  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');
  const [pollRetryNonce, setPollRetryNonce] = useState(0);

  const activeUserRef = useRef<string | null>(userId);
  const historyRequestTokenRef = useRef(0);
  const selectedRequestTokenRef = useRef(0);
  const trackedRequestTokenRef = useRef(0);
  const trackedAnalysisIdRef = useRef<string | null>(null);
  const selectedAnalysisRef = useRef<AnalysisRecord | null>(null);
  const retryIntentRef = useRef<AnalysisStartIntent | null>(null);
  const startOperationRef = useRef<object | null>(null);
  const nextPollDelayRef = useRef(FIRST_POLL_DELAY_MS);
  const historyRef = useRef<AnalysisRecord[]>([]);
  const historyOffsetRef = useRef(0);
  const hasMoreHistoryRef = useRef(false);
  const isLoadingMoreRef = useRef(false);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    selectedAnalysisRef.current = selectedAnalysis;
  }, [selectedAnalysis]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setIsAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  const scopedProviders = providersUserId === userId ? providers : null;
  const modelSelection = useMemo(
    () => (scopedProviders ? resolveDefaultModels(scopedProviders) : null),
    [scopedProviders]
  );

  const persistActiveAnalysis = useCallback(async (id: string | null) => {
    const scopedUserId = activeUserRef.current;
    if (!scopedUserId) return;
    const key = `${ACTIVE_ANALYSIS_KEY_PREFIX}${scopedUserId}`;
    try {
      if (id) await AsyncStorage.setItem(key, id);
      else await AsyncStorage.removeItem(key);
    } catch {
      // Persistence failure must not block the analysis flow.
    }
  }, []);

  const loadProviders = useCallback(async (forceRefresh = false) => {
    const requestUserId = activeUserRef.current;
    if (!requestUserId) return;
    setIsProvidersLoading(true);
    setProvidersError(null);
    try {
      const result = await fetchAnalysisProviders({
        userId: requestUserId,
        forceRefresh,
      });
      if (activeUserRef.current !== requestUserId) return;
      setProviders(result);
      setIsAccessDenied(false);
      setProvidersUserId(requestUserId);
      setProvidersError(getAnalysisModelCatalogError(result));
    } catch (error) {
      if (activeUserRef.current !== requestUserId) return;
      setProviders(null);
      setProvidersUserId(null);
      setProvidersError(safeMessage(error));
      setIsAccessDenied(isAnalysisApiError(error) && error.status === 403);
    } finally {
      if (activeUserRef.current === requestUserId) setIsProvidersLoading(false);
    }
  }, []);

  const refreshProviders = useCallback(
    async () => loadProviders(true),
    [loadProviders]
  );

  const applyHistoryPage = useCallback((page: AnalysisHistoryResult, append: boolean) => {
    setHistory((previous) => {
      if (!append) return page.items;
      const ids = new Set(previous.map((item) => item.id));
      return [...previous, ...page.items.filter((item) => !ids.has(item.id))];
    });
    const nextOffset = page.offset + page.items.length;
    historyOffsetRef.current = nextOffset;
    hasMoreHistoryRef.current = page.hasMore;
    setHistoryTotalCount(page.totalCount);
    setHasMoreHistory(page.hasMore);
  }, []);

  const loadHistory = useCallback(
    async (options: { append?: boolean; refresh?: boolean } = {}) => {
      const requestUserId = activeUserRef.current;
      if (!requestUserId) return;
      const append = options.append === true;
      if (append && (isLoadingMoreRef.current || !hasMoreHistoryRef.current)) return;
      const requestOffset = append ? historyOffsetRef.current : 0;
      const requestToken = ++historyRequestTokenRef.current;

      if (append) {
        isLoadingMoreRef.current = true;
        setIsLoadingMore(true);
        setLoadMoreError(null);
      } else if (options.refresh && historyRef.current.length > 0) {
        setIsHistoryRefreshing(true);
        setHistoryError(null);
      } else {
        setIsHistoryLoading(true);
        setHistoryError(null);
      }

      try {
        const page = await fetchAnalysisHistory(HISTORY_PAGE_SIZE, requestOffset);
        if (
          requestToken !== historyRequestTokenRef.current ||
          activeUserRef.current !== requestUserId
        ) {
          return;
        }
        applyHistoryPage(page, append);
      } catch (error) {
        if (
          requestToken !== historyRequestTokenRef.current ||
          activeUserRef.current !== requestUserId
        ) {
          return;
        }
        if (append) setLoadMoreError(safeMessage(error));
        else setHistoryError(safeMessage(error));
      } finally {
        if (
          requestToken === historyRequestTokenRef.current &&
          activeUserRef.current === requestUserId
        ) {
          setIsHistoryLoading(false);
          setIsHistoryRefreshing(false);
          setIsLoadingMore(false);
          isLoadingMoreRef.current = false;
        }
      }
    },
    [applyHistoryPage]
  );

  const trackAnalysis = useCallback(
    (record: AnalysisRecord, firstPoll = false) => {
      if (!isAnalysisActive(record)) return;
      if (trackedAnalysisIdRef.current !== record.id) {
        ++trackedRequestTokenRef.current;
      }
      trackedAnalysisIdRef.current = record.id;
      setTrackedAnalysisId(record.id);
      nextPollDelayRef.current = firstPoll ? FIRST_POLL_DELAY_MS : POLL_INTERVAL_MS;
      void persistActiveAnalysis(record.id);
    },
    [persistActiveAnalysis]
  );

  const stopTrackingAnalysis = useCallback(
    (analysisId: string) => {
      if (trackedAnalysisIdRef.current !== analysisId) return;
      ++trackedRequestTokenRef.current;
      trackedAnalysisIdRef.current = null;
      setTrackedAnalysisId(null);
      void persistActiveAnalysis(null);
    },
    [persistActiveAnalysis]
  );

  const loadSelectedAnalysis = useCallback(
    async (analysisId: string, showLoading = false) => {
      const requestUserId = activeUserRef.current;
      if (!requestUserId) return;
      const requestToken = ++selectedRequestTokenRef.current;
      if (showLoading) setIsSelectedLoading(true);
      setSelectedError(null);

      try {
        log.debug('Seçili analiz durumu kontrol ediliyor', { analysisId, requestToken });
        const status = await fetchAnalysisStatus(analysisId);
        if (
          requestToken !== selectedRequestTokenRef.current ||
          activeUserRef.current !== requestUserId
        ) {
          log.debug('Geciken analiz durumu cevabı reddedildi', { analysisId, requestToken });
          return;
        }

        log.debug('Analiz durumu güncellendi', {
          analysisId,
          status: status.status,
          stage: status.stage,
        });
        selectedAnalysisRef.current = status;
        setSelectedAnalysis(status);
        setHistory((previous) => mergeHistoryItem(previous, status));

        if (isAnalysisSuccessful(status)) {
          log.info('Tamamlanan analiz için rapor isteniyor', { analysisId, ticker: status.ticker });
          const report = await fetchAnalysisReport(analysisId);
          if (
            requestToken !== selectedRequestTokenRef.current ||
            activeUserRef.current !== requestUserId
          ) {
            log.debug('Geciken analiz raporu cevabı reddedildi', { analysisId, requestToken });
            return;
          }
          log.info('Analiz raporu arayüze uygulandı', {
            analysisId,
            sectionCount: report.sections.length,
            partCount: report.sections.reduce(
              (total, section) => total + Object.keys(section.parts).length,
              0
            ),
          });
          selectedAnalysisRef.current = status;
          setSelectedReport(report);
          stopTrackingAnalysis(analysisId);
        } else if (isAnalysisActive(status)) {
          trackAnalysis(status);
          setPollRetryNonce((value) => value + 1);
        } else if (isAnalysisTerminal(status)) {
          setSelectedReport(null);
          stopTrackingAnalysis(analysisId);
        }
      } catch (error) {
        if (
          requestToken === selectedRequestTokenRef.current &&
          activeUserRef.current === requestUserId
        ) {
          log.warn('Seçili analiz yüklenemedi', {
            analysisId,
            errorCode: isAnalysisApiError(error) ? error.code : 'UNKNOWN',
            error: safeMessage(error),
          });
          setSelectedError(safeMessage(error));
          setPollRetryNonce((value) => value + 1);
        }
      } finally {
        if (
          requestToken === selectedRequestTokenRef.current &&
          activeUserRef.current === requestUserId
        ) {
          setIsSelectedLoading(false);
        }
      }
    },
    [stopTrackingAnalysis, trackAnalysis]
  );

  const pollTrackedAnalysis = useCallback(
    async (analysisId: string) => {
      const requestUserId = activeUserRef.current;
      if (!requestUserId || trackedAnalysisIdRef.current !== analysisId) return;
      const requestToken = ++trackedRequestTokenRef.current;

      try {
        log.debug('Arka plan analiz durumu kontrol ediliyor', { analysisId, requestToken });
        const status = await fetchAnalysisStatus(analysisId);
        if (
          requestToken !== trackedRequestTokenRef.current ||
          trackedAnalysisIdRef.current !== analysisId ||
          activeUserRef.current !== requestUserId
        ) {
          log.debug('Geciken arka plan analiz cevabı reddedildi', { analysisId, requestToken });
          return;
        }

        setHistory((previous) => mergeHistoryItem(previous, status));
        const isSelected = selectedAnalysisRef.current?.id === analysisId;
        if (isSelected) {
          selectedAnalysisRef.current = status;
          setSelectedAnalysis(status);
          setSelectedError(null);
        }

        if (isAnalysisSuccessful(status)) {
          if (isSelected) {
            try {
              const report = await fetchAnalysisReport(analysisId);
              if (
                requestToken === trackedRequestTokenRef.current &&
                trackedAnalysisIdRef.current === analysisId &&
                selectedAnalysisRef.current?.id === analysisId &&
                activeUserRef.current === requestUserId
              ) {
                setSelectedReport(report);
              }
            } catch (error) {
              if (selectedAnalysisRef.current?.id === analysisId) {
                setSelectedError(safeMessage(error));
              }
            }
          }
          stopTrackingAnalysis(analysisId);
          return;
        }

        if (isAnalysisTerminal(status)) {
          if (isSelected) setSelectedReport(null);
          stopTrackingAnalysis(analysisId);
          return;
        }

        setPollRetryNonce((value) => value + 1);
      } catch (error) {
        if (
          requestToken !== trackedRequestTokenRef.current ||
          trackedAnalysisIdRef.current !== analysisId ||
          activeUserRef.current !== requestUserId
        ) {
          return;
        }
        log.warn('Arka plan analiz durumu alınamadı', {
          analysisId,
          errorCode: isAnalysisApiError(error) ? error.code : 'UNKNOWN',
          error: safeMessage(error),
        });
        if (selectedAnalysisRef.current?.id === analysisId) {
          setSelectedError(safeMessage(error));
        }
        setPollRetryNonce((value) => value + 1);
      }
    },
    [stopTrackingAnalysis]
  );

  const openAnalysis = useCallback(
    async (record: AnalysisRecord) => {
      log.info('Analiz detayı açıldı', {
        analysisId: record.id,
        ticker: record.ticker,
        status: record.status,
        stage: record.stage,
      });
      setSelectedAnalysis(record);
      selectedAnalysisRef.current = record;
      setSelectedReport(null);
      setSelectedError(null);
      nextPollDelayRef.current = isAnalysisActive(record)
        ? FIRST_POLL_DELAY_MS
        : POLL_INTERVAL_MS;
      if (isAnalysisActive(record)) trackAnalysis(record);
      await loadSelectedAnalysis(record.id, true);
    },
    [loadSelectedAnalysis, trackAnalysis]
  );

  const closeAnalysis = useCallback(() => {
    ++selectedRequestTokenRef.current;
    selectedAnalysisRef.current = null;
    setSelectedAnalysis(null);
    setSelectedReport(null);
    setSelectedError(null);
    setIsSelectedLoading(false);
  }, []);

  const refreshSelected = useCallback(async () => {
    if (selectedAnalysis) await loadSelectedAnalysis(selectedAnalysis.id, true);
  }, [loadSelectedAnalysis, selectedAnalysis]);

  const executeStart = useCallback(
    async (intent: AnalysisStartIntent): Promise<boolean> => {
      if (startOperationRef.current) return false;
      const requestUserId = activeUserRef.current;
      if (!requestUserId) {
        setStartError('Analiz başlatmak için oturum doğrulanmalıdır.');
        return false;
      }
      const operation = {};
      startOperationRef.current = operation;
      retryIntentRef.current = intent;
      setIsStarting(true);
      setStartError(null);
      try {
        const result = await startAnalysis(intent.input, intent.idempotencyKey, undefined, requestUserId);
        if (activeUserRef.current !== requestUserId || startOperationRef.current !== operation) return false;
        retryIntentRef.current = null;
        setHistory((previous) => mergeHistoryItem(previous, result));
        trackAnalysis(result, true);
        log.info('Analiz kabul edildi; ana ekran etkileşimi korunarak arka planda takip ediliyor', {
          analysisId: result.id,
          ticker: result.ticker,
          status: result.status,
        });
        return true;
      } catch (error) {
        if (activeUserRef.current !== requestUserId || startOperationRef.current !== operation) return false;
        if (isModelNotAllowedError(error)) {
          retryIntentRef.current = null;
          setProviders(null);
          setProvidersUserId(null);
          await refreshProviders();
          if (activeUserRef.current === requestUserId && startOperationRef.current === operation) {
            setStartError(
              'Model erişiminiz değişti. Güncel listeden hızlı ve derin modeli yeniden seçin.'
            );
          }
          return false;
        }
        setStartError(safeMessage(error));
        if (isAnalysisApiError(error) && error.code === 'CONNECTION_NOT_FOUND') {
          await refreshConnections();
        }
        if (!isAnalysisApiError(error) || !error.isRetryable) {
          retryIntentRef.current = null;
        }
        if (isAnalysisApiError(error) && error.status === 409) {
          await loadHistory({ refresh: true });
        }
        return false;
      } finally {
        if (startOperationRef.current === operation) {
          startOperationRef.current = null;
          setIsStarting(false);
        }
      }
    },
    [loadHistory, refreshConnections, refreshProviders, trackAnalysis]
  );

  const startNewAnalysis = useCallback(
    async (input: AnalysisCreateInput) => {
      const intent: AnalysisStartIntent = { idempotencyKey: generateUUID(), input };
      return executeStart(intent);
    },
    [executeStart]
  );

  const retryStart = useCallback(async () => {
    const intent = retryIntentRef.current;
    if (!intent) return false;
    return executeStart(intent);
  }, [executeStart]);

  const clearStartError = useCallback(() => {
    setStartError(null);
    retryIntentRef.current = null;
  }, []);

  const refreshDashboard = useCallback(async () => {
    await Promise.all([refreshProviders(), refreshConnections(), loadHistory({ refresh: true })]);
  }, [loadHistory, refreshConnections, refreshProviders]);

  useEffect(() => {
    activeUserRef.current = userId;
    ++historyRequestTokenRef.current;
    ++selectedRequestTokenRef.current;
    ++trackedRequestTokenRef.current;
    trackedAnalysisIdRef.current = null;
    selectedAnalysisRef.current = null;
    retryIntentRef.current = null;
    startOperationRef.current = null;
    setIsStarting(false);
    setHistory([]);
    historyRef.current = [];
    historyOffsetRef.current = 0;
    setHistoryTotalCount(null);
    setHasMoreHistory(false);
    hasMoreHistoryRef.current = false;
    isLoadingMoreRef.current = false;
    setHistoryError(null);
    setProviders(null);
    setProvidersUserId(null);
    setIsProvidersLoading(false);
    setProvidersError(null);
    setIsAccessDenied(false);
    setSelectedAnalysis(null);
    setSelectedReport(null);
    setSelectedError(null);
    setTrackedAnalysisId(null);
    setStartError(null);

    if (!isAuthReady || !userId) return;

    loadProviders();
    loadHistory();

    let cancelled = false;
    AsyncStorage.getItem(`${ACTIVE_ANALYSIS_KEY_PREFIX}${userId}`)
      .then((storedId) => {
        if (
          !cancelled &&
          storedId &&
          !trackedAnalysisIdRef.current &&
          activeUserRef.current === userId
        ) {
          trackedAnalysisIdRef.current = storedId;
          setTrackedAnalysisId(storedId);
          nextPollDelayRef.current = FIRST_POLL_DELAY_MS;
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isAuthReady, loadHistory, loadProviders, loadSelectedAnalysis, userId]);

  useEffect(() => {
    if (!isFocused || !isAppActive || !isAuthReady || !userId) return;
    void loadProviders();
  }, [isAppActive, isAuthReady, isFocused, loadProviders, userId]);

  useEffect(() => {
    if (!userId || trackedAnalysisIdRef.current) return;
    const active = findActiveAnalysisToTrack(history);
    if (active) trackAnalysis(active, true);
  }, [history, trackAnalysis, userId]);

  useEffect(() => {
    if (
      !isFocused ||
      !isAppActive ||
      !trackedAnalysisId
    ) {
      return;
    }

    const delay = nextPollDelayRef.current;
    nextPollDelayRef.current = POLL_INTERVAL_MS;
    const timer = setTimeout(() => {
      pollTrackedAnalysis(trackedAnalysisId);
    }, delay);
    return () => clearTimeout(timer);
  }, [isAppActive, isFocused, pollRetryNonce, pollTrackedAnalysis, trackedAnalysisId]);

  return {
    userId,
    connections,
    isAuthReady,
    isAuthenticated,
    retryAuth,
    providers: scopedProviders,
    modelSelection,
    isProvidersLoading,
    providersError,
    isAccessDenied,
    history,
    historyTotalCount,
    isHistoryLoading,
    isHistoryRefreshing,
    historyError,
    hasMoreHistory,
    isLoadingMore,
    loadMoreError,
    selectedAnalysis,
    selectedReport,
    isSelectedLoading,
    selectedError,
    isStarting,
    startError,
    canRetryStart: activeUserRef.current === userId && retryIntentRef.current !== null,
    refreshDashboard,
    refreshProviders,
    loadMoreHistory: () => loadHistory({ append: true }),
    openAnalysis,
    closeAnalysis,
    refreshSelected,
    startNewAnalysis,
    retryStart,
    clearStartError,
  };
}
