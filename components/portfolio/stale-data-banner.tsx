/**
 * Stale Data Banner Component
 * 
 * Displays a non-intrusive warning banner when previously cached portfolio data
 * is shown after a failed background network refresh.
 */

import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface StaleDataBannerProps {
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export function StaleDataBanner({ onRefresh, isRefreshing = false }: StaleDataBannerProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  return (
    <View style={[styles.bannerContainer, { backgroundColor: 'rgba(208, 165, 103, 0.12)', borderColor: theme.warning }]}>
      <View style={styles.contentRow}>
        <IconSymbol size={16} name="exclamationmark.triangle.fill" color={theme.warning} />
        <Text style={[styles.bannerText, { color: theme.text }]}>
          Veriler güncel olmayabilir.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.retryButton, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}
        onPress={onRefresh}
        disabled={isRefreshing}
        activeOpacity={0.7}
      >
        {isRefreshing ? (
          <ActivityIndicator size="small" color={theme.tint} />
        ) : (
          <Text style={[styles.retryText, { color: theme.tint }]}>Yenile</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bannerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  bannerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  retryButton: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
