/**
 * Lucrari — Pure Portfolio Cash Mutation Guard Tests
 * 
 * Validates fail-closed mutation behavior for TransactionModal and PositionTradeModal:
 * - Uninitialized cash accounts block BUY, SELL, DEPOSIT, and WITHDRAWAL immediately (UNINITIALIZED)
 * - Initialized cash accounts require known, finite, non-negative availableCash for BUY & WITHDRAWAL (BALANCE_UNAVAILABLE)
 * - Initialized cash accounts require valid positive amountOrTotal for BUY & WITHDRAWAL (INVALID_AMOUNT)
 * - Initialized cash accounts allow BUY when amount <= availableCash, and block when amount > availableCash (INSUFFICIENT_CASH)
 * - Initialized cash accounts allow SELL and DEPOSIT even when availableCash is unavailable (since they do not reduce cash)
 */

import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';
import { evaluateCashMutation } from '../utils/portfolio-guard';

describe('Portfolio Cash Mutation Guard (Fail-Closed)', () => {
  describe('Uninitialized Cash Accounts (isCashInitialized = false)', () => {
    it('should block BUY when cash is uninitialized', () => {
      const result = evaluateCashMutation({
        action: 'BUY',
        isCashInitialized: false,
        amountOrTotal: 1000,
        availableCash: 5000,
      });
      assert.strictEqual(result.isBlocked, true);
      assert.strictEqual(result.reason, 'UNINITIALIZED');
    });

    it('should block SELL when cash is uninitialized', () => {
      const result = evaluateCashMutation({
        action: 'SELL',
        isCashInitialized: false,
        amountOrTotal: null,
        availableCash: 0,
      });
      assert.strictEqual(result.isBlocked, true);
      assert.strictEqual(result.reason, 'UNINITIALIZED');
    });

    it('should block DEPOSIT when cash is uninitialized', () => {
      const result = evaluateCashMutation({
        action: 'DEPOSIT',
        isCashInitialized: false,
        amountOrTotal: 10000,
        availableCash: 0,
      });
      assert.strictEqual(result.isBlocked, true);
      assert.strictEqual(result.reason, 'UNINITIALIZED');
    });

    it('should block WITHDRAWAL when cash is uninitialized', () => {
      const result = evaluateCashMutation({
        action: 'WITHDRAWAL',
        isCashInitialized: false,
        amountOrTotal: 500,
        availableCash: 1000,
      });
      assert.strictEqual(result.isBlocked, true);
      assert.strictEqual(result.reason, 'UNINITIALIZED');
    });
  });

  describe('Initialized Cash Accounts — Strict Fail-Closed Unavailable / Invalid Balance', () => {
    it('initialized BUY + availableCash null -> blocked with BALANCE_UNAVAILABLE', () => {
      const result = evaluateCashMutation({
        action: 'BUY',
        isCashInitialized: true,
        amountOrTotal: 1000,
        availableCash: null,
      });
      assert.strictEqual(result.isBlocked, true);
      assert.strictEqual(result.reason, 'BALANCE_UNAVAILABLE');
    });

    it('initialized BUY + availableCash undefined -> blocked with BALANCE_UNAVAILABLE', () => {
      const result = evaluateCashMutation({
        action: 'BUY',
        isCashInitialized: true,
        amountOrTotal: 1000,
        availableCash: undefined,
      });
      assert.strictEqual(result.isBlocked, true);
      assert.strictEqual(result.reason, 'BALANCE_UNAVAILABLE');
    });

    it('initialized BUY + availableCash NaN -> blocked with BALANCE_UNAVAILABLE', () => {
      const result = evaluateCashMutation({
        action: 'BUY',
        isCashInitialized: true,
        amountOrTotal: 1000,
        availableCash: NaN,
      });
      assert.strictEqual(result.isBlocked, true);
      assert.strictEqual(result.reason, 'BALANCE_UNAVAILABLE');
    });

    it('initialized BUY + availableCash negative -> blocked with BALANCE_UNAVAILABLE', () => {
      const result = evaluateCashMutation({
        action: 'BUY',
        isCashInitialized: true,
        amountOrTotal: 1000,
        availableCash: -50,
      });
      assert.strictEqual(result.isBlocked, true);
      assert.strictEqual(result.reason, 'BALANCE_UNAVAILABLE');
    });

    it('initialized WITHDRAWAL + unavailable balance -> blocked with BALANCE_UNAVAILABLE', () => {
      const result = evaluateCashMutation({
        action: 'WITHDRAWAL',
        isCashInitialized: true,
        amountOrTotal: 500,
        availableCash: null,
      });
      assert.strictEqual(result.isBlocked, true);
      assert.strictEqual(result.reason, 'BALANCE_UNAVAILABLE');
    });

    it('initialized BUY + amountOrTotal null/invalid -> blocked with INVALID_AMOUNT', () => {
      const result = evaluateCashMutation({
        action: 'BUY',
        isCashInitialized: true,
        amountOrTotal: null,
        availableCash: 5000,
      });
      assert.strictEqual(result.isBlocked, true);
      assert.strictEqual(result.reason, 'INVALID_AMOUNT');
    });

    it('initialized BUY + amountOrTotal zero or negative -> blocked with INVALID_AMOUNT', () => {
      const resultZero = evaluateCashMutation({
        action: 'BUY',
        isCashInitialized: true,
        amountOrTotal: 0,
        availableCash: 5000,
      });
      assert.strictEqual(resultZero.isBlocked, true);
      assert.strictEqual(resultZero.reason, 'INVALID_AMOUNT');

      const resultNeg = evaluateCashMutation({
        action: 'BUY',
        isCashInitialized: true,
        amountOrTotal: -100,
        availableCash: 5000,
      });
      assert.strictEqual(resultNeg.isBlocked, true);
      assert.strictEqual(resultNeg.reason, 'INVALID_AMOUNT');
    });

    it('initialized SELL + unavailable balance -> allowed (does not reduce cash)', () => {
      const result = evaluateCashMutation({
        action: 'SELL',
        isCashInitialized: true,
        amountOrTotal: null,
        availableCash: null,
      });
      assert.strictEqual(result.isBlocked, false);
      assert.strictEqual(result.reason, null);
    });

    it('initialized DEPOSIT + unavailable balance -> allowed (does not reduce cash)', () => {
      const result = evaluateCashMutation({
        action: 'DEPOSIT',
        isCashInitialized: true,
        amountOrTotal: 10000,
        availableCash: null,
      });
      assert.strictEqual(result.isBlocked, false);
      assert.strictEqual(result.reason, null);
    });
  });

  describe('Initialized Cash Accounts — Valid Balance Evaluations', () => {
    it('initialized BUY + exact balance -> allowed', () => {
      const result = evaluateCashMutation({
        action: 'BUY',
        isCashInitialized: true,
        amountOrTotal: 5000,
        availableCash: 5000,
      });
      assert.strictEqual(result.isBlocked, false);
      assert.strictEqual(result.reason, null);
    });

    it('initialized BUY + available cash greater than amount -> allowed', () => {
      const result = evaluateCashMutation({
        action: 'BUY',
        isCashInitialized: true,
        amountOrTotal: 2500,
        availableCash: 5000,
      });
      assert.strictEqual(result.isBlocked, false);
      assert.strictEqual(result.reason, null);
    });

    it('initialized BUY + amount exceeds available cash -> blocked with INSUFFICIENT_CASH', () => {
      const result = evaluateCashMutation({
        action: 'BUY',
        isCashInitialized: true,
        amountOrTotal: 5000.01,
        availableCash: 5000,
      });
      assert.strictEqual(result.isBlocked, true);
      assert.strictEqual(result.reason, 'INSUFFICIENT_CASH');
    });

    it('initialized WITHDRAWAL + amount within available cash -> allowed', () => {
      const result = evaluateCashMutation({
        action: 'WITHDRAWAL',
        isCashInitialized: true,
        amountOrTotal: 2000,
        availableCash: 5000,
      });
      assert.strictEqual(result.isBlocked, false);
      assert.strictEqual(result.reason, null);
    });

    it('initialized WITHDRAWAL + amount exceeds available cash -> blocked with INSUFFICIENT_CASH', () => {
      const result = evaluateCashMutation({
        action: 'WITHDRAWAL',
        isCashInitialized: true,
        amountOrTotal: 7000,
        availableCash: 5000,
      });
      assert.strictEqual(result.isBlocked, true);
      assert.strictEqual(result.reason, 'INSUFFICIENT_CASH');
    });
  });
});
