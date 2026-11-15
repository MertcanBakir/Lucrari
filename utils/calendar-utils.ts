/**
 * Calendar Utilities
 * 
 * Generates monthly calendar matrices with Monday-based week indexing,
 * date comparisons, and Turkish localized month & day headers.
 */

export const WEEKDAYS_TR = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'] as const;

export const MONTH_NAMES_TR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
] as const;

export interface CalendarDay {
  date: Date;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  dateString: string; // YYYY-MM-DD
}

/**
 * Checks if two dates refer to the exact same calendar day
 */
export function isSameDay(dateA?: Date | null, dateB?: Date | null): boolean {
  if (!dateA || !dateB) return false;
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

/**
 * Formats date into YYYY-MM-DD string
 */
export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formats year and month into "Ağustos 2026"
 */
export function formatMonthYear(year: number, month: number): string {
  const safeMonth = Math.min(11, Math.max(0, month));
  const monthName = MONTH_NAMES_TR[safeMonth];
  return `${monthName} ${year}`;
}

/**
 * Returns previous month and year
 */
export function getPreviousMonth(year: number, month: number): { year: number; month: number } {
  if (month === 0) {
    return { year: year - 1, month: 11 };
  }
  return { year, month: month - 1 };
}

/**
 * Returns next month and year
 */
export function getNextMonth(year: number, month: number): { year: number; month: number } {
  if (month === 11) {
    return { year: year + 1, month: 0 };
  }
  return { year, month: month + 1 };
}

/**
 * Generates the full 35 or 42 day matrix for a month (Monday-start).
 */
export function getMonthMatrix(
  year: number,
  month: number,
  selectedDate?: Date | null,
  today: Date = new Date()
): CalendarDay[] {
  // First day of target month
  const firstDay = new Date(year, month, 1);
  // Total days in target month
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Day of week for 1st of month: 0 = Sunday, 1 = Monday... 6 = Saturday
  const firstDayOfWeekSundayBased = firstDay.getDay();
  // Convert to Monday-based index: 0 = Monday, 6 = Sunday
  const startDayOffset = (firstDayOfWeekSundayBased + 6) % 7;

  // Days in previous month
  const prevMonthDaysCount = new Date(year, month, 0).getDate();

  const days: CalendarDay[] = [];

  // 1. Padding days from previous month
  for (let i = startDayOffset - 1; i >= 0; i--) {
    const dayNum = prevMonthDaysCount - i;
    const date = new Date(year, month - 1, dayNum);
    days.push({
      date,
      dayNumber: dayNum,
      isCurrentMonth: false,
      isToday: isSameDay(date, today),
      isSelected: isSameDay(date, selectedDate),
      dateString: formatDateKey(date),
    });
  }

  // 2. Days of current month
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    days.push({
      date,
      dayNumber: d,
      isCurrentMonth: true,
      isToday: isSameDay(date, today),
      isSelected: isSameDay(date, selectedDate),
      dateString: formatDateKey(date),
    });
  }

  // 3. Padding days to complete full weeks (multiples of 7, usually 35 or 42)
  const remainingDays = (7 - (days.length % 7)) % 7;
  for (let nextDay = 1; nextDay <= remainingDays; nextDay++) {
    const date = new Date(year, month + 1, nextDay);
    days.push({
      date,
      dayNumber: nextDay,
      isCurrentMonth: false,
      isToday: isSameDay(date, today),
      isSelected: isSameDay(date, selectedDate),
      dateString: formatDateKey(date),
    });
  }

  return days;
}
