import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTradingSession,
  formatEventTime,
  fetchMonthlyCalendarEvents,
  clearCalendarCache,
} from '../services/calendar/calendar-service';
import { getSupabaseClient } from '../services/supabase/client';

describe('Calendar Service & Event Formatting', () => {
  beforeEach(() => {
    clearCalendarCache();
  });

  it('should format trading session into user-friendly Turkish labels', () => {
    assert.equal(formatTradingSession('pre_market'), 'Seans Öncesi');
    assert.equal(formatTradingSession('after_hours'), 'Kapanış Sonrası');
    assert.equal(formatTradingSession('time_not_supplied'), 'Gün Boyu');
    assert.equal(formatTradingSession(null), 'Gün Boyu');
    assert.equal(formatTradingSession(undefined), 'Gün Boyu');
  });

  it('should format event time from ISO string to HH:mm or return Gün Boyu', () => {
    assert.equal(formatEventTime('2026-08-19T14:30:00Z'), new Date('2026-08-19T14:30:00Z').getHours().toString().padStart(2, '0') + ':' + new Date('2026-08-19T14:30:00Z').getMinutes().toString().padStart(2, '0'));
    assert.equal(formatEventTime(null), 'Gün Boyu');
    assert.equal(formatEventTime(''), 'Gün Boyu');
    assert.equal(formatEventTime('invalid-date'), 'Gün Boyu');
  });

  it('should fetch and process both earnings and economic events successfully', async () => {
    const client = getSupabaseClient();
    const originalFrom = client.from;

    (client as any).from = (table: string) => {
      if (table === 'earnings_events') {
        return {
          select: () => ({
            gte: () => ({
              lte: () => ({
                eq: () => ({
                  order: () => Promise.resolve({
                    data: [
                      {
                        id: 'e-1',
                        market: 'BIST100',
                        earnings_date: '2026-08-10',
                        session: null,
                        fiscal_year: 2026,
                        fiscal_period: 'Q2',
                        source_url: 'https://example.com/e1',
                        instrument: {
                          symbol: 'THYAO',
                          company_name: 'Türk Hava Yolları',
                          market: 'BIST100',
                        },
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'economic_events') {
        return {
          select: () => ({
            gte: () => ({
              lte: () => ({
                eq: () => ({
                  order: () => Promise.resolve({
                    data: [
                      {
                        id: 'ec-1',
                        name: 'TÜFE (Aylık)',
                        country: 'TR',
                        reference_period: 'Temmuz',
                        scheduled_at: '2026-08-10T07:00:00.000Z',
                        source_url: null,
                      },
                    ],
                    error: null,
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
      const result = await fetchMonthlyCalendarEvents(2026, 7);
      assert.strictEqual(result.year, 2026);
      assert.strictEqual(result.month, 7);

      const dayEvents = result.eventsByDate['2026-08-10'];
      assert.ok(dayEvents, '2026-08-10 events should exist');
      assert.strictEqual(dayEvents.length, 2);
      assert.strictEqual(dayEvents[0].type, 'earnings');
      assert.strictEqual(dayEvents[0].title, 'THYAO');
      assert.strictEqual(dayEvents[1].type, 'economic');
      assert.strictEqual(dayEvents[1].title, 'TÜFE (Aylık)');

      const indicator = result.dayIndicators['2026-08-10'];
      assert.ok(indicator);
      assert.strictEqual(indicator.hasEarnings, true);
      assert.strictEqual(indicator.hasEconomic, true);
      assert.strictEqual(indicator.count, 2);
    } finally {
      client.from = originalFrom;
    }
  });

  it('should deduplicate concurrent in-flight requests for the same month', async () => {
    const client = getSupabaseClient();
    const originalFrom = client.from;
    let queryCallCount = 0;

    (client as any).from = (table: string) => {
      queryCallCount++;
      return {
        select: () => ({
          gte: () => ({
            lte: () => ({
              eq: () => ({
                order: () => new Promise((resolve) => {
                  setTimeout(() => {
                    resolve({ data: [], error: null });
                  }, 20);
                }),
              }),
            }),
          }),
        }),
      };
    };

    try {
      const [res1, res2] = await Promise.all([
        fetchMonthlyCalendarEvents(2026, 7),
        fetchMonthlyCalendarEvents(2026, 7),
      ]);

      assert.strictEqual(res1, res2, 'Both concurrent calls must return the same deduplicated result object');
      // Only 2 table queries (1 for earnings, 1 for economic) should be triggered, NOT 4
      assert.strictEqual(queryCallCount, 2, 'Must execute exactly 1 pair of queries during concurrent in-flight requests');
    } finally {
      client.from = originalFrom;
    }
  });

  it('should fail-closed and throw when earnings_events query errors without caching partial data', async () => {
    const client = getSupabaseClient();
    const originalFrom = client.from;

    (client as any).from = (table: string) => {
      if (table === 'earnings_events') {
        return {
          select: () => ({
            gte: () => ({
              lte: () => ({
                eq: () => ({
                  order: () => Promise.resolve({
                    data: null,
                    error: { message: 'Database connection failed' },
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'economic_events') {
        return {
          select: () => ({
            gte: () => ({
              lte: () => ({
                eq: () => ({
                  order: () => Promise.resolve({
                    data: [{ id: 'ec-1', name: 'TÜFE', country: 'TR', scheduled_at: '2026-08-10T07:00:00Z' }],
                    error: null,
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
      await assert.rejects(
        async () => {
          await fetchMonthlyCalendarEvents(2026, 7);
        },
        (err: Error) => {
          return err.message.includes('Bilanço verileri');
        }
      );
    } finally {
      client.from = originalFrom;
    }
  });

  it('should fail-closed and throw when economic_events query errors without caching partial data', async () => {
    const client = getSupabaseClient();
    const originalFrom = client.from;

    (client as any).from = (table: string) => {
      if (table === 'earnings_events') {
        return {
          select: () => ({
            gte: () => ({
              lte: () => ({
                eq: () => ({
                  order: () => Promise.resolve({
                    data: [{ id: 'e-1', earnings_date: '2026-08-10', market: 'BIST100' }],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'economic_events') {
        return {
          select: () => ({
            gte: () => ({
              lte: () => ({
                eq: () => ({
                  order: () => Promise.resolve({
                    data: null,
                    error: { message: 'Economic table timeout' },
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
      await assert.rejects(
        async () => {
          await fetchMonthlyCalendarEvents(2026, 7);
        },
        (err: Error) => {
          return err.message.includes('Ekonomik göstergeler');
        }
      );
    } finally {
      client.from = originalFrom;
    }
  });
});
