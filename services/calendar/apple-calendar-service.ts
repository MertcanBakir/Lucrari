/**
 * Apple Calendar Integration Service
 * 
 * Provides native iOS Calendar integration using expo-calendar.
 * Allows users to batch export financial earnings and macroeconomic events
 * into a dedicated "Lucrari Finans Takvimi" on Apple devices.
 */

import type { CalendarEventItem } from './calendar-service';
import { createScopedLogger } from '@/utils/logger';

const log = createScopedLogger('AppleCalendar');

export const CALENDAR_TITLE = 'Lucrari Finans Takvimi';
export const CALENDAR_COLOR = '#725766'; // Muted Plum

export interface ExportResult {
  success: boolean;
  addedCount: number;
  calendarId?: string;
  error?: string;
}

function getPlatformOS(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native');
    return Platform.OS;
  } catch {
    return 'ios';
  }
}

/**
 * Checks if Apple Calendar native sync is supported on current platform
 */
export function isAppleCalendarSupported(): boolean {
  return getPlatformOS() === 'ios';
}

/**
 * Dynamically loads expo-calendar only on supported platforms
 */
function getExpoCalendar() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-calendar');
  } catch (err) {
    log.warn('calendar.native.unavailable', {
      message: 'Calendar native unavailable.',
      error: err
    });
    return null;
  }
}

/**
 * Requests Calendar permissions on iOS
 */
export async function requestCalendarPermission(): Promise<boolean> {
  if (!isAppleCalendarSupported()) return false;

  const ExpoCalendar = getExpoCalendar();
  if (!ExpoCalendar) return false;

  try {
    const { status } = await ExpoCalendar.requestCalendarPermissionsAsync();
    log.info('calendar.permission.checked', {
      message: 'Calendar permission checked.',
      context: { status }
    });
    return status === 'granted';
  } catch (err) {
    log.error('calendar.permission.failed', {
      message: 'Calendar permission failed.',
      error: err
    });
    return false;
  }
}

/**
 * Retrieves the user's existing default Apple Calendar ID (without creating a new calendar)
 */
export async function getDefaultAppleCalendarId(): Promise<string | null> {
  const ExpoCalendar = getExpoCalendar();
  if (!ExpoCalendar) return null;

  try {
    // 1. Try to get default calendar
    const defaultCalendar = await ExpoCalendar.getDefaultCalendarAsync().catch(() => null);
    if (defaultCalendar?.id && defaultCalendar.allowsModifications !== false) {
      log.debug('calendar.default.selected', {
        message: 'Calendar default selected.',
        context: { id: defaultCalendar.id }
      });
      return defaultCalendar.id;
    }

    // 2. If getDefaultCalendarAsync didn't return a writable calendar, find first writable calendar
    const calendars = await ExpoCalendar.getCalendarsAsync(ExpoCalendar.EntityTypes.EVENT);
    const writableCal = calendars.find(
      (cal: { allowsModifications: boolean }) => cal.allowsModifications
    );

    if (writableCal) {
      log.debug('calendar.writable.selected', {
        message: 'Calendar writable selected.',
        context: { id: writableCal.id }
      });
      return writableCal.id;
    }

    return null;
  } catch (err) {
    log.error('calendar.lookup.failed', {
      message: 'Calendar lookup failed.',
      error: err
    });
    return null;
  }
}

/**
 * Parses event start and end Date objects based on dateKey and timeLabel
 */
export function calculateEventDates(event: CalendarEventItem): { startDate: Date; endDate: Date; allDay: boolean } {
  const [year, month, day] = event.dateKey.split('-').map(Number);

  // Check if timeLabel has HH:mm format (e.g. "14:30")
  const timeMatch = event.timeLabel.match(/^(\d{1,2}):(\d{2})$/);

  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const startDate = new Date(year, month - 1, day, hours, minutes, 0);
    const endDate = new Date(year, month - 1, day, hours + 1, minutes, 0);
    return { startDate, endDate, allDay: false };
  }

  // Seans Öncesi (09:00 - 10:00)
  if (event.timeLabel.includes('Seans Öncesi')) {
    const startDate = new Date(year, month - 1, day, 9, 0, 0);
    const endDate = new Date(year, month - 1, day, 10, 0, 0);
    return { startDate, endDate, allDay: false };
  }

  // Kapanış Sonrası (18:15 - 19:15)
  if (event.timeLabel.includes('Kapanış Sonrası')) {
    const startDate = new Date(year, month - 1, day, 18, 15, 0);
    const endDate = new Date(year, month - 1, day, 19, 15, 0);
    return { startDate, endDate, allDay: false };
  }

  // Belirli bir saat yoksa tam gün (All-Day) etkinlik olarak ayarla
  const startDate = new Date(year, month - 1, day, 0, 0, 0);
  const endDate = new Date(year, month - 1, day, 23, 59, 59);
  return { startDate, endDate, allDay: true };
}

/**
 * Batch exports selected financial events into Apple Calendar
 */
export async function exportEventsToAppleCalendar(events: CalendarEventItem[]): Promise<ExportResult> {
  if (events.length === 0) {
    return { success: true, addedCount: 0 };
  }

  if (!isAppleCalendarSupported()) {
    return { success: false, addedCount: 0, error: 'Apple Takvim senkronizasyonu yalnızca iOS cihazlarda desteklenir.' };
  }

  const hasPermission = await requestCalendarPermission();
  if (!hasPermission) {
    return {
      success: false,
      addedCount: 0,
      error: 'Takvim erişim izni verilmedi. Lütfen iOS Ayarlar > Lucrari bölümünden Takvim iznini açın.',
    };
  }

  const calendarId = await getDefaultAppleCalendarId();
  if (!calendarId) {
    return { success: false, addedCount: 0, error: 'Mevcut Apple Takvimi bulunamadı veya düzenleme izni yok.' };
  }

  const ExpoCalendar = getExpoCalendar();
  let addedCount = 0;

  for (const event of events) {
    try {
      const { startDate, endDate, allDay } = calculateEventDates(event);
      const typeTag = event.type === 'earnings' ? '[Bilanço]' : '[Ekonomik]';
      const eventTitle = `${typeTag} ${event.title} - ${event.subtitle}`;
      const notes = `${event.subtitle}\nPiyasa/Ülke: ${event.marketOrCountry}\nZaman: ${event.timeLabel}`;

      await ExpoCalendar.createEventAsync(calendarId, {
        title: eventTitle,
        startDate,
        endDate,
        allDay,
        notes,
      });

      addedCount++;
    } catch (err) {
      log.warn('calendar.event.failed', {
        message: 'Calendar event failed.',
        context: { eventId: event.id },
        error: err
      });
    }
  }

  log.info('calendar.export.completed', {
    message: 'Calendar export completed.',
    context: { addedCount: addedCount, totalCount: events.length }
  });

  return {
    success: addedCount > 0,
    addedCount,
    calendarId,
  };
}

/**
 * Directs user to the native Apple Calendar app, optionally focused on a date
 */
export async function openAppleCalendar(date?: Date): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Linking = require('expo-linking');
    if (date) {
      const timestamp = Math.floor(date.getTime() / 1000);
      await Linking.openURL(`calshow:${timestamp}`);
    } else {
      await Linking.openURL('calshow:');
    }
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Linking = require('expo-linking');
      await Linking.openURL('calshow:').catch(() => {});
    } catch {
      // Fallback for non-expo environments
    }
  }
}
