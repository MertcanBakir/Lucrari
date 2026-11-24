/**
 * Lucrari — System and Data Health Pure View-Model & Formatters
 * 
 * Pure deterministic functions for data normalization, catalog allowlisting,
 * fail-closed contract validation, overall health evaluation (critical > warning > running > unknown > healthy),
 * category grouping, duration, and date formatting.
 */

import type {
  JobExecutionStatus,
  JobHealthStatus,
  JobMessageCode,
  NormalizedJobHealthItem,
  OverallHealthEvaluation,
  SystemHealthCategoryKey,
  SystemHealthSection,
  ExpectedJobCode,
  ExpectedJobMetadata,
} from '@/types/system-health';
import type { SystemHealthRpcItem } from '@/types/database';

export const EXPECTED_JOBS_CATALOG: readonly ExpectedJobMetadata[] = [
  {
    jobCode: 'BIST_PRICES',
    category: 'prices',
    categoryKey: 'prices',
    categoryTitle: 'Fiyat Verileri',
    displayName: 'Borsa İstanbul Fiyatları',
    sortOrder: 1,
  },
  {
    jobCode: 'NASDAQ_PRICES',
    category: 'prices',
    categoryKey: 'prices',
    categoryTitle: 'Fiyat Verileri',
    displayName: 'NASDAQ 100 Fiyatları',
    sortOrder: 2,
  },
  {
    jobCode: 'CRYPTO_PRICES',
    category: 'prices',
    categoryKey: 'prices',
    categoryTitle: 'Fiyat Verileri',
    displayName: 'Kripto Varlık Fiyatları',
    sortOrder: 3,
  },
  {
    jobCode: 'TEFAS_PRICES',
    category: 'prices',
    categoryKey: 'prices',
    categoryTitle: 'Fiyat Verileri',
    displayName: 'TEFAS Fon Fiyatları',
    sortOrder: 4,
  },
  {
    jobCode: 'USDTRY_PRICE',
    category: 'prices',
    categoryKey: 'prices',
    categoryTitle: 'Fiyat Verileri',
    displayName: 'USD/TRY Döviz Kuru',
    sortOrder: 5,
  },
  {
    jobCode: 'EARNINGS_CALENDAR',
    category: 'calendar',
    categoryKey: 'calendar',
    categoryTitle: 'Takvimler',
    displayName: 'Şirket Bilançoları Takvimi',
    sortOrder: 6,
  },
  {
    jobCode: 'ECONOMIC_CALENDAR',
    category: 'calendar',
    categoryKey: 'calendar',
    categoryTitle: 'Takvimler',
    displayName: 'Ekonomik Göstergeler Takvimi',
    sortOrder: 7,
  },
  {
    jobCode: 'PORTFOLIO_SNAPSHOTS',
    category: 'portfolio',
    categoryKey: 'portfolio',
    categoryTitle: 'Portföy',
    displayName: 'Portföy Günlük Değerleme Motoru',
    sortOrder: 8,
  },
] as const;

const EXPECTED_JOBS_MAP = new Map<string, ExpectedJobMetadata>(
  EXPECTED_JOBS_CATALOG.map((item) => [item.jobCode, item])
);

const VALID_EXECUTION_STATUSES: Set<JobExecutionStatus> = new Set([
  'running',
  'success',
  'partial',
  'failed',
  'skipped',
  'never_run',
]);

const VALID_HEALTH_STATUSES: Set<JobHealthStatus> = new Set([
  'healthy',
  'warning',
  'critical',
  'running',
  'inactive',
  'unknown',
]);

const VALID_MESSAGE_CODES: Set<JobMessageCode> = new Set([
  'JOB_OK',
  'JOB_PARTIAL',
  'JOB_FAILED',
  'JOB_OVERDUE',
  'JOB_RUNNING',
  'JOB_SKIPPED',
  'JOB_NEVER_RUN',
]);

const CATEGORY_SORT_ORDER: Record<SystemHealthCategoryKey, number> = {
  prices: 1,
  calendar: 2,
  portfolio: 3,
  other: 4,
};

/**
 * Validates whether an ISO string represents a valid parseable date.
 */
function parseValidIsoString(dateStr: unknown): string | null {
  if (typeof dateStr !== 'string' || !dateStr.trim()) {
    return null;
  }
  const date = new Date(dateStr.trim());
  if (isNaN(date.getTime())) {
    return null;
  }
  return dateStr.trim();
}

/**
 * Normalizes duration_seconds safely.
 * Non-empty numeric strings and finite non-negative numbers are allowed.
 * Empty string, whitespace, NaN, Infinity, negative values return null.
 */
function normalizeDuration(duration: unknown): number | null {
  if (duration === null || duration === undefined) {
    return null;
  }

  if (typeof duration === 'number') {
    return Number.isFinite(duration) && duration >= 0 ? duration : null;
  }

  if (typeof duration === 'string') {
    const trimmed = duration.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  return null;
}

/**
 * Normalizes a single raw RPC item safely against the expected catalog allowlist.
 * If any mandatory contract requirement is violated:
 * - Unsupported or missing message_code
 * - Invalid or missing execution_status
 * - Invalid or missing health_status
 * - Invalid or missing mandatory checked_at
 * - Non-boolean is_overdue
 * The item fails closed to:
 * - healthStatus: 'unknown'
 * - messageCode: 'JOB_STATUS_UNAVAILABLE'
 * - executionStatus: 'never_run'
 * - isOverdue: false
 */
export function normalizeJobHealthItem(raw: unknown): NormalizedJobHealthItem | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const r = raw as Partial<SystemHealthRpcItem>;

  if (!r.job_code || typeof r.job_code !== 'string') {
    return null;
  }

  const code = r.job_code.trim();
  const meta = EXPECTED_JOBS_MAP.get(code);
  if (!meta) {
    // Ignore unknown extra jobs outside allowlist
    return null;
  }

  const isValidMessageCode =
    typeof r.message_code === 'string' && VALID_MESSAGE_CODES.has(r.message_code as JobMessageCode);

  const isValidExecutionStatus =
    typeof r.execution_status === 'string' && VALID_EXECUTION_STATUSES.has(r.execution_status as JobExecutionStatus);

  const isValidHealthStatus =
    typeof r.health_status === 'string' && VALID_HEALTH_STATUSES.has(r.health_status as JobHealthStatus);

  const checkedAt = parseValidIsoString(r.checked_at);
  const isValidCheckedAt = checkedAt !== null;

  const isValidIsOverdue = typeof r.is_overdue === 'boolean';

  const hasContractViolation =
    !isValidMessageCode ||
    !isValidExecutionStatus ||
    !isValidHealthStatus ||
    !isValidCheckedAt ||
    !isValidIsOverdue;

  const durationSeconds = normalizeDuration(r.duration_seconds);
  const lastStartedAt = parseValidIsoString(r.last_started_at);
  const lastFinishedAt = parseValidIsoString(r.last_finished_at);
  const lastSuccessAt = parseValidIsoString(r.last_success_at);

  if (hasContractViolation) {
    return {
      jobCode: meta.jobCode,
      category: meta.category,
      categoryKey: meta.categoryKey,
      categoryTitle: meta.categoryTitle,
      displayName: meta.displayName,
      sortOrder: meta.sortOrder,
      executionStatus: 'never_run',
      healthStatus: 'unknown',
      lastStartedAt,
      lastFinishedAt,
      lastSuccessAt,
      durationSeconds,
      isOverdue: false,
      messageCode: 'JOB_STATUS_UNAVAILABLE',
      checkedAt,
    };
  }

  return {
    jobCode: meta.jobCode,
    category: meta.category,
    categoryKey: meta.categoryKey,
    categoryTitle: meta.categoryTitle,
    displayName: meta.displayName,
    sortOrder: meta.sortOrder,
    executionStatus: r.execution_status as JobExecutionStatus,
    healthStatus: r.health_status as JobHealthStatus,
    lastStartedAt,
    lastFinishedAt,
    lastSuccessAt,
    durationSeconds,
    isOverdue: r.is_overdue === true,
    messageCode: r.message_code as JobMessageCode,
    checkedAt,
  };
}

export interface NormalizeSystemHealthResult {
  items: NormalizedJobHealthItem[];
  isIncomplete: boolean;
  checkedAt: string | null;
}

/**
 * Normalizes the entire RPC response:
 * - Throws a contract error if response is not an array.
 * - Deduplicates matching jobs deterministically (picks the newest checked_at).
 * - Ignores unknown extra jobs outside the allowlist.
 * - Fills in any missing expected jobs as synthetic unknown items and sets isIncomplete=true.
 * - Sets isIncomplete=true if any expected job had a contract violation.
 * - Sorts items according to catalog sortOrder.
 */
export function normalizeSystemHealthResponse(raw: unknown): NormalizeSystemHealthResult {
  if (!Array.isArray(raw)) {
    throw new Error('Sistem durumu bilgisi alınamadı.');
  }

  const rawMap = new Map<ExpectedJobCode, { item: NormalizedJobHealthItem; hasContractViolation: boolean }>();

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Partial<SystemHealthRpcItem>;
    if (!r.job_code || typeof r.job_code !== 'string') continue;
    const code = r.job_code.trim();
    if (!EXPECTED_JOBS_MAP.has(code)) continue;

    const isValidMessageCode =
      typeof r.message_code === 'string' && VALID_MESSAGE_CODES.has(r.message_code as JobMessageCode);
    const isValidExecutionStatus =
      typeof r.execution_status === 'string' && VALID_EXECUTION_STATUSES.has(r.execution_status as JobExecutionStatus);
    const isValidHealthStatus =
      typeof r.health_status === 'string' && VALID_HEALTH_STATUSES.has(r.health_status as JobHealthStatus);
    const checkedAt = parseValidIsoString(r.checked_at);
    const isValidCheckedAt = checkedAt !== null;
    const isValidIsOverdue = typeof r.is_overdue === 'boolean';

    const hasContractViolation =
      !isValidMessageCode ||
      !isValidExecutionStatus ||
      !isValidHealthStatus ||
      !isValidCheckedAt ||
      !isValidIsOverdue;

    const item = normalizeJobHealthItem(entry);
    if (!item) continue;

    const expectedCode = item.jobCode as ExpectedJobCode;
    const existing = rawMap.get(expectedCode);
    if (!existing) {
      rawMap.set(expectedCode, { item, hasContractViolation });
    } else {
      // Deterministic duplicate resolution: prefer item with newer valid checked_at
      const existingTime = existing.item.checkedAt ? new Date(existing.item.checkedAt).getTime() : 0;
      const itemTime = item.checkedAt ? new Date(item.checkedAt).getTime() : 0;
      if (itemTime > existingTime) {
        rawMap.set(expectedCode, { item, hasContractViolation });
      }
    }
  }

  let isIncomplete = false;
  let latestCheckedAt: string | null = null;
  const finalItems: NormalizedJobHealthItem[] = [];

  for (const meta of EXPECTED_JOBS_CATALOG) {
    const found = rawMap.get(meta.jobCode);
    if (found) {
      finalItems.push(found.item);
      if (found.hasContractViolation) {
        isIncomplete = true;
      }
      if (found.item.checkedAt) {
        if (!latestCheckedAt || new Date(found.item.checkedAt).getTime() > new Date(latestCheckedAt).getTime()) {
          latestCheckedAt = found.item.checkedAt;
        }
      }
    } else {
      // Missing expected job in catalog
      isIncomplete = true;
      finalItems.push({
        jobCode: meta.jobCode,
        category: meta.category,
        categoryKey: meta.categoryKey,
        categoryTitle: meta.categoryTitle,
        displayName: meta.displayName,
        sortOrder: meta.sortOrder,
        executionStatus: 'never_run',
        healthStatus: 'unknown',
        lastStartedAt: null,
        lastFinishedAt: null,
        lastSuccessAt: null,
        durationSeconds: null,
        isOverdue: false,
        messageCode: 'JOB_STATUS_UNAVAILABLE',
        checkedAt: null,
      });
    }
  }

  finalItems.sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    items: finalItems,
    isIncomplete,
    checkedAt: latestCheckedAt,
  };
}

/**
 * Evaluates the overall system health according to the strict priority rule:
 * critical > warning > running > unknown > healthy
 * 
 * Rules:
 * - Any critical -> critical ("Bazı işlemler çalışmıyor.")
 * - Critical yok, any warning -> warning ("Bazı veriler gecikmiş veya kısmi.")
 * - Bunlar yok, any running -> running ("Veriler güncelleniyor.")
 * - Bunlar yok, any unknown veya never_run -> unknown ("İlk çalışma sonuçları bekleniyor.")
 * - inactive/skipped tek başına unknown veya hata sayılmaz
 * - Kalan kayıtların tamamı healthy veya normal inactive/skipped ise -> healthy ("Tüm sistemler normal.")
 */
export function evaluateOverallHealth(
  items: NormalizedJobHealthItem[],
  checkedAt?: string | null
): OverallHealthEvaluation {
  const totalJobCount = items.length;

  if (totalJobCount === 0) {
    return {
      status: 'unknown',
      title: 'İlk çalışma sonuçları bekleniyor.',
      subtitle: checkedAt ? `Son kontrol: ${formatSystemHealthDateTime(checkedAt)}` : 'Henüz durum verisi bulunmuyor.',
      failedCount: 0,
      overdueCount: 0,
      warningCount: 0,
      runningCount: 0,
      unknownCount: 0,
      totalJobCount: 0,
      checkedAt: checkedAt ?? null,
    };
  }

  // Issue counts
  // skipped and never_run are NOT counted in failedCount or overdueCount
  const failedCount = items.filter((item) => item.executionStatus === 'failed').length;
  const overdueCount = items.filter((item) => item.isOverdue || item.messageCode === 'JOB_OVERDUE').length;
  const warningCount = items.filter((item) => item.healthStatus === 'warning').length;
  const runningCount = items.filter(
    (item) => item.executionStatus === 'running' || item.healthStatus === 'running'
  ).length;
  const unknownCount = items.filter(
    (item) =>
      (item.healthStatus === 'unknown' || item.executionStatus === 'never_run') &&
      item.healthStatus !== 'inactive' &&
      item.executionStatus !== 'skipped'
  ).length;

  const hasCritical = items.some((item) => item.healthStatus === 'critical');
  const hasWarning = items.some((item) => item.healthStatus === 'warning');
  const hasRunning = items.some((item) => item.healthStatus === 'running' || item.executionStatus === 'running');
  const hasUnknownOrNeverRun = items.some(
    (item) =>
      (item.healthStatus === 'unknown' || item.executionStatus === 'never_run') &&
      item.healthStatus !== 'inactive' &&
      item.executionStatus !== 'skipped'
  );

  let status: OverallHealthEvaluation['status'] = 'healthy';
  let title = 'Tüm sistemler normal.';

  if (hasCritical) {
    status = 'critical';
    title = 'Bazı işlemler çalışmıyor.';
  } else if (hasWarning) {
    status = 'warning';
    title = 'Bazı veriler gecikmiş veya kısmi.';
  } else if (hasRunning) {
    status = 'running';
    title = 'Veriler güncelleniyor.';
  } else if (hasUnknownOrNeverRun) {
    status = 'unknown';
    title = 'İlk çalışma sonuçları bekleniyor.';
  }

  // Informative subtitle construction
  let subtitle: string;
  if (failedCount > 0 && overdueCount > 0) {
    subtitle = `${failedCount} işlem başarısız, ${overdueCount} veri kaynağı gecikmiş`;
  } else if (failedCount > 0) {
    subtitle = `${failedCount} işlem başarısız`;
  } else if (overdueCount > 0) {
    subtitle = `${overdueCount} veri kaynağı gecikmiş`;
  } else if (warningCount > 0) {
    subtitle = `${warningCount} veri kaynağında kısmi durum`;
  } else if (runningCount > 0) {
    subtitle = `${runningCount} veri kaynağı şu anda güncelleniyor`;
  } else if (unknownCount > 0) {
    subtitle = `${unknownCount} servis ilk çalışma sonucunu bekliyor`;
  } else if (checkedAt) {
    subtitle = `Son kontrol: ${formatSystemHealthDateTime(checkedAt)}`;
  } else {
    subtitle = 'Tüm veri akışları sağlıklı';
  }

  return {
    status,
    title,
    subtitle,
    failedCount,
    overdueCount,
    warningCount,
    runningCount,
    unknownCount,
    totalJobCount,
    checkedAt: checkedAt ?? null,
  };
}

/**
 * Groups jobs into SectionList sections based on predefined business categories.
 */
export function groupJobsIntoSections(items: NormalizedJobHealthItem[]): SystemHealthSection[] {
  const groups: Record<SystemHealthCategoryKey, NormalizedJobHealthItem[]> = {
    prices: [],
    calendar: [],
    portfolio: [],
    other: [],
  };

  for (const item of items) {
    const key = item.categoryKey;
    if (groups[key]) {
      groups[key].push(item);
    } else {
      groups.other.push(item);
    }
  }

  const sections: SystemHealthSection[] = [];
  const orderedKeys: SystemHealthCategoryKey[] = ['prices', 'calendar', 'portfolio', 'other'];

  for (const key of orderedKeys) {
    const groupItems = groups[key];
    if (groupItems.length > 0) {
      sections.push({
        key,
        title: groupItems[0]?.categoryTitle || 'Diğer',
        data: groupItems.sort((a, b) => a.sortOrder - b.sortOrder),
      });
    }
  }

  return sections.sort((a, b) => CATEGORY_SORT_ORDER[a.key] - CATEGORY_SORT_ORDER[b.key]);
}

/**
 * Translates execution status to human-readable Turkish label.
 */
export function formatJobExecutionStatus(status: JobExecutionStatus): string {
  switch (status) {
    case 'running':
      return 'Çalışıyor';
    case 'success':
      return 'Başarılı';
    case 'partial':
      return 'Kısmi tamamlandı';
    case 'failed':
      return 'Başarısız';
    case 'skipped':
      return 'Planlı olarak atlandı';
    case 'never_run':
      return 'Henüz çalışmadı';
    default:
      return 'Bilinmiyor';
  }
}

/**
 * Translates backend message code into a safe, friendly Turkish explanation.
 */
export function formatJobMessageCode(code: JobMessageCode): string {
  switch (code) {
    case 'JOB_OK':
      return 'Veriler güncel.';
    case 'JOB_PARTIAL':
      return 'İşlem tamamlandı ancak bazı veriler güncellenemedi.';
    case 'JOB_FAILED':
      return 'Son güncelleme tamamlanamadı.';
    case 'JOB_OVERDUE':
      return 'Beklenen güncelleme gecikmiş görünüyor.';
    case 'JOB_RUNNING':
      return 'Güncelleme şu anda devam ediyor.';
    case 'JOB_SKIPPED':
      return 'Bu çalışma planlı olarak atlandı.';
    case 'JOB_NEVER_RUN':
      return 'İlk çalışma sonucu henüz oluşmadı.';
    case 'JOB_STATUS_UNAVAILABLE':
    default:
      return 'Bu servis için durum bilgisi doğrulanamadı.';
  }
}

/**
 * Formats duration in seconds into human-readable Turkish duration (e.g. "42 sn", "1 dk 18 sn").
 */
export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }

  if (seconds === 0) {
    return '0 sn';
  }

  if (seconds < 60) {
    return `${Math.round(seconds)} sn`;
  }

  const mins = Math.floor(seconds / 60);
  const remSecs = Math.round(seconds % 60);

  if (remSecs === 0) {
    return `${mins} dk`;
  }

  return `${mins} dk ${remSecs} sn`;
}

/**
 * Formats ISO timestamp to Turkish local datetime representation (e.g. "Bugün 14:32", "Dün 23:30", "28 Ağu 14:32").
 */
export function formatSystemHealthDateTime(isoString: string | null | undefined): string {
  if (!isoString || typeof isoString !== 'string') {
    return '—';
  }

  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    return '—';
  }

  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  if (isToday) {
    return `Bugün ${timeStr}`;
  }

  if (isYesterday) {
    return `Dün ${timeStr}`;
  }

  const months = [
    'Oca',
    'Şub',
    'Mar',
    'Nis',
    'May',
    'Haz',
    'Tem',
    'Ağu',
    'Eyl',
    'Eki',
    'Kas',
    'Ara',
  ];
  const day = date.getDate();
  const monthName = months[date.getMonth()] || '';
  const isSameYear = date.getFullYear() === now.getFullYear();

  if (isSameYear) {
    return `${day} ${monthName} ${timeStr}`;
  }

  return `${day} ${monthName} ${date.getFullYear()} ${timeStr}`;
}
