import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';
import {
  formatLatency,
  getLatencyColor,
  formatCurrency,
  formatAvailableCash,
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

  describe('formatAvailableCash (Missing vs Real Zero Separation)', () => {
    it('should return isAvailable=false and placeholder for null, undefined, NaN, Infinity, or negative', () => {
      const nullRes = formatAvailableCash(null, 'TRY');
      assert.strictEqual(nullRes.isAvailable, false);
      assert.strictEqual(nullRes.formatted, EMPTY_VALUE_PLACEHOLDER);
      assert.strictEqual(nullRes.rawAmount, null);

      const undefRes = formatAvailableCash(undefined, 'USD');
      assert.strictEqual(undefRes.isAvailable, false);
      assert.strictEqual(undefRes.formatted, EMPTY_VALUE_PLACEHOLDER);
      assert.strictEqual(undefRes.rawAmount, null);

      const nanRes = formatAvailableCash(NaN, 'TRY');
      assert.strictEqual(nanRes.isAvailable, false);
      assert.strictEqual(nanRes.formatted, EMPTY_VALUE_PLACEHOLDER);
      assert.strictEqual(nanRes.rawAmount, null);

      const infRes = formatAvailableCash(Infinity, 'TRY');
      assert.strictEqual(infRes.isAvailable, false);
      assert.strictEqual(infRes.formatted, EMPTY_VALUE_PLACEHOLDER);
      assert.strictEqual(infRes.rawAmount, null);

      const negRes = formatAvailableCash(-50, 'USD');
      assert.strictEqual(negRes.isAvailable, false);
      assert.strictEqual(negRes.formatted, EMPTY_VALUE_PLACEHOLDER);
      assert.strictEqual(negRes.rawAmount, null);
    });

    it('should format real zero 0 as valid 0.00 currency without placeholder', () => {
      const zeroTry = formatAvailableCash(0, 'TRY', 'tr-TR');
      assert.strictEqual(zeroTry.isAvailable, true);
      assert.strictEqual(zeroTry.rawAmount, 0);
      assert.ok(zeroTry.formatted.includes('0,00') || zeroTry.formatted.includes('₺'));

      const zeroUsd = formatAvailableCash(0, 'USD', 'en-US');
      assert.strictEqual(zeroUsd.isAvailable, true);
      assert.strictEqual(zeroUsd.rawAmount, 0);
      assert.strictEqual(zeroUsd.formatted, '$0.00');
    });

    it('should format valid positive available cash correctly', () => {
      const posUsd = formatAvailableCash(1250.5, 'USD', 'en-US');
      assert.strictEqual(posUsd.isAvailable, true);
      assert.strictEqual(posUsd.rawAmount, 1250.5);
      assert.strictEqual(posUsd.formatted, '$1,250.50');
    });
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
