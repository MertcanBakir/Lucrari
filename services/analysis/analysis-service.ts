import { ensureAnonymousSession } from '@/services/auth/auth-service';
import { getSupabaseClient } from '@/services/supabase/client';
import type {
  AnalysisConnection,
  AnalysisCreateInput,
  AnalysisHistoryResult,
  AnalysisProvidersResult,
  AnalysisRecord,
  AnalysisReport,
} from '@/types/analysis';
import {
  normalizeAnalysisHistory,
  normalizeAnalysisRecord,
  normalizeAnalysisReport,
  normalizeProviders,
} from '@/utils/analysis';
import { createScopedLogger } from '@/utils/logger';
import { isValidIsoTimestampWithTimezone, isValidUUID } from '@/utils/validation';

const log = createScopedLogger('AnalysisService');
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RATE_LIMIT_DELAY_MS = 10_000;
export const ANALYSIS_PROVIDERS_CACHE_TTL_MS = 5 * 60 * 1_000;
const providersCacheByUserId = new Map<
  string,
  { result: AnalysisProvidersResult; timestamp: number }
>();
const inFlightProvidersByUserId = new Map<string, Promise<AnalysisProvidersResult>>();

const BACKEND_ERRORS = new Map<string, [message: string, retryable: boolean]>([
  ['MODEL_NOT_ALLOWED', ['Seçtiğiniz modele erişim artık kullanılamıyor. Model listesini yenileyip tekrar seçin.', false]],
  ['CONNECTION_NOT_FOUND', ['Bağlantı bulunamadı veya artık etkin değil.', false]],
  ['CONNECTION_LIMIT', ['En fazla 10 etkin bağlantı ekleyebilirsiniz.', false]],
  ['PROVIDER_NOT_AVAILABLE', ['Bu sağlayıcı şu anda kullanılamıyor.', false]],
  ['PROVIDER_ACCESS_ERROR', ['Sağlayıcıya erişilemedi. API anahtarını ve sağlayıcı hesabınızı kontrol edin.', false]],
  ['PROVIDER_QUOTA_ERROR', ['Sağlayıcı kotası dolmuş olabilir. API hesabınızın kullanım ve fatura durumunu kontrol edin.', false]],
  ['PROVIDER_TEMPORARY_ERROR', ['Sağlayıcı geçici olarak kullanılamıyor.', true]],
  ['CONNECTION_SECRET_UNAVAILABLE', ['Bağlantı anahtarına erişilemedi. Yeni bir bağlantı ekleyin.', false]],
  ['INSTRUMENT_NOT_SUPPORTED', ['Bu varlık analiz hizmetinde desteklenmiyor.', false]],
  ['PROVIDER_VERIFICATION_UNSUPPORTED', ['Bu sağlayıcı için bağlantı kontrolü desteklenmiyor.', false]],
  ['IDEMPOTENCY_CONFLICT', ['Bu istek anahtarı farklı bir analiz için kullanılmış. Analiz geçmişini kontrol edin.', false]],
  ['REPORT_NOT_READY', ['Rapor henüz hazır değil.', true]],
  ['CAPACITY_FULL', ['Başka bir analiz sürüyor. Biraz sonra tekrar deneyin.', true]],
  ['DAILY_ANALYSIS_LIMIT', ['Günlük analiz sınırına ulaştınız.', false]],
  ['RATE_LIMITED', ['Çok fazla istek gönderildi. Biraz sonra tekrar deneyin.', true]],
]);

export function getAnalysisFailureMessage(code: string | null): string | null {
  return code ? BACKEND_ERRORS.get(code)?.[0] ?? null : null;
}

export class AnalysisApiError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly isRetryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(options: {
    message: string;
    status?: number | null;
    code: string;
    isRetryable: boolean;
    retryAfterMs?: number | null;
    cause?: unknown;
  }) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AnalysisApiError';
    this.status = options.status ?? null;
    this.code = options.code;
    this.isRetryable = options.isRetryable;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export function getAnalysisApiBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_ANALYSIS_API_URL?.trim();
  if (!raw) {
    throw new AnalysisApiError({
      message: 'Analiz servisi yapılandırılmamış.',
      code: 'ANALYSIS_API_NOT_CONFIGURED',
      isRetryable: false,
    });
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('invalid analysis base url');
    }
    return url.toString().replace(/\/$/, '');
  } catch (error) {
    throw new AnalysisApiError({
      message: 'Analiz servisi adresi geçersiz.',
      code: 'ANALYSIS_API_INVALID_URL',
      isRetryable: false,
      cause: error,
    });
  }
}

function getRetryAfterMs(response: Response): number {
  const header = response.headers.get('retry-after');
  if (!header) return 2_000;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, MAX_RATE_LIMIT_DELAY_MS);
  }
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(dateMs - Date.now(), 0), MAX_RATE_LIMIT_DELAY_MS);
  }
  return 2_000;
}

function mapHttpError(
  status: number,
  retryAfterMs: number | null = null,
  backendCode: string | null = null
): AnalysisApiError {
  const known = backendCode ? BACKEND_ERRORS.get(backendCode) : undefined;
  if (known && backendCode) {
    return new AnalysisApiError({
      message: known[0],
      status,
      code: backendCode,
      isRetryable: known[1],
      retryAfterMs,
    });
  }
  if (status === 401) {
    return new AnalysisApiError({
      message: 'Oturum doğrulanamadı. Lütfen tekrar deneyin.',
      status,
      code: 'ANALYSIS_AUTH_REQUIRED',
      isRetryable: true,
    });
  }
  if (status === 403) {
    return new AnalysisApiError({
      message: 'Bu analiz hizmetini kullanmaya yetkiniz yok.',
      status,
      code: 'ANALYSIS_ACCESS_DENIED',
      isRetryable: false,
    });
  }
  if (status === 404) {
    return new AnalysisApiError({
      message: 'Analiz bulunamadı veya bu kayda erişilemiyor.',
      status,
      code: 'ANALYSIS_NOT_FOUND',
      isRetryable: false,
    });
  }
  if (status === 409) {
    return new AnalysisApiError({
      message: 'Analiz isteği mevcut bir işlemle çakıştı. Durumu yenileyip tekrar deneyin.',
      status,
      code: 'ANALYSIS_CONFLICT',
      isRetryable: true,
    });
  }
  if (status === 422) {
    return new AnalysisApiError({
      message: 'Analiz bilgileri geçersiz. Seçimleri kontrol edin.',
      status,
      code: 'ANALYSIS_VALIDATION_FAILED',
      isRetryable: false,
    });
  }
  if (status === 429) {
    return new AnalysisApiError({
      message: 'Çok fazla analiz isteği gönderildi. Biraz bekleyip tekrar deneyin.',
      status,
      code: 'ANALYSIS_RATE_LIMITED',
      isRetryable: true,
      retryAfterMs,
    });
  }
  return new AnalysisApiError({
    message: 'Analiz servisi geçici olarak kullanılamıyor. Lütfen tekrar deneyin.',
    status,
    code: 'ANALYSIS_SERVER_ERROR',
    isRetryable: status >= 500,
  });
}

async function readSafeBackendErrorCode(response: Response): Promise<string | null> {
  try {
    const raw = (await response.json()) as unknown;
    if (
      typeof raw === 'object' &&
      raw !== null &&
      !Array.isArray(raw) &&
      typeof (raw as { error?: unknown }).error === 'object' &&
      (raw as { error: unknown }).error !== null &&
      !Array.isArray((raw as { error: unknown }).error)
    ) {
      const code = (raw as { error: { code?: unknown } }).error.code;
      return typeof code === 'string' && code.trim() ? code.trim() : null;
    }
  } catch {
    // Error bodies are optional and must never be surfaced verbatim.
  }
  return null;
}

export function isAnalysisApiError(error: unknown): error is AnalysisApiError {
  return error instanceof AnalysisApiError;
}

export function isModelNotAllowedError(error: unknown): error is AnalysisApiError {
  return isAnalysisApiError(error) && error.code === 'MODEL_NOT_ALLOWED';
}

async function getAccessToken(forceRefresh: boolean, expectedUserId?: string): Promise<string> {
  const client = getSupabaseClient();
  const result = forceRefresh
    ? await client.auth.refreshSession()
    : await client.auth.getSession();

  if (!result.data.session && !forceRefresh && !expectedUserId) {
    const auth = await ensureAnonymousSession();
    if (auth.error || !auth.session?.access_token) {
      throw new AnalysisApiError({
        message: 'Oturum doğrulanamadı. Lütfen tekrar deneyin.',
        code: 'ANALYSIS_AUTH_REQUIRED',
        isRetryable: true,
      });
    }
    return auth.session.access_token;
  }

  if (
    result.error || !result.data.session?.access_token ||
    (expectedUserId && result.data.session.user.id !== expectedUserId)
  ) {
    throw new AnalysisApiError({
      message: 'Oturum doğrulanamadı. Lütfen tekrar deneyin.',
      code: 'ANALYSIS_AUTH_REQUIRED',
      isRetryable: true,
    });
  }

  return result.data.session.access_token;
}

async function wait(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  requiresAuth?: boolean;
  signal?: AbortSignal;
  userId?: string;
}

async function requestApi(path: string, options: ApiRequestOptions = {}): Promise<unknown> {
  const baseUrl = getAnalysisApiBaseUrl();
  const requiresAuth = options.requiresAuth !== false;
  let refreshedSession = false;
  let retriedRateLimit = false;

  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const abortListener = () => controller.abort();
    options.signal?.addEventListener('abort', abortListener, { once: true });

    try {
      const token = requiresAuth ? await getAccessToken(refreshedSession, options.userId) : null;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });

      if (response.status === 401 && requiresAuth && !refreshedSession) {
        refreshedSession = true;
        continue;
      }

      if (response.status === 429 && !retriedRateLimit && (!options.method || options.method === 'GET')) {
        retriedRateLimit = true;
        await wait(getRetryAfterMs(response));
        continue;
      }

      if (!response.ok) {
        const retryAfterMs = response.status === 429 ? getRetryAfterMs(response) : null;
        const backendCode = await readSafeBackendErrorCode(response);
        log.warn('Analiz API isteği başarısız oldu', { path, status: response.status });
        throw mapHttpError(response.status, retryAfterMs, backendCode);
      }

      const text = await response.text();
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new AnalysisApiError({
          message: 'Analiz servisi beklenmeyen bir yanıt döndürdü.',
          code: 'ANALYSIS_INVALID_JSON',
          isRetryable: false,
        });
      }
    } catch (error) {
      if (isAnalysisApiError(error)) throw error;
      const wasAborted = error instanceof Error && error.name === 'AbortError';
      throw new AnalysisApiError({
        message: wasAborted
          ? 'Analiz servisi zaman aşımına uğradı. Lütfen tekrar deneyin.'
          : 'Analiz servisine bağlanılamadı. İnternet bağlantınızı kontrol edin.',
        code: wasAborted ? 'ANALYSIS_TIMEOUT' : 'ANALYSIS_NETWORK_ERROR',
        isRetryable: true,
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortListener);
    }
  }
}

function contractError(): AnalysisApiError {
  return new AnalysisApiError({
    message: 'Analiz servisi beklenmeyen bir yanıt döndürdü.',
    code: 'ANALYSIS_CONTRACT_ERROR',
    isRetryable: false,
  });
}

function summarizeReportResponse(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { responseType: Array.isArray(raw) ? 'array' : typeof raw };
  }

  const record = raw as Record<string, unknown>;
  const sections = Array.isArray(record.sections) ? record.sections : [];
  let contentSectionCount = 0;
  let emptySectionCount = 0;
  let partSectionCount = 0;
  let partCount = 0;
  let hasDisclaimer = false;

  for (const rawSection of sections) {
    if (typeof rawSection !== 'object' || rawSection === null || Array.isArray(rawSection)) {
      continue;
    }
    const section = rawSection as Record<string, unknown>;
    if (section.code === 'disclaimer') hasDisclaimer = true;
    if (typeof section.content_markdown === 'string' && section.content_markdown.trim()) {
      contentSectionCount += 1;
    }
    const parts =
      typeof section.parts === 'object' && section.parts !== null && !Array.isArray(section.parts)
        ? Object.values(section.parts as Record<string, unknown>).filter(
            (part) => typeof part === 'string' && part.trim().length > 0
          ).length
        : 0;
    if (parts > 0) {
      partSectionCount += 1;
      partCount += parts;
    }
    if (
      !(typeof section.content_markdown === 'string' && section.content_markdown.trim()) &&
      parts === 0
    ) {
      emptySectionCount += 1;
    }
  }

  return {
    sectionCount: sections.length,
    contentSectionCount,
    emptySectionCount,
    partSectionCount,
    partCount,
    hasDisclaimer,
    hasEffectiveConfig:
      typeof record.effective_config === 'object' && record.effective_config !== null,
  };
}

export async function checkAnalysisHealth(signal?: AbortSignal): Promise<boolean> {
  const raw = await requestApi('/healthz', { requiresAuth: false, signal });
  return typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>).status === 'ok';
}

export interface FetchAnalysisProvidersOptions {
  userId: string;
  forceRefresh?: boolean;
  signal?: AbortSignal;
}

export function clearAnalysisProvidersCacheForTesting(): void {
  providersCacheByUserId.clear();
  inFlightProvidersByUserId.clear();
}

export async function fetchAnalysisProviders(
  options: FetchAnalysisProvidersOptions
): Promise<AnalysisProvidersResult> {
  const userId = options.userId.trim();
  if (!userId) throw contractError();

  const cached = providersCacheByUserId.get(userId);
  if (
    options.forceRefresh !== true &&
    cached &&
    Date.now() - cached.timestamp < ANALYSIS_PROVIDERS_CACHE_TTL_MS
  ) {
    return cached.result;
  }

  const activeRequest = inFlightProvidersByUserId.get(userId);
  if (activeRequest) return activeRequest;

  const fetchPromise = (async () => {
    const raw = await requestApi('/v1/providers', { signal: options.signal, userId });
    const result = normalizeProviders(raw);
    if (!result) throw contractError();
    providersCacheByUserId.set(userId, { result, timestamp: Date.now() });
    return result;
  })();

  inFlightProvidersByUserId.set(userId, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    if (inFlightProvidersByUserId.get(userId) === fetchPromise) {
      inFlightProvidersByUserId.delete(userId);
    }
  }
}

export async function startAnalysis(
  input: AnalysisCreateInput,
  idempotencyKey: string,
  signal?: AbortSignal,
  userId?: string
): Promise<AnalysisRecord> {
  const body = {
    request: {
      ticker: input.ticker,
      analysis_date: input.analysisDate,
      analysis_horizon: input.analysisHorizon,
      profile: 'standard',
      language: input.language,
      analysts: input.analysts,
    },
    auth_type: input.authType,
    ...(input.authType === 'personal_chatgpt'
      ? { quick_model: input.quickModel, deep_model: input.deepModel }
      : {
          models: {
            quick: { connection_id: input.quick.connectionId, model: input.quick.model },
            deep: { connection_id: input.deep.connectionId, model: input.deep.model },
          },
        }),
  };

  const raw = await requestApi('/v1/analyses', {
    method: 'POST',
    body,
    idempotencyKey,
    signal,
    userId,
  });
  const result = normalizeAnalysisRecord(raw);
  if (!result) throw contractError();
  return result;
}

export async function fetchAnalysisConnections(userId: string): Promise<AnalysisConnection[]> {
  const raw = await requestApi('/v1/connections', { userId });
  const items = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length > 10) throw contractError();

  const ids = new Set<string>();
  return items.map((item) => {
    if (
      !item || !isValidUUID(item.id) || ids.has(item.id) ||
      typeof item.provider !== 'string' || !item.provider.trim() ||
      item.status !== 'active' ||
      (item.name != null && typeof item.name !== 'string') ||
      !isValidIsoTimestampWithTimezone(item.created_at) ||
      (item.verified_at != null && !isValidIsoTimestampWithTimezone(item.verified_at))
    ) throw contractError();
    ids.add(item.id);
    return {
      id: item.id,
      provider: item.provider,
      name: item.name ?? null,
      createdAt: item.created_at,
      verifiedAt: item.verified_at ?? null,
    };
  });
}

export async function createAnalysisConnection(
  userId: string,
  provider: string,
  name: string,
  apiKey: string
): Promise<void> {
  await requestApi('/v1/connections', {
    userId,
    method: 'POST',
    body: { provider, ...(name ? { name } : {}), api_key: apiKey },
  });
}

export async function changeAnalysisConnection(
  userId: string,
  id: string,
  action: 'verify' | 'remove'
): Promise<void> {
  const path = `/v1/connections/${encodeURIComponent(id)}`;
  await requestApi(action === 'verify' ? `${path}/verify` : path, {
    userId,
    method: action === 'verify' ? 'POST' : 'DELETE',
  });
}

export async function fetchAnalysisStatus(
  analysisId: string,
  signal?: AbortSignal
): Promise<AnalysisRecord> {
  const raw = await requestApi(`/v1/analyses/${encodeURIComponent(analysisId)}`, { signal });
  const result = normalizeAnalysisRecord(raw);
  if (!result) throw contractError();
  return result;
}

export async function fetchAnalysisReport(
  analysisId: string,
  signal?: AbortSignal
): Promise<AnalysisReport> {
  log.info('Analiz raporu yükleniyor', { analysisId });

  let raw: unknown;
  try {
    raw = await requestApi(`/v1/analyses/${encodeURIComponent(analysisId)}/report`, { signal });
  } catch (error) {
    log.error('Analiz raporu isteği tamamlanamadı', error, {
      analysisId,
      errorCode: isAnalysisApiError(error) ? error.code : 'UNKNOWN',
    });
    throw error;
  }

  const responseSummary = summarizeReportResponse(raw);
  const result = normalizeAnalysisReport(raw);
  if (!result) {
    log.error('Analiz raporu cevabı sözleşmeye uymuyor', {
      analysisId,
      ...responseSummary,
    });
    throw contractError();
  }

  log.info('Analiz raporu başarıyla yüklendi', {
    analysisId,
    ...responseSummary,
    upstreamVersion: result.upstreamVersion,
  });
  return result;
}

export async function fetchAnalysisHistory(
  limit = 20,
  offset = 0,
  signal?: AbortSignal
): Promise<AnalysisHistoryResult> {
  const raw = await requestApi(`/v1/analyses?limit=${limit}&offset=${offset}`, { signal });
  const result = normalizeAnalysisHistory(raw, limit, offset);
  if (!result) throw contractError();
  return result;
}
