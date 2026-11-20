/**
 * Lucrari — Portfolio Activity Domain Types & Contracts
 * 
 * Defines domain models, filter criteria, cursor pagination parameters,
 * SectionList view structures, and validation types for Portfolio Activity.
 */

import type { MarketType, CurrencyCode } from '@/types/database';

export type ActivitySourceKind = 'TRANSACTION';
export type ActivityType = 'BUY' | 'SELL';
export type PortfolioActivityFilter = 'ALL' | 'BUY' | 'SELL';

export interface PortfolioActivityFilterOption {
  id: PortfolioActivityFilter;
  label: string;
  shortLabel: string;
  description: string;
}

export const PORTFOLIO_ACTIVITY_FILTER_OPTIONS: readonly PortfolioActivityFilterOption[] = [
  { id: 'ALL', label: 'Tümü', shortLabel: 'Tümü', description: 'Tüm alış ve satış işlemleri' },
  { id: 'BUY', label: 'Alış', shortLabel: 'Alış', description: 'Yalnızca hisse ve varlık alış işlemleri' },
  { id: 'SELL', label: 'Satış', shortLabel: 'Satış', description: 'Yalnızca hisse ve varlık satış işlemleri' },
] as const;

/**
 * Normalized immutable domain model for a single portfolio activity item.
 * Guarantees fail-closed numeric/date types and clean presentation flags.
 */
export interface PortfolioActivityItem {
  activityId: string;
  sourceKind: ActivitySourceKind;
  activityType: ActivityType;
  portfolioId: string;
  instrumentId: string | null;
  symbol: string | null;
  companyName: string | null;
  market: MarketType | null;
  quantity: number | null;
  unitPrice: number | null;
  grossAmount: number;
  currency: CurrencyCode;
  occurredAt: string;
  createdAt: string;
  notes: string | null;
  isReversed: boolean;
  reversedAt: string | null;
  reversalReason: string | null;
  compositeKey: string; // `${sourceKind}:${activityId}`
}

/**
 * 4-part cursor for keyset pagination.
 * Ordering:
 * 1. occurred_at DESC
 * 2. created_at DESC
 * 3. source_kind DESC
 * 4. activity_id DESC
 */
export interface PortfolioActivityCursor {
  beforeOccurredAt: string;
  beforeCreatedAt: string;
  beforeSourceKind: ActivitySourceKind;
  beforeActivityId: string;
}

export interface FetchPortfolioActivityParams {
  portfolioId: string;
  filter?: PortfolioActivityFilter;
  search?: string | null;
  cursor?: PortfolioActivityCursor | null;
  limit?: number;
  forceRefresh?: boolean;
}

export interface PortfolioActivityPageResult {
  items: PortfolioActivityItem[];
  hasMore: boolean;
  nextCursor: PortfolioActivityCursor | null;
  isStale: boolean;
  timestamp: number;
}

/**
 * SectionList section grouped by date (localized to device's local timezone).
 */
export interface PortfolioActivitySection {
  title: string; // 'Bugün', 'Dün', '28 Ağustos 2026'
  dateKey: string; // YYYY-MM-DD
  data: PortfolioActivityItem[];
}
