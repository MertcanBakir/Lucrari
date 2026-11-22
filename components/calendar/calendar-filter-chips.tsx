import { MotionView } from '@/components/feedback/motion-view';
/**
 * Lucrari — Calendar Filter Chips Component
 * 
 * Horizontal scrollable filter chips for calendar events:
 * [Tümü] [Portföyüm (X)] [İzleme Listesi (Y)] [Şirketler] [Ekonomik] [BIST] [ABD]
 */

import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { haptics as Haptics } from '@/services/feedback/haptics';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  CALENDAR_FILTER_OPTIONS,
  type CalendarFilter,
} from '@/utils/calendar-event-filter';

export interface CalendarFilterChipsProps {
  activeFilter: CalendarFilter;
  onFilterChange: (filter: CalendarFilter) => void;
  ownedCount?: number;
  watchedCount?: number;
}

export function CalendarFilterChips({
  activeFilter,
  onFilterChange,
  ownedCount = 0,
  watchedCount = 0,
}: CalendarFilterChipsProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const handleSelectFilter = async (filter: CalendarFilter) => {
    if (filter === activeFilter) return;

    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    onFilterChange(filter);
  };

  return (
    <MotionView motionKey={activeFilter} style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {CALENDAR_FILTER_OPTIONS.map((option) => {
          const isSelected = activeFilter === option.id;
          const isPortfolioOption = option.id === 'portfolio';
          const isWatchlistOption = option.id === 'watchlist';

          return (
            <TouchableOpacity
              key={option.id}
              style={[
                styles.chip,
                {
                  backgroundColor: isSelected ? theme.tint : theme.surface,
                  borderColor: isSelected ? theme.tintPressed : theme.border,
                },
              ]}
              onPress={() => handleSelectFilter(option.id)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${option.label} filtresini seç`}
              accessibilityState={{ selected: isSelected }}
            >
              {isPortfolioOption && (
                <IconSymbol
                  size={13}
                  name="briefcase.fill"
                  color={isSelected ? (isDark ? '#171416' : '#FFFFFF') : theme.tint}
                />
              )}
              {isWatchlistOption && (
                <IconSymbol
                  size={13}
                  name="list.bullet"
                  color={isSelected ? (isDark ? '#171416' : '#FFFFFF') : theme.tint}
                />
              )}
              <Text
                style={[
                  styles.chipText,
                  {
                    color: isSelected ? (isDark ? '#171416' : '#FFFFFF') : theme.text,
                    fontWeight: isSelected ? '700' : '500',
                  },
                ]}
              >
                {option.label}
              </Text>

              {isPortfolioOption && ownedCount > 0 && (
                <View
                  style={[
                    styles.countBadge,
                    {
                      backgroundColor: isSelected
                        ? (isDark ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)')
                        : theme.tintMuted,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.countBadgeText,
                      {
                        color: isSelected
                          ? (isDark ? '#171416' : '#FFFFFF')
                          : theme.tint,
                      },
                    ]}
                  >
                    {ownedCount}
                  </Text>
                </View>
              )}

              {isWatchlistOption && watchedCount > 0 && (
                <View
                  style={[
                    styles.countBadge,
                    {
                      backgroundColor: isSelected
                        ? (isDark ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)')
                        : theme.tintMuted,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.countBadgeText,
                      {
                        color: isSelected
                          ? (isDark ? '#171416' : '#FFFFFF')
                          : theme.tint,
                      },
                    ]}
                  >
                    {watchedCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </MotionView>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  chipText: {
    fontSize: 13,
    letterSpacing: -0.1,
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
  },
  countBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
});
