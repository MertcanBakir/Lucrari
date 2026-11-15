/**
 * Automated Unit Tests for Instrument Catalog & Price Search Service
 * 
 * Validates:
 * - Supabase successful search with live prices
 * - Handling real instruments without latest prices (price: null, hasPrice: false)
 * - Stale price flag propagation
 * - Query error handling
 * - Zero results handling
 * - STRICT CHECK: Verifies no fake hardcoded presets or IDs (inst-*) are returned
 */

import { describe, it, beforeEach } from '@jest/globals';
import assert from 'node:assert/strict';
import {
  searchInstrumentsDetailed,
  searchInstruments,
} from '@/services/portfolio/instrument-service';
import { setSupabaseClientForTesting, resetSupabaseClientForTesting } from '@/services/supabase/client';

function createMockSupabaseQuery(data: any[] | null, error: any = null) {
  const queryBuilder: any = {
    select: () => queryBuilder,
    eq: () => queryBuilder,
    or: () => queryBuilder,
    order: () => queryBuilder,
    range: () => queryBuilder,
    then: (onfulfilled: any, onrejected: any) =>
      Promise.resolve({ data, error }).then(onfulfilled, onrejected),
  };

  return {
    from: () => queryBuilder,
  };
}

describe('Instrument Catalog Service & Price Search', () => {
  beforeEach(() => {
    resetSupabaseClientForTesting();
  });

  it('should return real instruments with live prices from Supabase', async () => {
    const mockData = [
      {
        id: '018f2d5e-4b67-73d8-b271-9c3f0a123456',
        symbol: 'THYAO',
        company_name: 'Türk Hava Yolları',
        market: 'BIST100',
        asset_type: 'stock',
        currency: 'TRY',
        is_active: true,
        instrument_latest_prices: {
          price: 345.50,
          change_percent: 2.15,
          change_amount: 7.25,
          price_at: '2026-08-26T10:00:00Z',
          is_stale: false,
        },
      },
    ];

    setSupabaseClientForTesting(createMockSupabaseQuery(mockData));

    const result = await searchInstrumentsDetailed('THYAO', 'BIST100');

    assert.equal(result.error, null);
    assert.equal(result.items.length, 1);
    const item = result.items[0];
    assert.equal(item.id, '018f2d5e-4b67-73d8-b271-9c3f0a123456');
    assert.equal(item.symbol, 'THYAO');
    assert.equal(item.price, 345.50);
    assert.equal(item.hasPrice, true);
    assert.equal(item.isStale, false);
  });

  it('should accurately return price=null and hasPrice=false when price record is missing', async () => {
    const mockData = [
      {
        id: '018f2d5e-8888-73d8-b271-9c3f0a654321',
        symbol: 'NEWSTOCK',
        company_name: 'Yeni Halka Arz Şirketi',
        market: 'BIST100',
        asset_type: 'stock',
        currency: 'TRY',
        is_active: true,
        instrument_latest_prices: null, // No price in database yet
      },
    ];

    setSupabaseClientForTesting(createMockSupabaseQuery(mockData));

    const result = await searchInstrumentsDetailed('NEWSTOCK');

    assert.equal(result.items.length, 1);
    const item = result.items[0];
    assert.equal(item.id, '018f2d5e-8888-73d8-b271-9c3f0a654321');
    assert.equal(item.price, null, 'Price must be null, never fallback 100');
    assert.equal(item.hasPrice, false);
  });

  it('should return error when Supabase query fails without returning fake presets', async () => {
    setSupabaseClientForTesting(createMockSupabaseQuery(null, { message: 'Database connection failed' }));

    const result = await searchInstrumentsDetailed('THYAO');

    assert.notEqual(result.error, null);
    assert.equal(result.items.length, 0, 'Must NOT return fake fallback presets on error');
  });

  it('should return empty items with no error when search finds 0 results', async () => {
    setSupabaseClientForTesting(createMockSupabaseQuery([]));

    const result = await searchInstrumentsDetailed('NONEXISTENT_SYMBOL');

    assert.equal(result.error, null);
    assert.equal(result.items.length, 0);
  });

  it('should NOT generate or return fake IDs starting with "inst-" in search results', async () => {
    const mockData = [
      {
        id: 'e2b3c4d5-0000-1111-2222-333344445555',
        symbol: 'BTC',
        company_name: 'Bitcoin',
        market: 'CRYPTO',
        asset_type: 'crypto',
        currency: 'USD',
        is_active: true,
        instrument_latest_prices: {
          price: 65400.0,
          is_stale: false,
        },
      },
    ];

    setSupabaseClientForTesting(createMockSupabaseQuery(mockData));

    const items = await searchInstruments('BTC');

    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'e2b3c4d5-0000-1111-2222-333344445555');
    assert.ok(!items[0].id.startsWith('inst-'), 'IDs must not be fake inst-* strings');
  });
});
