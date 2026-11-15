/**
 * Lucrari — Portfolio Activity Section Header
 * 
 * Sticky/discrete section title displaying the localized date ('Bugün', 'Dün', '28 Ağustos 2026').
 */

import React, { memo } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useAppTheme } from '@/context/theme-context';
import { Colors } from '@/constants/theme';

export interface PortfolioActivitySectionHeaderProps {
  title: string;
  count?: number;
}

export const PortfolioActivitySectionHeader = memo(function PortfolioActivitySectionHeader({
  title,
  count,
}: PortfolioActivitySectionHeaderProps) {
  const { colorScheme } = useAppTheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.title, { color: theme.textSecondary }]}>
        {title}
      </Text>
      {count !== undefined && count > 0 && (
        <View style={[styles.badge, { backgroundColor: theme.surfaceHighlight }]}>
          <Text style={[styles.badgeText, { color: theme.textMuted }]}>
            {count}
          </Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
