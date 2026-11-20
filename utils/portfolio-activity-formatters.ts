/**
 * Lucrari — Portfolio Activity Formatters & Date Grouping Utilities
 * 
 * Pure formatting and grouping functions for portfolio activity items:
 * - Date headers ('Bugün', 'Dün', '28 Ağustos 2026') using device's local timezone.
 * - Time and datetime formatters.
 * - Historical quantity formatting (up to 8 decimals without false-zero).
 * - Historical unit price and gross amount formatting (TRY / USD locale rules without live FX conversion).
 * - Badges and visual semantic categorization.
 * - Deterministic SectionList grouping and deduplication by compositeKey `${sourceKind}:${activityId}`.
 */

import type { CurrencyCode } from '@/types/database';
import type {
  PortfolioActivityItem,
  PortfolioActivitySection,
  ActivityType,
} from '@/types/portfolio-activity';
import { formatCurrency, EMPTY_VALUE_PLACEHOLDER } from '@/utils/financial-formatters';
import type { IconSymbolName } from '@/constants/icon-mapping';

/**
 * Returns YYYY-MM-DD string in device's local timezone for a given ISO timestamp or Date.
 */
export function getLocalDateKey(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) {
    return '1970-01-01';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats date section headers strictly into 'Bugün', 'Dün', or localized date e.g. '28 Ağustos 2026'.
 */
export function formatActivityDateHeader(dateInput: string | Date, now: Date = new Date()): string {
  const targetDate = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(targetDate.getTime())) {
    return EMPTY_VALUE_PLACEHOLDER;
  }

  const targetKey = getLocalDateKey(targetDate);
  const todayKey = getLocalDateKey(now);

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = getLocalDateKey(yesterday);

  if (targetKey === todayKey) {
    return 'Bugün';
  }
  if (targetKey === yesterdayKey) {
    return 'Dün';
  }

  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(targetDate);
}

/**
 * Formats time in HH:mm.
 */
export function formatActivityTime(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) {
    return EMPTY_VALUE_PLACEHOLDER;
  }
  return new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Formats full datetime e.g. '28 Ağustos 2026, 14:35'.
 */
export function formatActivityDateTime(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) {
    return EMPTY_VALUE_PLACEHOLDER;
  }
  const dateStr = new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  const timeStr = formatActivityTime(date);
  return `${dateStr}, ${timeStr}`;
}

/**
 * Formats historical quantity supporting fractional/micro quantities up to 8 decimal places.
 * Guaranteed never to format a positive micro quantity as "0 Adet".
 */
export function formatActivityQuantity(quantity: number | null | undefined): string {
  if (quantity === null || quantity === undefined || typeof quantity !== 'number' || !Number.isFinite(quantity)) {
    return EMPTY_VALUE_PLACEHOLDER;
  }
  if (quantity === 0) {
    return '0 Adet';
  }

  const formatted = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  }).format(quantity);

  return `${formatted} Adet`;
}

/**
 * Formats historical unit price with appropriate decimal precision (up to 8 decimals for micro prices).
 * Never performs live currency conversion.
 * Positive finite numbers > 0 required.
 */
export function formatActivityUnitPrice(
  price: number | null | undefined,
  currency: CurrencyCode
): string {
  if (
    price === null ||
    price === undefined ||
    typeof price !== 'number' ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return EMPTY_VALUE_PLACEHOLDER;
  }

  // Calculate needed fraction digits (at least 2, up to 8 decimals to avoid false zero for micro prices)
  let maximumFractionDigits = 2;
  if (price < 1) {
    const str = price.toFixed(8).replace(/\.?0+$/, '');
    const decimalPart = str.split('.')[1] || '';
    maximumFractionDigits = Math.min(8, Math.max(2, decimalPart.length));
  } else {
    const str = price.toString();
    const decimalPart = str.split('.')[1] || '';
    maximumFractionDigits = Math.min(8, Math.max(2, decimalPart.length));
  }

  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(price);
}

/**
 * Formats total gross transaction amount.
 */
export function formatActivityGrossAmount(
  amount: number | null | undefined,
  currency: CurrencyCode
): string {
  if (amount === null || amount === undefined || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return EMPTY_VALUE_PLACEHOLDER;
  }
  return formatCurrency(amount, currency, 'tr-TR');
}

export interface ActivityTypeMeta {
  label: string;
  shortLabel: string;
  icon: IconSymbolName;
  variant: 'buy' | 'sell';
  sign: '+' | '-' | '';
}

/**
 * Returns metadata and presentation attributes for each ActivityType.
 */
export function getActivityTypeMeta(type: ActivityType): ActivityTypeMeta {
  switch (type) {
    case 'BUY':
      return {
        label: 'Varlık Alışı',
        shortLabel: 'Alış',
        icon: 'plus',
        variant: 'buy',
        sign: '+',
      };
    case 'SELL':
      return {
        label: 'Varlık Satışı',
        shortLabel: 'Satış',
        icon: 'arrow.left.arrow.right',
        variant: 'sell',
        sign: '-',
      };

  }
}

/**
 * Groups an array of activities into SectionList sections by local calendar day.
 * Deduplicates rows using `compositeKey` to guarantee no duplicates across cursor pages.
 */
export function groupActivitiesByDate(
  items: PortfolioActivityItem[],
  now: Date = new Date()
): PortfolioActivitySection[] {
  if (!items || items.length === 0) {
    return [];
  }

  const seenKeys = new Set<string>();
  const sectionsMap = new Map<string, { title: string; dateKey: string; data: PortfolioActivityItem[] }>();

  for (const item of items) {
    if (seenKeys.has(item.compositeKey)) {
      continue;
    }
    seenKeys.add(item.compositeKey);

    const dateKey = getLocalDateKey(item.occurredAt);
    let section = sectionsMap.get(dateKey);

    if (!section) {
      const title = formatActivityDateHeader(item.occurredAt, now);
      section = {
        title,
        dateKey,
        data: [],
      };
      sectionsMap.set(dateKey, section);
    }

    section.data.push(item);
  }

  return Array.from(sectionsMap.values());
}
