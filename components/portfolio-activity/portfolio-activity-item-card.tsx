/**
 * Lucrari — Portfolio Activity Item Card
 * 
 * Renders an individual transaction activity row with
 * rich semantic formatting, market tag, reversal state, and accessibility support.
 */

import React, { memo, useCallback } from 'react';
import { StyleSheet, View, Text, Pressable, Platform } from 'react-native';
import { haptics as Haptics } from '@/services/feedback/haptics';
import { useAppTheme } from '@/context/theme-context';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  formatActivityTime,
  formatActivityQuantity,
  formatActivityUnitPrice,
  formatActivityGrossAmount,
  getActivityTypeMeta,
} from '@/utils/portfolio-activity-formatters';
import type { PortfolioActivityItem } from '@/types/portfolio-activity';

export interface PortfolioActivityItemCardProps {
  item: PortfolioActivityItem;
  onPress: (item: PortfolioActivityItem) => void;
}

export const PortfolioActivityItemCard = memo(function PortfolioActivityItemCard({
  item,
  onPress,
}: PortfolioActivityItemCardProps) {
  const { colorScheme } = useAppTheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const typeMeta = getActivityTypeMeta(item.activityType);
  const isReversed = item.isReversed;

  const handlePress = useCallback(async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    onPress(item);
  }, [item, onPress]);

  // Color semantics based on activity type and reversal state
  let badgeColor = theme.tint;
  let badgeBg = isDark ? 'rgba(78, 205, 196, 0.15)' : 'rgba(10, 126, 164, 0.1)';

  if (isReversed) {
    badgeColor = theme.textMuted;
    badgeBg = theme.surfaceHighlight;
  } else if (item.activityType === 'BUY') {
    badgeColor = isDark ? '#4ECDC4' : '#0A7EA4';
    badgeBg = isDark ? 'rgba(78, 205, 196, 0.15)' : 'rgba(10, 126, 164, 0.1)';
  } else if (item.activityType === 'SELL') {
    badgeColor = isDark ? '#9BA1A6' : '#687076';
    badgeBg = theme.surfaceHighlight;

  }

  const timeStr = formatActivityTime(item.occurredAt);
  const formattedGross = formatActivityGrossAmount(item.grossAmount, item.currency);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
        },
        isReversed && { opacity: 0.65 },
        pressed && { opacity: 0.8 },
      ]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${typeMeta.label}, ${item.symbol}, ${timeStr}${isReversed ? ', Geri Alındı' : ''}`}
      accessibilityHint="Detayları görüntülemek için dokunun"
    >
      <View style={styles.cardHeader}>
        {/* Left: Icon & Type Tag */}
        <View style={styles.leftMeta}>
          <View style={[styles.typeIconBadge, { backgroundColor: badgeBg }]}>
            <IconSymbol size={16} name={typeMeta.icon} color={badgeColor} />
          </View>
          <View style={styles.typeTextContainer}>
            <View style={styles.typeBadgeRow}>
              <Text style={[styles.typeBadgeLabel, { color: badgeColor }]}>
                {typeMeta.shortLabel}
              </Text>
              {isReversed && (
                <View
                  style={[
                    styles.reversedBadge,
                    { backgroundColor: theme.surfaceHighlight, borderColor: theme.borderSubtle },
                  ]}
                >
                  <Text style={[styles.reversedBadgeText, { color: theme.textMuted }]}>
                    Geri Alındı
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.timeText, { color: theme.textMuted }]}>
              {timeStr}
            </Text>
          </View>
        </View>

        {/* Right: Gross Total Amount */}
        <View style={styles.rightAmount}>
          <Text
            style={[
              styles.grossAmountText,
              {
                color: isReversed ? theme.textMuted : theme.text,
                textDecorationLine: isReversed ? 'line-through' : 'none',
              },
            ]}
          >
            {formattedGross}
          </Text>
        </View>
      </View>

      {/* Detail Body */}

        <View style={styles.transactionBody}>
          <View style={styles.symbolRow}>
            <Text style={[styles.symbolText, { color: theme.text }]} numberOfLines={1}>
              {item.symbol}
            </Text>
            {item.market && (
              <View style={[styles.marketTag, { backgroundColor: theme.surfaceHighlight }]}>
                <Text style={[styles.marketTagText, { color: theme.textSecondary }]}>
                  {item.market}
                </Text>
              </View>
            )}
          </View>
          {item.companyName ? (
            <Text style={[styles.companyText, { color: theme.textSecondary }]} numberOfLines={1}>
              {item.companyName}
            </Text>
          ) : null}

          <View style={[styles.financialsRow, { borderTopColor: theme.borderSubtle }]}>
            <Text style={[styles.financialsText, { color: theme.textSecondary }]}>
              {formatActivityQuantity(item.quantity)} × {formatActivityUnitPrice(item.unitPrice, item.currency)}
            </Text>
          </View>
        </View>

    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  typeIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  typeTextContainer: {
    justifyContent: 'center',
  },
  typeBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  typeBadgeLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  reversedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  reversedBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  timeText: {
    fontSize: 11,
    fontWeight: '400',
    marginTop: 1,
  },
  rightAmount: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  grossAmountText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  transactionBody: {
    marginTop: 8,
    paddingTop: 6,
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  symbolText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  marketTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  marketTagText: {
    fontSize: 10,
    fontWeight: '600',
  },
  companyText: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  financialsRow: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  financialsText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
