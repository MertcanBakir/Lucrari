/**
 * Financial UI & Data Formatters
 * 
 * Centralized formatting utilities according to Lucrari Financial UI skill guidelines.
 * - Handles missing data with '—'
 * - Consistent rounding and localized formatting
 * - Prevents raw string concatenation of currency or percentage symbols
 */

export const EMPTY_VALUE_PLACEHOLDER = '—';

/**
 * Formats latency in milliseconds with unit.
 * Example: 142 ms
 */
export function formatLatency(latencyMs: number | null | undefined): string {
  if (latencyMs === null || latencyMs === undefined || isNaN(latencyMs)) {
    return EMPTY_VALUE_PLACEHOLDER;
  }
  return `${Math.round(latencyMs)} ms`;
}

/**
 * Returns color category based on network latency thresholds.
 */
export function getLatencyColor(latencyMs: number | null | undefined): 'good' | 'moderate' | 'poor' | 'unknown' {
  if (latencyMs === null || latencyMs === undefined) return 'unknown';
  if (latencyMs < 250) return 'good';
  if (latencyMs < 600) return 'moderate';
  return 'poor';
}

/**
 * Formats a currency value with locale rules.
 */
export function formatCurrency(
  value: number | null | undefined,
  currency: 'TRY' | 'USD' | 'EUR' = 'TRY',
  locale: string = 'tr-TR'
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return EMPTY_VALUE_PLACEHOLDER;
  }

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Formats percentage value.
 * Example: +2.45% or -0.80%
 */
export function formatPercentage(
  value: number | null | undefined,
  includeSign: boolean = true,
  decimals: number = 2,
  locale: string = 'tr-TR'
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return EMPTY_VALUE_PLACEHOLDER;
  }

  const formatted = new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: includeSign ? 'exceptZero' : 'auto',
  }).format(value / 100);

  return formatted;
}

/**
 * Formats a timestamp into standard financial date-time format.
 */
export function formatDateTime(
  date: string | Date | null | undefined,
  locale: string = 'tr-TR'
): string {
  if (!date) return EMPTY_VALUE_PLACEHOLDER;
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return EMPTY_VALUE_PLACEHOLDER;

    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return EMPTY_VALUE_PLACEHOLDER;
  }
}
