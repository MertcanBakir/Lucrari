/**
 * Lucrari — Watchlist Row Component (Swipe-to-Reveal Delete)
 * 
 * Renders an individual watchlist asset card with clean, uncluttered layout:
 * - Symbol, market pill, and company name on the left.
 * - Real price formatting, percentage/amount change, and stale/missing price indicators on the right.
 * - Swipe left to reveal the dedicated "Sil" action button with smooth spring animations, mutual exclusion, and haptic feedback.
 */

import React, { useRef, useMemo, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Animated,
  PanResponder,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatCurrency, formatPercentage } from '@/utils/financial-formatters';
import {
  shouldCaptureSwipeGesture,
  resolveSwipeReleaseAction,
  computeSwipeOffset,
  DEFAULT_ACTION_WIDTH,
} from '@/utils/watchlist-swipe-helper';
import type { WatchlistItem } from '@/types/watchlist';

export interface WatchlistRowProps {
  item: WatchlistItem;
  isOpen?: boolean;
  isAnyRowOpen?: boolean;
  isPendingMutation?: boolean;
  onRemove: (instrumentId: string) => void;
  onSwipeOpen?: (instrumentId: string) => void;
  onSwipeClose?: () => void;
  onDismissOpenRows?: () => void;
}

export function WatchlistRow({
  item,
  isOpen = false,
  isAnyRowOpen = false,
  isPendingMutation = false,
  onRemove,
  onSwipeOpen,
  onSwipeClose,
  onDismissOpenRows,
}: WatchlistRowProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const translateX = useRef(new Animated.Value(0)).current;
  const isOpenRef = useRef(false);

  const snapTo = useCallback(
    (toValue: number) => {
      isOpenRef.current = toValue !== 0;
      Animated.spring(translateX, {
        toValue,
        useNativeDriver: true,
        bounciness: 4,
        speed: 16,
      }).start();
    },
    [translateX]
  );

  // Mutual exclusion: Close this row if another row is opened externally
  useEffect(() => {
    if (!isOpen && isOpenRef.current) {
      snapTo(0);
    }
  }, [isOpen, snapTo]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return shouldCaptureSwipeGesture(gestureState);
        },
        onPanResponderGrant: () => {
          translateX.stopAnimation();
        },
        onPanResponderMove: (_, gestureState) => {
          const baseOffset = isOpenRef.current ? -DEFAULT_ACTION_WIDTH : 0;
          const newOffset = computeSwipeOffset(baseOffset, gestureState.dx, DEFAULT_ACTION_WIDTH);
          translateX.setValue(newOffset);
        },
        onPanResponderRelease: (_, gestureState) => {
          const action = resolveSwipeReleaseAction(
            gestureState,
            isOpenRef.current,
            DEFAULT_ACTION_WIDTH
          );

          if (action.shouldOpen) {
            if (Platform.OS !== 'web') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }
            snapTo(action.targetOffset);
            onSwipeOpen?.(item.instrumentId);
          } else {
            snapTo(action.targetOffset);
            onSwipeClose?.();
          }
        },
        onPanResponderTerminate: () => {
          snapTo(isOpenRef.current ? -DEFAULT_ACTION_WIDTH : 0);
        },
      }),
    [translateX, snapTo, item.instrumentId, onSwipeOpen, onSwipeClose]
  );

  const handleRemovePress = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        // Fallback
      }
    }
    snapTo(0);
    onRemove(item.instrumentId);
  };

  const handleCardPress = () => {
    if (isOpenRef.current) {
      snapTo(0);
      onSwipeClose?.();
      return;
    }
    if (isAnyRowOpen) {
      onDismissOpenRows?.();
    }
  };

  // Price formatting & status
  const formattedPrice = item.hasPrice && item.price !== null
    ? formatCurrency(item.price, item.currency)
    : '—';

  // Numeric change direction
  const changeValue = item.changePercent ?? item.changeAmount ?? null;
  const isPositive = typeof changeValue === 'number' && Number.isFinite(changeValue) && changeValue > 0;
  const isNegative = typeof changeValue === 'number' && Number.isFinite(changeValue) && changeValue < 0;
  const changeColor = isPositive ? theme.positive : isNegative ? theme.negative : theme.textSecondary;
  const changeBg = isPositive ? theme.positiveBg : isNegative ? theme.negativeBg : theme.surfaceElevated;
  const changeBorder = isPositive ? theme.positiveBorder : isNegative ? theme.negativeBorder : theme.borderSubtle;

  const formattedChangePercent = typeof item.changePercent === 'number' && Number.isFinite(item.changePercent)
    ? formatPercentage(item.changePercent, true)
    : null;

  return (
    <View style={styles.swipeContainer}>
      {/* Background Revealed Action: Red Delete Button */}
      <View style={styles.actionBackground}>
        <TouchableOpacity
          style={[
            styles.deleteActionBtn,
            {
              backgroundColor: theme.negativeBg,
              borderColor: theme.negativeBorder,
            },
          ]}
          onPress={handleRemovePress}
          disabled={isPendingMutation}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`${item.symbol} varlığını izleme listesinden çıkar`}
        >
          {isPendingMutation ? (
            <ActivityIndicator size="small" color={theme.negative} />
          ) : (
            <View style={styles.deleteActionContent}>
              <IconSymbol size={16} name="trash.fill" color={theme.negative} />
              <Text style={[styles.deleteActionText, { color: theme.negative }]}>Sil</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Foreground Swipeable Card */}
      <Animated.View
        style={[
          styles.cardForeground,
          {
            backgroundColor: theme.surfaceElevated,
            borderColor: theme.borderSubtle,
            transform: [{ translateX }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={handleCardPress}
          style={styles.cardInnerTouch}
        >
          {/* Left Column: Symbol & Company Name */}
          <View style={styles.leftCol}>
            <View style={styles.symbolRow}>
              <Text style={[styles.symbolText, { color: theme.text }]}>{item.symbol}</Text>
              <View style={[styles.marketPill, { backgroundColor: theme.surfaceHighlight, borderColor: theme.borderSubtle }]}>
                <Text style={[styles.marketText, { color: theme.tint }]}>{item.market}</Text>
              </View>
            </View>

            <Text style={[styles.companyText, { color: theme.textSecondary }]} numberOfLines={1}>
              {item.companyName}
            </Text>

            {!item.isActive && (
              <Text style={[styles.inactiveText, { color: theme.warning }]}>
                Artık aktif olarak fiyatlanmıyor
              </Text>
            )}
          </View>

          {/* Right Column: Price & Change */}
          <View style={styles.rightCol}>
            <Text style={[styles.priceText, { color: theme.text }]}>{formattedPrice}</Text>

            {!item.hasPrice ? (
              <Text style={[styles.statusText, { color: theme.textMuted }]}>
                Fiyat bilgisi alınamadı
              </Text>
            ) : item.priceIsStale ? (
              <Text style={[styles.statusText, { color: theme.warning }]}>
                Fiyat güncel olmayabilir
              </Text>
            ) : formattedChangePercent !== null ? (
              <View style={[styles.changeBadge, { backgroundColor: changeBg, borderColor: changeBorder }]}>
                <Text style={[styles.changeText, { color: changeColor }]}>
                  {formattedChangePercent}
                </Text>
              </View>
            ) : (
              <Text style={[styles.statusText, { color: theme.textMuted }]}>—</Text>
            )}
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  swipeContainer: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 14,
  },
  actionBackground: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  deleteActionBtn: {
    width: DEFAULT_ACTION_WIDTH,
    height: '100%',
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteActionContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  deleteActionText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardForeground: {
    borderRadius: 14,
    borderWidth: 1,
  },
  cardInnerTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  leftCol: {
    flex: 1,
    gap: 3,
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  symbolText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  marketPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  marketText: {
    fontSize: 10,
    fontWeight: '700',
  },
  companyText: {
    fontSize: 12,
    fontWeight: '500',
  },
  inactiveText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  rightCol: {
    alignItems: 'flex-end',
    gap: 3,
    minWidth: 80,
  },
  priceText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  changeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  changeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '500',
  },
});
