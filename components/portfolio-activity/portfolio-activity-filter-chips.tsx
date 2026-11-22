import { MotionView } from '@/components/feedback/motion-view';
/**
 * Lucrari — Portfolio Activity Filter Chips
 * 
 * Horizontally scrollable chip filter bar (Tümü, Alış, Satış, Para Yatırma, Para Çekme).
 */

import React, { memo, useCallback } from 'react';
import { StyleSheet, Text, ScrollView, Pressable, Platform } from 'react-native';
import { haptics as Haptics } from '@/services/feedback/haptics';
import { useAppTheme } from '@/context/theme-context';
import { Colors } from '@/constants/theme';
import {
  PORTFOLIO_ACTIVITY_FILTER_OPTIONS,
  type PortfolioActivityFilter,
} from '@/types/portfolio-activity';

export interface PortfolioActivityFilterChipsProps {
  activeFilter: PortfolioActivityFilter;
  onSelectFilter: (filter: PortfolioActivityFilter) => void;
  disabled?: boolean;
}

export const PortfolioActivityFilterChips = memo(function PortfolioActivityFilterChips({
  activeFilter,
  onSelectFilter,
  disabled = false,
}: PortfolioActivityFilterChipsProps) {
  const { colorScheme } = useAppTheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const handleSelect = useCallback(
    async (filter: PortfolioActivityFilter) => {
      if (disabled || filter === activeFilter) return;

      if (Platform.OS !== 'web') {
        try {
          await Haptics.selectionAsync();
        } catch {
          // Fallback
        }
      }
      onSelectFilter(filter);
    },
    [disabled, activeFilter, onSelectFilter]
  );

  return (
    <MotionView motionKey={activeFilter} style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="always"
      >
        {PORTFOLIO_ACTIVITY_FILTER_OPTIONS.map((option) => {
          const isSelected = option.id === activeFilter;
          return (
            <Pressable
              key={option.id}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: isSelected
                    ? theme.tint
                    : theme.surface,
                  borderColor: isSelected
                    ? theme.tint
                    : theme.border,
                },
                pressed && !disabled && { opacity: 0.8 },
                disabled && { opacity: 0.5 },
              ]}
              onPress={() => handleSelect(option.id)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${option.label} filtresi`}
            >
              <Text
                style={[
                  styles.chipText,
                  {
                    color: isSelected
                      ? isDark ? '#000000' : '#FFFFFF'
                      : theme.textSecondary,
                    fontWeight: isSelected ? '700' : '500',
                  },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </MotionView>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    letterSpacing: -0.1,
  },
});
