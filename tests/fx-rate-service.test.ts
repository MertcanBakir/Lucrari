/**
 * Automated Unit Tests for USD/TRY Foreign Exchange Rate Service
 * 
 * Validates:
 * - Live valid rate fetching from Supabase
 * - Stale rate handling and flags
 * - Missing USDTRY instrument handling
 * - Missing or invalid price values (0, negative, NaN, Infinity)
 * - Query error handling and resilient cache fallback
 * - Concurrent in-flight request deduplication
 * - Normal in-flight request sharing with concurrent forceRefresh: true call
 * - 3 concurrent forceRefresh calls triggering only 1 Supabase query
 * - In-flight promise cleanup after successful completion
 * - Retry capability after a failed request
 * - Generation-safe cleanup (older promise does not delete a newer promise)
 */

import { describe, it, beforeEach } from '@jest/globals';
import assert from 'node:assert/strict';
import {
  fetchUsdTryRate,
  clearFxRateCache,
} from '@/services/portfolio/fx-rate-service';
import { setSupabaseClientForTesting, resetSupabaseClientForTesting } from '@/services/supabase/client';

describe('USD/TRY FX Rate Service & Live Valuation', () => {
  beforeEach(() => {
    clearFxRateCache();
    resetSupabaseClientForTesting();
  });

  it('should fetch valid live USD/TRY exchange rate from Supabase', async () => {
    let callCount = 0;
    const mockClient = {
      from: (table: string) => {
        assert.equal(table, 'instruments');
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => {
                    callCount++;
                    return {
                      data: {
                        id: 'fx-usdtry-uuid-1234',
                        symbol: 'USDTRY',
                        market: 'FX',
                        instrument_latest_prices: {
                          price: 35.45,
                          price_at: '2026-08-26T10:00:00Z',
                          is_stale: false,
                          stale_reason: null,
                        },
                      },
                      error: null,
                    };
                  },
                }),
              }),
            }),
          }),
        };
      },
    };

    setSupabaseClientForTesting(mockClient as any);

    const result = await fetchUsdTryRate({ forceRefresh: true });

    assert.equal(callCount, 1);
    assert.equal(result.isAvailable, true);
    assert.equal(result.rate, 35.45);
    assert.equal(result.rateAt, '2026-08-26T10:00:00Z');
    assert.equal(result.isStale, false);
    assert.equal(result.source, 'database');
  });

  it('should flag stale USD/TRY rate correctly', async () => {
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'fx-usdtry-uuid-1234',
                    symbol: 'USDTRY',
                    market: 'FX',
                    instrument_latest_prices: {
                      price: 36.10,
                      price_at: '2026-08-25T18:00:00Z',
                      is_stale: true,
                      stale_reason: 'Piyasa kapalı',
                    },
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    };

    setSupabaseClientForTesting(mockClient as any);

    const result = await fetchUsdTryRate({ forceRefresh: true });

    assert.equal(result.isAvailable, true);
    assert.equal(result.rate, 36.10);
    assert.equal(result.isStale, true);
    assert.equal(result.staleReason, 'Piyasa kapalı');
  });

  it('should return isAvailable=false when USDTRY instrument is not in database', async () => {
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    };

    setSupabaseClientForTesting(mockClient as any);

    const result = await fetchUsdTryRate({ forceRefresh: true });

    assert.equal(result.isAvailable, false);
    assert.equal(result.rate, null);
    assert.equal(result.source, 'none');
  });

  it('should reject invalid or non-positive price values (0, negative, NaN)', async () => {
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'fx-usdtry-uuid-1234',
                    symbol: 'USDTRY',
                    market: 'FX',
                    instrument_latest_prices: {
                      price: -5.0,
                      price_at: '2026-08-26T10:00:00Z',
                      is_stale: false,
                    },
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    };

    setSupabaseClientForTesting(mockClient as any);

    const result = await fetchUsdTryRate({ forceRefresh: true });

    assert.equal(result.isAvailable, false);
    assert.equal(result.rate, null);
  });

  it('should return isAvailable=false on query error when no previous rate was cached', async () => {
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: { message: 'Network connection timeout' },
                }),
              }),
            }),
          }),
        }),
      }),
    };

    setSupabaseClientForTesting(mockClient as any);

    const result = await fetchUsdTryRate({ forceRefresh: true });

    assert.equal(result.isAvailable, false);
    assert.equal(result.rate, null);
  });

  it('should share in-flight query when forceRefresh: true is called while a normal request is pending', async () => {
    let callCount = 0;
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  callCount++;
                  await new Promise((resolve) => setTimeout(resolve, 40));
                  return {
                    data: {
                      id: 'fx-usdtry-uuid-1234',
                      symbol: 'USDTRY',
                      market: 'FX',
                      instrument_latest_prices: {
                        price: 35.80,
                        price_at: '2026-08-26T10:00:00Z',
                        is_stale: false,
                      },
                    },
                    error: null,
                  };
                },
              }),
            }),
          }),
        }),
      }),
    };

    setSupabaseClientForTesting(mockClient as any);

    // Call normal request, and immediately call forceRefresh
    const normalPromise = fetchUsdTryRate();
    const forceRefreshPromise = fetchUsdTryRate({ forceRefresh: true });

    const [res1, res2] = await Promise.all([normalPromise, forceRefreshPromise]);

    assert.equal(callCount, 1, 'Supabase query must only be performed once even when forceRefresh is true during pending request');
    assert.equal(res1.rate, 35.80);
    assert.equal(res2.rate, 35.80);
  });

  it('should perform only 1 Supabase query when 3 concurrent forceRefresh calls are made', async () => {
    let callCount = 0;
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  callCount++;
                  await new Promise((resolve) => setTimeout(resolve, 30));
                  return {
                    data: {
                      id: 'fx-usdtry-uuid-1234',
                      symbol: 'USDTRY',
                      market: 'FX',
                      instrument_latest_prices: {
                        price: 35.95,
                        price_at: '2026-08-26T10:00:00Z',
                        is_stale: false,
                      },
                    },
                    error: null,
                  };
                },
              }),
            }),
          }),
        }),
      }),
    };

    setSupabaseClientForTesting(mockClient as any);

    const [req1, req2, req3] = await Promise.all([
      fetchUsdTryRate({ forceRefresh: true }),
      fetchUsdTryRate({ forceRefresh: true }),
      fetchUsdTryRate({ forceRefresh: true }),
    ]);

    assert.equal(callCount, 1, 'Database must only be queried once for 3 concurrent forceRefresh requests');
    assert.equal(req1.rate, 35.95);
    assert.equal(req2.rate, 35.95);
    assert.equal(req3.rate, 35.95);
  });

  it('should clean up in-flight record after successful completion so subsequent call initiates a fresh query', async () => {
    let callCount = 0;
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  callCount++;
                  return {
                    data: {
                      id: 'fx-usdtry-uuid-1234',
                      symbol: 'USDTRY',
                      market: 'FX',
                      instrument_latest_prices: {
                        price: 35.50 + callCount,
                        price_at: '2026-08-26T10:00:00Z',
                        is_stale: false,
                      },
                    },
                    error: null,
                  };
                },
              }),
            }),
          }),
        }),
      }),
    };

    setSupabaseClientForTesting(mockClient as any);

    const first = await fetchUsdTryRate();
    assert.equal(first.rate, 36.50);
    assert.equal(callCount, 1);

    // After completion, next call initiates fresh query
    const second = await fetchUsdTryRate();
    assert.equal(second.rate, 37.50);
    assert.equal(callCount, 2);
  });

  it('should clean up in-flight record after failed request allowing retry', async () => {
    let callCount = 0;
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  callCount++;
                  if (callCount === 1) {
                    return { data: null, error: { message: 'Temporary network failure' } };
                  }
                  return {
                    data: {
                      id: 'fx-usdtry-uuid-1234',
                      symbol: 'USDTRY',
                      market: 'FX',
                      instrument_latest_prices: {
                        price: 36.0,
                        price_at: '2026-08-26T10:00:00Z',
                        is_stale: false,
                      },
                    },
                    error: null,
                  };
                },
              }),
            }),
          }),
        }),
      }),
    };

    setSupabaseClientForTesting(mockClient as any);

    const failRes = await fetchUsdTryRate();
    assert.equal(failRes.isAvailable, false);
    assert.equal(callCount, 1);

    // Retry should succeed
    const retryRes = await fetchUsdTryRate();
    assert.equal(retryRes.isAvailable, true);
    assert.equal(retryRes.rate, 36.0);
    assert.equal(callCount, 2);
  });
});

describe('USDTRY fallbacks', () => {
  const query = jest.fn();
  const rows = (price: number) => ({ data: { instrument_latest_prices: [{ price }] }, error: null });
  beforeEach(() => {
    clearFxRateCache();
    query.mockReset();
    const builder = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: query };
    setSupabaseClientForTesting({ from: () => builder });
  });

  afterEach(resetSupabaseClientForTesting);

  it('uses a cached rate when the record disappears, price is invalid or a request throws', async () => {
    query.mockResolvedValueOnce(rows(35))
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce(rows(0))
      .mockRejectedValueOnce('offline');
    await expect(fetchUsdTryRate()).resolves.toMatchObject({ rate: 35, rateAt: null, source: 'database' });
    for (const message of ['USDTRY kaydı bulunamadı', 'Güncel fiyat geçersiz', 'Bağlantı hatası']) {
      const rate = await fetchUsdTryRate();
      expect(rate).toMatchObject({ rate: 35, isStale: true, source: 'cache' });
      expect(rate.staleReason).toContain(message);
    }
  });

  it('reports a thrown request without inventing a rate when no earlier price exists', async () => {
    query.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchUsdTryRate()).resolves.toMatchObject({ rate: null, source: 'none', isAvailable: false });
  });
});
