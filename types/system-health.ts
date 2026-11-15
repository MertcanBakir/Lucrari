/**
 * Lucrari — System and Data Health Domain Types
 * 
 * Centralized type definitions for backend jobs, health statuses,
 * execution states, categories, and report aggregates.
 */

export type JobExecutionStatus =
  | 'running'
  | 'success'
  | 'partial'
  | 'failed'
  | 'skipped'
  | 'never_run';

export type JobHealthStatus =
  | 'healthy'
  | 'warning'
  | 'critical'
  | 'running'
  | 'inactive'
  | 'unknown';

export type JobMessageCode =
  | 'JOB_OK'
  | 'JOB_PARTIAL'
  | 'JOB_FAILED'
  | 'JOB_OVERDUE'
  | 'JOB_RUNNING'
  | 'JOB_SKIPPED'
  | 'JOB_NEVER_RUN'
  | 'JOB_STATUS_UNAVAILABLE';

export type OverallHealthStatus =
  | 'healthy'
  | 'warning'
  | 'critical'
  | 'running'
  | 'unknown';

export type SystemHealthCategoryKey = 'prices' | 'calendar' | 'portfolio' | 'summary' | 'other';

export type ExpectedJobCode =
  | 'BIST_PRICES'
  | 'NASDAQ_PRICES'
  | 'CRYPTO_PRICES'
  | 'TEFAS_PRICES'
  | 'USDTRY_PRICE'
  | 'EARNINGS_CALENDAR'
  | 'ECONOMIC_CALENDAR'
  | 'PORTFOLIO_SNAPSHOTS'
  | 'MORNING_SUMMARY'
  | 'CLOSING_SUMMARY';

export interface ExpectedJobMetadata {
  jobCode: ExpectedJobCode;
  category: string;
  categoryKey: SystemHealthCategoryKey;
  categoryTitle: string;
  displayName: string;
  sortOrder: number;
}

export interface NormalizedJobHealthItem {
  jobCode: string;
  category: string;
  categoryKey: SystemHealthCategoryKey;
  categoryTitle: string;
  displayName: string;
  sortOrder: number;
  executionStatus: JobExecutionStatus;
  healthStatus: JobHealthStatus;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSuccessAt: string | null;
  durationSeconds: number | null;
  isOverdue: boolean;
  messageCode: JobMessageCode;
  checkedAt: string | null;
}

export interface OverallHealthEvaluation {
  status: OverallHealthStatus;
  title: string;
  subtitle: string;
  failedCount: number;
  overdueCount: number;
  warningCount: number;
  runningCount: number;
  unknownCount: number;
  totalJobCount: number;
  checkedAt: string | null;
}

export interface SystemHealthSection {
  key: SystemHealthCategoryKey;
  title: string;
  data: NormalizedJobHealthItem[];
}

export interface SystemHealthReport {
  items: NormalizedJobHealthItem[];
  sections: SystemHealthSection[];
  overall: OverallHealthEvaluation;
  checkedAt: string | null;
  isStale: boolean;
  isIncomplete: boolean;
}
