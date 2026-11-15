import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';
import * as Calendar from 'expo-calendar';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import {
  calculateEventDates,
  isAppleCalendarSupported,
  exportEventsToAppleCalendar,
  getDefaultAppleCalendarId,
  openAppleCalendar,
  requestCalendarPermission,
} from '../services/calendar/apple-calendar-service';
import type { CalendarEventItem } from '../services/calendar/calendar-service';

jest.mock('expo-calendar', () => ({
  EntityTypes: { EVENT: 'event' },
  requestCalendarPermissionsAsync: jest.fn(),
  getDefaultCalendarAsync: jest.fn(),
  getCalendarsAsync: jest.fn(),
  createEventAsync: jest.fn(),
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));

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

describe('native calendar integration', () => {
  const event: CalendarEventItem = {
    id: 'event', type: 'earnings', dateKey: '2026-08-19', timeLabel: '14:30',
    title: 'THYAO', subtitle: 'Bilanço', marketOrCountry: 'Türkiye',
    instrumentId: 'instrument', market: null,
  };

  const originalPlatform = Platform.OS;
  afterEach(() => { Platform.OS = originalPlatform; });

  beforeEach(() => {
    jest.resetAllMocks();
    Platform.OS = 'ios';
    jest.mocked(Calendar.requestCalendarPermissionsAsync).mockResolvedValue({ status: 'granted' } as Calendar.PermissionResponse);
    jest.mocked(Calendar.getDefaultCalendarAsync).mockResolvedValue({ id: 'default', allowsModifications: true } as Calendar.Calendar);
    jest.mocked(Calendar.getCalendarsAsync).mockResolvedValue([]);
    jest.mocked(Calendar.createEventAsync).mockResolvedValue('event-id');
    jest.mocked(Linking.openURL).mockResolvedValue(true);
  });

  it('skips empty batches and denies export on unsupported platforms or without permission', async () => {
    await expect(exportEventsToAppleCalendar([])).resolves.toEqual({ success: true, addedCount: 0 });
    Platform.OS = 'android';
    await expect(exportEventsToAppleCalendar([event])).resolves.toMatchObject({ success: false });
    expect(Calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
    Platform.OS = 'ios';
    jest.mocked(Calendar.requestCalendarPermissionsAsync).mockResolvedValueOnce({ status: 'denied' } as Calendar.PermissionResponse);
    await expect(exportEventsToAppleCalendar([event])).resolves.toMatchObject({ success: false });
    expect(Calendar.createEventAsync).not.toHaveBeenCalled();
    jest.mocked(Calendar.requestCalendarPermissionsAsync).mockRejectedValueOnce(new Error('permissions'));
    await expect(requestCalendarPermission()).resolves.toBe(false);
  });

  it('uses a writable fallback calendar and keeps successful events when another fails', async () => {
    jest.mocked(Calendar.getDefaultCalendarAsync).mockResolvedValue({ id: 'readonly', allowsModifications: false } as Calendar.Calendar);
    jest.mocked(Calendar.getCalendarsAsync).mockResolvedValue([
      { id: 'readonly', allowsModifications: false }, { id: 'writable', allowsModifications: true },
    ] as Calendar.Calendar[]);
    jest.mocked(Calendar.createEventAsync).mockRejectedValueOnce(new Error('event failed'));
    const result = await exportEventsToAppleCalendar([{ ...event, id: 'first', type: 'economic' }, event]);
    expect(result).toEqual({ success: true, addedCount: 1, calendarId: 'writable' });
    expect(Calendar.createEventAsync).toHaveBeenLastCalledWith('writable', expect.objectContaining({
      title: '[Bilanço] THYAO - Bilanço', allDay: false,
    }));
  });

  it('uses the default calendar and reports missing calendars or rejected writes', async () => {
    jest.mocked(Calendar.createEventAsync).mockRejectedValueOnce(new Error('no event'));
    await expect(exportEventsToAppleCalendar([event])).resolves.toEqual({ success: false, addedCount: 0, calendarId: 'default' });
    jest.mocked(Calendar.getDefaultCalendarAsync).mockRejectedValue(new Error('no default'));
    await expect(exportEventsToAppleCalendar([event])).resolves.toMatchObject({ success: false, addedCount: 0 });
    jest.mocked(Calendar.getCalendarsAsync).mockRejectedValue(new Error('no access'));
    await expect(getDefaultAppleCalendarId()).resolves.toBeNull();
  });

  it('opens the calendar on a specific date and falls back to opening it without a date', async () => {
    jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('cannot open specific date'));
    await openAppleCalendar(new Date(1000));
    await openAppleCalendar();
    expect(jest.mocked(Linking.openURL).mock.calls).toEqual([['calshow:1'], ['calshow:'], ['calshow:']]);
  });
});
