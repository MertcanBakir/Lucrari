import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';
import {
  getMonthMatrix,
  formatMonthYear,
  getPreviousMonth,
  getNextMonth,
  isSameDay,
  formatDateKey,
} from '../utils/calendar-utils';

describe('Calendar Utilities', () => {
  it('should format month and year in Turkish correctly', () => {
    assert.equal(formatMonthYear(2026, 7), 'Ağustos 2026'); // Month 7 is August (0-indexed)
    assert.equal(formatMonthYear(2026, 0), 'Ocak 2026');
    assert.equal(formatMonthYear(2026, 11), 'Aralık 2026');
  });

  it('should calculate previous and next months correctly across year boundaries', () => {
    assert.deepEqual(getPreviousMonth(2026, 7), { year: 2026, month: 6 });
    assert.deepEqual(getPreviousMonth(2026, 0), { year: 2025, month: 11 }); // Jan -> Prev Dec

    assert.deepEqual(getNextMonth(2026, 7), { year: 2026, month: 8 });
    assert.deepEqual(getNextMonth(2026, 11), { year: 2027, month: 0 }); // Dec -> Next Jan
  });

  it('should identify same day accurately', () => {
    const d1 = new Date(2026, 7, 19, 10, 30);
    const d2 = new Date(2026, 7, 19, 22, 15);
    const d3 = new Date(2026, 7, 20, 10, 30);

    assert.equal(isSameDay(d1, d2), true);
    assert.equal(isSameDay(d1, d3), false);
    assert.equal(isSameDay(d1, null), false);
  });

  it('should format date key in YYYY-MM-DD format', () => {
    assert.equal(formatDateKey(new Date(2026, 7, 19)), '2026-08-19');
    assert.equal(formatDateKey(new Date(2026, 0, 5)), '2026-01-05');
  });

  it('should generate a valid 7-column calendar matrix with Monday start for August 2026', () => {
    const today = new Date(2026, 7, 19);
    const selected = new Date(2026, 7, 21);
    const matrix = getMonthMatrix(2026, 7, selected, today);

    // Matrix length must always be a multiple of 7
    assert.equal(matrix.length % 7, 0);

    // August 2026 has 31 days
    const currentMonthDays = matrix.filter((d) => d.isCurrentMonth);
    assert.equal(currentMonthDays.length, 31);

    // August 1, 2026 was a Saturday -> Monday-based offset is 5 padding days (Mon-Fri from July)
    const firstCurrentMonthIndex = matrix.findIndex((d) => d.isCurrentMonth && d.dayNumber === 1);
    assert.equal(firstCurrentMonthIndex, 5);

    // Verify today marker
    const todayCell = matrix.find((d) => d.isToday);
    assert.ok(todayCell);
    assert.equal(todayCell?.dayNumber, 19);
    assert.equal(todayCell?.isCurrentMonth, true);

    // Verify selected marker
    const selectedCell = matrix.find((d) => d.isSelected);
    assert.ok(selectedCell);
    assert.equal(selectedCell?.dayNumber, 21);
  });
});
