import { formatTradePrice } from '@/utils/portfolio-trade';

it('keeps micro-price inputs in decimal notation', () => {
  expect(formatTradePrice(0.00000001)).toBe('0.00000001');
  expect(formatTradePrice(1234.5)).toBe('1234.5');
  expect(formatTradePrice(null)).toBe('');
});

it('formats default stock quotes with two Turkish decimals', () => {
  expect(formatTradePrice(12.78123123, 'BIST100')).toBe('12,78');
  expect(formatTradePrice(12.789, 'NASDAQ100')).toBe('12,79');
  expect(formatTradePrice(100, 'BIST100')).toBe('100,00');
  expect(formatTradePrice(null, 'BIST100')).toBe('');
  expect(formatTradePrice(0.00000001, 'CRYPTO')).toBe('0.00000001');
});
