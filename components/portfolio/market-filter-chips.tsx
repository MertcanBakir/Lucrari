/**
 * Market Filter Chips Component
 * 
 * Horizontal scrollable filter pills for filtering positions by market
 * (Tümü, BIST, NASDAQ, Kripto, FX/Altın).
 */

import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ExtendedMarketType } from '@/types/database';

export const MARKET_TABS: { id: ExtendedMarketType; label: string; icon: string }[] = [
  { id: 'ALL', label: 'Tümü', icon: 'chart.pie.fill' },
  { id: 'BIST100', label: 'BIST', icon: 'chart.line.uptrend.xyaxis' },
  { id: 'NASDAQ100', label: 'NASDAQ', icon: 'briefcase.fill' },
  { id: 'TEFAS', label: 'Fonlar', icon: 'folder.fill' },
  { id: 'CRYPTO', label: 'Kripto', icon: 'dollarsign.circle.fill' },
  { id: 'FX', label: 'FX / Altın', icon: 'banknote' },
];

export interface MarketFilterChipsProps {
  activeMarket: ExtendedMarketType;
  onSelectMarket: (market: ExtendedMarketType) => void;
}

export function MarketFilterChips({ activeMarket, onSelectMarket }: MarketFilterChipsProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const handlePress = async (marketId: ExtendedMarketType) => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    onSelectMarket(marketId);
  };

  return (
    <View style={styles.marketTabsContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.marketTabsScroll}
      >
        {MARKET_TABS.map((tab) => {
          const isSelected = activeMarket === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[
                styles.marketTabPill,
                {
                  backgroundColor: isSelected ? theme.tint : theme.surface,
                  borderColor: isSelected ? theme.tintPressed : theme.border,
                },
              ]}
              onPress={() => handlePress(tab.id)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.marketTabLabel,
                  { color: isSelected ? (isDark ? '#171416' : '#FFFFFF') : theme.text },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  marketTabsContainer: {
    marginBottom: 14,
  },
  marketTabsScroll: {
    gap: 8,
    paddingRight: 8,
  },
  marketTabPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  marketTabLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
});
