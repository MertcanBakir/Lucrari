import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEventDates,
  isAppleCalendarSupported,
} from '../services/calendar/apple-calendar-service';
import type { CalendarEventItem } from '../services/calendar/calendar-service';

describe('Apple Calendar Service', () => {
  it('should accurately calculate start and end dates for timed events', () => {
    const event: CalendarEventItem = {
      id: 'test-1',
      type: 'economic',
      dateKey: '2026-08-19',
      timeLabel: '14:30',
      title: 'TÜFE',
      subtitle: 'Türkiye • Temmuz',
      marketOrCountry: 'Türkiye 🇹🇷',
      instrumentId: null,
      market: null,
    };

    const result = calculateEventDates(event);
    assert.equal(result.allDay, false);
    assert.equal(result.startDate.getFullYear(), 2026);
    assert.equal(result.startDate.getMonth(), 7); // August
    assert.equal(result.startDate.getDate(), 19);
    assert.equal(result.startDate.getHours(), 14);
    assert.equal(result.startDate.getMinutes(), 30);
    assert.equal(result.endDate.getHours(), 15);
  });

  it('should calculate dates for Seans Öncesi events', () => {
    const event: CalendarEventItem = {
      id: 'test-2',
      type: 'earnings',
      dateKey: '2026-08-20',
      timeLabel: 'Seans Öncesi',
      title: 'THYAO',
      subtitle: 'Türk Hava Yolları 2026/Q2',
      marketOrCountry: 'BIST 100 🇹🇷',
      instrumentId: 'inst-thyao',
      market: 'BIST100',
    };

    const result = calculateEventDates(event);
    assert.equal(result.allDay, false);
    assert.equal(result.startDate.getHours(), 9);
    assert.equal(result.endDate.getHours(), 10);
  });

  it('should calculate dates for Kapanış Sonrası events', () => {
    const event: CalendarEventItem = {
      id: 'test-3',
      type: 'earnings',
      dateKey: '2026-08-21',
      timeLabel: 'Kapanış Sonrası',
      title: 'GARAN',
      subtitle: 'Garanti BBVA 2026/Q2',
      marketOrCountry: 'BIST 100 🇹🇷',
      instrumentId: 'inst-garan',
      market: 'BIST100',
    };

    const result = calculateEventDates(event);
    assert.equal(result.allDay, false);
    assert.equal(result.startDate.getHours(), 18);
    assert.equal(result.startDate.getMinutes(), 15);
  });

  it('should calculate all-day dates when no specific time is provided', () => {
    const event: CalendarEventItem = {
      id: 'test-4',
      type: 'earnings',
      dateKey: '2026-08-22',
      timeLabel: 'Gün Boyu',
      title: 'KCHOL',
      subtitle: 'Koç Holding 2026/Q2',
      marketOrCountry: 'BIST 100 🇹🇷',
      instrumentId: 'inst-kchol',
      market: 'BIST100',
    };

    const result = calculateEventDates(event);
    assert.equal(result.allDay, true);
    assert.equal(result.startDate.getHours(), 0);
    assert.equal(result.endDate.getHours(), 23);
  });

  it('isAppleCalendarSupported should return a boolean platform capability flag', () => {
    const supported = isAppleCalendarSupported();
    assert.equal(typeof supported, 'boolean');
  });
});
