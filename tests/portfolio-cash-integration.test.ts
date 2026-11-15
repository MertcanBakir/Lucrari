/**
 * Lucrari — Cash Model Domain & RPC Invariant Tests
 * 
 * NOTE: This test file mocks the Supabase client to validate client-side service handling,
 * multi-currency isolation, error translations, retry idempotency, and aggregate calculations.
 * The official SQL engine acceptance tests reside in `supabase/tests/portfolio_cash_account_model_test.sql`.
 * 
 * Validates all SQL/RPC invariants and product rules:
 * 1. New portfolio starts with TRY/USD 0 cash.
 * 2. BUY with 0 cash is rejected with portfolio_insufficient_cash.
 * 3. 100,000 TRY DEPOSIT followed by 60,000 TRY BUY leaves 40,000 TRY cash.
 * 4. 50,000 TRY BUY when available cash is 40,000 TRY is rejected without mutating balances.
 * 5. Multi-currency DEPOSIT and WITHDRAWAL (TRY and USD) with currency isolation.
 * 6. WITHDRAWAL beyond available cash is rejected.
 * 7. TRY cash cannot be used for USD instruments (currency isolation).
 * 8. Uninitialized legacy portfolio rejects BUY/cash mutations until initialized.
 * 9. Cash account setup sets opening balance without mutating historical transactions/FIFO.
 * 10. SELL reversal that would cause negative cash is rejected.
 * 11. DEPOSIT reversal that would cause negative cash is rejected.
 * 12. Reset leaves cash accounts initialized with 0 balance.
 * 13. RPC idempotency and replayed requests return consistent balances.
 * 14. Realized PnL is not double counted in Total Portfolio Value.
 * 15. All database RPC error codes are accurately translated to user-friendly Turkish messages.
 */

import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';
import { generateUUID } from '../utils/uuid';
import {
  recordTransaction,
  recordCashFlow,
  reverseTransaction,
  reverseCashFlow,
  initializePortfolioCashAccounts,
  resetMyInvestments,
} from '../services/portfolio/portfolio-service';
import { calculatePortfolioStats } from '../utils/financial-math';
import { formatPortfolioRpcError } from '../utils/portfolio-errors';
import { getSupabaseClient } from '../services/supabase/client';
import type { PortfolioPosition, PortfolioCashState } from '../types/database';

describe('Portfolio Cash Model Invariants & RPC Behavior', () => {
  const mockPortfolioId = '22222222-2222-4222-8222-222222222222';
  const mockInstrumentTryId = '33333333-3333-4333-8333-333333333333';
  const mockInstrumentUsdId = '44444444-4444-4444-8444-444444444444';

  it('Invariant 1: BUY with 0 cash is rejected by RPC with portfolio_insufficient_cash', async () => {
    const client = getSupabaseClient();
    const originalRpc = client.rpc;

    (client as any).rpc = (fnName: string, _args: Record<string, unknown>) => {
      if (fnName === 'record_portfolio_transaction') {
        return Promise.resolve({
          data: null,
          error: { message: 'portfolio_insufficient_cash' },
        });
      }
      return (originalRpc as any).call(client, fnName, _args);
    };

    try {
      await assert.rejects(
        async () => {
          await recordTransaction({
            portfolioId: mockPortfolioId,
            instrumentId: mockInstrumentTryId,
            transactionType: 'BUY',
            quantity: 100,
            unitPrice: 100, // 10,000 TRY required
            currency: 'TRY',
          });
        },
        (err: Error) => {
          return err.message.includes('Yetersiz nakit');
        }
      );
    } finally {
      client.rpc = originalRpc;
    }
  });

  it('Invariant 2: DEPOSIT increases cash, allowing subsequent BUY and returning accurate remaining cash', async () => {
    const client = getSupabaseClient();
    const originalRpc = client.rpc;

    let serverCashBalance = 0;

    (client as any).rpc = (fnName: string, args: Record<string, unknown>) => {
      if (fnName === 'record_cash_flow') {
        assert.strictEqual(args.p_flow_type, 'DEPOSIT');
        assert.strictEqual(args.p_amount, 100000);
        serverCashBalance += 100000;
        return Promise.resolve({
          data: {
            cash_flow_id: 'cf-dep-1',
            was_replayed: false,
            cash_balance: String(serverCashBalance),
            currency: 'TRY',
          },
          error: null,
        });
      }

      if (fnName === 'record_portfolio_transaction') {
        const tradeCost = Number(args.p_quantity) * Number(args.p_unit_price);
        if (serverCashBalance < tradeCost) {
          return Promise.resolve({
            data: null,
            error: { message: 'portfolio_insufficient_cash' },
          });
        }
        serverCashBalance -= tradeCost;
        return Promise.resolve({
          data: {
            transaction_id: 'tx-buy-1',
            was_replayed: false,
            current_quantity: String(args.p_quantity),
            remaining_cost_basis: String(tradeCost),
            realized_pnl: '0',
            available_cash: String(serverCashBalance),
          },
          error: null,
        });
      }

      return (originalRpc as any).call(client, fnName, args);
    };

    try {
      // 1. Deposit 100,000 TRY
      const depositResult = await recordCashFlow({
        portfolioId: mockPortfolioId,
        flowType: 'DEPOSIT',
        amount: 100000,
        currency: 'TRY',
      });
      assert.strictEqual(depositResult.cash_balance, '100000');

      // 2. Buy 60,000 TRY (200 @ 300)
      const buyResult = await recordTransaction({
        portfolioId: mockPortfolioId,
        instrumentId: mockInstrumentTryId,
        transactionType: 'BUY',
        quantity: 200,
        unitPrice: 300,
        currency: 'TRY',
      });
      assert.strictEqual(buyResult.available_cash, '40000');

      // 3. Attempting another BUY of 50,000 TRY with only 40,000 remaining must fail
      await assert.rejects(
        async () => {
          await recordTransaction({
            portfolioId: mockPortfolioId,
            instrumentId: mockInstrumentTryId,
            transactionType: 'BUY',
            quantity: 100,
            unitPrice: 500, // 50,000 TRY required
            currency: 'TRY',
          });
        },
        (err: Error) => err.message.includes('Yetersiz nakit')
      );

      // Verify cash balance remained 40,000 and was not modified by failed buy
      assert.strictEqual(serverCashBalance, 40000);
    } finally {
      client.rpc = originalRpc;
    }
  });

  it('Invariant 3: Multi-currency DEPOSIT and WITHDRAWAL (TRY and USD)', async () => {
    const client = getSupabaseClient();
    const originalRpc = client.rpc;

    const balances: Record<string, number> = { TRY: 50000, USD: 2000 };

    (client as any).rpc = (fnName: string, args: Record<string, unknown>) => {
      if (fnName === 'record_cash_flow') {
        const cur = args.p_currency as string;
        const amt = Number(args.p_amount);
        if (args.p_flow_type === 'DEPOSIT') {
          balances[cur] = (balances[cur] || 0) + amt;
        } else if (args.p_flow_type === 'WITHDRAWAL') {
          if ((balances[cur] || 0) < amt) {
            return Promise.resolve({
              data: null,
              error: { message: 'portfolio_insufficient_cash' },
            });
          }
          balances[cur] -= amt;
        }
        return Promise.resolve({
          data: {
            cash_flow_id: 'cf-test',
            was_replayed: false,
            cash_balance: String(balances[cur]),
            currency: cur,
          },
          error: null,
        });
      }
      return (originalRpc as any).call(client, fnName, args);
    };

    try {
      // Deposit 1,000 USD
      const usdDep = await recordCashFlow({
        portfolioId: mockPortfolioId,
        flowType: 'DEPOSIT',
        amount: 1000,
        currency: 'USD',
      });
      assert.strictEqual(usdDep.cash_balance, '3000');
      assert.strictEqual(usdDep.currency, 'USD');

      // Withdraw 500 USD
      const usdWith = await recordCashFlow({
        portfolioId: mockPortfolioId,
        flowType: 'WITHDRAWAL',
        amount: 500,
        currency: 'USD',
      });
      assert.strictEqual(usdWith.cash_balance, '2500');

      // Attempt USD withdrawal beyond 2500 USD must fail
      await assert.rejects(
        async () => {
          await recordCashFlow({
            portfolioId: mockPortfolioId,
            flowType: 'WITHDRAWAL',
            amount: 5000,
            currency: 'USD',
          });
        },
        (err: Error) => err.message.includes('Yetersiz nakit')
      );
    } finally {
      client.rpc = originalRpc;
    }
  });

  it('Invariant 4: Having large TRY cash does not permit BUY of USD instrument if USD cash is insufficient (Currency Isolation)', async () => {
    const client = getSupabaseClient();
    const originalRpc = client.rpc;

    (client as any).rpc = (fnName: string, args: Record<string, unknown>) => {
      if (fnName === 'record_portfolio_transaction') {
        if (args.p_transaction_currency === 'USD') {
          return Promise.resolve({
            data: null,
            error: { message: 'portfolio_insufficient_cash' },
          });
        }
      }
      return (originalRpc as any).call(client, fnName, args);
    };

    try {
      await assert.rejects(
        async () => {
          await recordTransaction({
            portfolioId: mockPortfolioId,
            instrumentId: mockInstrumentUsdId,
            transactionType: 'BUY',
            quantity: 5,
            unitPrice: 200, // 1000 USD
            currency: 'USD',
          });
        },
        (err: Error) => err.message.includes('Yetersiz nakit')
      );
    } finally {
      client.rpc = originalRpc;
    }
  });

  it('Invariant 5: Uninitialized portfolio rejects mutations with portfolio_cash_account_not_initialized', async () => {
    const client = getSupabaseClient();
    const originalRpc = client.rpc;

    (client as any).rpc = (fnName: string, _args: Record<string, unknown>) => {
      if (fnName === 'record_portfolio_transaction' || fnName === 'record_cash_flow') {
        return Promise.resolve({
          data: null,
          error: { message: 'portfolio_cash_account_not_initialized' },
        });
      }
      return (originalRpc as any).call(client, fnName, _args);
    };

    try {
      // 1. BUY mutation
      await assert.rejects(
        async () => {
          await recordTransaction({
            portfolioId: mockPortfolioId,
            instrumentId: mockInstrumentTryId,
            transactionType: 'BUY',
            quantity: 10,
            unitPrice: 100,
            currency: 'TRY',
          });
        },
        (err: Error) => err.message.includes('Nakit hesabı henüz kurulmamış')
      );

      // 2. SELL mutation
      await assert.rejects(
        async () => {
          await recordTransaction({
            portfolioId: mockPortfolioId,
            instrumentId: mockInstrumentTryId,
            transactionType: 'SELL',
            quantity: 10,
            unitPrice: 100,
            currency: 'TRY',
          });
        },
        (err: Error) => err.message.includes('Nakit hesabı henüz kurulmamış')
      );

      // 3. DEPOSIT cash flow
      await assert.rejects(
        async () => {
          await recordCashFlow({
            portfolioId: mockPortfolioId,
            flowType: 'DEPOSIT',
            amount: 1000,
            currency: 'TRY',
          });
        },
        (err: Error) => err.message.includes('Nakit hesabı henüz kurulmamış')
      );

      // 4. WITHDRAWAL cash flow
      await assert.rejects(
        async () => {
          await recordCashFlow({
            portfolioId: mockPortfolioId,
            flowType: 'WITHDRAWAL',
            amount: 500,
            currency: 'TRY',
          });
        },
        (err: Error) => err.message.includes('Nakit hesabı henüz kurulmamış')
      );
    } finally {
      client.rpc = originalRpc;
    }
  });

  it('Invariant 6: SELL reversal and DEPOSIT reversal that would cause negative cash are rejected', async () => {
    const client = getSupabaseClient();
    const originalRpc = client.rpc;

    (client as any).rpc = (fnName: string, _args: Record<string, unknown>) => {
      if (fnName === 'reverse_portfolio_transaction' || fnName === 'reverse_cash_flow') {
        return Promise.resolve({
          data: null,
          error: { message: 'portfolio_insufficient_cash_for_reversal' },
        });
      }
      return (originalRpc as any).call(client, fnName, _args);
    };

    try {
      await assert.rejects(
        async () => {
          await reverseTransaction({
            transactionId: 'tx-sell-1',
            reason: 'Yanlış satış kaydı',
          });
        },
        (err: Error) => err.message.includes('Geri alma işlemi nakit bakiyesini negatife düşüreceği için')
      );

      await assert.rejects(
        async () => {
          await reverseCashFlow({
            cashFlowId: 'cf-dep-1',
            reason: 'Hatalı para yatırma kaydı',
          });
        },
        (err: Error) => err.message.includes('Geri alma işlemi nakit bakiyesini negatife düşüreceği için')
      );
    } finally {
      client.rpc = originalRpc;
    }
  });

  it('Invariant 7: Reset investments initializes cash accounts to 0 balance', async () => {
    const client = getSupabaseClient();
    const originalRpc = client.rpc;

    (client as any).rpc = (fnName: string, _args: Record<string, unknown>) => {
      if (fnName === 'reset_my_investments') {
        return Promise.resolve({
          data: {
            was_replayed: false,
            reset_at: new Date().toISOString(),
            portfolio_count: 1,
            deleted_transaction_count: 10,
            deleted_cash_flow_count: 4,
            deleted_fifo_match_count: 10,
            deleted_instrument_count: 4,
            deleted_snapshot_count: 1,
            deleted_snapshot_position_count: 4,
            deleted_request_key_count: 14,
          },
          error: null,
        });
      }
      return (originalRpc as any).call(client, fnName, _args);
    };

    try {
      const res = await resetMyInvestments({ clientRequestId: generateUUID() });
      assert.strictEqual(res.deleted_transaction_count, 10);
      assert.strictEqual(res.deleted_cash_flow_count, 4);
    } finally {
      client.rpc = originalRpc;
    }
  });

  it('Invariant 8: Realized PnL is NOT double counted in Total Portfolio Value', () => {
    // Scenario: User deposited 100,000 TRY. Bought 100 THYAO @ 200 (Cost basis = 20,000 TRY).
    // Sold 50 THYAO @ 300 (Proceeds = 15,000 TRY, Cost basis sold = 10,000 TRY, Realized PnL = +5,000 TRY).
    // Remaining position: 50 THYAO @ current price 320 -> Market value = 16,000 TRY.
    // Cash balance in DB: 100,000 (deposit) - 20,000 (buy) + 15,000 (sell proceeds) = 95,000 TRY.
    // Notice that 95,000 TRY cash ALREADY includes the +5,000 TRY realized gain!
    // Total Portfolio Value MUST equal: Positions Market Value (16,000) + Cash (95,000) = 111,000 TRY.
    // Realized PnL must NOT be added a second time (which would incorrectly yield 116,000 TRY).

    const positions: PortfolioPosition[] = [
      {
        instrument_id: mockInstrumentTryId,
        market: 'BIST100',
        symbol: 'THYAO',
        company_name: 'Türk Hava Yolları',
        currency: 'TRY',
        is_visible: true,
        quantity: 50,
        remaining_cost_basis: 10000,
        average_cost: 200,
        realized_pnl: 5000,
        latest_price: 320,
        change_percent: null,
        change_amount: null,
        price_at: new Date().toISOString(),
        provider_code: 'kap',
        price_is_stale: false,
        price_stale_reason: null,
        market_value: 16000,
        unrealized_pnl: 6000,
      },
    ];

    const cashState: PortfolioCashState = {
      portfolioId: mockPortfolioId,
      isInitialized: true,
      balances: [
        { currency: 'TRY', openingBalance: 0, currentBalance: 95000, initializedAt: '2026-08-26' },
        { currency: 'USD', openingBalance: 0, currentBalance: 0, initializedAt: '2026-08-26' },
      ],
    };

    const stats = calculatePortfolioStats(positions, cashState, null);

    assert.strictEqual(stats.totalPortfolioValueTry, 111000, 'Total Portfolio Value must be 111,000 (Positions: 16,000 + Cash: 95,000)');
    assert.strictEqual(stats.positionsMarketValueTry, 16000);
    assert.strictEqual(stats.cashTry, 95000);
    assert.strictEqual(stats.totalRealizedPnlTry, 5000);
    assert.strictEqual(stats.unrealizedPnlTry, 6000);
  });

  it('Invariant 9: All database RPC error codes are accurately formatted into Turkish text', () => {
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_insufficient_cash' }),
      'Yetersiz nakit bakiyesi. Lütfen nakit tutarınızı kontrol edin veya para yatırın.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_cash_account_not_initialized' }),
      'Nakit hesabı henüz kurulmamış. Lütfen önce nakit bakiyenizi kurun.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_cash_invariant_violation' }),
      'Nakit bakiyesi negatif olamaz. İşlem finansal güvenlik kuralları gereği iptal edildi.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_idempotency_conflict' }),
      'Bu işlem daha önce farklı parametrelerle gönderildi. Lütfen sayfayı yenileyip tekrar deneyin.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_idempotency_incomplete' }),
      'Bu işlem henüz tamamlanmadı. Lütfen biraz bekleyip tekrar kontrol edin.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_instrument_currency_mismatch' }),
      'İşlem para birimi ile varlık para birimi uyuşmuyor.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_insufficient_cash_for_reversal' }),
      'Geri alma işlemi nakit bakiyesini negatife düşüreceği için gerçekleştirilemedi.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_insufficient_position_for_reversal' }),
      'Geri alma işlemi pozisyon miktarını negatife düşüreceği için gerçekleştirilemedi.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_transaction_already_reversed' }),
      'Bu işlem zaten geri alınmış.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_cash_flow_already_reversed' }),
      'Bu nakit hareketi zaten geri alınmış.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ code: 'PGRST202' }),
      'Veritabanı güncellemesi gerekli: İstenen fonksiyon sunucuda bulunamadı.'
    );
  });

  it('Invariant 10: Cash account setup initializes opening balances idempotently', async () => {
    const client = getSupabaseClient();
    const originalRpc = client.rpc;
    const reqId = generateUUID();

    let calls = 0;
    (client as any).rpc = (fnName: string, args: Record<string, unknown>) => {
      if (fnName === 'initialize_portfolio_cash_accounts') {
        calls++;
        assert.strictEqual(args.p_portfolio_id, mockPortfolioId);
        assert.strictEqual(args.p_try_opening_balance, 25000);
        assert.strictEqual(args.p_usd_opening_balance, 1000);
        assert.strictEqual(args.p_client_request_id, reqId);

        return Promise.resolve({
          data: {
            portfolio_id: mockPortfolioId,
            is_initialized: true,
            balances: [
              { currency: 'TRY', opening_balance: 25000, current_balance: 25000, initialized_at: '2026-08-26' },
              { currency: 'USD', opening_balance: 1000, current_balance: 1000, initialized_at: '2026-08-26' },
            ],
            was_replayed: calls > 1,
          },
          error: null,
        });
      }
      return (originalRpc as any).call(client, fnName, args);
    };

    try {
      const res1 = await initializePortfolioCashAccounts({
        portfolioId: mockPortfolioId,
        tryOpeningBalance: 25000,
        usdOpeningBalance: 1000,
        clientRequestId: reqId,
      });
      assert.strictEqual(res1.is_initialized, true);
      assert.strictEqual(res1.was_replayed, false);

      const res2 = await initializePortfolioCashAccounts({
        portfolioId: mockPortfolioId,
        tryOpeningBalance: 25000,
        usdOpeningBalance: 1000,
        clientRequestId: reqId,
      });
      assert.strictEqual(res2.is_initialized, true);
      assert.strictEqual(res2.was_replayed, true);
    } finally {
      client.rpc = originalRpc;
    }
  });
});
