/**
 * Portfolio Allocation Card Component
 * 
 * Displays asset allocation breakdown with an interactive segmented progress bar,
 * clean borderless legend items with transparent backgrounds, and detailed valuation inspection.
 */

import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatPortfolioValue, type CurrencyMode } from '@/utils/financial-math';
import type { AllocationItem, AllocationKey } from '@/hooks/use-portfolio';

export interface PortfolioAllocationCardProps {
  allocationItems: AllocationItem[];
  currencyMode: CurrencyMode;
  usdTryRate: number | null;
}

export function PortfolioAllocationCard({
  allocationItems,
  currencyMode,
  usdTryRate,
}: PortfolioAllocationCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const [selectedAllocKey, setSelectedAllocKey] = useState<AllocationKey | null>(null);

  const handleSelectAllocKey = async (key: AllocationKey) => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    setSelectedAllocKey((prev) => (prev === key ? null : key));
  };

  const activeAllocItem = selectedAllocKey
    ? allocationItems.find((item) => item.key === selectedAllocKey) || null
    : null;

  return (
    <View style={[styles.allocationCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.allocationHeader}>
        <View>
          <Text style={[styles.allocationTitle, { color: theme.text }]}>Varlık Dağılımı</Text>
          <Text style={[styles.allocationSubtitle, { color: theme.textSecondary }]}>
            Varlığa dokunarak tutarını inceleyin
          </Text>
        </View>
      </View>

      {/* Segmented Color Bar (Touch Targets) */}
      <View style={styles.allocationBarContainer}>
        {allocationItems.length === 0 ? (
          <View style={[styles.allocationSegment, { flex: 1, backgroundColor: theme.surfaceElevated }]} />
        ) : (
          allocationItems.map((item) => {
            const isSelected = selectedAllocKey === item.key;
            return (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.allocationSegment,
                  {
                    flex: Math.max(item.pct, 4),
                    backgroundColor: item.dotColor,
                    opacity: selectedAllocKey === null || isSelected ? 1 : 0.35,
                    transform: [{ scaleY: isSelected ? 1.3 : 1 }],
                  },
                ]}
                onPress={() => handleSelectAllocKey(item.key)}
                activeOpacity={0.8}
              />
            );
          })
        )}
      </View>

      {/* Clean Borderless Legend Items (Transparent Background) */}
      <View style={styles.allocationLegendGrid}>
        {allocationItems.map((item) => {
          const isSelected = selectedAllocKey === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              style={[
                styles.allocationLegendItem,
                { opacity: selectedAllocKey === null || isSelected ? 1 : 0.4 },
              ]}
              onPress={() => handleSelectAllocKey(item.key)}
              activeOpacity={0.7}
            >
              <View style={[styles.legendDot, { backgroundColor: item.dotColor }]} />
              <Text
                style={[
                  styles.legendLabelText,
                  {
                    color: isSelected ? theme.text : theme.textSecondary,
                    fontWeight: isSelected ? '800' : '600',
                  },
                ]}
                numberOfLines={1}
              >
                {item.label}
              </Text>
              <Text
                style={[
                  styles.legendPercentText,
                  {
                    color: isSelected ? theme.text : theme.textMuted,
                    fontWeight: isSelected ? '800' : '600',
                  },
                ]}
              >
                %{item.pct}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Selected Segment Quick Inspection Details */}
      {activeAllocItem && (
        <View
          style={[
            styles.allocInspectionBox,
            { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle },
          ]}
        >
          <View style={styles.allocInspectionLeft}>
            <View style={[styles.allocInspectionDot, { backgroundColor: activeAllocItem.dotColor }]} />
            <View style={styles.allocInspectionTitles}>
              <Text style={[styles.allocInspectionTitle, { color: theme.text }]}>
                {activeAllocItem.fullName}
              </Text>
              <Text style={[styles.allocInspectionSubtitle, { color: theme.textSecondary }]}>
                Portföy Payı: %{activeAllocItem.pct}
              </Text>
            </View>
          </View>
          <Text style={[styles.allocInspectionVal, { color: theme.text }]}>
            {formatPortfolioValue(activeAllocItem.valueTry, currencyMode, usdTryRate)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  allocationCard: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    marginBottom: 14,
  },
  allocationHeader: {
    marginBottom: 12,
  },
  allocationTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  allocationSubtitle: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  allocationBarContainer: {
    flexDirection: 'row',
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    marginBottom: 14,
    gap: 2,
  },
  allocationSegment: {
    height: '100%',
    borderRadius: 4,
  },
  allocationLegendGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 8,
    columnGap: 14,
    justifyContent: 'flex-start',
  },
  allocationLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabelText: {
    fontSize: 12,
    letterSpacing: -0.1,
  },
  legendPercentText: {
    fontSize: 11,
    letterSpacing: -0.1,
  },
  allocInspectionBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
  },
  allocInspectionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  allocInspectionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  allocInspectionTitles: {
    gap: 2,
  },
  allocInspectionTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  allocInspectionSubtitle: {
    fontSize: 10,
    fontWeight: '600',
  },
  allocInspectionVal: {
    fontSize: 13,
    fontWeight: '800',
  },
});
