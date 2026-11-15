/**
 * Lucrari — Portfolio Activity Entry Card
 * 
 * Compact navigation card rendered on the Investments tab between asset allocation
 * and market filter chips.
 */

import React, { memo, useCallback } from 'react';
import { StyleSheet, View, Text, Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/context/theme-context';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';

export interface PortfolioActivityEntryCardProps {
  disabled?: boolean;
}

export const PortfolioActivityEntryCard = memo(function PortfolioActivityEntryCard({
  disabled = false,
}: PortfolioActivityEntryCardProps) {
  const router = useRouter();
  const { colorScheme } = useAppTheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const handlePress = useCallback(async () => {
    if (disabled) return;

    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    router.push('/portfolio-activity');
  }, [disabled, router]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
        },
        pressed && !disabled && { opacity: 0.85, transform: [{ scale: 0.99 }] },
        disabled && { opacity: 0.6 },
      ]}
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Portföy Hareketleri. Alış, satış ve nakit işlemlerinizi görüntüleyin."
      accessibilityHint="Portföy hareketleri geçmişi ekranını açar"
    >
      <View style={[styles.iconBadge, { backgroundColor: isDark ? 'rgba(78, 205, 196, 0.12)' : 'rgba(10, 126, 164, 0.1)' }]}>
        <IconSymbol size={22} name="clock.arrow.circlepath" color={theme.tint} />
      </View>

      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          Portföy Hareketleri
        </Text>
        <Text style={[styles.description, { color: theme.textSecondary }]} numberOfLines={1}>
          Alış, satış ve nakit işlemlerinizi görüntüleyin
        </Text>
      </View>

      <View style={styles.arrowContainer}>
        <IconSymbol size={18} name="chevron.right" color={theme.textMuted} />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 8,
    marginBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  description: {
    fontSize: 12,
    fontWeight: '400',
  },
  arrowContainer: {
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
