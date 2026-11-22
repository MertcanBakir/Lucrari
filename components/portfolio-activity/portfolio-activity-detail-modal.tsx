import { useReducedMotion } from '@/hooks/use-reduced-motion';
/**
 * Lucrari — Portfolio Activity Detail Modal
 * 
 * Read-only modal bottom sheet presenting full historical details of a transaction
 *  without exposing raw UUIDs or performing destructive mutations.
 */

import React, { memo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  Platform,
} from 'react-native';
import { haptics as Haptics } from '@/services/feedback/haptics';
import { useAppTheme } from '@/context/theme-context';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  formatActivityDateTime,
  formatActivityQuantity,
  formatActivityUnitPrice,
  formatActivityGrossAmount,
  getActivityTypeMeta,
} from '@/utils/portfolio-activity-formatters';
import type { PortfolioActivityItem } from '@/types/portfolio-activity';

export interface PortfolioActivityDetailModalProps {
  visible: boolean;
  item: PortfolioActivityItem | null;
  onClose: () => void;
}

export const PortfolioActivityDetailModal = memo(function PortfolioActivityDetailModal({
  visible,
  item,
  onClose,
}: PortfolioActivityDetailModalProps) {
  const reducedMotion = useReducedMotion();
  const { colorScheme } = useAppTheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const handleClose = useCallback(async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    onClose();
  }, [onClose]);

  if (!item) return null;

  const typeMeta = getActivityTypeMeta(item.activityType);
  const isReversed = item.isReversed;

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

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouchable} onPress={handleClose} />

        <View style={[styles.sheetContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {/* Header */}
          <View style={[styles.headerRow, { borderBottomColor: theme.borderSubtle }]}>
            <View style={styles.headerTitleGroup}>
              <View style={[styles.typeIconBadge, { backgroundColor: badgeBg }]}>
                <IconSymbol size={18} name={typeMeta.icon} color={badgeColor} />
              </View>
              <View>
                <Text style={[styles.headerTitle, { color: theme.text }]}>
                  {typeMeta.label} Detayı
                </Text>
                <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
                  Salt Okunur Kayıt
                </Text>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.closeButton,
                { backgroundColor: theme.surfaceElevated },
                pressed && { opacity: 0.7 },
              ]}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Kapat"
              hitSlop={8}
            >
              <IconSymbol size={18} name="xmark" color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView style={styles.scrollBody} showsVerticalScrollIndicator={false}>
            {/* Reversal Notice if reversed */}
            {isReversed && (
              <View
                style={[
                  styles.reversalBanner,
                  {
                    backgroundColor: isDark ? 'rgba(255, 107, 107, 0.12)' : 'rgba(220, 53, 69, 0.08)',
                    borderColor: isDark ? 'rgba(255, 107, 107, 0.3)' : 'rgba(220, 53, 69, 0.2)',
                  },
                ]}
              >
                <IconSymbol size={20} name="arrow.counterclockwise" color={isDark ? '#FF6B6B' : '#DC3545'} />
                <View style={styles.reversalBannerContent}>
                  <Text style={[styles.reversalBannerTitle, { color: isDark ? '#FF6B6B' : '#DC3545' }]}>
                    Bu İşlem Geri Alınmıştır
                  </Text>
                  {item.reversedAt && (
                    <Text style={[styles.reversalBannerDate, { color: theme.textSecondary }]}>
                      Geri Alınma: {formatActivityDateTime(item.reversedAt)}
                    </Text>
                  )}
                  {item.reversalReason ? (
                    <Text style={[styles.reversalBannerReason, { color: theme.textSecondary }]}>
                      Neden: {item.reversalReason}
                    </Text>
                  ) : null}
                </View>
              </View>
            )}

            {/* Total Amount Hero Card */}
            <View style={[styles.amountHeroCard, { backgroundColor: theme.surfaceHighlight }]}>
              <Text style={[styles.amountHeroLabel, { color: theme.textSecondary }]}>
                TOPLAM TUTAR
              </Text>
              <Text style={[styles.amountHeroValue, { color: theme.text }]}>
                {formatActivityGrossAmount(item.grossAmount, item.currency)}
              </Text>
              <Text style={[styles.amountHeroCurrency, { color: theme.textMuted }]}>
                {item.currency}
              </Text>
            </View>

            {/* Transaction Specific Rows */}

              <View style={styles.detailsGroup}>
                <View style={[styles.detailRow, { borderBottomColor: theme.borderSubtle }]}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Varlık</Text>
                  <View style={styles.symbolMarketRow}>
                    <Text style={[styles.detailValueBold, { color: theme.text }]}>{item.symbol}</Text>
                    {item.market && (
                      <View style={[styles.marketBadge, { backgroundColor: theme.surfaceElevated }]}>
                        <Text style={[styles.marketBadgeText, { color: theme.textSecondary }]}>
                          {item.market}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {item.companyName ? (
                  <View style={[styles.detailRow, { borderBottomColor: theme.borderSubtle }]}>
                    <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Şirket</Text>
                    <Text style={[styles.detailValue, { color: theme.text }]} numberOfLines={2}>
                      {item.companyName}
                    </Text>
                  </View>
                ) : null}

                <View style={[styles.detailRow, { borderBottomColor: theme.borderSubtle }]}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>İşlem Adedi</Text>
                  <Text style={[styles.detailValue, { color: theme.text }]}>
                    {formatActivityQuantity(item.quantity)}
                  </Text>
                </View>

                <View style={[styles.detailRow, { borderBottomColor: theme.borderSubtle }]}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Birim Fiyat</Text>
                  <Text style={[styles.detailValue, { color: theme.text }]}>
                    {formatActivityUnitPrice(item.unitPrice, item.currency)}
                  </Text>
                </View>
              </View>

            {/* Common Date & Notes Rows */}
            <View style={styles.detailsGroup}>
              <View style={[styles.detailRow, { borderBottomColor: theme.borderSubtle }]}>
                <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>İşlem Tarihi</Text>
                <Text style={[styles.detailValue, { color: theme.text }]}>
                  {formatActivityDateTime(item.occurredAt)}
                </Text>
              </View>

              <View style={[styles.detailRow, { borderBottomColor: theme.borderSubtle }]}>
                <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Kayıt Tarihi</Text>
                <Text style={[styles.detailValue, { color: theme.textSecondary }]}>
                  {formatActivityDateTime(item.createdAt)}
                </Text>
              </View>

              {item.notes ? (
                <View style={[styles.detailColumnRow, { borderBottomColor: theme.borderSubtle }]}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Açıklama / Not</Text>
                  <Text style={[styles.notesContent, { color: theme.text }]}>
                    {item.notes}
                  </Text>
                </View>
              ) : null}
            </View>
          </ScrollView>

          {/* Footer Action */}
          <View style={[styles.modalFooter, { borderTopColor: theme.borderSubtle }]}>
            <Pressable
              style={({ pressed }) => [
                styles.doneButton,
                { backgroundColor: theme.tint },
                pressed && { opacity: 0.8 },
              ]}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Tamam"
            >
              <Text
                style={[
                  styles.doneButtonText,
                  { color: isDark ? '#000000' : '#FFFFFF' },
                ]}
              >
                Kapat
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  backdropTouchable: {
    flex: 1,
  },
  sheetContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    maxHeight: '85%',
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  typeIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  reversalBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    gap: 10,
  },
  reversalBannerContent: {
    flex: 1,
  },
  reversalBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  reversalBannerDate: {
    fontSize: 12,
    marginTop: 2,
  },
  reversalBannerReason: {
    fontSize: 12,
    marginTop: 1,
    fontStyle: 'italic',
  },
  amountHeroCard: {
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  amountHeroLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  amountHeroValue: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 4,
  },
  amountHeroCurrency: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  detailsGroup: {
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '400',
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'right',
    maxWidth: '60%',
  },
  detailValueBold: {
    fontSize: 14,
    fontWeight: '700',
  },
  symbolMarketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  marketBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  marketBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  detailColumnRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  notesContent: {
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },
  modalFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  doneButton: {
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
