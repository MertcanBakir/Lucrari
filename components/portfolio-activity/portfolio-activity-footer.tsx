/**
 * Lucrari — Portfolio Activity List Footer Component
 * 
 * Renders pagination loading spinner or inline retry button upon next page error.
 */

import React, { memo } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Pressable } from 'react-native';
import { useAppTheme } from '@/context/theme-context';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';

export interface PortfolioActivityFooterProps {
  isLoadingMore: boolean;
  loadMoreError?: string | null;
  onRetry?: () => void;
}

export const PortfolioActivityFooter = memo(function PortfolioActivityFooter({
  isLoadingMore,
  loadMoreError,
  onRetry,
}: PortfolioActivityFooterProps) {
  const { colorScheme } = useAppTheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  if (isLoadingMore) {
    return (
      <View style={styles.footerContainer}>
        <ActivityIndicator size="small" color={theme.tint} />
        <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
          Daha fazla hareket yükleniyor...
        </Text>
      </View>
    );
  }

  if (loadMoreError) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <IconSymbol size={16} name="exclamationmark.triangle.fill" color={isDark ? '#FF6B6B' : '#DC3545'} />
        <Text style={[styles.errorText, { color: theme.textSecondary }]} numberOfLines={1}>
          Sonraki sayfa yüklenemedi.
        </Text>
        {onRetry && (
          <Pressable
            style={({ pressed }) => [
              styles.retryButton,
              { backgroundColor: theme.surfaceHighlight },
              pressed && { opacity: 0.7 },
            ]}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Tekrar dene"
          >
            <Text style={[styles.retryButtonText, { color: theme.tint }]}>
              Tekrar Dene
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  return <View style={styles.emptySpacing} />;
});

const styles = StyleSheet.create({
  footerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    fontWeight: '400',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    marginLeft: 8,
  },
  retryButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
  },
  retryButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptySpacing: {
    height: 32,
  },
});
