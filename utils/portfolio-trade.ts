import type { MarketType } from '@/types/database';

/** Database trade prices support up to 12 decimals; keep tiny quotes editable. */
export function formatTradePrice(price: number | null | undefined, market?: MarketType): string {
  if (price == null || !Number.isFinite(price) || price <= 0) return '';
  if (market === 'BIST100' || market === 'NASDAQ100') {
    return price.toLocaleString('tr-TR', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return price.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 12 });
}
