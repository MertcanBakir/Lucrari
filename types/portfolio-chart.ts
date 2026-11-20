import type { CurrencyCode, ExtendedMarketType } from './database';

export const CHART_RANGES = [
  { id: '1W', label: '1H' }, { id: '1M', label: '1A' }, { id: '3M', label: '3A' },
  { id: '6M', label: '6A' }, { id: '1Y', label: '1Y' }, { id: 'ALL', label: 'Tümü' },
] as const;
export type ChartRange = typeof CHART_RANGES[number]['id'];
export type ChartMetric = 'VALUE' | 'PNL';
export interface ChartQuery {
  range: ChartRange;
  market: ExtendedMarketType;
  currency: CurrencyCode;
  metric: ChartMetric;
}
export interface PortfolioChartPoint {
  date: string;
  value: number | null;
  calculationVersion: number;
  isPartial: boolean;
  missingFx: boolean;
  missingMarketPnl: boolean;
  capturedAt: string | null;
  sourceCount: number;
}
