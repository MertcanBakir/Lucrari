/**
 * Portfolio Error View Component
 * 
 * Displays a clean, user-friendly error card when initial portfolio data fails to load,
 * providing a prominent "Tekrar Dene" retry button.
 */

import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface PortfolioErrorViewProps {
  error: string | null;
  onRetry: () => void;
  isLoading?: boolean;
}

export function PortfolioErrorView({ error, onRetry, isLoading = false }: PortfolioErrorViewProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[styles.iconCircle, { backgroundColor: theme.surfaceElevated }]}>
        <IconSymbol size={28} name="exclamationmark.triangle.fill" color={theme.warning} />
      </View>

      <Text style={[styles.title, { color: theme.text }]}>
        Portföy Verisi Yüklenemedi
      </Text>

      <Text style={[styles.message, { color: theme.textSecondary }]}>
        {error || 'Portföy verileriniz alınırken bir hata oluştu. Lütfen bağlantınızı kontrol edip tekrar deneyiniz.'}
      </Text>

      <TouchableOpacity
        style={[styles.retryButton, { backgroundColor: theme.tint }]}
        onPress={onRetry}
        disabled={isLoading}
        activeOpacity={0.8}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={isDark ? '#171416' : '#FFFFFF'} />
        ) : (
          <Text style={[styles.retryButtonText, { color: isDark ? '#171416' : '#FFFFFF' }]}>
            Tekrar Dene
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 16,
    gap: 12,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    fontWeight: '500',
    paddingHorizontal: 8,
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
