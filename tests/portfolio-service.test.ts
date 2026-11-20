/** Portfolio calculations, validation and request behavior for the simplified model. */

import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';
import { generateUUID } from '../utils/uuid';
import { createResetIntent } from '../utils/mutation-intent';
import {
  ensureDefaultPortfolio,
  fetchPortfolioPositions,
  fetchPortfolioDataCombined,
  fetchPortfolioCash,
  fetchRealizedPnl,
  setPortfolioCash,
  recordTransaction,
  reverseTransaction,
  resetMyInvestments,
  subscribePortfolioChanges,
  notifyPortfolioChanged,
} from '../services/portfolio/portfolio-service';
import { getSupabaseClient } from '../services/supabase/client';

jest.mock('@/services/portfolio/fx-rate-service', () => ({ fetchUsdTryRate: jest.fn().mockResolvedValue({ rate: 30, isAvailable: true, isStale: false, rateAt: null }) }));

describe('Portfolio Service & RPC Integration (Mock Unit Tests)', () => {
  const mockPortfolioId = '11111111-1111-4111-8111-111111111111';
  const mockInstrumentId = '33333333-3333-4333-8333-333333333333';
  const mockUserId = '99999999-9999-4999-8999-999999999999';

  it('generateUUID should produce valid RFC4122 v4 UUID format', () => {
    const id1 = generateUUID();
    const id2 = generateUUID();

    assert.strictEqual(typeof id1, 'string');
    assert.strictEqual(typeof id2, 'string');
    assert.notStrictEqual(id1, id2);

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    assert.match(id1, uuidRegex);
    assert.match(id2, uuidRegex);
  });

  it('ensureDefaultPortfolio should deduplicate concurrent requests for the same userId', async () => {
    const client = getSupabaseClient();
    let queryCount = 0;
    const originalFrom = client.from;

    (client as any).from = (table: string) => {
      if (table === 'portfolios') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => {
                        queryCount++;
                        await new Promise((r) => setTimeout(r, 20));
                        return {
                          data: {
                            id: mockPortfolioId,
                            user_id: mockUserId,
                            name: 'Ana Portföyüm',
                            base_currency: 'TRY',
                            is_default: true,
                          },
                          error: null,
                        };
                      },
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return (originalFrom as any).call(client, table);
    };

    try {
      const [p1, p2, p3] = await Promise.all([
        ensureDefaultPortfolio(mockUserId),
        ensureDefaultPortfolio(mockUserId),
        ensureDefaultPortfolio(mockUserId),
      ]);

      assert.strictEqual(queryCount, 1, 'Database query must only be performed once for concurrent ensureDefaultPortfolio calls');
      assert.strictEqual(p1.id, mockPortfolioId);
      assert.deepStrictEqual(p1, p2);
      assert.deepStrictEqual(p2, p3);
    } finally {
      client.from = originalFrom;
    }
  });

  it('ensureDefaultPortfolio should throw user-friendly error on SELECT failure and NOT attempt INSERT', async () => {
    const client = getSupabaseClient();
    let insertCallCount = 0;
    const originalFrom = client.from;

    (client as any).from = (table: string) => {
      if (table === 'portfolios') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: null,
                        error: { message: 'Database connection failed' },
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
          insert: () => {
            insertCallCount++;
            return {
              select: () => ({
                single: async () => ({ data: { id: 'should-not-exist' }, error: null }),
              }),
            };
          },
        };
      }
      return (originalFrom as any).call(client, table);
    };

    try {
      await assert.rejects(
        async () => {
          await ensureDefaultPortfolio(mockUserId);
        },
        (err: Error) => {
          return err.message.includes('Portföy bilgisi alınamadı: Database connection failed');
        }
      );

      assert.strictEqual(insertCallCount, 0, 'INSERT must NEVER be called when SELECT query fails');
    } finally {
      client.from = originalFrom;
    }
  });

  it('ensureDefaultPortfolio should recover from 23505 unique conflict and return the default portfolio when non-default portfolios exist', async () => {
    const client = getSupabaseClient();
    let insertAttempted = false;
    let refetchQueryExecuted = false;
    const originalFrom = client.from;

    const nonDefaultPortfolio = {
      id: '22222222-2222-4222-8222-222222222222',
      user_id: mockUserId,
      name: 'Özel Portföy',
      base_currency: 'TRY',
      is_default: false,
      archived_at: null,
    };

    const defaultPortfolio = {
      id: mockPortfolioId,
      user_id: mockUserId,
      name: 'Ana Portföyüm',
      base_currency: 'TRY',
      is_default: true,
      archived_at: null,
    };

    (client as any).from = (table: string) => {
      if (table === 'portfolios') {
        return {
          select: () => ({
            eq: (col1: string, _val1: unknown) => {
              if (col1 === 'user_id') {
                return {
                  is: () => ({
                    order: () => ({
                      order: () => ({
                        limit: () => ({
                          maybeSingle: async () => ({
                            data: null, // First SELECT finds no portfolio
                            error: null,
                          }),
                        }),
                      }),
                    }),
                  }),
                  // Re-query chain after 23505 conflict: .eq('user_id', userId).eq('is_default', true).is('archived_at', null).maybeSingle()
                  eq: (col2: string, val2: unknown) => {
                    assert.strictEqual(col2, 'is_default');
                    assert.strictEqual(val2, true);
                    return {
                      is: (col3: string, val3: unknown) => {
                        assert.strictEqual(col3, 'archived_at');
                        assert.strictEqual(val3, null);
                        return {
                          maybeSingle: async () => {
                            refetchQueryExecuted = true;
                            // Returns the default portfolio, NOT the nonDefaultPortfolio
                            return { data: defaultPortfolio, error: null };
                          },
                        };
                      },
                    };
                  },
                };
              }
              return (originalFrom as any).call(client, table);
            },
          }),
          insert: () => {
            insertAttempted = true;
            return {
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_portfolios_user_default_unique"' },
                }),
              }),
            };
          },
        };
      }
      return (originalFrom as any).call(client, table);
    };

    try {
      const result = await ensureDefaultPortfolio(mockUserId);
      assert.strictEqual(insertAttempted, true, 'Insert must have been attempted');
      assert.strictEqual(refetchQueryExecuted, true, 'Re-fetch with is_default=true must have been executed');
      assert.strictEqual(result.id, mockPortfolioId);
      assert.strictEqual(result.is_default, true);
      assert.notStrictEqual(result.id, nonDefaultPortfolio.id);
    } finally {
      client.from = originalFrom;
    }
  });

  it('fetchPortfolioPositions should make exactly 1 get_portfolio_positions RPC call, 0 table queries, and preserve change_percent/change_amount', async () => {
    const client = getSupabaseClient();
    let rpcCallCount = 0;
    let tableQueryCount = 0;

    const originalRpc = client.rpc;
    const originalFrom = client.from;

    const mockPositions = [
      {
        instrument_id: mockInstrumentId,
        market: 'BIST100',
        symbol: 'THYAO',
        company_name: 'Türk Hava Yolları',
        currency: 'TRY',
        is_visible: true,
        quantity: 100,
        remaining_cost_basis: 25000,
        average_cost: 250,
        realized_pnl: 1500,
        latest_price: 330,
        change_percent: 2.45,
        change_amount: 7.9,
        price_at: new Date().toISOString(),
        provider_code: 'kap',
        price_is_stale: false,
        price_stale_reason: null,
        market_value: 33000,
        unrealized_pnl: 8000,
      },
    ];

    (client as any).rpc = (fnName: string, args: Record<string, unknown>) => {
      if (fnName === 'get_portfolio_positions') {
        rpcCallCount++;
        assert.strictEqual(args.p_portfolio_id, mockPortfolioId);
        return Promise.resolve({ data: mockPositions, error: null });
      }
      return (originalRpc as any).call(client, fnName, args);
    };

    (client as any).from = (table: string) => {
      tableQueryCount++;
      return (originalFrom as any).call(client, table);
    };

    try {
      const positions = await fetchPortfolioPositions(mockPortfolioId);

      assert.strictEqual(rpcCallCount, 1, 'Exactly 1 get_portfolio_positions RPC call must be made');
      assert.strictEqual(tableQueryCount, 0, 'Zero table queries (e.g. instrument_latest_prices) must be performed');
      assert.strictEqual(positions.length, 1);
      assert.strictEqual(positions[0].symbol, 'THYAO');
      assert.strictEqual(positions[0].change_percent, 2.45);
      assert.strictEqual(positions[0].change_amount, 7.9);
      assert.strictEqual(positions[0].market_value, 33000);
    } finally {
      client.rpc = originalRpc;
      client.from = originalFrom;
    }
  });

  it('recordTransaction caller retry with same intent after transport failure should preserve clientRequestId and transactionAt', async () => {
    const client = getSupabaseClient();
    const customRequestId = generateUUID();
    const customTransactionAt = '2026-08-26T10:30:00.000Z';
    const receivedCalls: { clientRequestId: unknown; transactionAt: unknown }[] = [];

    const originalRpc = client.rpc;
    (client as any).rpc = (fnName: string, args: Record<string, unknown>) => {
      if (fnName === 'record_portfolio_transaction') {
        receivedCalls.push({
          clientRequestId: args.p_client_request_id,
          transactionAt: args.p_transaction_at,
        });

        assert.strictEqual(args.p_portfolio_id, mockPortfolioId);
        assert.strictEqual(args.p_instrument_id, mockInstrumentId);
        assert.strictEqual(args.p_transaction_type, 'BUY');

        // Call 1: Server processes or fails with transport network error (uncertain result)
        if (receivedCalls.length === 1) {
          return Promise.resolve({
            data: null,
            error: { message: 'TypeError: fetch failed (network timeout / transport error)' },
          });
        }

        // Call 2: Caller retries with identical intent, server replays existing transaction
        return Promise.resolve({
          data: {
            transaction_id: 'tx-123',
            was_replayed: true,
            current_quantity: '50',
            remaining_cost_basis: '16000',
            realized_pnl: '0',
          },
          error: null,
        });
      }
      return (originalRpc as any).call(client, fnName, args);
    };

    try {
      // First attempt fails due to transport error
      await assert.rejects(
        async () => {
          await recordTransaction({
            portfolioId: mockPortfolioId,
            instrumentId: mockInstrumentId,
            transactionType: 'BUY',
            quantity: 50,
            unitPrice: 320,
            currency: 'TRY',
            clientRequestId: customRequestId,
            transactionAt: customTransactionAt,
          });
        },
        (err: Error) => {
          return err.message.includes('İşlem kaydedilemedi') || err.message.includes('İnternet bağlantısı');
        }
      );

      // Caller explicitly retries with identical clientRequestId and timestamp
      const retryResult = await recordTransaction({
        portfolioId: mockPortfolioId,
        instrumentId: mockInstrumentId,
        transactionType: 'BUY',
        quantity: 50,
        unitPrice: 320,
        currency: 'TRY',
        clientRequestId: customRequestId,
        transactionAt: customTransactionAt,
      });

      assert.strictEqual(receivedCalls.length, 2);
      assert.strictEqual(receivedCalls[0].clientRequestId, customRequestId);
      assert.strictEqual(receivedCalls[1].clientRequestId, customRequestId);
      assert.strictEqual(receivedCalls[0].clientRequestId, receivedCalls[1].clientRequestId, 'clientRequestId must be identical across retries');

      assert.strictEqual(receivedCalls[0].transactionAt, customTransactionAt);
      assert.strictEqual(receivedCalls[1].transactionAt, customTransactionAt);
      assert.strictEqual(receivedCalls[0].transactionAt, receivedCalls[1].transactionAt, 'transactionAt must be identical across retries');

      assert.strictEqual(retryResult.was_replayed, true);
    } finally {
      client.rpc = originalRpc;
    }
  });

  it('resetMyInvestments caller retry after transport failure should preserve clientRequestId; new reset intent generates fresh ID', async () => {
    const client = getSupabaseClient();
    const intent1 = createResetIntent(generateUUID);
    const receivedCalls: { clientRequestId: unknown; confirmation: unknown }[] = [];

    const originalRpc = client.rpc;
    (client as any).rpc = (fnName: string, args: Record<string, unknown>) => {
      if (fnName === 'reset_my_investments') {
        receivedCalls.push({
          clientRequestId: args.p_client_request_id,
          confirmation: args.p_confirmation,
        });

        // Call 1: transport failure
        if (receivedCalls.length === 1) {
          return Promise.resolve({
            data: null,
            error: { message: 'TypeError: fetch failed' },
          });
        }

        // Call 2: replay success
        return Promise.resolve({
          data: {
            was_replayed: true,
            reset_at: new Date().toISOString(),
            portfolio_count: 1,
            deleted_transaction_count: 5,
            deleted_instrument_count: 3,
            deleted_snapshot_count: 1,
            deleted_snapshot_position_count: 2,
            deleted_request_key_count: 3,
          },
          error: null,
        });
      }
      return (originalRpc as any).call(client, fnName, args);
    };

    try {
      // 1. Initial attempt fails due to transport error
      await assert.rejects(
        async () => {
          await resetMyInvestments({ clientRequestId: intent1.clientRequestId });
        },
        (err: Error) => {
          return err.message.includes('Yatırımlar sıfırlanamadı') || err.message.includes('İnternet bağlantısı');
        }
      );

      // 2. Caller chooses "Tekrar Dene" with the SAME intent
      const retryResult = await resetMyInvestments({ clientRequestId: intent1.clientRequestId });

      assert.strictEqual(receivedCalls.length, 2);
      assert.strictEqual(receivedCalls[0].clientRequestId, intent1.clientRequestId);
      assert.strictEqual(receivedCalls[1].clientRequestId, intent1.clientRequestId);
      assert.strictEqual(retryResult.was_replayed, true);

      // 3. User later cancels or initiates a brand NEW reset intent
      const intent2 = createResetIntent(generateUUID);
      assert.notStrictEqual(intent1.clientRequestId, intent2.clientRequestId, 'Fresh reset intent must generate a distinct UUID');
    } finally {
      client.rpc = originalRpc;
    }
  });

  it('reverseTransaction should invoke reverse_portfolio_transaction RPC', async () => {
    const client = getSupabaseClient();

    const originalRpc = client.rpc;
    (client as any).rpc = (fnName: string, args: Record<string, unknown>) => {
      if (fnName === 'reverse_portfolio_transaction') {
        assert.strictEqual(args.p_transaction_id, 'tx-123');
        assert.strictEqual(args.p_reason, 'Hatalı işlem girişi');

        return Promise.resolve({
          data: {
            transaction_id: 'tx-123',
            was_replayed: false,
            current_quantity: '0',
            remaining_cost_basis: '0',
            realized_pnl: '0',
          },
          error: null,
        });
      }
      return (originalRpc as any).call(client, fnName, args);
    };

    try {
      const result = await reverseTransaction({
        transactionId: 'tx-123',
        reason: 'Hatalı işlem girişi',
      });

      assert.strictEqual(result.transaction_id, 'tx-123');
      assert.strictEqual(result.current_quantity, '0');
    } finally {
      client.rpc = originalRpc;
    }
  });

  it('resetMyInvestments should throw error without table delete fallback when RPC fails', async () => {
    const client = getSupabaseClient();
    const originalRpc = client.rpc;
    let tableDeleteAttempted = false;
    const originalFrom = client.from;

    (client as any).rpc = (fnName: string, _args: Record<string, unknown>) => {
      if (fnName === 'reset_my_investments') {
        return Promise.resolve({
          data: null,
          error: { code: 'PGRST202', message: 'Could not find the function' },
        });
      }
      return (originalRpc as any).call(client, fnName, _args);
    };

    (client as any).from = (table: string) => {
      tableDeleteAttempted = true;
      return (originalFrom as any).call(client, table);
    };

    try {
      await assert.rejects(
        async () => {
          await resetMyInvestments({ clientRequestId: 'req-fail-test' });
        },
        (err: Error) => {
          return err.message.includes('Veritabanı güncellemesi gerekli');
        }
      );

      assert.strictEqual(tableDeleteAttempted, false, 'Direct table delete fallback must NOT be attempted');
    } finally {
      client.rpc = originalRpc;
      client.from = originalFrom;
    }
  });

  it('resetMyInvestments should throw error if clientRequestId is missing or empty', async () => {
    await assert.rejects(
      async () => {
        await (resetMyInvestments as any)();
      },
      (err: Error) => {
        return err.message.includes('clientRequestId zorunludur');
      }
    );

    await assert.rejects(
      async () => {
        await resetMyInvestments({ clientRequestId: '' });
      },
      (err: Error) => {
        return err.message.includes('clientRequestId zorunludur');
      }
    );
  });

  it('subscribePortfolioChanges should notify subscribers on mutations', () => {
    let notified = false;
    const unsubscribe = subscribePortfolioChanges(() => {
      notified = true;
    });

    notifyPortfolioChanged();
    assert.strictEqual(notified, true);

    notified = false;
    unsubscribe();
    notifyPortfolioChanged();
    assert.strictEqual(notified, false);
  });
});

it('reads and edits manual cash, and includes closed sale profit in the combined request', async () => {
  const client = getSupabaseClient();
  const rpc = jest.spyOn(client, 'rpc').mockImplementation(((name: string) => {
    const data = name === 'get_portfolio_cash' ? { try_balance: 100, usd_balance: 5 }
      : name === 'get_portfolio_realized_pnl' ? { try_pnl: 1200, usd_pnl: 10 } : [];
    return Promise.resolve({ data, error: null });
  }) as any);
  try {
    expect(await fetchPortfolioCash('portfolio-test')).toEqual({ tryBalance: 100, usdBalance: 5 });
    expect(await fetchRealizedPnl('portfolio-test')).toEqual({ tryPnl: 1200, usdPnl: 10 });
    await setPortfolioCash({ portfolioId: 'portfolio-test', tryBalance: 12, usdBalance: 0 });
    expect(rpc).toHaveBeenCalledWith('set_portfolio_cash', { p_portfolio_id: 'portfolio-test', p_try_balance: 12, p_usd_balance: 0 });
    const [a, b] = await Promise.all([fetchPortfolioDataCombined('portfolio-test'), fetchPortfolioDataCombined('portfolio-test')]);
    expect(a).toBe(b);
    expect(a.cash.tryBalance).toBe(100);
    expect(a.realizedPnl.tryPnl).toBe(1200);
  } finally { rpc.mockRestore(); }
});

it('does not publish failed manual cash edits', async () => {
  const client = getSupabaseClient();
  const rpc = jest.spyOn(client, 'rpc').mockResolvedValue({ data: null, error: { message: 'network failed' } } as any);
  const change = jest.fn();
  const unsubscribe = subscribePortfolioChanges(change);
  try {
    await expect(setPortfolioCash({ portfolioId: 'portfolio-test', tryBalance: 0, usdBalance: 0 })).rejects.toThrow(/Nakit/);
    await expect(fetchPortfolioCash('portfolio-test')).rejects.toThrow(/Nakit/);
    await expect(fetchRealizedPnl('portfolio-test')).rejects.toThrow(/Satış/);
    expect(change).not.toHaveBeenCalled();
  } finally { unsubscribe(); rpc.mockRestore(); }
});
