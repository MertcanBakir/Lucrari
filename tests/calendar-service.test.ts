import { describe, it, beforeEach } from '@jest/globals';
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

it('groups events on the same day, skips incomplete rows and forwards abort signals', async () => {
  clearCalendarCache();
  const controller = new AbortController();
  const date = '2026-08-10';
  const rows = {
    earnings_events: [
      { id: 'skip', earnings_date: null },
      { id: 'company', earnings_date: date, fiscal_period: 'Q2', instrument: null, instrument_id: 'fallback-id' },
      { id: 'other', earnings_date: date, market: 'NASDAQ100', instrument: { id: 'apple', symbol: 'AAPL' } },
    ],
    economic_events: [
      { id: 'skip', scheduled_at: null },
      { id: 'euro', scheduled_at: `${date}T12:00:00Z`, country: 'DE', name: 'CPI', reference_period: null },
      { id: 'usa', scheduled_at: `${date}T13:00:00Z`, country: 'US', name: 'Jobs', reference_period: 'Q2' },
    ],
  };
  const client = getSupabaseClient();
  const abortSignal = jest.fn();
  const from = jest.spyOn(client, 'from').mockImplementation((table) => {
    const builder = {
      select: jest.fn().mockReturnThis(), gte: jest.fn().mockReturnThis(), lte: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(),
      abortSignal: (signal: AbortSignal) => {
        abortSignal(signal);
        return Promise.resolve({ data: rows[table as keyof typeof rows], error: null });
      },
    };
    return builder as unknown as ReturnType<typeof client.from>;
  });
  try {
    const result = await fetchMonthlyCalendarEvents(2026, 7, { signal: controller.signal });
    expect(abortSignal.mock.calls).toEqual([[controller.signal], [controller.signal]]);
    expect(result.dayIndicators[date]).toEqual({ count: 4, hasEarnings: true, hasEconomic: true });
    expect(result.eventsByDate[date]).toEqual([
      expect.objectContaining({ title: 'BIST/NASDAQ', instrumentId: 'fallback-id', period: 'Q2' }),
      expect.objectContaining({ title: 'AAPL', instrumentId: 'apple' }),
      expect.objectContaining({ title: 'CPI', subtitle: 'DE Göstergesi' }),
      expect.objectContaining({ title: 'Jobs', country: 'US' }),
    ]);
    expect(await fetchMonthlyCalendarEvents(2026, 7)).toBe(result);
    expect(from).toHaveBeenCalledTimes(2);
  } finally {
    from.mockRestore();
    clearCalendarCache();
  }
});
