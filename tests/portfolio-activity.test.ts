/** Portfolio calculations, validation and request behavior for the simplified model. */

import { describe, it, beforeEach, afterEach } from '@jest/globals';
import assert from 'node:assert';
import {
  setSupabaseClientForTesting,
  resetSupabaseClientForTesting,
} from '../services/supabase/client';
import {
  fetchPortfolioActivityPage,
  normalizePortfolioActivityRow,
  normalizePortfolioActivityPage,
  clearPortfolioActivityCache,
  formatPortfolioActivityRpcError,
  bumpPortfolioActivityRevision,
} from '../services/portfolio/portfolio-activity-service';
import {
  formatActivityUnitPrice,
  formatActivityDateHeader,
  formatActivityDateTime,
  formatActivityGrossAmount,
  formatActivityQuantity,
  formatActivityTime,
  getLocalDateKey,
  getActivityTypeMeta,
} from '../utils/portfolio-activity-formatters';
import {
  buildActivityQueryKey,
  resolvePortfolioActivityViewState,
  resolveQueryScopedActivityState,
  resolveUserScopedPortfolioState,
  resolveUserScopedActivityState,
  shouldAcceptPortfolioResolutionResult,
  shouldTriggerPortfolioResolution,
  canTriggerLoadMore,
  shouldAcceptLoadMoreResult,
  shouldAcceptLoadMoreFinally,
  reduceLoadMoreItems,
  buildPortfolioSubscriptionScopeKey,
  shouldAcceptPortfolioChangeNotification,
} from '../utils/portfolio-activity-view-state';
import {
  notifyPortfolioChanged,
} from '../services/portfolio/portfolio-service';
import {
  createPortfolioOperationError,
} from '../utils/portfolio-errors';
import type {
  PortfolioActivityItem,
} from '../types/portfolio-activity';

describe('Portfolio Activity Comprehensive Hardening Suite', () => {
  const defaultUserId = '550e8400-e29b-41d4-a716-446655440000';
  const defaultPortfolioId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  const validInstrumentId1 = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
  const validInstrumentId2 = '6ba7b812-9dad-11d1-80b4-00c04fd430c8';
  const validActivityId1 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const validActivityId2 = '8d0e7780-8536-41ef-a55c-f18fd2001bf8';

  beforeEach(() => {
    clearPortfolioActivityCache();
    resetSupabaseClientForTesting();
  });

  afterEach(() => {
    clearPortfolioActivityCache();
    resetSupabaseClientForTesting();
  });

  describe('Activity contract and presentation boundaries', () => {
    const date = '2026-08-31T10:00:00Z';
    const cashRow = {
      activity_id: validActivityId1,
      portfolio_id: defaultPortfolioId,
      source_kind: 'TRANSACTION',
      activity_type: 'SELL',
      instrument_id: validInstrumentId1, symbol: 'THYAO', company_name: 'THY', market: 'BIST100', quantity: 1, unit_price: 50,
      currency: 'TRY',
      gross_amount: 50,
      occurred_at: date,
      created_at: date,
      is_reversed: false,
      has_more: false,
    };
    const tradeRow = {
      ...cashRow,
      source_kind: 'TRANSACTION',
      activity_type: 'SELL',
      instrument_id: validInstrumentId1,
      symbol: 'THYAO',
      company_name: 'Turkish Airlines',
      market: 'BIST100',
      quantity: 1,
      unit_price: 50,
    };

    it('rejects malformed common fields and invalid trade amounts', () => {
      assert.throws(() => normalizePortfolioActivityRow(null), /kaydı formatı/);
      const malformed = [
        [{ activity_id: null }, /activity_id/],
        [{ portfolio_id: false }, /portfolio_id/],
        [{ source_kind: 'UNKNOWN' }, /source_kind/],
        [{ activity_type: 'TRANSFER' }, /activity_type/],
        [{ created_at: 'invalid' }, /created_at/],
        [{ gross_amount: NaN }, /gross_amount/],
        [{ gross_amount: 0 }, /gross_amount/],
        [{ currency: null }, /currency/],
        [{ currency: 'EUR' }, /currency/],
        [{ reversal_reason: 'wrong state' }, /alma nedeni bulunamaz/],
        [{ notes: false }, /not alanı/],
      ] as const;
      for (const [fields, expected] of malformed) {
        assert.throws(() => normalizePortfolioActivityRow({ ...cashRow, ...fields }), expected);
      }
      for (const value of [NaN, Infinity, -1, 0]) {
        assert.throws(() => normalizePortfolioActivityRow({ ...tradeRow, quantity: value }), /quantity/);
        assert.throws(() => normalizePortfolioActivityRow({ ...tradeRow, unit_price: value }), /unit_price/);
      }
      for (const fields of [
        { symbol: null }, { symbol: ' ' }, { company_name: null }, { company_name: ' ' }, { market: false },
      ]) {
        assert.throws(() => normalizePortfolioActivityRow({ ...tradeRow, ...fields }), /zorunludur/);
      }
    });

    it('discards oversized, malformed, or inconsistent pages', () => {
      assert.throws(() => normalizePortfolioActivityPage([cashRow, tradeRow], defaultPortfolioId, 1), /limiti|limit/);
      assert.throws(() => normalizePortfolioActivityPage([null], defaultPortfolioId), /satır yapısı/);
      assert.throws(() => normalizePortfolioActivityPage([{ ...cashRow, has_more: 0 }], defaultPortfolioId), /has_more/);
      assert.throws(() => normalizePortfolioActivityPage([
        cashRow, { ...tradeRow, has_more: true },
      ], defaultPortfolioId), /tutarsız has_more/);
      assert.throws(() => normalizePortfolioActivityPage([cashRow], validInstrumentId1), /kimliği uyuşmazlığı/);
      assert.throws(() => normalizePortfolioActivityPage([cashRow, cashRow], defaultPortfolioId), /mükerrer/);
    });

    it('preserves local dates and amounts without displaying invalid data as zero', () => {
      const local = new Date(2026, 7, 31, 9, 15);
      const nextDay = new Date(2026, 8, 1, 9, 15);
      assert.equal(getLocalDateKey(local), '2026-08-31');
      assert.equal(getLocalDateKey('invalid'), '1970-01-01');
      assert.equal(formatActivityDateHeader('invalid', nextDay), '—');
      assert.equal(formatActivityDateHeader(local, nextDay), 'Dün');
      assert.equal(formatActivityDateHeader(local, local), 'Bugün');
      assert.equal(formatActivityTime(local), '09:15');
      assert.equal(formatActivityTime('invalid'), '—');
      assert.match(formatActivityDateTime(local.toISOString()), /31 Ağustos 2026, 09:15/);
      assert.equal(formatActivityDateTime('invalid'), '—');
      for (const amount of [undefined, null, NaN, Infinity]) {
        assert.equal(formatActivityQuantity(amount), '—');
        assert.equal(formatActivityGrossAmount(amount, 'USD'), '—');
        assert.equal(formatActivityUnitPrice(amount, 'USD'), '—');
      }
      assert.equal(formatActivityGrossAmount(0, 'TRY'), '—');
      assert.equal(formatActivityQuantity(0), '0 Adet');
      assert.equal(formatActivityQuantity(0.00001234), '0,00001234 Adet');
      assert.match(formatActivityGrossAmount(12.5, 'TRY'), /12,50/);
      assert.match(formatActivityUnitPrice(12, 'TRY'), /12,00/);
      assert.equal(getActivityTypeMeta('SELL').sign, '-');
    });

    it('scopes query metadata and portfolio resolution to the current user', () => {
      const key = buildActivityQueryKey(defaultUserId, defaultPortfolioId, 'ALL', '');
      for (const [active, loaded] of [['', key], [key, null]] as const) {
        assert.equal(resolveQueryScopedActivityState(active, loaded, { items: [], hasMore: true }).hasMore, false);
      }
      const scoped = resolveQueryScopedActivityState(key, key, { items: [] });
      assert.equal(scoped.isQueryMatch, true);
      assert.equal(scoped.nextCursor, null);
      assert.equal(scoped.initialError, null);
      assert.equal(scoped.loadMoreError, null);
      assert.equal(resolveQueryScopedActivityState(key, key, []).hasMore, false);

      const portfolio = { userId: defaultUserId, portfolioId: defaultPortfolioId, portfolioName: 'My portfolio' };
      assert.equal(resolveUserScopedPortfolioState(defaultUserId, portfolio).status, 'success');
      assert.equal(resolveUserScopedPortfolioState(defaultUserId, { ...portfolio, error: 'Unavailable' }).status, 'error');
      assert.equal(resolveUserScopedPortfolioState(defaultUserId, { ...portfolio, portfolioId: null }).status, 'loading');
      for (const activeUserId of [null, ' ']) {
        const signedOut = resolveUserScopedPortfolioState(activeUserId, portfolio);
        assert.equal(signedOut.status, 'idle');
        assert.equal(signedOut.portfolioId, null);
      }
      assert.equal(resolveUserScopedPortfolioState('other-user', portfolio, false).status, 'idle');
      assert.equal(resolveUserScopedActivityState(defaultUserId, null, []).isUserMatch, false);
      assert.equal(resolveUserScopedActivityState(null, defaultUserId, []).isUserMatch, false);
    });

    it('blocks pagination independently for each unresolved loading or ownership condition', () => {
      const ready = {
        isLoadingMore: false, isLoadingInitial: false, isRefreshing: false,
        hasMore: true, hasCursor: true, hasPortfolio: true, hasUser: true, isQueryMatch: true,
      };
      assert.equal(canTriggerLoadMore(ready), true);
      for (const key of Object.keys(ready) as (keyof typeof ready)[]) {
        assert.equal(canTriggerLoadMore({ ...ready, [key]: !ready[key] }), false, key);
      }
      assert.equal(buildActivityQueryKey(null, undefined, 'ALL', ''), 'anon:none:ALL:');
      assert.equal(buildPortfolioSubscriptionScopeKey(undefined, null), 'anon:none');
      assert.equal(shouldAcceptPortfolioChangeNotification('', ''), false);
      assert.equal(shouldAcceptPortfolioChangeNotification('user:portfolio', ''), false);
      assert.equal(shouldAcceptPortfolioChangeNotification('user:none', 'user:none'), false);
    });
  });

  describe('1. Strict Fail-Closed Normalization & Data Integrity', () => {
    it('1. Rejects "false" string for is_reversed (does not coerce to true)', () => {
      assert.throws(() => {
        normalizePortfolioActivityRow({
          activity_id: validActivityId1,
          portfolio_id: defaultPortfolioId,
          source_kind: 'TRANSACTION',
          activity_type: 'BUY',
          instrument_id: validInstrumentId1,
          symbol: 'THYAO',
          company_name: 'THY',
          market: 'BIST100',
          quantity: 10,
          unit_price: 300,
          gross_amount: 3000,
          currency: 'TRY',
          occurred_at: '2026-08-31T10:00:00Z',
          created_at: '2026-08-31T10:00:01Z',
          is_reversed: 'false', // String "false"
        });
      }, /Geçersiz geri alınma durumu/);
    });

    it('2. Rejects non-boolean numbers and nulls for is_reversed', () => {
      for (const badVal of [0, 1, null, undefined, 'true', '']) {
        assert.throws(() => {
          normalizePortfolioActivityRow({
            activity_id: validActivityId1,
            portfolio_id: defaultPortfolioId,
            source_kind: 'TRANSACTION',
            activity_type: 'BUY',
            instrument_id: validInstrumentId1,
            symbol: 'THYAO',
            company_name: 'THY',
            market: 'BIST100',
            quantity: 10,
            unit_price: 300,
            gross_amount: 3000,
            currency: 'TRY',
            occurred_at: '2026-08-31T10:00:00Z',
            created_at: '2026-08-31T10:00:01Z',
            is_reversed: badVal,
          });
        }, /Geçersiz geri alınma durumu/);
      }
    });

    it('3. Rejects invalid non-UUID activity_id, portfolio_id, and instrument_id', () => {
      // Bad activity_id ("abc")
      assert.throws(() => {
        normalizePortfolioActivityRow({
          activity_id: 'abc',
          portfolio_id: defaultPortfolioId,
          source_kind: 'TRANSACTION',
          activity_type: 'BUY',
          instrument_id: validInstrumentId1, symbol: 'THYAO', company_name: 'THY', market: 'BIST100', quantity: 1, unit_price: 50,
          gross_amount: 1000,
          currency: 'TRY',
          occurred_at: '2026-08-31T10:00:00Z',
          created_at: '2026-08-31T10:00:01Z',
          is_reversed: false,
        });
      }, /Geçersiz hareket kimliği/);

      // Bad portfolio_id ("xyz")
      assert.throws(() => {
        normalizePortfolioActivityRow({
          activity_id: validActivityId1,
          portfolio_id: 'xyz',
          source_kind: 'TRANSACTION',
          activity_type: 'BUY',
          instrument_id: validInstrumentId1, symbol: 'THYAO', company_name: 'THY', market: 'BIST100', quantity: 1, unit_price: 50,
          gross_amount: 1000,
          currency: 'TRY',
          occurred_at: '2026-08-31T10:00:00Z',
          created_at: '2026-08-31T10:00:01Z',
          is_reversed: false,
        });
      }, /Geçersiz portföy kimliği/);

      // Bad instrument_id on transaction
      assert.throws(() => {
        normalizePortfolioActivityRow({
          activity_id: validActivityId1,
          portfolio_id: defaultPortfolioId,
          source_kind: 'TRANSACTION',
          activity_type: 'BUY',
          instrument_id: 'invalid-inst-id',
          symbol: 'THYAO',
          company_name: 'THY',
          market: 'BIST100',
          quantity: 10,
          unit_price: 300,
          gross_amount: 3000,
          currency: 'TRY',
          occurred_at: '2026-08-31T10:00:00Z',
          created_at: '2026-08-31T10:00:01Z',
          is_reversed: false,
        });
      }, /geçerli instrument_id zorunludur/);
    });

    it('4. Rejects "1", date-only "2026-08-31", and timestamps without timezone offset', () => {
      const badDates = ['1', '2026-08-31', '2026-08-31T10:00:00', 'invalid-date', '2026-02-30T10:00:00Z'];
      for (const badDate of badDates) {
        assert.throws(() => {
          normalizePortfolioActivityRow({
            activity_id: validActivityId1,
            portfolio_id: defaultPortfolioId,
            source_kind: 'TRANSACTION',
            activity_type: 'BUY',
          instrument_id: validInstrumentId1, symbol: 'THYAO', company_name: 'THY', market: 'BIST100', quantity: 1, unit_price: 50,
            gross_amount: 1000,
            currency: 'TRY',
            occurred_at: badDate,
            created_at: '2026-08-31T10:00:01Z',
            is_reversed: false,
          });
        }, /Geçersiz işlem tarihi/);
      }
    });

    it('5. Rejects invalid market strings (e.g. "INVALID", "BIST")', () => {
      assert.throws(() => {
        normalizePortfolioActivityRow({
          activity_id: validActivityId1,
          portfolio_id: defaultPortfolioId,
          source_kind: 'TRANSACTION',
          activity_type: 'BUY',
          instrument_id: validInstrumentId1,
          symbol: 'THYAO',
          company_name: 'THY',
          market: 'INVALID',
          quantity: 10,
          unit_price: 300,
          gross_amount: 3000,
          currency: 'TRY',
          occurred_at: '2026-08-31T10:00:00Z',
          created_at: '2026-08-31T10:00:01Z',
          is_reversed: false,
        });
      }, /geçerli piyasa \(market\) zorunludur/);
    });

    it('7. Rejects string numeric values without silent casting', () => {
      assert.throws(() => {
        normalizePortfolioActivityRow({
          activity_id: validActivityId1,
          portfolio_id: defaultPortfolioId,
          source_kind: 'TRANSACTION',
          activity_type: 'BUY',
          instrument_id: validInstrumentId1,
          symbol: 'THYAO',
          company_name: 'THY',
          market: 'BIST100',
          quantity: '10', // String instead of number
          unit_price: 300,
          gross_amount: 3000,
          currency: 'TRY',
          occurred_at: '2026-08-31T10:00:00Z',
          created_at: '2026-08-31T10:00:01Z',
          is_reversed: false,
        });
      }, /pozitif adet \(quantity\) zorunludur/);

      assert.throws(() => {
        normalizePortfolioActivityRow({
          activity_id: validActivityId1,
          portfolio_id: defaultPortfolioId,
          source_kind: 'TRANSACTION',
          activity_type: 'BUY',
          instrument_id: validInstrumentId1, symbol: 'THYAO', company_name: 'THY', market: 'BIST100', quantity: 1, unit_price: 50,
          gross_amount: '1000', // String instead of number
          currency: 'TRY',
          occurred_at: '2026-08-31T10:00:00Z',
          created_at: '2026-08-31T10:00:01Z',
          is_reversed: false,
        });
      }, /Geçersiz brüt işlem tutarı/);
    });

    it('8. Enforces reversal consistency: unreversed row cannot contain reversed_at or reversal_reason', () => {
      assert.throws(() => {
        normalizePortfolioActivityRow({
          activity_id: validActivityId1,
          portfolio_id: defaultPortfolioId,
          source_kind: 'TRANSACTION',
          activity_type: 'BUY',
          instrument_id: validInstrumentId1, symbol: 'THYAO', company_name: 'THY', market: 'BIST100', quantity: 1, unit_price: 50,
          gross_amount: 1000,
          currency: 'TRY',
          occurred_at: '2026-08-31T10:00:00Z',
          created_at: '2026-08-31T10:00:01Z',
          is_reversed: false,
          reversed_at: '2026-08-31T11:00:00Z', // Illegal when is_reversed is false
        });
      }, /Geri alınmamış işlemde geri alınma tarihi bulunamaz/);
    });
  });

  describe('2. Micro Price & Asset Label Formatting', () => {
    it('9. Micro unit price formats up to 8 decimal places without showing false zero', () => {
      const p1 = formatActivityUnitPrice(0.00000001, 'TRY');
      assert.strictEqual(p1.includes('0,00000001'), true);

      const p2 = formatActivityUnitPrice(0.00045123, 'USD');
      assert.strictEqual(p2.includes('0,00045123'), true);

      assert.strictEqual(formatActivityUnitPrice(0, 'TRY'), '—');
      assert.strictEqual(formatActivityUnitPrice(-5, 'TRY'), '—');
      assert.strictEqual(formatActivityUnitPrice(null, 'TRY'), '—');
    });

    it('10. Uses general "Varlık Alışı" and "Varlık Satışı" labels to support non-stock assets', () => {
      const buyMeta = getActivityTypeMeta('BUY');
      assert.strictEqual(buyMeta.label, 'Varlık Alışı');
      assert.strictEqual(buyMeta.shortLabel, 'Alış');

      const sellMeta = getActivityTypeMeta('SELL');
      assert.strictEqual(sellMeta.label, 'Varlık Satışı');
      assert.strictEqual(sellMeta.shortLabel, 'Satış');
    });
  });

  describe('3. Technical Error Leak Elimination', () => {
    const errorMatrix = [
      {
        code: 'P0001',
        rawMsg: 'portfolio_activity_authentication_required',
        expectedMsg: 'Portföy hareketlerini görüntülemek için oturum açılması gerekmektedir.',
      },
      {
        code: 'P0001',
        rawMsg: 'portfolio_activity_portfolio_required',
        expectedMsg: 'Geçerli bir portföy seçilmelidir.',
      },
      {
        code: 'P0001',
        rawMsg: 'portfolio_activity_not_found_or_access_denied',
        expectedMsg: 'Portföy bulunamadı veya bu portföye erişim yetkiniz yok.',
      },
      {
        code: 'P0001',
        rawMsg: 'portfolio_activity_limit_out_of_range',
        expectedMsg: 'Geçersiz sayfa boyutu belirtildi (1-100 arasında olmalıdır).',
      },
      {
        code: 'P0001',
        rawMsg: 'portfolio_activity_invalid_filter',
        expectedMsg: 'Geçersiz hareket filtresi seçildi.',
      },
      {
        code: 'P0001',
        rawMsg: 'portfolio_activity_search_too_long',
        expectedMsg: 'Arama metni çok uzun (en fazla 100 karakter olabilir).',
      },
      {
        code: 'P0001',
        rawMsg: 'portfolio_activity_incomplete_cursor',
        expectedMsg: 'Sayfalama imleci eksik veya geçersiz.',
      },
      {
        code: 'P0001',
        rawMsg: 'portfolio_activity_invalid_cursor_source',
        expectedMsg: 'Geçersiz sayfalama kaynak türü.',
      },
    ];

    for (const testCase of errorMatrix) {
      it(`11. Exact error message for ${testCase.rawMsg} contains NO technical leaks`, () => {
        const rawObj = { code: testCase.code, message: testCase.rawMsg };
        const formatted = formatPortfolioActivityRpcError(rawObj);
        const err = createPortfolioOperationError(formatted, rawObj, { userMessageIsFinal: true });

        assert.strictEqual(err.message, testCase.expectedMsg);
        assert.strictEqual(err.message.includes('portfolio_activity_'), false);
        assert.strictEqual(err.message.includes(':'), false);
        assert.strictEqual(err.isRetryable, false);
        assert.strictEqual(err.code, testCase.code);
        assert.strictEqual(err.cause, rawObj);
      });
    }

    it('12. Unknown 42501 / permission denied error produces safe localized message without technical leaks', () => {
      const rawError = {
        code: '42501',
        message: 'permission denied for function get_my_portfolio_activity',
        details: 'Failed RLS check on table portfolios for user uuid',
        hint: 'Check your policy definition',
      };
      const formatted = formatPortfolioActivityRpcError(rawError);
      const err = createPortfolioOperationError(formatted, rawError, { userMessageIsFinal: true });

      assert.strictEqual(err.message, 'Portföy bulunamadı veya bu portföye erişim yetkiniz yok.');
      assert.strictEqual(err.message.includes('42501'), false);
      assert.strictEqual(err.message.includes('permission denied'), false);
      assert.strictEqual(err.message.includes('get_my_portfolio_activity'), false);
      assert.strictEqual(err.message.includes('RLS'), false);
      assert.strictEqual(err.message.includes('policy'), false);
      assert.strictEqual(err.message.includes(':'), false);
      assert.strictEqual(err.isRetryable, false);
      assert.strictEqual(err.code, '42501');
      assert.strictEqual(err.cause, rawError);
    });

    it('13. Network transport error produces single clean message without colon-concatenated duplicate sentences', () => {
      const rawNet = new Error('TypeError: fetch failed (network timeout)');
      const formatted = formatPortfolioActivityRpcError(rawNet);
      const err = createPortfolioOperationError(formatted, rawNet, { userMessageIsFinal: true });

      assert.strictEqual(err.message, 'İnternet bağlantınızı kontrol edip tekrar deneyiniz.');
      assert.strictEqual(err.message.includes(':'), false);
      assert.strictEqual(err.isRetryable, true);
      assert.strictEqual(err.cause, rawNet);
    });

    it('14. userMessageIsFinal option guarantees Error.message is exactly the user message without modifications', () => {
      const rawError = { code: 'P0001', message: 'portfolio_activity_authentication_required' };
      const err = createPortfolioOperationError(
        'Portföy hareketlerini görüntülemek için oturum açılması gerekmektedir.',
        rawError,
        { userMessageIsFinal: true }
      );

      assert.strictEqual(err.message, 'Portföy hareketlerini görüntülemek için oturum açılması gerekmektedir.');
      assert.strictEqual(err.message.includes(':'), false);
      assert.strictEqual(err.isRetryable, false);
    });
  });

  describe('4. Deterministic Error & Retry Decision Contracts (Exact RPC Count Assertions)', () => {
    it('14. portfolio_activity_invalid_filter executes exactly 1 RPC and fails immediately without retry', async () => {
      let rpcCount = 0;
      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: defaultUserId } } },
            error: null,
          }),
        },
        rpc: async () => {
          rpcCount++;
          return {
            data: null,
            error: { code: 'P0001', message: 'portfolio_activity_invalid_filter' },
          };
        },
      };
      setSupabaseClientForTesting(mockClient);

      await assert.rejects(async () => {
        await fetchPortfolioActivityPage({
          portfolioId: defaultPortfolioId,
          filter: 'BUY',
          forceRefresh: true,
        });
      }, (err: any) => {
        assert.strictEqual(err.message, 'Geçersiz hareket filtresi seçildi.');
        assert.strictEqual(err.isRetryable, false);
        return true;
      });

      assert.strictEqual(rpcCount, 1);
    });

    it('15. Auth / Access denied error executes exactly 1 RPC and throws immediately without stale fallback', async () => {
      let rpcCount = 0;
      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: defaultUserId } } },
            error: null,
          }),
        },
        rpc: async () => {
          rpcCount++;
          return {
            data: null,
            error: { code: 'P0001', message: 'portfolio_activity_not_found_or_access_denied' },
          };
        },
      };
      setSupabaseClientForTesting(mockClient);

      await assert.rejects(async () => {
        await fetchPortfolioActivityPage({
          portfolioId: defaultPortfolioId,
          forceRefresh: true,
        });
      }, (err: any) => {
        assert.strictEqual(err.message, 'Portföy bulunamadı veya bu portföye erişim yetkiniz yok.');
        assert.strictEqual(err.isRetryable, false);
        return true;
      });

      assert.strictEqual(rpcCount, 1);
    });

    it('16. Broken normalization response executes exactly 1 RPC and throws contract error without stale fallback', async () => {
      let rpcCount = 0;
      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: defaultUserId } } },
            error: null,
          }),
        },
        rpc: async () => {
          rpcCount++;
          return {
            data: [
              {
                activity_id: 'invalid-non-uuid', // Broken!
                source_kind: 'TRANSACTION',
                activity_type: 'BUY',
          instrument_id: validInstrumentId1, symbol: 'THYAO', company_name: 'THY', market: 'BIST100', quantity: 1, unit_price: 50,
                portfolio_id: defaultPortfolioId,
                gross_amount: 1000,
                currency: 'TRY',
                occurred_at: '2026-08-31T10:00:00Z',
                created_at: '2026-08-31T10:00:01Z',
                is_reversed: false,
                has_more: false,
              },
            ],
            error: null,
          };
        },
      };
      setSupabaseClientForTesting(mockClient);

      await assert.rejects(async () => {
        await fetchPortfolioActivityPage({
          portfolioId: defaultPortfolioId,
          forceRefresh: true,
        });
      }, /Geçersiz hareket kimliği/);

      assert.strictEqual(rpcCount, 1);
    });

    it('17. Transport error with exact-query cache returns stale cache with original timestamp preserved', async () => {
      let rpcCount = 0;
      let shouldFailWithNetwork = false;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: defaultUserId } } },
            error: null,
          }),
        },
        rpc: async () => {
          rpcCount++;
          if (shouldFailWithNetwork) {
            throw new Error('TypeError: fetch failed (network timeout)');
          }
          return {
            data: [
              {
                activity_id: validActivityId1,
                source_kind: 'TRANSACTION',
                activity_type: 'BUY',
                portfolio_id: defaultPortfolioId,
                instrument_id: validInstrumentId1,
                symbol: 'THYAO',
                company_name: 'THY',
                market: 'BIST100',
                quantity: 10,
                unit_price: 300,
                gross_amount: 3000,
                currency: 'TRY',
                occurred_at: '2026-08-31T10:00:00Z',
                created_at: '2026-08-31T10:00:01Z',
                notes: null,
                is_reversed: false,
                reversed_at: null,
                reversal_reason: null,
                has_more: false,
              },
            ],
            error: null,
          };
        },
      };
      setSupabaseClientForTesting(mockClient);

      // 1. Successful initial fetch (populates cache)
      const freshResult = await fetchPortfolioActivityPage({
        portfolioId: defaultPortfolioId,
        forceRefresh: true,
      });
      assert.strictEqual(rpcCount, 1);
      assert.strictEqual(freshResult.isStale, false);
      const initialTimestamp = freshResult.timestamp;

      // 2. Background force refresh fails with transport error
      shouldFailWithNetwork = true;
      const staleResult = await fetchPortfolioActivityPage({
        portfolioId: defaultPortfolioId,
        forceRefresh: true,
      });
      assert.strictEqual(rpcCount, 2); // Only 1 attempt for this user action (not looping 3 times)
      assert.strictEqual(staleResult.isStale, true);
      assert.strictEqual(staleResult.timestamp, initialTimestamp); // Timestamp preserved!
      assert.strictEqual(staleResult.items.length, 1);

      // 3. Normal cache-hit returns stale cache with 0 new RPCs
      const cacheHit = await fetchPortfolioActivityPage({
        portfolioId: defaultPortfolioId,
        forceRefresh: false,
      });
      assert.strictEqual(rpcCount, 2); // 0 new RPC calls!
      assert.strictEqual(cacheHit.isStale, true);

      // 4. Successful retry clears stale and advances timestamp
      shouldFailWithNetwork = false;
      const retryResult = await fetchPortfolioActivityPage({
        portfolioId: defaultPortfolioId,
        forceRefresh: true,
      });
      assert.strictEqual(rpcCount, 3);
      assert.strictEqual(retryResult.isStale, false);
      assert.strictEqual(retryResult.timestamp >= initialTimestamp, true);
    });

    it('18. Continuous revision storm (3 mismatched attempts) without cache throws controlled error after exactly 3 RPCs', async () => {
      let rpcCount = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: defaultUserId } } },
            error: null,
          }),
        },
        rpc: async () => {
          rpcCount++;
          // Bump revision continuously during each RPC call
          bumpPortfolioActivityRevision(defaultPortfolioId);

          return {
            data: [
              {
                activity_id: validActivityId1,
                source_kind: 'TRANSACTION',
                activity_type: 'BUY',
                portfolio_id: defaultPortfolioId,
                instrument_id: validInstrumentId1,
                symbol: 'THYAO',
                company_name: 'THY',
                market: 'BIST100',
                quantity: 10,
                unit_price: 300,
                gross_amount: 3000,
                currency: 'TRY',
                occurred_at: '2026-08-31T10:00:00Z',
                created_at: '2026-08-31T10:00:01Z',
                notes: null,
                is_reversed: false,
                reversed_at: null,
                reversal_reason: null,
                has_more: false,
              },
            ],
            error: null,
          };
        },
      };
      setSupabaseClientForTesting(mockClient);

      await assert.rejects(async () => {
        await fetchPortfolioActivityPage({
          portfolioId: defaultPortfolioId,
          forceRefresh: true,
        });
      }, /işlem çakışması oluştu/);

      assert.strictEqual(rpcCount, 3); // Exhausted exactly 3 attempts
    });

    it('19. Continuous revision storm (3 mismatched attempts) with exact cache returns stale cache after exactly 3 RPCs', async () => {
      let rpcCount = 0;
      let simulateStorm = false;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: defaultUserId } } },
            error: null,
          }),
        },
        rpc: async () => {
          rpcCount++;
          if (simulateStorm) {
            bumpPortfolioActivityRevision(defaultPortfolioId);
          }
          return {
            data: [
              {
                activity_id: validActivityId1,
                source_kind: 'TRANSACTION',
                activity_type: 'BUY',
                portfolio_id: defaultPortfolioId,
                instrument_id: validInstrumentId1,
                symbol: 'THYAO',
                company_name: 'THY',
                market: 'BIST100',
                quantity: 10,
                unit_price: 300,
                gross_amount: 3000,
                currency: 'TRY',
                occurred_at: '2026-08-31T10:00:00Z',
                created_at: '2026-08-31T10:00:01Z',
                notes: null,
                is_reversed: false,
                reversed_at: null,
                reversal_reason: null,
                has_more: false,
              },
            ],
            error: null,
          };
        },
      };
      setSupabaseClientForTesting(mockClient);

      // Seed cache with initial fetch
      const fresh = await fetchPortfolioActivityPage({
        portfolioId: defaultPortfolioId,
        forceRefresh: true,
      });
      assert.strictEqual(rpcCount, 1);
      assert.strictEqual(fresh.isStale, false);

      // Trigger revision storm during force refresh
      simulateStorm = true;
      const staleResult = await fetchPortfolioActivityPage({
        portfolioId: defaultPortfolioId,
        forceRefresh: true,
      });

      assert.strictEqual(rpcCount, 4); // 1 initial + 3 storm attempts
      assert.strictEqual(staleResult.isStale, true);
      assert.strictEqual(staleResult.items.length, 1);
    });

    it('20. Single real mutation (notifyPortfolioChanged) during in-flight RPC triggers retry and produces exactly 2 RPC calls', async () => {
      let rpcCount = 0;
      let notifyRpc1Started!: () => void;
      const rpc1StartedPromise = new Promise<void>((resolve) => {
        notifyRpc1Started = resolve;
      });

      let resolveRpc1Deferred!: (val: any) => void;
      const rpc1Deferred = new Promise((resolve) => {
        resolveRpc1Deferred = resolve;
      });

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: defaultUserId } } },
            error: null,
          }),
        },
        rpc: async (_fnName: string, _args: any) => {
          rpcCount++;

          if (rpcCount === 1) {
            notifyRpc1Started();
            await rpc1Deferred; // Hold RPC 1
            return {
              data: [
                {
                  activity_id: validActivityId1,
                  source_kind: 'TRANSACTION',
                  activity_type: 'BUY',
                  portfolio_id: defaultPortfolioId,
                  instrument_id: validInstrumentId1,
                  symbol: 'THYAO',
                  company_name: 'THY',
                  market: 'BIST100',
                  quantity: 10,
                  unit_price: 300,
                  gross_amount: 3000,
                  currency: 'TRY',
                  occurred_at: '2026-08-31T10:00:00Z',
                  created_at: '2026-08-31T10:00:01Z',
                  notes: null,
                  is_reversed: false,
                  reversed_at: null,
                  reversal_reason: null,
                  has_more: false,
                },
              ],
              error: null,
            };
          }

          // RPC 2: Fresh post-mutation data
          return {
            data: [
              {
                activity_id: validActivityId2,
                source_kind: 'TRANSACTION',
                activity_type: 'BUY',
                portfolio_id: defaultPortfolioId,
                instrument_id: validInstrumentId2,
                symbol: 'GARAN',
                company_name: 'Garanti BBVA',
                market: 'BIST100',
                quantity: 50,
                unit_price: 110,
                gross_amount: 5500,
                currency: 'TRY',
                occurred_at: '2026-08-31T11:00:00Z',
                created_at: '2026-08-31T11:00:01Z',
                notes: null,
                is_reversed: false,
                reversed_at: null,
                reversal_reason: null,
                has_more: false,
              },
            ],
            error: null,
          };
        },
      };

      setSupabaseClientForTesting(mockClient);

      const fetchPromise = fetchPortfolioActivityPage({
        portfolioId: defaultPortfolioId,
        forceRefresh: true,
      });

      await rpc1StartedPromise;
      notifyPortfolioChanged();
      resolveRpc1Deferred(null);

      const result = await fetchPromise;

      assert.strictEqual(rpcCount, 2); // Exactly 2 RPC calls executed!
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].symbol, 'GARAN');
      assert.strictEqual(result.isStale, false);
    });

    it('21. limit=10 and limit=20 requests are fetched and cached independently via distinct RPCs', async () => {
      let rpcCount = 0;
      const requestedLimits: number[] = [];

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: defaultUserId } } },
            error: null,
          }),
        },
        rpc: async (_fnName: string, args: any) => {
          rpcCount++;
          requestedLimits.push(args.p_limit);
          return {
            data: [
              {
                activity_id: validActivityId1,
                source_kind: 'TRANSACTION',
                activity_type: 'BUY',
                portfolio_id: defaultPortfolioId,
                instrument_id: validInstrumentId1,
                symbol: 'THYAO',
                company_name: 'THY',
                market: 'BIST100',
                quantity: 10,
                unit_price: 300,
                gross_amount: 3000,
                currency: 'TRY',
                occurred_at: '2026-08-31T10:00:00Z',
                created_at: '2026-08-31T10:00:01Z',
                notes: null,
                is_reversed: false,
                reversed_at: null,
                reversal_reason: null,
                has_more: false,
              },
            ],
            error: null,
          };
        },
      };
      setSupabaseClientForTesting(mockClient);

      // Fetch with limit=10
      await fetchPortfolioActivityPage({
        portfolioId: defaultPortfolioId,
        limit: 10,
        forceRefresh: false,
      });
      assert.strictEqual(rpcCount, 1);
      assert.strictEqual(requestedLimits[0], 10);

      // Fetch with limit=20 -> MUST trigger a separate RPC call (not served from limit=10 cache)
      await fetchPortfolioActivityPage({
        portfolioId: defaultPortfolioId,
        limit: 20,
        forceRefresh: false,
      });
      assert.strictEqual(rpcCount, 2);
      assert.strictEqual(requestedLimits[1], 20);
    });
  });

  describe('5. Active Query Identity & Full Metadata Scoping (Zero-Frame Isolation)', () => {
    const mockItem: PortfolioActivityItem = {
      activityId: validActivityId1,
      sourceKind: 'TRANSACTION',
      activityType: 'BUY',
      portfolioId: defaultPortfolioId,
      instrumentId: validInstrumentId1,
      symbol: 'THYAO',
      companyName: 'Türk Hava Yolları',
      market: 'BIST100',
      quantity: 10,
      unitPrice: 300,
      grossAmount: 3000,
      currency: 'TRY',
      occurredAt: '2026-08-31T10:00:00Z',
      createdAt: '2026-08-31T10:00:01Z',
      notes: null,
      isReversed: false,
      reversedAt: null,
      reversalReason: null,
      compositeKey: `TRANSACTION:${validActivityId1}`,
    };

    it('22. ALL -> BUY filter switch immediately returns empty items and clears previous error/stale metadata on the first render frame', () => {
      const queryALL = buildActivityQueryKey(defaultUserId, defaultPortfolioId, 'ALL', '');
      const queryBUY = buildActivityQueryKey(defaultUserId, defaultPortfolioId, 'BUY', '');

      // Initially loaded for ALL with stale banner and loadMoreError
      const loadedALL = resolveQueryScopedActivityState(queryALL, queryALL, {
        items: [mockItem],
        hasMore: true,
        isStale: true,
        initialError: null,
        loadMoreError: 'Ağ hatası',
      });
      assert.strictEqual(loadedALL.isQueryMatch, true);
      assert.strictEqual(loadedALL.items.length, 1);
      assert.strictEqual(loadedALL.isStale, true);
      assert.strictEqual(loadedALL.loadMoreError, 'Ağ hatası');

      // User switches to BUY -> render frame evaluates with queryBUY while loadedQueryKey is still queryALL
      const switchedToBUY = resolveQueryScopedActivityState(queryBUY, queryALL, {
        items: [mockItem],
        hasMore: true,
        isStale: true,
        initialError: null,
        loadMoreError: 'Ağ hatası',
      });
      assert.strictEqual(switchedToBUY.isQueryMatch, false);
      assert.strictEqual(switchedToBUY.items.length, 0);
      assert.strictEqual(switchedToBUY.sections.length, 0);
      assert.strictEqual(switchedToBUY.isStale, false); // NO stale banner leak!
      assert.strictEqual(switchedToBUY.loadMoreError, null); // NO error leak!
      assert.strictEqual(switchedToBUY.hasMore, false);
    });

    it('23. Portfolio A -> Portfolio B (same user) provides instant zero-frame data isolation', () => {
      const portA = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
      const portB = '7cb8c920-0eae-22e2-91c5-11d15fe541d9';

      const keyA = buildActivityQueryKey(defaultUserId, portA, 'ALL', '');
      const keyB = buildActivityQueryKey(defaultUserId, portB, 'ALL', '');

      const scopedB = resolveQueryScopedActivityState(keyB, keyA, [mockItem]);
      assert.strictEqual(scopedB.isQueryMatch, false);
      assert.strictEqual(scopedB.items.length, 0);
    });

    it('24. User A -> User B provides instant zero-frame data isolation', () => {
      const userA = '550e8400-e29b-41d4-a716-446655440000';
      const userB = '660e8400-e29b-41d4-a716-446655440000';

      const keyA = buildActivityQueryKey(userA, defaultPortfolioId, 'ALL', '');
      const keyB = buildActivityQueryKey(userB, defaultPortfolioId, 'ALL', '');

      const scopedB = resolveQueryScopedActivityState(keyB, keyA, [mockItem]);
      assert.strictEqual(scopedB.isQueryMatch, false);
      assert.strictEqual(scopedB.items.length, 0);

      const scopedUser = resolveUserScopedActivityState(userA, userB, [mockItem]);
      assert.strictEqual(scopedUser.isUserMatch, false);
      assert.strictEqual(scopedUser.items.length, 0);
    });

    it('25. Search query transition THYAO -> AAPL provides instant zero-frame isolation', () => {
      const keyTHYAO = buildActivityQueryKey(defaultUserId, defaultPortfolioId, 'ALL', 'THYAO');
      const keyAAPL = buildActivityQueryKey(defaultUserId, defaultPortfolioId, 'ALL', 'AAPL');

      const scopedAAPL = resolveQueryScopedActivityState(keyAAPL, keyTHYAO, [mockItem]);
      assert.strictEqual(scopedAAPL.isQueryMatch, false);
      assert.strictEqual(scopedAAPL.items.length, 0);
    });

    it('26. Failed new filter query resolves to initial_error (not masked as filtered_empty or stale data)', () => {
      const state = resolvePortfolioActivityViewState({
        isAuthReady: true,
        hasAuthUser: true,
        hasPortfolio: true,
        isActiveQueryLoaded: false, // New query not yet successfully loaded
        isLoadingInitial: false,
        isRefreshing: false,
        isLoadingMore: false,
        initialError: 'Sunucuya bağlanılamadı.',
        isStale: false,
        itemCount: 0,
        activeFilter: 'BUY',
        searchQuery: '',
      });

      assert.strictEqual(state, 'initial_error');
    });

    it('27. Background refresh failure of the SAME query retains previous data and resolves to stale_data', () => {
      const state = resolvePortfolioActivityViewState({
        isAuthReady: true,
        hasAuthUser: true,
        hasPortfolio: true,
        isActiveQueryLoaded: true, // Same query was previously loaded!
        isLoadingInitial: false,
        isRefreshing: false,
        isLoadingMore: false,
        isStale: true,
        itemCount: 5,
        activeFilter: 'ALL',
        searchQuery: '',
      });

      assert.strictEqual(state, 'stale_data');
    });
  });

  describe('6. Portfolio Resolution Async Race, Lifecycle & User Scoping', () => {
    it('28a. Resolution Trigger: User A resolved -> User B becomes active -> shouldTriggerPortfolioResolution returns true', () => {
      const userA = '550e8400-e29b-41d4-a716-446655440000';
      const userB = '660e8400-e29b-41d4-a716-446655440000';

      const shouldTrigger = shouldTriggerPortfolioResolution({
        isAuthReady: true,
        activeUserId: userB,
        currentResolutionUserId: userA,
        currentResolutionStatus: 'success',
      });

      assert.strictEqual(shouldTrigger, true);
    });

    it('28b. Deduplication: Same User A render does NOT trigger redundant second resolution', () => {
      const userA = '550e8400-e29b-41d4-a716-446655440000';

      const triggerWhenSuccess = shouldTriggerPortfolioResolution({
        isAuthReady: true,
        activeUserId: userA,
        currentResolutionUserId: userA,
        currentResolutionStatus: 'success',
      });
      assert.strictEqual(triggerWhenSuccess, false);

      const triggerWhenLoading = shouldTriggerPortfolioResolution({
        isAuthReady: true,
        activeUserId: userA,
        currentResolutionUserId: userA,
        currentResolutionStatus: 'loading',
      });
      assert.strictEqual(triggerWhenLoading, false);
    });

    it('28c. Real Async Transition: User A request pending -> User B switches -> B request actually initiated to backend', async () => {
      const userA = '550e8400-e29b-41d4-a716-446655440000';
      const userB = '660e8400-e29b-41d4-a716-446655440000';
      const portA = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
      const portB = '7cb8c920-0eae-22e2-91c5-11d15fe541d9';

      const resolutionCallOrder: string[] = [];

      // Mock ensureDefaultPortfolio backend function
      let resolveUserAPromise!: (val: any) => void;
      const userAPromise = new Promise<any>((resolve) => {
        resolveUserAPromise = resolve;
      });

      const mockEnsureDefaultPortfolio = async (userId: string) => {
        resolutionCallOrder.push(userId);
        if (userId === userA) {
          return await userAPromise;
        }
        return { id: portB, name: 'User B Portföyü' };
      };

      // 1. User A starts resolution
      let currentActiveUserId: string | null = userA;
      let activeToken = 1;
      const tokenA = activeToken;
      const requestUserIdA = userA;

      const pA = mockEnsureDefaultPortfolio(requestUserIdA);

      // 2. User switches to B -> token incremented immediately in cleanup effect
      currentActiveUserId = userB;
      activeToken++; // Token 2
      const tokenB = activeToken;
      const requestUserIdB = userB;

      // 3. User B resolution is actually triggered
      const pB = mockEnsureDefaultPortfolio(requestUserIdB);
      const resB = await pB;

      assert.strictEqual(resolutionCallOrder.length, 2);
      assert.strictEqual(resolutionCallOrder[0], userA);
      assert.strictEqual(resolutionCallOrder[1], userB);

      const canAcceptB = shouldAcceptPortfolioResolutionResult({
        isMounted: true,
        requestToken: tokenB,
        activeToken,
        requestUserId: requestUserIdB,
        currentActiveUserId,
      });
      assert.strictEqual(canAcceptB, true);
      assert.strictEqual(resB.id, portB);

      // 4. User A finishes late
      resolveUserAPromise({ id: portA, name: 'User A Portföyü' });
      await pA;

      const canAcceptA = shouldAcceptPortfolioResolutionResult({
        isMounted: true,
        requestToken: tokenA,
        activeToken,
        requestUserId: requestUserIdA,
        currentActiveUserId,
      });
      assert.strictEqual(canAcceptA, false);
    });

    it('28d. Real Async Race: User A deferred starts -> switches to User B -> B succeeds -> A succeeds late -> final state strictly belongs to B', async () => {
      const userA = '550e8400-e29b-41d4-a716-446655440000';
      const userB = '660e8400-e29b-41d4-a716-446655440000';
      const portA = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
      const portB = '7cb8c920-0eae-22e2-91c5-11d15fe541d9';

      let currentActiveUserId: string | null = userA;
      let activeToken = 1;
      let isResolving = true;
      let resolvedState: { userId: string | null; portfolioId: string | null; portfolioName: string | null } = {
        userId: null,
        portfolioId: null,
        portfolioName: null,
      };

      // 1. User A deferred request starts with token 1
      let resolveUserAPromise!: (val: any) => void;
      const userAPromise = new Promise<any>((resolve) => {
        resolveUserAPromise = resolve;
      });
      const tokenA = activeToken;
      const requestUserIdA = userA;

      // 2. User switches to B -> token incremented immediately in cleanup
      currentActiveUserId = userB;
      activeToken++; // Token 2
      const tokenB = activeToken;
      const requestUserIdB = userB;

      // 3. User B request runs and completes
      const portfolioB = { id: portB, name: 'User B Portföyü' };
      const canAcceptB = shouldAcceptPortfolioResolutionResult({
        isMounted: true,
        requestToken: tokenB,
        activeToken,
        requestUserId: requestUserIdB,
        currentActiveUserId,
      });
      assert.strictEqual(canAcceptB, true);
      resolvedState = { userId: userB, portfolioId: portfolioB.id, portfolioName: portfolioB.name };
      isResolving = false;

      // 4. User A request resolves late
      resolveUserAPromise({ id: portA, name: 'User A Portföyü' });
      const portfolioA = await userAPromise;

      const canAcceptA = shouldAcceptPortfolioResolutionResult({
        isMounted: true,
        requestToken: tokenA,
        activeToken,
        requestUserId: requestUserIdA,
        currentActiveUserId,
      });

      // Assert A is strictly rejected!
      assert.strictEqual(canAcceptA, false);

      if (canAcceptA) {
        resolvedState = { userId: userA, portfolioId: portfolioA.id, portfolioName: portfolioA.name };
      }

      // 5. Final state belongs strictly to User B
      assert.strictEqual(resolvedState.userId, userB);
      assert.strictEqual(resolvedState.portfolioId, portB);
      assert.strictEqual(resolvedState.portfolioName, 'User B Portföyü');
      assert.strictEqual(isResolving, false);
    });

    it('28e. User A error state -> User B first render: User A error is invisible, User B is loading', () => {
      const userA = '550e8400-e29b-41d4-a716-446655440000';
      const userB = '660e8400-e29b-41d4-a716-446655440000';

      const stateBelongingToA = {
        status: 'error' as const,
        userId: userA,
        portfolioId: null,
        portfolioName: null,
        error: 'Portföy bilgisi alınamadı. Lütfen tekrar deneyiniz.',
      };

      // Render frame when User B becomes active
      const scopedForB = resolveUserScopedPortfolioState(userB, stateBelongingToA, true);
      assert.strictEqual(scopedForB.isUserMatch, false);
      assert.strictEqual(scopedForB.portfolioId, null);
      assert.strictEqual(scopedForB.portfolioName, null);
      assert.strictEqual(scopedForB.error, null); // A's error is 100% hidden!
      assert.strictEqual(scopedForB.isResolvingPortfolio, true); // B is in loading!
      assert.strictEqual(scopedForB.status, 'loading');

      const viewState = resolvePortfolioActivityViewState({
        isAuthReady: true,
        hasAuthUser: true,
        hasPortfolio: false,
        isResolvingPortfolio: scopedForB.isResolvingPortfolio,
        portfolioResolutionError: scopedForB.error,
        isActiveQueryLoaded: false,
        isLoadingInitial: true,
        isRefreshing: false,
        isLoadingMore: false,
        isStale: false,
        itemCount: 0,
        activeFilter: 'ALL',
        searchQuery: '',
      });

      assert.strictEqual(viewState, 'initial_loading');
    });

    it('28f. Custom portfolio + user change is properly scoped', () => {
      const userA = '550e8400-e29b-41d4-a716-446655440000';
      const userB = '660e8400-e29b-41d4-a716-446655440000';
      const customPortId = 'custom-port-uuid-123';

      const customStateA = {
        status: 'success' as const,
        userId: userA,
        portfolioId: customPortId,
        portfolioName: 'Seçili Portföy',
        error: null,
      };

      // Before User B resolution updates state:
      const scopedBeforeB = resolveUserScopedPortfolioState(userB, customStateA, true);
      assert.strictEqual(scopedBeforeB.isUserMatch, false);
      assert.strictEqual(scopedBeforeB.portfolioId, null);

      // Once hook sets state for User B:
      const customStateB = {
        status: 'success' as const,
        userId: userB,
        portfolioId: customPortId,
        portfolioName: 'Seçili Portföy',
        error: null,
      };
      const scopedAfterB = resolveUserScopedPortfolioState(userB, customStateB, true);
      assert.strictEqual(scopedAfterB.isUserMatch, true);
      assert.strictEqual(scopedAfterB.portfolioId, customPortId);
      assert.strictEqual(scopedAfterB.portfolioName, 'Seçili Portföy');
    });

    it('29. isResolvingPortfolio resolves to initial_loading while portfolio is being fetched', () => {
      const state = resolvePortfolioActivityViewState({
        isAuthReady: true,
        hasAuthUser: true,
        hasPortfolio: false,
        isResolvingPortfolio: true,
        isActiveQueryLoaded: false,
        isLoadingInitial: true,
        isRefreshing: false,
        isLoadingMore: false,
        isStale: false,
        itemCount: 0,
        activeFilter: 'ALL',
        searchQuery: '',
      });

      assert.strictEqual(state, 'initial_loading');
    });

    it('30. portfolioResolutionError resolves to initial_error (not auth_failed)', () => {
      const state = resolvePortfolioActivityViewState({
        isAuthReady: true,
        hasAuthUser: true,
        hasPortfolio: false,
        isResolvingPortfolio: false,
        portfolioResolutionError: 'Portföy bilgisi alınamadı.',
        isActiveQueryLoaded: false,
        isLoadingInitial: false,
        isRefreshing: false,
        isLoadingMore: false,
        isStale: false,
        itemCount: 0,
        activeFilter: 'ALL',
        searchQuery: '',
      });

      assert.strictEqual(state, 'initial_error');
    });

    it('31. authError / unauthenticated user resolves strictly to auth_failed', () => {
      const state = resolvePortfolioActivityViewState({
        isAuthReady: true,
        hasAuthUser: false,
        authError: 'Oturum açılmadı',
        hasPortfolio: false,
        isActiveQueryLoaded: false,
        isLoadingInitial: false,
        isRefreshing: false,
        isLoadingMore: false,
        isStale: false,
        itemCount: 0,
        activeFilter: 'ALL',
        searchQuery: '',
      });

      assert.strictEqual(state, 'auth_failed');
    });
  });

  describe('7. Keyset Pagination, Tie-Breaking & Read-Only Invariants', () => {
    it('32. First page sends null cursor fields; second page passes 4-part tuple cursor', async () => {
      const rpcCalls: any[] = [];

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: defaultUserId } } },
            error: null,
          }),
        },
        rpc: async (_fnName: string, args: any) => {
          rpcCalls.push(args);
          if (rpcCalls.length === 1) {
            return {
              data: [
                {
                  activity_id: validActivityId1,
                  source_kind: 'TRANSACTION',
                  activity_type: 'BUY',
                  portfolio_id: defaultPortfolioId,
                  instrument_id: validInstrumentId1,
                  symbol: 'THYAO',
                  company_name: 'THY',
                  market: 'BIST100',
                  quantity: 10,
                  unit_price: 300,
                  gross_amount: 3000,
                  currency: 'TRY',
                  occurred_at: '2026-08-31T10:00:00Z',
                  created_at: '2026-08-31T10:00:01Z',
                  notes: null,
                  is_reversed: false,
                  reversed_at: null,
                  reversal_reason: null,
                  has_more: true,
                },
              ],
              error: null,
            };
          }
          return {
            data: [
              {
                activity_id: validActivityId2,
                source_kind: 'TRANSACTION',
                activity_type: 'BUY',
                portfolio_id: defaultPortfolioId,
                instrument_id: validInstrumentId1,
                symbol: 'THYAO',
                company_name: 'THY',
                market: 'BIST100',
                quantity: 1,
                unit_price: 50,
                gross_amount: 5000,
                currency: 'TRY',
                occurred_at: '2026-08-30T15:00:00Z',
                created_at: '2026-08-30T15:00:01Z',
                notes: null,
                is_reversed: false,
                reversed_at: null,
                reversal_reason: null,
                has_more: false,
              },
            ],
            error: null,
          };
        },
      };

      setSupabaseClientForTesting(mockClient);

      const p1 = await fetchPortfolioActivityPage({
        portfolioId: defaultPortfolioId,
        forceRefresh: true,
      });

      assert.strictEqual(rpcCalls[0].p_before_occurred_at, null);
      assert.strictEqual(rpcCalls[0].p_before_created_at, null);
      assert.strictEqual(rpcCalls[0].p_before_source_kind, null);
      assert.strictEqual(rpcCalls[0].p_before_activity_id, null);

      await fetchPortfolioActivityPage({
        portfolioId: defaultPortfolioId,
        cursor: p1.nextCursor,
      });

      assert.strictEqual(rpcCalls[1].p_before_occurred_at, '2026-08-31T10:00:00Z');
      assert.strictEqual(rpcCalls[1].p_before_created_at, '2026-08-31T10:00:01Z');
      assert.strictEqual(rpcCalls[1].p_before_source_kind, 'TRANSACTION');
      assert.strictEqual(rpcCalls[1].p_before_activity_id, validActivityId1);
    });

    it('33. Read-only safety invariant: never invokes mutation RPCs', async () => {
      const invokedRpcNames: string[] = [];

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: defaultUserId } } },
            error: null,
          }),
        },
        rpc: async (fnName: string) => {
          invokedRpcNames.push(fnName);
          return { data: [], error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      await fetchPortfolioActivityPage({
        portfolioId: defaultPortfolioId,
        forceRefresh: true,
      });

      assert.strictEqual(invokedRpcNames.length, 1);
      assert.strictEqual(invokedRpcNames[0], 'get_my_portfolio_activity');
      assert.strictEqual(invokedRpcNames.includes('record_portfolio_transaction'), false);
      assert.strictEqual(invokedRpcNames.includes('reverse_portfolio_transaction'), false);
      assert.strictEqual(invokedRpcNames.includes('reset_my_investments'), false);
    });
  });

  describe('8. Concurrency, In-Flight Promise Guard & Subscription Stability', () => {
    it('34. Generation-safe in-flight cleanup: Request 1 old finally does NOT delete Request 2; Request 3 joins Request 2 (Total RPCs = exactly 2)', async () => {
      let rpcCount = 0;

      let notifyRpc1Started!: () => void;
      const rpc1StartedPromise = new Promise<void>((resolve) => {
        notifyRpc1Started = resolve;
      });

      let resolveRpc1Deferred!: () => void;
      const rpc1Deferred = new Promise<void>((resolve) => {
        resolveRpc1Deferred = resolve;
      });

      let notifyRpc2Started!: () => void;
      const rpc2StartedPromise = new Promise<void>((resolve) => {
        notifyRpc2Started = resolve;
      });

      let resolveRpc2Deferred!: () => void;
      const rpc2Deferred = new Promise<void>((resolve) => {
        resolveRpc2Deferred = resolve;
      });

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: defaultUserId } } },
            error: null,
          }),
        },
        rpc: async () => {
          rpcCount++;
          if (rpcCount === 1) {
            notifyRpc1Started();
            await rpc1Deferred;
            return {
              data: [
                {
                  activity_id: validActivityId1,
                  source_kind: 'TRANSACTION',
                  activity_type: 'BUY',
                  portfolio_id: defaultPortfolioId,
                  instrument_id: validInstrumentId1,
                  symbol: 'THYAO',
                  company_name: 'THY',
                  market: 'BIST100',
                  quantity: 10,
                  unit_price: 300,
                  gross_amount: 3000,
                  currency: 'TRY',
                  occurred_at: '2026-08-31T10:00:00Z',
                  created_at: '2026-08-31T10:00:01Z',
                  notes: null,
                  is_reversed: false,
                  reversed_at: null,
                  reversal_reason: null,
                  has_more: false,
                },
              ],
              error: null,
            };
          }

          // RPC 2
          notifyRpc2Started();
          await rpc2Deferred;
          return {
            data: [
              {
                activity_id: validActivityId2,
                source_kind: 'TRANSACTION',
                activity_type: 'BUY',
                portfolio_id: defaultPortfolioId,
                instrument_id: validInstrumentId2,
                symbol: 'GARAN',
                company_name: 'Garanti',
                market: 'BIST100',
                quantity: 20,
                unit_price: 110,
                gross_amount: 2200,
                currency: 'TRY',
                occurred_at: '2026-08-31T11:00:00Z',
                created_at: '2026-08-31T11:00:01Z',
                notes: null,
                is_reversed: false,
                reversed_at: null,
                reversal_reason: null,
                has_more: false,
              },
            ],
            error: null,
          };
        },
      };

      setSupabaseClientForTesting(mockClient);

      // 1. Request 1 starts and stays pending
      const p1 = fetchPortfolioActivityPage({
        portfolioId: defaultPortfolioId,
        forceRefresh: true,
      });
      await rpc1StartedPromise;
      assert.strictEqual(rpcCount, 1);

      // 2. Cache/in-flight cleared
      clearPortfolioActivityCache();

      // 3. Request 2 starts and stays pending
      const p2 = fetchPortfolioActivityPage({
        portfolioId: defaultPortfolioId,
        forceRefresh: true,
      });
      await rpc2StartedPromise;
      assert.strictEqual(rpcCount, 2);

      // 4. Request 1 completes -> its old finally executes
      resolveRpc1Deferred();
      const res1 = await p1;
      assert.strictEqual(res1.items[0].symbol, 'THYAO');

      // 5. Request 3 is initiated with the same cache key
      // It MUST join Request 2's existing in-flight Promise without issuing a 3rd RPC!
      const p3 = fetchPortfolioActivityPage({
        portfolioId: defaultPortfolioId,
        forceRefresh: false,
      });

      // Assert total RPC count is STILL strictly 2!
      assert.strictEqual(rpcCount, 2);

      // 6. Release Request 2
      resolveRpc2Deferred();
      const [res2, res3] = await Promise.all([p2, p3]);

      // Both Request 2 and Request 3 resolve with the exact same data from RPC 2
      assert.strictEqual(res2.items[0].symbol, 'GARAN');
      assert.strictEqual(res3.items[0].symbol, 'GARAN');
      assert.strictEqual(rpcCount, 2);
    });

    it('35. Live activeQueryKeyRef load-more race: ALL load-more pending -> filter switch to BUY -> live query is BUY -> old ALL result rejected', () => {
      const activeUser = defaultUserId;
      const activePortfolio = defaultPortfolioId;

      const queryALL = buildActivityQueryKey(activeUser, activePortfolio, 'ALL', '');
      const queryBUY = buildActivityQueryKey(activeUser, activePortfolio, 'BUY', '');

      let activeToken = 1;
      const activeQueryKeyRef = { current: queryALL };

      // 1. ALL load-more begins with token 1
      const requestToken = activeToken;
      const requestQueryKey = queryALL;

      // 2. User switches filter to BUY -> render immediately updates activeQueryKeyRef & bumps token
      activeToken++; // Token 2
      activeQueryKeyRef.current = queryBUY;

      // 3. ALL load-more response arrives
      const canAccept = shouldAcceptLoadMoreResult({
        requestToken,
        activeToken,
        requestQueryKey,
        activeQueryKey: activeQueryKeyRef.current,
      });

      // Assert: Result is strictly rejected on the live ref!
      assert.strictEqual(canAccept, false);
    });

    it('36. Live activeQueryKeyRef load-more race: Search THYAO load-more pending -> search becomes AAPL -> old THYAO result rejected', () => {
      const activeUser = defaultUserId;
      const activePortfolio = defaultPortfolioId;

      const queryTHYAO = buildActivityQueryKey(activeUser, activePortfolio, 'ALL', 'thyao');
      const queryAAPL = buildActivityQueryKey(activeUser, activePortfolio, 'ALL', 'aapl');

      let activeToken = 1;
      const activeQueryKeyRef = { current: queryTHYAO };

      // 1. Search THYAO load-more starts
      const requestToken = activeToken;
      const requestQueryKey = queryTHYAO;

      // 2. Search input updates to AAPL -> render immediately updates activeQueryKeyRef & bumps token
      activeToken++; // Token 2
      activeQueryKeyRef.current = queryAAPL;

      // 3. THYAO load-more response arrives
      const canAccept = shouldAcceptLoadMoreResult({
        requestToken,
        activeToken,
        requestQueryKey,
        activeQueryKey: activeQueryKeyRef.current,
      });

      assert.strictEqual(canAccept, false);
    });

    it('37. Load-More finally safety: Old load-more finally does NOT close new query loading state', () => {
      let activeToken = 1;

      // Request 1 starts
      const requestToken = activeToken;

      // User initiates new query / load-more
      activeToken++; // Token 2

      // Request 1 finally executes
      const canClose = shouldAcceptLoadMoreFinally(requestToken, activeToken);
      assert.strictEqual(canClose, false);
    });

    it('38. Load-More concurrency guard: Double onEndReached in same tick produces exactly 1 trigger', () => {
      const state = {
        isLoadingMore: false,
        isLoadingInitial: false,
        isRefreshing: false,
        hasMore: true,
        hasCursor: true,
        hasPortfolio: true,
        hasUser: true,
        isQueryMatch: true,
      };

      // Call 1
      const trigger1 = canTriggerLoadMore(state);
      assert.strictEqual(trigger1, true);

      // Mutate state to loading
      state.isLoadingMore = true;

      // Call 2 (in same tick or before Call 1 finishes)
      const trigger2 = canTriggerLoadMore(state);
      assert.strictEqual(trigger2, false);
    });

    it('39. Load-More empty guard: hasMore=false produces 0 triggers', () => {
      const trigger = canTriggerLoadMore({
        isLoadingMore: false,
        isLoadingInitial: false,
        isRefreshing: false,
        hasMore: false, // No more pages!
        hasCursor: false,
        hasPortfolio: true,
        hasUser: true,
        isQueryMatch: true,
      });

      assert.strictEqual(trigger, false);
    });

    it('40. Load-More item reducer: reduceLoadMoreItems appends only unique items by compositeKey', () => {
      const item1: PortfolioActivityItem = {
        activityId: validActivityId1,
        sourceKind: 'TRANSACTION',
        activityType: 'BUY',
        portfolioId: defaultPortfolioId,
        instrumentId: validInstrumentId1,
        symbol: 'THYAO',
        companyName: 'THY',
        market: 'BIST100',
        quantity: 10,
        unitPrice: 300,
        grossAmount: 3000,
        currency: 'TRY',
        occurredAt: '2026-08-31T10:00:00Z',
        createdAt: '2026-08-31T10:00:01Z',
        notes: null,
        isReversed: false,
        reversedAt: null,
        reversalReason: null,
        compositeKey: `TRANSACTION:${validActivityId1}`,
      };

      const item2: PortfolioActivityItem = {
        ...item1,
        activityId: validActivityId2,
        symbol: 'GARAN',
        compositeKey: `TRANSACTION:${validActivityId2}`,
      };

      const combined = reduceLoadMoreItems([item1], [item1, item2]);
      assert.strictEqual(combined.length, 2);
      assert.strictEqual(combined[0].activityId, validActivityId1);
      assert.strictEqual(combined[1].activityId, validActivityId2);
    });

    it('41. Subscription Scope Stability: Same user and portfolio maintains identical scope key across filter & search changes', () => {
      const userA = defaultUserId;
      const portA = defaultPortfolioId;

      // Base scope
      const baseScopeKey = buildPortfolioSubscriptionScopeKey(userA, portA);
      assert.strictEqual(baseScopeKey, `${userA}:${portA}`);

      // Filter changes ALL -> BUY -> SELL (scope key remains unchanged!)
      const buyFilterScopeKey = buildPortfolioSubscriptionScopeKey(userA, portA);
      assert.strictEqual(buyFilterScopeKey, baseScopeKey);

      // Search changes "" -> "THYAO" (scope key remains unchanged!)
      const searchScopeKey = buildPortfolioSubscriptionScopeKey(userA, portA);
      assert.strictEqual(searchScopeKey, baseScopeKey);
    });

    it('42. Subscription Scope Switching & Stale Notification Rejection: Port or User switch creates new scope and rejects old callbacks', () => {
      const userA = '550e8400-e29b-41d4-a716-446655440000';
      const userB = '660e8400-e29b-41d4-a716-446655440000';
      const portA = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
      const portB = '7cb8c920-0eae-22e2-91c5-11d15fe541d9';

      const scopeA = buildPortfolioSubscriptionScopeKey(userA, portA);
      const scopeB = buildPortfolioSubscriptionScopeKey(userA, portB);
      const scopeUserB = buildPortfolioSubscriptionScopeKey(userB, portB);

      // 1. Different portfolios produce different scope keys
      assert.notStrictEqual(scopeA, scopeB);

      // 2. Different users produce different scope keys
      assert.notStrictEqual(scopeB, scopeUserB);

      // 3. Stale Port A notification arriving when Port B is active is strictly rejected
      const canAcceptStalePortA = shouldAcceptPortfolioChangeNotification(scopeA, scopeB);
      assert.strictEqual(canAcceptStalePortA, false);

      // 4. Stale User A notification arriving when User B is active is strictly rejected
      const canAcceptStaleUserA = shouldAcceptPortfolioChangeNotification(scopeB, scopeUserB);
      assert.strictEqual(canAcceptStaleUserA, false);

      // 5. Valid matching notification for active scope is accepted
      const canAcceptValid = shouldAcceptPortfolioChangeNotification(scopeUserB, scopeUserB);
      assert.strictEqual(canAcceptValid, true);
    });
  });
});
