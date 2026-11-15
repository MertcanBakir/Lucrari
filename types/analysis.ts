export const ANALYST_CODES = ['market', 'social', 'news', 'fundamentals'] as const;
export type AnalystCode = (typeof ANALYST_CODES)[number];

export const ANALYSIS_LANGUAGES = ['tr', 'en'] as const;
export type AnalysisLanguage = (typeof ANALYSIS_LANGUAGES)[number];

export const ANALYSIS_HORIZONS = ['short_1m', 'medium_3m', 'long_12m'] as const;
export type AnalysisHorizon = (typeof ANALYSIS_HORIZONS)[number];

export const ANALYSIS_STATUSES = [
  'reserved',
  'running',
  'success',
  'partial',
  'failed',
  'timed_out',
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export const ANALYSIS_STAGES = ['accepted', 'analysis', 'persisting', 'finished'] as const;
export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];

export type AnalysisAuthType = 'api_key' | 'personal_chatgpt';

export interface AnalysisModelOption {
  id: string;
  name: string;
}

export interface AnalysisProvider {
  provider: string;
  models: string[];
  modelOptions: AnalysisModelOption[];
  authType: AnalysisAuthType;
}

export interface AnalysisProvidersResult {
  providers: AnalysisProvider[];
  unavailable: Record<string, string>;
}

interface AnalysisRequestInput {
  ticker: string;
  analysisDate: string;
  analysisHorizon: AnalysisHorizon;
  language: AnalysisLanguage;
  analysts: AnalystCode[];
}

export interface AnalysisModelBinding {
  connectionId: string;
  model: string;
}

export type AnalysisCreateInput = AnalysisRequestInput & (
  | { authType: 'personal_chatgpt'; quickModel: string; deepModel: string }
  | { authType: 'api_key'; quick: AnalysisModelBinding; deep: AnalysisModelBinding }
);

export interface AnalysisConnection {
  id: string;
  provider: string;
  name: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export interface AnalysisRecord {
  id: string;
  status: AnalysisStatus;
  stage: AnalysisStage;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  ticker: string;
  analysisDate: string;
  analysisHorizon?: AnalysisHorizon;
  replayed: boolean | null;
  authType?: AnalysisAuthType;
  models?: { quick: AnalysisModelConfig; deep: AnalysisModelConfig };
}

export interface AnalysisHistoryResult {
  items: AnalysisRecord[];
  limit: number;
  offset: number;
  totalCount: number | null;
  hasMore: boolean;
}

export interface AnalysisReportSection {
  code: string;
  title: string;
  contentMarkdown: string | null;
  parts: Record<string, string>;
}

export interface AnalysisModelConfig {
  provider: string;
  model: string;
}

export interface AnalysisEffectiveConfig {
  quick: AnalysisModelConfig;
  deep: AnalysisModelConfig;
  researchRounds: number;
  riskRounds: number;
  analysts: AnalystCode[];
  language: AnalysisLanguage;
}

export interface AnalysisReport {
  sections: AnalysisReportSection[];
  analysisHorizon?: AnalysisHorizon;
  effectiveConfig: AnalysisEffectiveConfig;
  upstreamVersion: string;
}

export interface AnalysisModelSelection {
  authType: AnalysisAuthType;
  quickModel: string;
  deepModel: string;
  availableModels: AnalysisModelOption[];
}

export interface AnalysisStartIntent {
  idempotencyKey: string;
  input: AnalysisCreateInput;
}
