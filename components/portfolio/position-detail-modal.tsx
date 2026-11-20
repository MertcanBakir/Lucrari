/**
 * Position Detail Modal Component (Modal 5)
 * 
 * Deep inspection of a chosen portfolio holding with full financial breakdown
 * (Quantity, Valuation, Average Cost, Market Price, Daily Change, Unrealized PnL, Realized PnL)
 * and direct quick Alış/Satış action triggers.
 * 
 * STRICT COMPLIANCE:
 * - NO hardcoded reference FX rate.
 * - Missing market price displayed as '—'.
 * - Stale price indicators.
 */

import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  TouchableWithoutFeedback,
} from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatCurrency, formatPercentage } from '@/utils/financial-formatters';
import {
  convertUsdToTry,
  convertTryToUsd,
  type CurrencyMode,
} from '@/utils/financial-math';
import type { PortfolioPosition } from '@/types/database';

export interface PositionDetailModalProps {
  visible: boolean;
  position: PortfolioPosition | null;
  currencyMode: CurrencyMode;
  usdTryRate: number | null;
  onClose: () => void;
  onTrade: (action: 'BUY' | 'SELL') => void;
}

export function PositionDetailModal({
  visible,
  position,
  currencyMode,
  usdTryRate,
  onClose,
  onTrade,
}: PositionDetailModalProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  if (!position) return null;

  const isUsd = position.currency === 'USD';
  const isStale = Boolean(position.price_is_stale);

  const rawLatest = position.latest_price;
  const numLatest = rawLatest != null ? Number(rawLatest) : null;
  const hasPrice = numLatest != null && Number.isFinite(numLatest) && numLatest > 0;
  const latestPrice = hasPrice ? numLatest : null;

  const qty = Number(position.quantity) || 0;
  const avgCost = Number(position.average_cost ?? 0) || 0;
  const posCostNative = Number(position.remaining_cost_basis) || (qty * avgCost);
  const realizedPnl = Number(position.realized_pnl) || 0;

  // Market Value in Native Currency
  const posValNative = hasPrice && latestPrice !== null ? qty * latestPrice : null;

  // Market Value in Display Currency
  let posValDisplay = '—';
  if (posValNative !== null) {
    if (currencyMode === 'USD') {
      if (isUsd) {
        posValDisplay = formatCurrency(posValNative, 'USD');
      } else {
        const usd = convertTryToUsd(posValNative, usdTryRate);
        posValDisplay = usd !== null ? formatCurrency(usd, 'USD') : '—';
      }
    } else {
      if (!isUsd) {
        posValDisplay = formatCurrency(posValNative, 'TRY');
      } else {
        const tryVal = convertUsdToTry(posValNative, usdTryRate);
        posValDisplay = tryVal !== null ? formatCurrency(tryVal, 'TRY') : '—';
      }
    }
  }

  // Unrealized PnL
  const totalPnlNative =
    hasPrice && posValNative !== null
      ? (position.unrealized_pnl != null ? Number(position.unrealized_pnl) : posValNative - posCostNative)
      : null;
  const totalPnlPct =
    totalPnlNative !== null && posCostNative > 0 ? (totalPnlNative / posCostNative) * 100 : null;
  const isTotalPos = totalPnlNative !== null ? totalPnlNative >= 0 : true;

  // Daily PnL
  const dailyPct = position.change_percent != null ? Number(position.change_percent) : null;
  const dailyAmtNative =
    hasPrice && latestPrice !== null && dailyPct !== null
      ? Number(position.change_amount ?? (latestPrice * (dailyPct / 100)))
      : null;
  const dailyPnlNative = dailyAmtNative !== null ? qty * dailyAmtNative : null;
  const isDailyPos = dailyPct !== null ? dailyPct >= 0 : true;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.modalBackdropDismiss} />
        </TouchableWithoutFeedback>

        <View
          style={[
            styles.modalContentCard,
            { backgroundColor: theme.surface, borderColor: theme.tintBorder },
          ]}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={styles.modalScrollableInner}
          >
            <View style={styles.modalHeaderRow}>
              <View>
                <View style={styles.symbolRow}>
                  <Text style={[styles.modalSymbol, { color: theme.text }]}>
                    {position.symbol}
                  </Text>
                  <View style={[styles.marketTagBadge, { backgroundColor: theme.tintMuted }]}>
                    <Text style={[styles.marketTagText, { color: theme.tint }]}>
                      {position.market}
                    </Text>
                  </View>
                  {isStale && (
                    <View style={[styles.staleBadge, { backgroundColor: 'rgba(208, 165, 103, 0.15)' }]}>
                      <Text style={[styles.staleBadgeText, { color: theme.warning }]}>Eski Fiyat</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.modalCompanyName, { color: theme.textSecondary }]}>
                  {position.company_name}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.modalCloseBtn, { backgroundColor: theme.surfaceHighlight }]}
                onPress={onClose}
                activeOpacity={0.7}
              >
                <IconSymbol size={16} name="xmark" color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Comprehensive Detail Grid */}
            <View
              style={[
                styles.modalDetailGrid,
                { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle },
              ]}
            >
              {/* Row 1: Miktar & Toplam Piyasa Değeri */}
              <View style={styles.detailGridRow}>
                <View style={styles.detailGridCol}>
                  <Text style={[styles.detailGridLabel, { color: theme.textSecondary }]}>
                    Toplam Miktar
                  </Text>
                  <Text style={[styles.detailGridVal, { color: theme.text }]}>
                    {position.quantity} Adet
                  </Text>
                </View>
                <View style={styles.detailGridCol}>
                  <Text style={[styles.detailGridLabel, { color: theme.textSecondary }]}>
                    Piyasa Değeri
                  </Text>
                  <Text style={[styles.detailGridVal, { color: theme.text }]}>
                    {posValDisplay}
                  </Text>
                </View>
              </View>

              <View style={[styles.gridDivider, { backgroundColor: theme.borderSubtle }]} />

              {/* Row 2: Ortalama Maliyet & Güncel Fiyat */}
              <View style={styles.detailGridRow}>
                <View style={styles.detailGridCol}>
                  <Text style={[styles.detailGridLabel, { color: theme.textSecondary }]}>
                    Ortalama Maliyet
                  </Text>
                  <Text style={[styles.detailGridVal, { color: theme.text }]}>
                    {formatCurrency(avgCost, position.currency)}
                  </Text>
                </View>
                <View style={styles.detailGridCol}>
                  <Text style={[styles.detailGridLabel, { color: theme.textSecondary }]}>
                    Güncel Fiyat
                  </Text>
                  <Text style={[styles.detailGridVal, { color: theme.text }]}>
                    {hasPrice && latestPrice !== null
                      ? formatCurrency(latestPrice, position.currency)
                      : '— (Alınamadı)'}
                  </Text>
                </View>
              </View>

              <View style={[styles.gridDivider, { backgroundColor: theme.borderSubtle }]} />

              {/* Row 3: Günlük Değişim & Toplam K/Z */}
              <View style={styles.detailGridRow}>
                <View style={styles.detailGridCol}>
                  <Text style={[styles.detailGridLabel, { color: theme.textSecondary }]}>
                    Günlük Değişim
                  </Text>
                  <Text
                    style={[
                      styles.detailGridVal,
                      { color: isDailyPos ? theme.positive : theme.negative },
                    ]}
                  >
                    {dailyPct !== null ? (
                      `${isDailyPos ? '+' : ''}${formatPercentage(dailyPct)}${dailyPnlNative !== null ? ` (${isDailyPos ? '+' : ''}${formatCurrency(dailyPnlNative, position.currency)})` : ''}`
                    ) : (
                      '—'
                    )}
                  </Text>
                </View>
                <View style={styles.detailGridCol}>
                  <Text style={[styles.detailGridLabel, { color: theme.textSecondary }]}>
                    Açık Pozisyon Kâr / Zarar
                  </Text>
                  <Text
                    style={[
                      styles.detailGridVal,
                      { color: isTotalPos ? theme.positive : theme.negative },
                    ]}
                  >
                    {totalPnlPct !== null && totalPnlNative !== null ? (
                      `${isTotalPos ? '+' : ''}${formatPercentage(totalPnlPct)} (${isTotalPos ? '+' : ''}${formatCurrency(totalPnlNative, position.currency)})`
                    ) : (
                      '—'
                    )}
                  </Text>
                </View>
              </View>

              {/* Optional Row 4: Satışlardan Kâr / Zarar */}
              {realizedPnl !== 0 && (
                <>
                  <View style={[styles.gridDivider, { backgroundColor: theme.borderSubtle }]} />
                  <View style={styles.detailGridRow}>
                    <View style={styles.detailGridCol}>
                      <Text style={[styles.detailGridLabel, { color: theme.textSecondary }]}>
                        Satışlardan Kâr / Zarar
                      </Text>
                      <Text
                        style={[
                          styles.detailGridVal,
                          { color: realizedPnl >= 0 ? theme.positive : theme.negative },
                        ]}
                      >
                        {realizedPnl >= 0 ? '+' : ''}
                        {formatCurrency(realizedPnl, position.currency)}
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </View>

            {/* Dedicated Quick Action Buttons (Opens Direct Position Trade UI) */}
            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={[styles.modalActionBuyBtn, { backgroundColor: theme.positive }]}
                onPress={() => onTrade('BUY')}
                activeOpacity={0.8}
              >
                <Text style={styles.modalActionBtnText}>+ Alış Yap</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalActionSellBtn, { backgroundColor: theme.negative }]}
                onPress={() => onTrade('SELL')}
                activeOpacity={0.8}
              >
                <Text style={styles.modalActionBtnText}>- Satış Yap</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalBackdropDismiss: {
    flex: 1,
  },
  modalContentCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    maxHeight: '88%',
    paddingBottom: 24,
  },
  modalScrollableInner: {
    padding: 20,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  modalSymbol: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  marketTagBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  marketTagText: {
    fontSize: 10,
    fontWeight: '800',
  },
  staleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  staleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  modalCompanyName: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDetailGrid: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
    gap: 12,
  },
  detailGridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailGridCol: {
    flex: 1,
  },
  detailGridLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  detailGridVal: {
    fontSize: 14,
    fontWeight: '800',
  },
  gridDivider: {
    height: 1,
    width: '100%',
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  modalActionBuyBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalActionSellBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalActionBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
