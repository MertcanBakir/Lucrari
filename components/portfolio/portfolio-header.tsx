/**
 * Portfolio Screen Header Component
 * 
 * Displays screen title, subtitle, currency toggle pill (TRY/USD),
 * and the primary "+ İşlem Ekle" button.
 */

import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface PortfolioHeaderProps {
  portfolioName?: string;
  currencyMode: 'TRY' | 'USD';
  onToggleCurrency: () => void;
  onAddTransaction: () => void;
  disabled?: boolean;
}

export function PortfolioHeader({
  portfolioName,
  currencyMode,
  onToggleCurrency,
  onAddTransaction,
  disabled = false,
}: PortfolioHeaderProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  return (
    <View style={styles.header}>
      <View style={styles.titleWrapper}>
        <Text style={[styles.title, { color: theme.text }]}>Yatırımlarım</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {portfolioName || 'Portföy & Varlık Yönetimi'}
        </Text>
      </View>

      <View style={styles.headerButtonsRow}>
        {/* Currency Mode Toggle Badge */}
        <TouchableOpacity
          style={[
            styles.currencyTogglePill,
            { backgroundColor: theme.surfaceElevated, borderColor: theme.tintBorder },
          ]}
          onPress={onToggleCurrency}
          activeOpacity={0.7}
        >
          <Text style={[styles.currencyToggleText, { color: theme.tint }]}>
            {currencyMode === 'TRY' ? '₺ TRY' : '$ USD'}
          </Text>
          <IconSymbol size={13} name="arrow.left.arrow.right" color={theme.tint} />
        </TouchableOpacity>

        {/* Clean Single-Plus Action Button */}
        <TouchableOpacity
          style={[
            styles.headerAddButton,
            { backgroundColor: theme.tint, borderColor: theme.tintPressed },
            disabled && { opacity: 0.5 },
          ]}
          onPress={onAddTransaction}
          disabled={disabled}
          activeOpacity={0.8}
        >
          <IconSymbol size={15} name="plus" color={isDark ? '#171416' : '#FFFFFF'} />
          <Text style={[styles.headerAddButtonText, { color: isDark ? '#171416' : '#FFFFFF' }]}>
            İşlem Ekle
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  titleWrapper: {
    flex: 1,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  headerButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  currencyTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  currencyToggleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  headerAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  headerAddButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
