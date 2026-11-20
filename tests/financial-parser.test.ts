/**
 * Unit Tests for Financial Number Parser & Validator
 * 
 * Verifies:
 * - Turkish decimal format (1.234,56, 1234,56, 50,25)
 * - Standard dot-decimal format (1234.56, 50.25)
 * - Rejection of invalid strings (1abc, --1, 1.2.3, 1,2,3)
 * - Rejection of scientific notation (1e5, 2E-3)
 * - Rejection of negative numbers and zero when disallowed
 * - Decimal precision limits
 * - Fractional and crypto quantities
 * - calculateTradeTotal calculation
 */

import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';
import {
  parseFinancialNumber,
  calculateTradeTotal,
} from '../utils/financial-parser';

describe('Financial Number Parser & Validator', () => {
  describe('Turkish Decimal Format', () => {
    it('should parse Turkish numbers with comma decimal separator', () => {
      const res = parseFinancialNumber('1234,56');
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.value, 1234.56);
    });

    it('should parse Turkish numbers with dots as thousands and comma as decimal', () => {
      const res = parseFinancialNumber('1.234.567,89');
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.value, 1234567.89);
    });

    it('should parse simple integers without decimals', () => {
      const res = parseFinancialNumber('500');
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.value, 500);
    });

    it('should parse Turkish thousands dots without decimal', () => {
      const res = parseFinancialNumber('1.000.000');
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.value, 1000000);
    });
  });

  describe('Standard Dot-Decimal Format', () => {
    it('should parse standard dot decimals', () => {
      const res = parseFinancialNumber('1234.56');
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.value, 1234.56);
    });

    it('should parse standard comma thousands with dot decimal', () => {
      const res = parseFinancialNumber('1,234,567.89');
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.value, 1234567.89);
    });

    it('should parse standard thousands commas without decimal', () => {
      const res = parseFinancialNumber('1,000,000');
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.value, 1000000);
    });
  });

  describe('Fractional & Crypto Quantities', () => {
    it('should parse small crypto fraction decimals', () => {
      const res = parseFinancialNumber('0.00045123', { maxDecimals: 8 });
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.value, 0.00045123);
    });

    it('should parse small crypto fractions with Turkish comma', () => {
      const res = parseFinancialNumber('0,00045123', { maxDecimals: 8 });
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.value, 0.00045123);
    });

    it('should enforce maxDecimals restriction', () => {
      const res = parseFinancialNumber('12.3456', { maxDecimals: 2 });
      assert.strictEqual(res.isValid, false);
      assert.match(res.errorMessage || '', /En fazla 2 ondalık basamak/);
    });
  });

  describe('Invalid Input Rejections', () => {
    it('should reject empty or null inputs', () => {
      assert.strictEqual(parseFinancialNumber('').isValid, false);
      assert.strictEqual(parseFinancialNumber('   ').isValid, false);
      assert.strictEqual(parseFinancialNumber(null).isValid, false);
      assert.strictEqual(parseFinancialNumber(undefined).isValid, false);
    });

    it('should reject alphanumeric strings', () => {
      assert.strictEqual(parseFinancialNumber('1abc').isValid, false);
      assert.strictEqual(parseFinancialNumber('abc').isValid, false);
      assert.strictEqual(parseFinancialNumber('$100').isValid, false);
    });

    it('should reject double signs or broken formats', () => {
      assert.strictEqual(parseFinancialNumber('--1').isValid, false);
      assert.strictEqual(parseFinancialNumber('++1').isValid, false);
      assert.strictEqual(parseFinancialNumber('+-5').isValid, false);
    });

    it('should reject multiple decimal points or commas', () => {
      assert.strictEqual(parseFinancialNumber('1.2.3').isValid, false);
      assert.strictEqual(parseFinancialNumber('1,2,3').isValid, false);
      assert.strictEqual(parseFinancialNumber('1.2.3,4.5').isValid, false);
    });

    it('should reject scientific notation', () => {
      assert.strictEqual(parseFinancialNumber('1e5').isValid, false);
      assert.strictEqual(parseFinancialNumber('2.5E-3').isValid, false);
    });

    it('should reject negative values when allowNegative is false', () => {
      const res = parseFinancialNumber('-50', { allowNegative: false });
      assert.strictEqual(res.isValid, false);
      assert.match(res.errorMessage || '', /Pozitif bir değer/);
    });

    it('should reject zero when allowZero is false', () => {
      const res = parseFinancialNumber('0', { allowZero: false });
      assert.strictEqual(res.isValid, false);
      assert.match(res.errorMessage || '', /sıfırdan büyük/);
    });

    it('should accept zero when allowZero is true', () => {
      const res = parseFinancialNumber('0', { allowZero: true });
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.value, 0);
    });
  });

  describe('calculateTradeTotal', () => {
    it('should calculate total trade cost accurately', () => {
      const res = calculateTradeTotal('100', '250,50');
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.quantity, 100);
      assert.strictEqual(res.price, 250.5);
      assert.strictEqual(res.total, 25050);
    });

    it('should handle fractional crypto quantity in total calculation', () => {
      const res = calculateTradeTotal('0.5', '60000');
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.quantity, 0.5);
      assert.strictEqual(res.price, 60000);
      assert.strictEqual(res.total, 30000);
    });

    it('should return error when quantity is invalid', () => {
      const res = calculateTradeTotal('0', '100');
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.total, null);
      assert.match(res.error || '', /sıfırdan büyük/);
    });

    it('should return error when price is invalid', () => {
      const res = calculateTradeTotal('100', 'invalid');
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.total, null);
    });
  });
});

it('preserves tiny trade totals and rejects arithmetic overflow', () => {
  const tiny = calculateTradeTotal('0,000001', '0,000001');
  expect(tiny.isValid).toBe(true);
  expect(tiny.total).toBeCloseTo(1e-12, 16);
  const huge = '9'.repeat(200);
  expect(calculateTradeTotal(huge, huge).isValid).toBe(false);
});
