import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';
import {
  formatLatency,
  getLatencyColor,
  formatCurrency,
  formatPercentage,
  formatDateTime,
  EMPTY_VALUE_PLACEHOLDER,
} from '../utils/financial-formatters';

describe('Financial Formatters & Standards', () => {
  it('should format latency correctly', () => {
    assert.equal(formatLatency(null), EMPTY_VALUE_PLACEHOLDER);
    assert.equal(formatLatency(undefined), EMPTY_VALUE_PLACEHOLDER);
    assert.equal(formatLatency(142.4), '142 ms');
    assert.equal(formatLatency(0), '0 ms');
  });

  it('should return correct latency color classifications', () => {
    assert.equal(getLatencyColor(null), 'unknown');
    assert.equal(getLatencyColor(120), 'good');
    assert.equal(getLatencyColor(350), 'moderate');
    assert.equal(getLatencyColor(800), 'poor');
  });

  it('should format currency with proper locale symbol', () => {
    assert.equal(formatCurrency(null), EMPTY_VALUE_PLACEHOLDER);
    const tryFormatted = formatCurrency(1250.5, 'TRY', 'tr-TR');
    assert.ok(tryFormatted.includes('1.250,50') || tryFormatted.includes('1250,50') || tryFormatted.includes('₺'));

    const usdFormatted = formatCurrency(50.25, 'USD', 'en-US');
    assert.equal(usdFormatted, '$50.25');
  });

  it('should format percentage with sign and proper precision', () => {
    assert.equal(formatPercentage(null), EMPTY_VALUE_PLACEHOLDER);
    const positive = formatPercentage(5.42, true, 2, 'tr-TR');
    assert.ok(positive.includes('+') || positive.includes('5,42'));

    const negative = formatPercentage(-3.1, true, 2, 'tr-TR');
    assert.ok(negative.includes('-') || negative.includes('3,10'));
  });

  it('should format date and time or return placeholder for invalid dates', () => {
    assert.equal(formatDateTime(null), EMPTY_VALUE_PLACEHOLDER);
    assert.equal(formatDateTime('invalid-date'), EMPTY_VALUE_PLACEHOLDER);
    const formatted = formatDateTime(new Date('2026-08-19T12:00:00Z'));
    assert.notEqual(formatted, EMPTY_VALUE_PLACEHOLDER);
  });
});
