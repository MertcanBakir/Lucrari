/**
 * Lucrari — Pure Portfolio Cash Mutation Guard Helper
 * 
 * Provides deterministic, fail-closed validation for financial mutations (BUY, SELL, DEPOSIT, WITHDRAWAL):
 * - If isCashInitialized is false, blocks all 4 actions immediately (reason: 'UNINITIALIZED').
 * - For BUY and WITHDRAWAL:
 *   1. Available cash must be a known, finite, non-negative number (otherwise: 'BALANCE_UNAVAILABLE').
 *   2. Amount / total must be a valid, finite, strictly positive number (otherwise: 'INVALID_AMOUNT').
 *   3. Amount / total cannot exceed available cash (otherwise: 'INSUFFICIENT_CASH').
 * - SELL and DEPOSIT do not reduce cash, so they are permitted as long as accounts are initialized.
 */

export type GuardActionType = 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL';

export interface EvaluateCashMutationParams {
  action: GuardActionType;
  isCashInitialized: boolean;
  amountOrTotal: number | null | undefined;
  availableCash: number | null | undefined;
}

export interface CashMutationEvaluation {
  isBlocked: boolean;
  reason: 'UNINITIALIZED' | 'INSUFFICIENT_CASH' | 'BALANCE_UNAVAILABLE' | 'INVALID_AMOUNT' | null;
}

/**
 * Evaluates whether a cash or position mutation is permitted under strict product rules.
 */
export function evaluateCashMutation({
  action,
  isCashInitialized,
  amountOrTotal,
  availableCash,
}: EvaluateCashMutationParams): CashMutationEvaluation {
  // 1. Fail-closed: If cash accounts are not initialized, block all actions
  if (!isCashInitialized) {
    return {
      isBlocked: true,
      reason: 'UNINITIALIZED',
    };
  }

  // 2. Strict fail-closed verification for cash-reducing actions (BUY, WITHDRAWAL)
  if (action === 'BUY' || action === 'WITHDRAWAL') {
    // 2a. Available cash must be a known, finite, non-negative number
    if (
      availableCash === null ||
      availableCash === undefined ||
      typeof availableCash !== 'number' ||
      !Number.isFinite(availableCash) ||
      availableCash < 0
    ) {
      return {
        isBlocked: true,
        reason: 'BALANCE_UNAVAILABLE',
      };
    }

    // 2b. Amount / total must be a valid, finite, strictly positive number
    if (
      amountOrTotal === null ||
      amountOrTotal === undefined ||
      typeof amountOrTotal !== 'number' ||
      !Number.isFinite(amountOrTotal) ||
      amountOrTotal <= 0
    ) {
      return {
        isBlocked: true,
        reason: 'INVALID_AMOUNT',
      };
    }

    // 2c. Amount / total cannot exceed available cash
    if (amountOrTotal > availableCash) {
      return {
        isBlocked: true,
        reason: 'INSUFFICIENT_CASH',
      };
    }
  }

  // Permitted
  return {
    isBlocked: false,
    reason: null,
  };
}
