/**
 * Monthly Calendar Component
 * 
 * Displays an interactive 1-month calendar grid with previous/next navigation,
 * day selection, today indicators, 2-color indicator dots for Earnings & Economic events,
 * and an interactive batch export selection mode for Apple Calendar.
 */

import React, { useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  WEEKDAYS_TR,
  getMonthMatrix,
  formatMonthYear,
  getPreviousMonth,
  getNextMonth,
  isSameDay,
  CalendarDay,
} from '@/utils/calendar-utils';
import type { DayIndicator } from '@/services/calendar/calendar-service';

export interface MonthlyCalendarProps {
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
  selectedDate?: Date | null;
  onSelectDate?: (date: Date) => void;
  dayIndicators?: Record<string, DayIndicator>;
  isLoading?: boolean;
  isSelectionMode?: boolean;
  selectedDaysForExport?: Set<string>;
  onToggleDayForExport?: (dateKey: string) => void;
}

export function MonthlyCalendar({
  year,
  month,
  onMonthChange,
  selectedDate: activeSelectedDate,
  onSelectDate,
  dayIndicators = {},
  isLoading = false,
  isSelectionMode = false,
  selectedDaysForExport = new Set(),
  onToggleDayForExport,
}: MonthlyCalendarProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const today = useMemo(() => new Date(), []);

  const handlePrevMonth = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Fallback
      }
    }
    const prev = getPreviousMonth(year, month);
    onMonthChange(prev.year, prev.month);
  };

  const handleNextMonth = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Fallback
      }
    }
    const next = getNextMonth(year, month);
    onMonthChange(next.year, next.month);
  };

  const handleDayPress = async (day: CalendarDay) => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }

    if (isSelectionMode) {
      const indicator = dayIndicators[dayItemKey(day)];
      const hasEvents = (indicator?.count ?? 0) > 0;
      if (hasEvents && onToggleDayForExport) {
        onToggleDayForExport(dayItemKey(day));
      }
      return;
    }

    // Normal mode: If user presses a day from prev/next month, jump to that month
    if (!day.isCurrentMonth) {
      onMonthChange(day.date.getFullYear(), day.date.getMonth());
    }
    if (onSelectDate) {
      onSelectDate(day.date);
    }
  };

  const dayItemKey = (day: CalendarDay) => day.dateString;

  // Generate memoized day matrix for current year/month
  const daysMatrix = useMemo(() => {
    return getMonthMatrix(year, month, activeSelectedDate, today);
  }, [year, month, activeSelectedDate, today]);

  const monthYearLabel = formatMonthYear(year, month);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {/* Calendar Header with Navigation Arrows & Month Title */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={[styles.arrowButton, { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }]}
          onPress={handlePrevMonth}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <IconSymbol size={18} name="chevron.left" color={theme.text} />
        </TouchableOpacity>

        {/* Center Month Title */}
        <View style={styles.monthTitleWrapper}>
          <Text style={[styles.monthTitleText, { color: theme.text }]}>
            {monthYearLabel}
          </Text>
          {isLoading && (
            <ActivityIndicator
              size="small"
              color={theme.tint}
              style={styles.headerLoader}
            />
          )}
        </View>

        <TouchableOpacity
          style={[styles.arrowButton, { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }]}
          onPress={handleNextMonth}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <IconSymbol size={18} name="chevron.right" color={theme.text} />
        </TouchableOpacity>
      </View>

      {/* Weekday Labels (Pzt, Sal, Çar, Per, Cum, Cmt, Paz) */}
      <View style={styles.weekdaysRow}>
        {WEEKDAYS_TR.map((dayName, idx) => {
          const isWeekend = idx === 5 || idx === 6;
          return (
            <View key={dayName} style={styles.weekdayCol}>
              <Text
                style={[
                  styles.weekdayText,
                  { color: isWeekend ? theme.tint : theme.textMuted },
                ]}
              >
                {dayName}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Monthly Days Grid */}
      <View style={styles.daysGrid}>
        {daysMatrix.map((dayItem) => {
          const isSelected = isSameDay(dayItem.date, activeSelectedDate);
          const indicator = dayIndicators[dayItem.dateString];
          const hasEarnings = indicator?.hasEarnings ?? false;
          const hasEconomic = indicator?.hasEconomic ?? false;
          const hasEvents = (indicator?.count ?? 0) > 0;
          const isExportSelected = selectedDaysForExport.has(dayItem.dateString);

          return (
            <TouchableOpacity
              key={dayItem.dateString}
              style={styles.dayCol}
              onPress={() => handleDayPress(dayItem)}
              activeOpacity={isSelectionMode && !hasEvents ? 1 : 0.7}
              disabled={isSelectionMode && !hasEvents}
            >
              <View
                style={[
                  styles.dayCell,
                  !isSelectionMode && isSelected && {
                    backgroundColor: theme.tint,
                    borderColor: theme.tintPressed,
                  },
                  !isSelectionMode && dayItem.isToday && !isSelected && {
                    borderColor: theme.positive,
                    borderWidth: 1.5,
                  },
                  isSelectionMode && isExportSelected && {
                    backgroundColor: theme.tint,
                    borderColor: theme.tintPressed,
                    borderWidth: 1.5,
                  },
                  isSelectionMode && !isExportSelected && hasEvents && {
                    borderColor: theme.tintBorder,
                    borderWidth: 1,
                    backgroundColor: theme.surfaceElevated,
                  },
                  isSelectionMode && !hasEvents && {
                    opacity: 0.25,
                  },
                ]}
              >
                {/* Export Mode Checkmark / Indicator */}
                {isSelectionMode && hasEvents && (
                  <View style={styles.selectionCheckWrapper}>
                    <Text
                      style={[
                        styles.selectionCheckText,
                        { color: isExportSelected ? (isDark ? '#171416' : '#FFFFFF') : theme.tint },
                      ]}
                    >
                      {isExportSelected ? '✓' : '○'}
                    </Text>
                  </View>
                )}

                <Text
                  style={[
                    styles.dayNumberText,
                    {
                      color: isSelectionMode
                        ? isExportSelected
                          ? isDark
                            ? '#171416'
                            : '#FFFFFF'
                          : theme.text
                        : isSelected
                        ? isDark
                          ? '#171416'
                          : '#FFFFFF'
                        : dayItem.isCurrentMonth
                        ? theme.text
                        : theme.textMuted,
                      fontWeight:
                        (isSelectionMode && isExportSelected) || isSelected || dayItem.isToday
                          ? '800'
                          : '500',
                      opacity: dayItem.isCurrentMonth ? 1 : 0.4,
                    },
                  ]}
                >
                  {dayItem.dayNumber}
                </Text>

                {/* Event Dots Container Under Day Number */}
                <View style={styles.dotsRow}>
                  {/* Bilanço (Earnings) Dot - Muted Gold */}
                  {hasEarnings && (
                    <View
                      style={[
                        styles.eventDot,
                        {
                          backgroundColor:
                            (isSelectionMode && isExportSelected) || (!isSelectionMode && isSelected)
                              ? isDark
                                ? '#171416'
                                : '#FFFFFF'
                              : theme.warning,
                        },
                      ]}
                    />
                  )}

                  {/* Ekonomik Gösterge (Macro) Dot - Dusty Blue */}
                  {hasEconomic && (
                    <View
                      style={[
                        styles.eventDot,
                        {
                          backgroundColor:
                            (isSelectionMode && isExportSelected) || (!isSelectionMode && isSelected)
                              ? isDark
                                ? '#171416'
                                : '#FFFFFF'
                              : theme.info,
                        },
                      ]}
                    />
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Calendar Legend Bar */}
      <View style={[styles.legendRow, { borderTopColor: theme.borderSubtle }]}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: theme.warning }]} />
          <Text style={[styles.legendText, { color: theme.textSecondary }]}>Şirket Bilançoları</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: theme.info }]} />
          <Text style={[styles.legendText, { color: theme.textSecondary }]}>Ekonomik Göstergeler</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 6,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  arrowButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitleWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  monthTitleText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerLoader: {
    marginLeft: 4,
  },
  weekdaysRow: {
    flexDirection: 'row',
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.04)',
  },
  weekdayCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayText: {
    fontSize: 11,
    fontWeight: '700',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCol: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCell: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    paddingVertical: 2,
  },
  selectionCheckWrapper: {
    position: 'absolute',
    top: 2,
    right: 4,
  },
  selectionCheckText: {
    fontSize: 9,
    fontWeight: '800',
  },
  dayNumberText: {
    fontSize: 13,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 6,
    marginTop: 2,
  },
  eventDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.5,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '500',
  },
});
