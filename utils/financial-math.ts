/**
 * Lucrari — Pure Financial Calculation & Valuation Selectors
 * 
 * Provides centralized, strongly typed calculation utilities for
 * portfolio valuation, currency conversion, position return metrics, and allocations.
 * 
 * STRICT PRODUCT RULES:
 * - Total Portfolio Value = Market Value of Positions + Available Cash.
 * - Margin/credit is NOT supported; cash is non-negative at the domain and DB level.
 * - Live USD/TRY rate is required to aggregate USD positions and USD cash into TRY.
 * - Missing prices or missing FX rates result in partial valuations (never fabricated).
 * - Realized PnL is NOT added a second time to total portfolio value (sell proceeds are in cash).
 * - Total Cost Basis does NOT include cash.
 */

import { formatCurrency, formatPercentage } from '@/utils/financial-formatters';
import type {
  PortfolioPosition,
  PortfolioCashState,
  CurrencyCode,
} from '@/types/database';
import type { FxRateInfo } from '@/services/portfolio/fx-rate-service';

export type CurrencyMode = 'TRY' | 'USD';
export type PnlMode = 'DAILY' | 'TOTAL';

export interface FxConversionResult {
  value: number | null;
  isAvailable: boolean;
}

/**
 * Converts a USD value to TRY using live exchange rate.
 * Returns null if rate is missing or invalid.
 */
export function convertUsdToTry(valueUsd: number, usdTryRate: number | null): number | null {
  if (usdTryRate === null || !Number.isFinite(usdTryRate) || usdTryRate <= 0) {
    return null;
  }
  return valueUsd * usdTryRate;
}

/**
 * Converts a TRY value to USD using live exchange rate.
 * Returns null if rate is missing or invalid.
 */
export function convertTryToUsd(valueTry: number, usdTryRate: number | null): number | null {
  if (usdTryRate === null || !Number.isFinite(usdTryRate) || usdTryRate <= 0) {
    return null;
  }
  return valueTry / usdTryRate;
}

/**
 * Formats a TRY value in the current currency mode (TRY or USD).
 * Returns '—' if value is null or if USD conversion rate is unavailable.
 */
export function formatPortfolioValue(
  valTry: number | null,
  mode: CurrencyMode,
  usdTryRate: number | null
): string {
  if (valTry === null || !Number.isFinite(valTry)) {
    return '—';
  }

  if (mode === 'USD') {
    const usdVal = convertTryToUsd(valTry, usdTryRate);
    if (usdVal === null) return '—';
    return formatCurrency(usdVal, 'USD');
  }

  return formatCurrency(valTry, 'TRY');
}

/**
 * Converts a monetary amount from a position's native currency to the target display currency mode.
 * Returns null if the amount is null or if the required USD/TRY exchange rate is missing/invalid.
 * Preserves exact zero (0) values without false null conversion.
 */
export function convertPositionMonetaryValue(
  amountNative: number | null,
  positionCurrency: CurrencyCode | undefined,
  targetCurrencyMode: CurrencyMode,
  usdTryRate: number | null
): number | null {
  if (amountNative === null || !Number.isFinite(amountNative)) {
    return null;
  }

  const posCurrency: CurrencyCode = positionCurrency || 'TRY';

  // If already matching target currency, return native value directly
  if (posCurrency === targetCurrencyMode) {
    return amountNative;
  }

  if (posCurrency === 'USD' && targetCurrencyMode === 'TRY') {
    return convertUsdToTry(amountNative, usdTryRate);
  }

  if (posCurrency === 'TRY' && targetCurrencyMode === 'USD') {
    return convertTryToUsd(amountNative, usdTryRate);
  }

  return null;
}

/**
 * Formats a converted monetary value in the target currency mode.
 * Returns '—' if conversion fails or if the value is null.
 * Correctly formats real zero values (e.g. '₺0,00' or '$0.00').
 */
export function formatConvertedCurrency(
  amountNative: number | null,
  positionCurrency: CurrencyCode | undefined,
  targetCurrencyMode: CurrencyMode,
  usdTryRate: number | null
): string {
  const converted = convertPositionMonetaryValue(amountNative, positionCurrency, targetCurrencyMode, usdTryRate);
  if (converted === null) {
    return '—';
  }
  return formatCurrency(converted, targetCurrencyMode);
}

/**
 * Formats a converted PnL monetary amount with sign and optional label prefix (e.g. "G: +₺1.200,00" or "T: +₺0,00").
 * Returns '—' if conversion is impossible or if the value is null.
 * Never converts a missing rate into 0.
 */
export function formatConvertedPnlAmount(
  amountNative: number | null,
  positionCurrency: CurrencyCode | undefined,
  targetCurrencyMode: CurrencyMode,
  usdTryRate: number | null,
  labelPrefix?: string
): string {
  const converted = convertPositionMonetaryValue(amountNative, positionCurrency, targetCurrencyMode, usdTryRate);
  if (converted === null) {
    return '—';
  }
  const sign = converted >= 0 ? '+' : '';
  const formatted = `${sign}${formatCurrency(converted, targetCurrencyMode)}`;
  return labelPrefix ? `${labelPrefix}: ${formatted}` : formatted;
}

export interface PositionComputedMetrics {
  quantity: number;
  hasMarketPrice: boolean;
  latestPrice: number | null;
  averageCost: number;
  totalCostNative: number;
  marketValueNative: number | null;
  marketValueDisplay: string;
  unrealizedPnlNative: number | null;
  unrealizedPnlPct: number | null;
  dailyChangePercent: number | null;
  dailyChangeAmountNative: number | null;
  dailyPnlNative: number | null;
  dailyChangeAmountDisplay: string;
  activePnlLabel: string;
  activePnlPercent: number | null;
  activePnlPercentDisplay: string;
  activePnlAmount: number | null;
  activePnlAmountDisplay: string;
  isPositive: boolean;
  isStale: boolean;
}

/**
 * Computes all display and financial metrics for a single position card / detail view.
 * If market price is unavailable, never fabricates valuation from cost basis.
 */
export function computePositionMetrics(
  position: PortfolioPosition,
  pnlMode: PnlMode,
  _currencyMode: CurrencyMode,
  _usdTryRate: number | null
): PositionComputedMetrics {
  const quantity = Number(position.quantity) || 0;
  const rawLatest = position.latest_price;
  const numLatest = rawLatest != null ? Number(rawLatest) : null;
  const hasMarketPrice = numLatest != null && Number.isFinite(numLatest) && numLatest > 0;
  const latestPrice = hasMarketPrice ? numLatest : null;

  const averageCost = Number(position.average_cost) || 0;
  const totalCostNative = Number(position.remaining_cost_basis) || (quantity * averageCost);

  const positionCurrency: CurrencyCode = position.currency || 'TRY';
  const isStale = Boolean(position.price_is_stale);

  if (!hasMarketPrice || latestPrice === null) {
    return {
      quantity,
      hasMarketPrice: false,
      latestPrice: null,
      averageCost,
      totalCostNative,
      marketValueNative: null,
      marketValueDisplay: '—',
      unrealizedPnlNative: null,
      unrealizedPnlPct: null,
      dailyChangePercent: null,
      dailyChangeAmountNative: null,
      dailyPnlNative: null,
      dailyChangeAmountDisplay: '—',
      activePnlLabel: pnlMode === 'DAILY' ? 'G' : 'T',
      activePnlPercent: null,
      activePnlPercentDisplay: '—',
      activePnlAmount: null,
      activePnlAmountDisplay: '—',
      isPositive: true,
      isStale,
    };
  }

  const marketValueNative = quantity * latestPrice;
  const unrealizedPnlNative =
    position.unrealized_pnl != null
      ? Number(position.unrealized_pnl)
      : marketValueNative - totalCostNative;
  const unrealizedPnlPct =
    totalCostNative > 0 ? (unrealizedPnlNative / totalCostNative) * 100 : 0;

  const dailyChangePercent = Number(position.change_percent ?? 0);
  const dailyChangeAmountNative = Number(
    position.change_amount ?? (latestPrice * (dailyChangePercent / 100))
  );
  const dailyPnlNative = quantity * dailyChangeAmountNative;

  const isDaily = pnlMode === 'DAILY';
  const activePnlPercent = isDaily ? dailyChangePercent : unrealizedPnlPct;
  const activePnlAmount = isDaily ? dailyPnlNative : unrealizedPnlNative;
  const isPositive = activePnlPercent >= 0;

  const activePnlLabel = isDaily ? 'G' : 'T';
  const activePnlPercentDisplay = formatPercentage(activePnlPercent);
  const marketValueDisplay = formatCurrency(marketValueNative, positionCurrency);
  const dailyChangeAmountDisplay = `${dailyPnlNative >= 0 ? '+' : ''}${formatCurrency(dailyPnlNative, positionCurrency)}`;
  const activePnlAmountDisplay = `${activePnlLabel}: ${activePnlAmount >= 0 ? '+' : ''}${formatCurrency(activePnlAmount, positionCurrency)}`;

  return {
    quantity,
    hasMarketPrice: true,
    latestPrice,
    averageCost,
    totalCostNative,
    marketValueNative,
    marketValueDisplay,
    unrealizedPnlNative,
    unrealizedPnlPct,
    dailyChangePercent,
    dailyChangeAmountNative,
    dailyPnlNative,
    dailyChangeAmountDisplay,
    activePnlLabel,
    activePnlPercent,
    activePnlPercentDisplay,
    activePnlAmount,
    activePnlAmountDisplay,
    isPositive,
    isStale,
  };
}

export type AllocationKey = 'BIST' | 'CRYPTO' | 'TEFAS' | 'NASDAQ' | 'FX' | 'CASH';

export interface AllocationItem {
  key: AllocationKey;
  label: string;
  fullName: string;
  pct: number;
  valueTry: number;
  dotColor: string;
}

export interface PortfolioStats {
  // 1. Positions Market Value
  positionsMarketValueTry: number | null; // null if partial valuation
  knownPositionsMarketValueTry: number;

  // 2. Cash Values
  cashValueTry: number | null; // null if uninitialized or if USD cash exists and rate is missing
  knownCashValueTry: number;
  cashTry: number | null;
  cashUsd: number | null;
  isCashInitialized: boolean;

  // 3. Total Portfolio Value = Positions Market Value + Available Cash
  totalPortfolioValueTry: number | null; // null if partial valuation
  knownPortfolioValueTry: number;

  // 4. Position PnL and Cost Basis (Cost basis does NOT include cash)
  totalCostTry: number | null;
  unrealizedPnlTry: number | null;
  totalPnlPct: number | null;
  dailyPnlTry: number | null;
  dailyPnlPct: number | null;
  totalRealizedPnlTry: number | null; // From closed FIFO lots (NOT added a second time to total portfolio value)

  // 5. Valuation Completeness & Diagnostics
  isValuationComplete: boolean;
  missingPriceCount: number;
  stalePriceCount: number;
  hasUsdExposure: boolean;
  isFxRateAvailable: boolean;
  isFxRateStale: boolean;
  fxRate: number | null;
  fxRateAt: string | null;
  valuationWarning: string | null;

  categoryValues: {
    BIST: number;
    CRYPTO: number;
    TEFAS: number;
    NASDAQ: number;
    FX: number;
    CASH: number;
  };
}

/**
 * Calculates complete aggregate portfolio metrics, strictly enforcing:
 * - Total Portfolio Value = Positions Market Value + Available Cash
 * - BUY decreases cash; SELL increases cash
 * - No negative cash
 * - Realized PnL is not double-counted in total portfolio value
 * - Partial valuation handling when prices, FX rate, or cash accounts are missing
 */
export function calculatePortfolioStats(
  positions: PortfolioPosition[],
  cashState: PortfolioCashState | null,
  fxRateInfo: FxRateInfo | null
): PortfolioStats {
  const fxRate = fxRateInfo?.rate ?? null;
  const isFxRateAvailable = Boolean(fxRateInfo?.isAvailable && fxRate !== null && fxRate > 0);
  const isFxRateStale = Boolean(fxRateInfo?.isStale);

  let knownPositionsMarketValueTry = 0;
  let totalCostTry = 0;
  let dailyPnlTry = 0;
  let totalRealizedPnlTry = 0;

  let bistValueTry = 0;
  let cryptoValueTry = 0;
  let tefasValueTry = 0;
  let nasdaqValueTry = 0;
  let fxValueTry = 0;

  let missingPriceCount = 0;
  let stalePriceCount = 0;
  let hasUsdExposure = false;

  for (const p of positions) {
    const isUsd = p.currency === 'USD';
    if (isUsd) hasUsdExposure = true;

    if (p.price_is_stale) stalePriceCount++;

    const rawLatest = p.latest_price;
    const numLatest = rawLatest != null ? Number(rawLatest) : null;
    const hasPrice = numLatest != null && Number.isFinite(numLatest) && numLatest > 0;

    if (!hasPrice) {
      missingPriceCount++;
    }

    const quantity = Number(p.quantity) || 0;
    const avgCost = Number(p.average_cost) || 0;
    const remainingCost = Number(p.remaining_cost_basis) || (quantity * avgCost);
    const realizedPnl = Number(p.realized_pnl) || 0;

    // Determine FX multiplier for this position
    const rateMultiplier = isUsd ? fxRate : 1;

    if (rateMultiplier !== null) {
      const posCostTry = remainingCost * rateMultiplier;
      totalCostTry += posCostTry;
      totalRealizedPnlTry += realizedPnl * rateMultiplier;

      if (hasPrice && numLatest !== null) {
        const posValueNative = quantity * numLatest;
        const posValueTry = posValueNative * rateMultiplier;
        knownPositionsMarketValueTry += posValueTry;

        const changePercent = Number(p.change_percent ?? 0);
        const changeAmount = Number(p.change_amount ?? (numLatest * (changePercent / 100)));
        const posDailyPnlTry = quantity * changeAmount * rateMultiplier;
        dailyPnlTry += posDailyPnlTry;

        if (p.market === 'BIST100') bistValueTry += posValueTry;
        else if (p.market === 'CRYPTO') cryptoValueTry += posValueTry;
        else if (p.market === 'TEFAS') tefasValueTry += posValueTry;
        else if (p.market === 'NASDAQ100') nasdaqValueTry += posValueTry;
        else if (p.market === 'FX') fxValueTry += posValueTry;
      }
    }
  }

  // Cash parsing & state detection - exclusively PortfolioCashState
  const isCashInitialized = Boolean(cashState?.isInitialized);
  let rawCashTry: number | null = null;
  let rawCashUsd: number | null = null;

  if (isCashInitialized && cashState?.balances) {
    const tryItem = cashState.balances.find((b) => b.currency === 'TRY');
    const usdItem = cashState.balances.find((b) => b.currency === 'USD');
    rawCashTry = tryItem?.currentBalance != null ? Number(tryItem.currentBalance) : null;
    rawCashUsd = usdItem?.currentBalance != null ? Number(usdItem.currentBalance) : null;
  }

  if (rawCashUsd != null && rawCashUsd > 0) {
    hasUsdExposure = true;
  }

  // Calculate Cash Value in TRY
  let cashValueTry: number | null = null;
  let knownCashValueTry = 0;

  if (isCashInitialized && rawCashTry !== null && rawCashUsd !== null) {
    knownCashValueTry += rawCashTry;
    if (rawCashUsd === 0) {
      cashValueTry = rawCashTry;
    } else if (fxRate !== null) {
      const usdInTry = rawCashUsd * fxRate;
      knownCashValueTry += usdInTry;
      cashValueTry = rawCashTry + usdInTry;
    } else {
      cashValueTry = null; // Cannot value USD cash without live FX rate
    }
  }

  // Valuation completeness assessment
  const hasMissingUsdRate = hasUsdExposure && !isFxRateAvailable;
  const isPositionsValuationComplete =
    missingPriceCount === 0 && (!positions.some((p) => p.currency === 'USD') || isFxRateAvailable);
  const isValuationComplete =
    isPositionsValuationComplete &&
    isCashInitialized &&
    (cashValueTry !== null || (rawCashUsd ?? 0) === 0);

  let valuationWarning: string | null = null;
  if (!isCashInitialized) {
    valuationWarning = 'Nakit bakiyesi kurulumu gerekli; portföy toplamı henüz nakit tutarını içermiyor.';
  } else if (missingPriceCount > 0) {
    valuationWarning = `${missingPriceCount} varlığın piyasa fiyatı henüz alınamadı, portföy toplamı kısmi gösteriliyor.`;
  } else if (hasMissingUsdRate) {
    valuationWarning = 'Canlı USD/TRY kuru alınamadı, USD varlıkların TRY toplamı eksik olabilir.';
  } else if (isFxRateStale && hasUsdExposure) {
    valuationWarning = 'USD/TRY kuru güncel olmayabilir.';
  } else if (stalePriceCount > 0) {
    valuationWarning = `${stalePriceCount} varlığın fiyatı güncel olmayabilir.`;
  }

  const positionsMarketValueTry = isPositionsValuationComplete ? knownPositionsMarketValueTry : null;
  const totalPortfolioValueTry =
    isValuationComplete && cashValueTry !== null && positionsMarketValueTry !== null
      ? positionsMarketValueTry + cashValueTry
      : null;
  const knownPortfolioValueTry = knownPositionsMarketValueTry + knownCashValueTry;

  const unrealizedPnlTry =
    positionsMarketValueTry !== null && totalCostTry !== null
      ? positionsMarketValueTry - totalCostTry
      : null;
  const totalPnlPct =
    totalCostTry > 0 && unrealizedPnlTry !== null ? (unrealizedPnlTry / totalCostTry) * 100 : null;
  const dailyPnlPct =
    knownPositionsMarketValueTry > 0 ? (dailyPnlTry / knownPositionsMarketValueTry) * 100 : null;

  return {
    positionsMarketValueTry,
    knownPositionsMarketValueTry,
    cashValueTry,
    knownCashValueTry,
    cashTry: rawCashTry,
    cashUsd: rawCashUsd,
    isCashInitialized,
    totalPortfolioValueTry,
    knownPortfolioValueTry,
    totalCostTry,
    unrealizedPnlTry,
    totalPnlPct,
    dailyPnlTry,
    dailyPnlPct,
    totalRealizedPnlTry,
    isValuationComplete,
    missingPriceCount,
    stalePriceCount,
    hasUsdExposure,
    isFxRateAvailable,
    isFxRateStale,
    fxRate,
    fxRateAt: fxRateInfo?.rateAt ?? null,
    valuationWarning,
    categoryValues: {
      BIST: bistValueTry,
      CRYPTO: cryptoValueTry,
      TEFAS: tefasValueTry,
      NASDAQ: nasdaqValueTry,
      FX: fxValueTry,
      CASH: isCashInitialized ? (cashValueTry ?? (rawCashTry ?? 0)) : 0,
    },
  };
}

/**
 * Computes asset allocation items for visual representation.
 * Cash is rendered as an allocation slice only when cash accounts are initialized and cash > 0.
 */
export function calculateAllocationItems(stats: PortfolioStats): AllocationItem[] {
  const cashTry = stats.isCashInitialized ? (stats.cashValueTry ?? (stats.cashTry ?? 0)) : 0;

  const totalPositiveAssets =
    stats.categoryValues.BIST +
    stats.categoryValues.CRYPTO +
    stats.categoryValues.TEFAS +
    stats.categoryValues.NASDAQ +
    stats.categoryValues.FX +
    cashTry;

  if (totalPositiveAssets <= 0) return [];

  const rawList: Omit<AllocationItem, 'pct'>[] = [
    {
      key: 'BIST',
      label: 'BIST',
      fullName: 'BIST Hisseleri',
      dotColor: '#5F806F',
      valueTry: stats.categoryValues.BIST,
    },
    {
      key: 'CRYPTO',
      label: 'Kripto',
      fullName: 'Kripto Varlıklar',
      dotColor: '#B98B4D',
      valueTry: stats.categoryValues.CRYPTO,
    },
    {
      key: 'TEFAS',
      label: 'Fonlar',
      fullName: 'TEFAS Fonları',
      dotColor: '#667B96',
      valueTry: stats.categoryValues.TEFAS,
    },
    {
      key: 'NASDAQ',
      label: 'NASDAQ',
      fullName: 'ABD / Nasdaq Hisseleri',
      dotColor: '#725766',
      valueTry: stats.categoryValues.NASDAQ,
    },
    {
      key: 'FX',
      label: 'FX / Altın',
      fullName: 'FX & Kıymetli Madenler',
      dotColor: '#D0A567',
      valueTry: stats.categoryValues.FX,
    },
    {
      key: 'CASH',
      label: 'Nakit',
      fullName: 'Likit Serbest Nakit',
      dotColor: '#988F94',
      valueTry: cashTry,
    },
  ];

  return rawList
    .filter((item) => item.valueTry > 0)
    .map((item) => {
      const calculatedPct = Math.round((item.valueTry / totalPositiveAssets) * 100);
      return {
        ...item,
        pct: Math.min(Math.max(calculatedPct, 1), 100),
      };
    });
}



