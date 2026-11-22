/**
 * Position Card Component
 * 
 * Renders a single portfolio asset card with symbol, market tag,
 * company name, quantity, cost basis, total market value, and dynamic PnL.
 * 
 * STRICT COMPLIANCE:
 * - NO hardcoded USD/TRY rate.
 * - Missing price displayed explicitly as '—'.
 * - Missing FX rate leaves monetary conversion as '—' (never disguises missing rate as 0 ₺ / $0).
 * - Stale price indicator badge.
 */

import React, { memo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import { haptics as Haptics } from '@/services/feedback/haptics';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatPercentage } from '@/utils/financial-formatters';
import {
  computePositionMetrics,
  formatConvertedCurrency,
  formatConvertedPnlAmount,
  type CurrencyMode,
  type PnlMode,
} from '@/utils/financial-math';
import type { PortfolioPosition } from '@/types/database';

export interface PositionCardProps {
  position: PortfolioPosition;
  pnlMode: PnlMode;
  currencyMode: CurrencyMode;
  usdTryRate: number | null;
  onPress: (position: PortfolioPosition) => void;
}

function PositionCardComponent({
  position,
  pnlMode,
  currencyMode,
  usdTryRate,
  onPress,
}: PositionCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const metrics = computePositionMetrics(position, pnlMode, currencyMode, usdTryRate);

  // 1. Total Market Value in target display currency (returns '—' if price or rate is missing)
  const marketValueDisplay = formatConvertedCurrency(
    metrics.marketValueNative,
    position.currency,
    currencyMode,
    usdTryRate
  );

  // 2. Active PnL Monetary Amount in target display currency (returns '—' if conversion is unavailable)
  const activePnlAmountDisplay = formatConvertedPnlAmount(
    metrics.activePnlAmount,
    position.currency,
    currencyMode,
    usdTryRate,
    metrics.activePnlLabel
  );

  // 3. Unit Cost Display in target display currency (returns '—' if conversion rate is missing)
  const unitCostDisplay = formatConvertedCurrency(
    metrics.averageCost,
    position.currency,
    currencyMode,
    usdTryRate
  );

  const handlePress = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Fallback
      }
    }
    onPress(position);
  };

  return (
    <TouchableOpacity
      style={[
        styles.holdingCard,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      {/* Left: Symbol, Badge, Company Name */}
      <View style={styles.holdingLeft}>
        <View style={styles.symbolRow}>
          <Text style={[styles.symbolText, { color: theme.text }]}>
            {position.symbol}
          </Text>
          <View
            style={[
              styles.marketTagBadge,
              { backgroundColor: theme.surfaceHighlight, borderColor: theme.borderSubtle },
            ]}
          >
            <Text style={[styles.marketTagText, { color: theme.tint }]}>
              {position.market}
            </Text>
          </View>
          {metrics.isStale && (
            <View style={[styles.staleBadge, { backgroundColor: 'rgba(208, 165, 103, 0.15)' }]}>
              <Text style={[styles.staleBadgeText, { color: theme.warning }]}>Eski Fiyat</Text>
            </View>
          )}
        </View>
        <Text
          style={[styles.companyNameText, { color: theme.textSecondary }]}
          numberOfLines={1}
        >
          {position.company_name}
        </Text>
        <Text style={[styles.quantityCostText, { color: theme.textMuted }]}>
          {position.quantity} Adet • Maliyet: {unitCostDisplay}
        </Text>
      </View>

      {/* Right: Total Value, PnL (Dynamic to pnlMode) */}
      <View style={styles.holdingRight}>
        <Text style={[styles.positionValueText, { color: theme.text }]}>
          {marketValueDisplay}
        </Text>
        {metrics.hasMarketPrice && metrics.activePnlPercent !== null ? (
          <View style={styles.pnlStatusRow}>
            <Text
              style={[
                styles.positionPnlText,
                { color: metrics.isPositive ? theme.positive : theme.negative },
              ]}
            >
              {metrics.isPositive ? '+' : ''}
              {formatPercentage(metrics.activePnlPercent)}
            </Text>
            {activePnlAmountDisplay !== '—' && (
              <View
                style={[
                  styles.dailyChangePill,
                  { backgroundColor: metrics.isPositive ? theme.positiveBg : theme.negativeBg },
                ]}
              >
                <Text
                  style={[
                    styles.dailyChangeText,
                    { color: metrics.isPositive ? theme.positive : theme.negative },
                  ]}
                >
                  {activePnlAmountDisplay}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.noPriceBadge, { backgroundColor: theme.surfaceHighlight }]}>
            <Text style={[styles.noPriceBadgeText, { color: theme.textMuted }]}>
              Fiyat Alınamadı
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export const PositionCard = memo(PositionCardComponent);

const styles = StyleSheet.create({
  holdingCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 8,
  },
  holdingLeft: {
    flex: 1,
    marginRight: 12,
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  symbolText: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  marketTagBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  marketTagText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  staleBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
  },
  staleBadgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  companyNameText: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  quantityCostText: {
    fontSize: 11,
    fontWeight: '500',
  },
  holdingRight: {
    alignItems: 'flex-end',
    gap: 3,
  },
  positionValueText: {
    fontSize: 15,
    fontWeight: '800',
  },
  pnlStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  positionPnlText: {
    fontSize: 12,
    fontWeight: '700',
  },
  dailyChangePill: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
  },
  dailyChangeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  noPriceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  noPriceBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
