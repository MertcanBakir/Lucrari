/**
 * Lucrari — Watchlist Empty Card Component
 * 
 * Rendered on the home screen when the user's watchlist is truly empty.
 * Provides clear explanation and primary CTA to open the search modal.
 */

import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface WatchlistEmptyCardProps {
  onOpenAddModal: () => void;
}

export function WatchlistEmptyCard({ onOpenAddModal }: WatchlistEmptyCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const handlePress = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Fallback
      }
    }
    onOpenAddModal();
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[styles.iconCircle, { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }]}>
        <IconSymbol size={28} name="star.fill" color={theme.tint} />
      </View>

      <Text style={[styles.title, { color: theme.text }]}>İzleme Listesi</Text>
      <Text style={[styles.description, { color: theme.textSecondary }]}>
        İlgilendiğiniz varlıkların fiyat hareketlerini portföyünüze eklemeden takip edin.
      </Text>

      <TouchableOpacity
        style={[styles.ctaButton, { backgroundColor: theme.tint, borderColor: theme.tintPressed }]}
        onPress={handlePress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="İzleme Listesi Oluştur"
      >
        <IconSymbol size={16} name="plus" color={isDark ? '#171416' : '#FFFFFF'} />
        <Text style={[styles.ctaText, { color: isDark ? '#171416' : '#FFFFFF' }]}>
          İzleme Listesi Oluştur
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    marginVertical: 8,
    gap: 10,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  ctaText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
