import {
  ANALYSIS_HORIZONS,
  ANALYSIS_LANGUAGES,
  ANALYSIS_STAGES,
  ANALYSIS_STATUSES,
  ANALYST_CODES,
  type AnalysisEffectiveConfig,
  type AnalysisHistoryResult,
  type AnalysisHorizon,
  type AnalysisModelOption,
  type AnalysisModelSelection,
  type AnalysisProvider,
  type AnalysisProvidersResult,
  type AnalysisRecord,
  type AnalysisReport,
  type AnalysisReportSection,
  type AnalysisStatus,
} from '@/types/analysis';
import { isValidIsoTimestampWithTimezone, isValidUUID } from '@/utils/validation';

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.\-]{0,19}$/;

export const ANALYSIS_HORIZON_LABELS: Record<AnalysisHorizon, string> = {
  short_1m: 'Kısa (1 ay)',
  medium_3m: 'Orta (3 ay)',
  long_12m: 'Uzun (12 ay)',
};

function readAnalysisHorizon(value: unknown): AnalysisHorizon | undefined {
  return ANALYSIS_HORIZONS.find((horizon) => horizon === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNullableTimestamp(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return isValidIsoTimestampWithTimezone(value) ? value : undefined;
}

export function isValidAnalysisDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidAnalysisTicker(value: unknown): value is string {
  return typeof value === 'string' && TICKER_PATTERN.test(value.trim().toUpperCase());
}

export function normalizeAnalysisRecord(raw: unknown): AnalysisRecord | null {
  if (!isRecord(raw)) return null;

  const request = isRecord(raw.request) ? raw.request : null;
  const id = raw.id;
  const status = raw.status;
  const stage = raw.stage;
  const createdAt = raw.created_at;
  const startedAt = readNullableTimestamp(raw.started_at);
  const finishedAt = readNullableTimestamp(raw.finished_at);
  const errorCode = raw.error_code;
  const ticker = raw.ticker ?? request?.ticker;
  const analysisDate = raw.analysis_date ?? request?.analysis_date;
  const analysisHorizon = readAnalysisHorizon(raw.analysis_horizon ?? request?.analysis_horizon);

  if (
    !isValidUUID(id) ||
    typeof status !== 'string' ||
    !ANALYSIS_STATUSES.includes(status as AnalysisStatus) ||
    typeof stage !== 'string' ||
    !ANALYSIS_STAGES.includes(stage as (typeof ANALYSIS_STAGES)[number]) ||
    !isValidIsoTimestampWithTimezone(createdAt) ||
    startedAt === undefined ||
    finishedAt === undefined ||
    !(errorCode === null || errorCode === undefined || typeof errorCode === 'string') ||
    !isValidAnalysisTicker(ticker) ||
    !isValidAnalysisDate(analysisDate)
  ) {
    return null;
  }

  const isTerminal = ['success', 'partial', 'failed', 'timed_out'].includes(status);
  if ((isTerminal && finishedAt === null) || (!isTerminal && finishedAt !== null)) return null;
  if (status === 'success' && stage !== 'finished') return null;

  const models = isRecord(raw.models) ? raw.models : null;
  const quick = normalizeModelConfig(models?.quick);
  const deep = normalizeModelConfig(models?.deep);
  return {
    id,
    status: status as AnalysisRecord['status'],
    stage: stage as AnalysisRecord['stage'],
    createdAt,
    startedAt,
    finishedAt,
    errorCode: typeof errorCode === 'string' ? errorCode : null,
    ticker: normalizeTicker(ticker),
    analysisDate,
    ...(analysisHorizon ? { analysisHorizon } : {}),
    replayed: typeof raw.replayed === 'boolean' ? raw.replayed : null,
    ...(raw.auth_type === 'api_key' || raw.auth_type === 'personal_chatgpt'
      ? { authType: raw.auth_type }
      : {}),
    ...(quick && deep ? { models: { quick, deep } } : {}),
  };
}

export function normalizeAnalysisHistory(
  raw: unknown,
  limit: number,
  offset: number
): AnalysisHistoryResult | null {
  let rawItems: unknown;
  let rawTotal: unknown = null;
  let rawHasMore: unknown = null;

  if (Array.isArray(raw)) {
    rawItems = raw;
  } else if (isRecord(raw)) {
    rawItems = Array.isArray(raw.items)
      ? raw.items
      : Array.isArray(raw.analyses)
        ? raw.analyses
        : null;
    rawTotal = raw.total_count ?? raw.total ?? null;
    rawHasMore = raw.has_more ?? null;
  } else {
    return null;
  }

  if (!Array.isArray(rawItems) || rawItems.length > limit) return null;
  const items = rawItems.map(normalizeAnalysisRecord);
  if (items.some((item) => item === null)) return null;

  const ids = new Set(items.map((item) => item!.id));
  if (ids.size !== items.length) return null;

  const totalCount =
    typeof rawTotal === 'number' && Number.isInteger(rawTotal) && rawTotal >= 0
      ? rawTotal
      : null;
  if (totalCount !== null && totalCount < offset + items.length) return null;

  const hasMore =
    typeof rawHasMore === 'boolean'
      ? rawHasMore
      : totalCount !== null
        ? offset + items.length < totalCount
        : items.length === limit;

  return {
    items: items as AnalysisRecord[],
    limit,
    offset,
    totalCount,
    hasMore,
  };
}

export function normalizeProviders(raw: unknown): AnalysisProvidersResult | null {
  if (!isRecord(raw) || !Array.isArray(raw.providers) || !isRecord(raw.unavailable)) return null;

  const providers: AnalysisProvider[] = [];
  for (const item of raw.providers) {
    if (!isRecord(item)) return null;
    const provider = item.provider;
    const models = item.models;
    const rawModelOptions = item.model_options;
    const authType = item.auth_type;
    if (
      typeof provider !== 'string' ||
      !provider.trim() ||
      !Array.isArray(models) ||
      models.some((model) => typeof model !== 'string' || !model.trim()) ||
      !(
        rawModelOptions === undefined ||
        (Array.isArray(rawModelOptions) &&
          rawModelOptions.every(
            (option) =>
              isRecord(option) &&
              typeof option.id === 'string' &&
              Boolean(option.id.trim()) &&
              typeof option.name === 'string' &&
              Boolean(option.name.trim())
          ))
      ) ||
      (authType !== 'api_key' && authType !== 'personal_chatgpt')
    ) {
      return null;
    }

    const normalizedModels = models.map((model) => String(model).trim());
    if (new Set(normalizedModels).size !== normalizedModels.length) return null;

    const normalizedModelOptions: AnalysisModelOption[] = Array.isArray(rawModelOptions)
      ? rawModelOptions.map((option) => ({
          id: String((option as Record<string, unknown>).id).trim(),
          name: String((option as Record<string, unknown>).name).trim(),
        }))
      : [];
    if (
      new Set(normalizedModelOptions.map((option) => option.id)).size !==
      normalizedModelOptions.length
    ) {
      return null;
    }

    const modelOptions = normalizedModelOptions.length > 0
      ? normalizedModelOptions
      : normalizedModels.map((model) => ({ id: model, name: model }));
    if (modelOptions.length === 0) return null;

    providers.push({
      provider: provider.trim(),
      models: normalizedModels,
      modelOptions,
      authType,
    });
  }

  const unavailable: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.unavailable)) {
    if (typeof value !== 'string') return null;
    unavailable[key] = value;
  }

  return { providers, unavailable };
}

function normalizeModelConfig(raw: unknown): { provider: string; model: string } | null {
  if (!isRecord(raw) || typeof raw.provider !== 'string' || typeof raw.model !== 'string') {
    return null;
  }
  if (!raw.provider.trim() || !raw.model.trim()) return null;
  return { provider: raw.provider.trim(), model: raw.model.trim() };
}

function normalizeEffectiveConfig(raw: unknown): AnalysisEffectiveConfig | null {
  if (!isRecord(raw)) return null;
  const quick = normalizeModelConfig(raw.quick);
  const deep = normalizeModelConfig(raw.deep);
  const analysts = raw.analysts;
  const language = raw.language;
  if (
    !quick ||
    !deep ||
    !Number.isInteger(raw.research_rounds) ||
    Number(raw.research_rounds) < 0 ||
    !Number.isInteger(raw.risk_rounds) ||
    Number(raw.risk_rounds) < 0 ||
    !Array.isArray(analysts) ||
    analysts.some((code) => !ANALYST_CODES.includes(code as (typeof ANALYST_CODES)[number])) ||
    !ANALYSIS_LANGUAGES.includes(language as (typeof ANALYSIS_LANGUAGES)[number])
  ) {
    return null;
  }
  return {
    quick,
    deep,
    researchRounds: Number(raw.research_rounds),
    riskRounds: Number(raw.risk_rounds),
    analysts: analysts as AnalysisEffectiveConfig['analysts'],
    language: language as AnalysisEffectiveConfig['language'],
  };
}

export function normalizeAnalysisReport(raw: unknown): AnalysisReport | null {
  if (!isRecord(raw) || !Array.isArray(raw.sections) || raw.sections.length === 0) return null;
  const sections: AnalysisReportSection[] = [];
  for (const section of raw.sections) {
    if (
      !isRecord(section) ||
      typeof section.code !== 'string' ||
      !section.code.trim() ||
      typeof section.title !== 'string' ||
      !section.title.trim() ||
      !(section.content_markdown === null || typeof section.content_markdown === 'string') ||
      !isRecord(section.parts)
    ) {
      return null;
    }

    const parts: Record<string, string> = {};
    for (const [partCode, partContent] of Object.entries(section.parts)) {
      if (typeof partContent !== 'string') continue;
      const normalizedCode = partCode.trim();
      if (!normalizedCode || !partContent.trim()) continue;
      parts[normalizedCode] = partContent;
    }

    const contentMarkdown =
      typeof section.content_markdown === 'string' && section.content_markdown.trim()
        ? section.content_markdown
        : null;
    sections.push({
      code: section.code.trim(),
      title: section.title.trim(),
      contentMarkdown,
      parts,
    });
  }

  const disclaimer = sections.find((section) => section.code === 'disclaimer');
  if (!disclaimer?.contentMarkdown) return null;
  const effectiveConfig = normalizeEffectiveConfig(raw.effective_config);
  if (!effectiveConfig || typeof raw.upstream_version !== 'string' || !raw.upstream_version.trim()) {
    return null;
  }

  const analysisHorizon = readAnalysisHorizon(raw.analysis_horizon);
  return {
    sections,
    ...(analysisHorizon ? { analysisHorizon } : {}),
    effectiveConfig,
    upstreamVersion: raw.upstream_version.trim(),
  };
}

const ANALYSIS_PART_TITLES: Record<string, string> = {
  research_manager: 'Araştırma yöneticisi',
  aggressive: 'Agresif yaklaşım',
  conservative: 'Muhafazakâr yaklaşım',
  neutral: 'Nötr yaklaşım',
};

export function formatAnalysisPartTitle(partCode: string): string {
  const normalized = partCode.trim();
  if (!normalized) return 'Alt değerlendirme';
  const knownTitle = ANALYSIS_PART_TITLES[normalized];
  if (knownTitle) return knownTitle;
  const readable = normalized.replace(/[_-]+/g, ' ').trim();
  return readable ? `${readable.charAt(0).toLocaleUpperCase('tr-TR')}${readable.slice(1)}` : 'Alt değerlendirme';
}

export function resolveDefaultModels(result: AnalysisProvidersResult): AnalysisModelSelection | null {
  if (result.unavailable.chatgpt === 'MODEL_CATALOG_UNAVAILABLE' ||
      result.unavailable.chatgpt === 'PERSONAL_OWNER_ONLY') return null;
  const provider = result.providers.find(
    (item) => item.provider === 'chatgpt' && item.authType === 'personal_chatgpt'
  );
  if (!provider || provider.modelOptions.length === 0) return null;

  const firstModelId = provider.modelOptions[0].id;

  return {
    authType: provider.authType,
    quickModel: firstModelId,
    deepModel: firstModelId,
    availableModels: provider.modelOptions,
  };
}

export function reconcileSelectedModelId(
  selectedModelId: string,
  availableModels: AnalysisModelOption[]
): string {
  if (availableModels.some((model) => model.id === selectedModelId)) {
    return selectedModelId;
  }
  return availableModels[0]?.id ?? '';
}

export function getAnalysisModelCatalogError(
  result: AnalysisProvidersResult
): string | null {
  if (resolveDefaultModels(result) || result.providers.some(
    (provider) => provider.authType === 'api_key' && provider.modelOptions.length > 0
  )) return null;
  return 'AI model listesi şu anda alınamıyor. Lütfen kısa bir süre sonra tekrar deneyin.';
}

export function canUseAnalysisModelCatalog(
  selection: AnalysisModelSelection | null,
  isLoading: boolean,
  error: string | null
): boolean {
  return selection !== null && !isLoading && error === null;
}

export function isAnalysisActive(record: AnalysisRecord): boolean {
  return !record.errorCode && (record.status === 'reserved' || record.status === 'running');
}

export function isAnalysisSuccessful(record: AnalysisRecord): boolean {
  return record.status === 'success' && record.stage === 'finished' && !record.errorCode;
}

export function isAnalysisTerminal(record: AnalysisRecord): boolean {
  return isAnalysisSuccessful(record) || ['partial', 'failed', 'timed_out'].includes(record.status) || Boolean(record.errorCode);
}

export function findActiveAnalysisToTrack(
  items: AnalysisRecord[],
  preferredAnalysisId?: string | null
): AnalysisRecord | null {
  if (preferredAnalysisId) {
    const preferred = items.find(
      (item) => item.id === preferredAnalysisId && isAnalysisActive(item)
    );
    if (preferred) return preferred;
  }
  return items.find(isAnalysisActive) ?? null;
}

export function formatAnalysisStatus(status: AnalysisStatus): string {
  const labels: Record<AnalysisStatus, string> = {
    reserved: 'Sırada',
    running: 'Hazırlanıyor',
    success: 'Tamamlandı',
    partial: 'Kısmi',
    failed: 'Başarısız',
    timed_out: 'Zaman aşımı',
  };
  return labels[status];
}

export function formatAnalysisStage(stage: AnalysisRecord['stage']): string {
  const labels: Record<AnalysisRecord['stage'], string> = {
    accepted: 'İstek kabul edildi',
    analysis: 'Uzman ajanlar analiz ediyor',
    persisting: 'Rapor hazırlanıyor',
    finished: 'Rapor tamamlandı',
  };
  return labels[stage];
}

export function createLocalAnalysisDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatAnalysisDate(value: string, locale = 'tr-TR'): string {
  if (!isValidAnalysisDate(value)) return '—';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, day, 12, 0, 0));
}

export function isFutureAnalysisDate(value: string, now = new Date()): boolean {
  if (!isValidAnalysisDate(value)) return false;
  return value > createLocalAnalysisDate(now);
}
