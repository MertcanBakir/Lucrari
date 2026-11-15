/**
 * Portfolio Summary Card Component
 * 
 * Displays total portfolio value (positions + available cash), positions breakdown,
 * cash summary, setup CTA for uninitialized legacy accounts, and interactive PnL toggle box.
 * 
 * STRICT COMPLIANCE:
 * - NO hardcoded reference FX rate.
 * - Total Portfolio Value = Positions Market Value + Available Cash.
 * - Cash is non-negative at the domain and DB level.
 * - Handles partial valuation when market prices, FX rates, or cash accounts are missing.
 */

import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatPercentage } from '@/utils/financial-formatters';
import {
  formatPortfolioValue,
  type CurrencyMode,
  type PnlMode,
  type PortfolioStats,
} from '@/utils/financial-math';

export interface PortfolioSummaryCardProps {
  stats: PortfolioStats;
  currencyMode: CurrencyMode;
  pnlMode: PnlMode;
  usdTryRate: number | null;
  onTogglePnlMode: () => void;
  onToggleCurrency: () => void;
  onOpenChart: () => void;
  onOpenCashSetup?: () => void;
}

export function PortfolioSummaryCard({
  stats,
  currencyMode,
  pnlMode,
  usdTryRate,
  onTogglePnlMode,
  onToggleCurrency,
  onOpenChart,
  onOpenCashSetup,
}: PortfolioSummaryCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const isDaily = pnlMode === 'DAILY';
  const activeAmount = isDaily ? stats.dailyPnlTry : stats.unrealizedPnlTry;
  const activePct = isDaily ? stats.dailyPnlPct : stats.totalPnlPct;
  const hasPnl = activeAmount !== null && activePct !== null;
  const isPositive = (activeAmount ?? 0) >= 0;

  // Portfolio total value
  const totalValue =
    stats.totalPortfolioValueTry !== null
      ? stats.totalPortfolioValueTry
      : stats.knownPortfolioValueTry;
  const positionsValue =
    stats.positionsMarketValueTry !== null
      ? stats.positionsMarketValueTry
      : stats.knownPositionsMarketValueTry;
  const isPartial = !stats.isValuationComplete;

  return (
    <View style={[styles.wealthCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {/* Top Header Row */}
      <View style={styles.wealthTopRow}>
        <View style={styles.wealthLabelRow}>
          <Text style={[styles.wealthLabel, { color: theme.textSecondary }]}>
            Toplam Portföy Değeri
          </Text>
          {isPartial && (
            <View style={[styles.partialBadge, { backgroundColor: 'rgba(208, 165, 103, 0.15)' }]}>
              <Text style={[styles.partialBadgeText, { color: theme.warning }]}>Kısmi</Text>
            </View>
          )}
        </View>

        {/* Performance Chart Icon Button */}
        <TouchableOpacity
          style={[
            styles.chartIconButton,
            { backgroundColor: theme.surfaceElevated, borderColor: theme.tintBorder },
          ]}
          onPress={onOpenChart}
          activeOpacity={0.7}
        >
          <IconSymbol size={15} name="chart.line.uptrend.xyaxis" color={theme.tint} />
        </TouchableOpacity>
      </View>

      {/* Big Portfolio Total Value — Tapping toggles TRY / USD */}
      <TouchableOpacity onPress={onToggleCurrency} activeOpacity={0.7}>
        <Text style={[styles.wealthValue, { color: theme.text }]}>
          {formatPortfolioValue(totalValue, currencyMode, usdTryRate)}
        </Text>
      </TouchableOpacity>

      {/* Sub-breakdown Row: Pozisyonlar + Kullanılabilir Nakit */}
      <View style={styles.breakdownRow}>
        <View style={styles.breakdownItem}>
          <Text style={[styles.breakdownLabel, { color: theme.textSecondary }]}>Pozisyonlar:</Text>
          <Text style={[styles.breakdownValue, { color: theme.text }]}>
            {formatPortfolioValue(positionsValue, currencyMode, usdTryRate)}
          </Text>
        </View>

        <View style={styles.breakdownDivider} />

        <View style={styles.breakdownItem}>
          <Text style={[styles.breakdownLabel, { color: theme.textSecondary }]}>Nakit:</Text>
          {stats.isCashInitialized ? (
            <Text style={[styles.breakdownValue, { color: theme.text }]}>
              {formatPortfolioValue(stats.cashValueTry, currencyMode, usdTryRate)}
            </Text>
          ) : (
            <TouchableOpacity onPress={onOpenCashSetup} activeOpacity={0.7}>
              <Text style={[styles.setupLinkText, { color: theme.tint }]}>Kurulum Gerekli</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Cash Account Setup CTA Banner for Uninitialized Portfolios */}
      {!stats.isCashInitialized && onOpenCashSetup && (
        <TouchableOpacity
          style={[
            styles.setupCtaBanner,
            { backgroundColor: theme.surfaceElevated, borderColor: theme.tintBorder },
          ]}
          onPress={onOpenCashSetup}
          activeOpacity={0.7}
        >
          <View style={styles.setupCtaLeft}>
            <IconSymbol size={16} name="banknote" color={theme.tint} />
            <Text style={[styles.setupCtaText, { color: theme.text }]}>
              Nakit Bakiyenizi Kurun
            </Text>
          </View>
          <IconSymbol size={12} name="chevron.right" color={theme.tint} />
        </TouchableOpacity>
      )}

      {/* Interactive PnL Box: Default Daily PnL, Tapping toggles Total PnL */}
      <TouchableOpacity
        style={[
          styles.pnlInteractiveBox,
          { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle },
        ]}
        onPress={onTogglePnlMode}
        activeOpacity={0.7}
      >
        <View style={styles.pnlBoxLeft}>
          <Text style={[styles.pnlBoxLabel, { color: theme.textSecondary }]}>
            {isDaily ? 'Günlük Değişim' : 'Toplam Kâr / Zarar'}
          </Text>
          <Text
            style={[
              styles.pnlBoxValue,
              { color: hasPnl ? (isPositive ? theme.positive : theme.negative) : theme.textMuted },
            ]}
          >
            {hasPnl ? `${isPositive ? '+' : ''}${formatPortfolioValue(activeAmount, currencyMode, usdTryRate)}` : '—'}
          </Text>
        </View>

        <View style={styles.pnlBoxRight}>
          {hasPnl && activePct !== null ? (
            <View
              style={[
                styles.pnlBadge,
                { backgroundColor: isPositive ? theme.positiveBg : theme.negativeBg },
              ]}
            >
              <Text
                style={[
                  styles.pnlBadgeText,
                  { color: isPositive ? theme.positive : theme.negative },
                ]}
              >
                {formatPercentage(activePct)}
              </Text>
            </View>
          ) : (
            <View style={[styles.pnlBadge, { backgroundColor: theme.surfaceHighlight }]}>
              <Text style={[styles.pnlBadgeText, { color: theme.textMuted }]}>—</Text>
            </View>
          )}

          <View style={[styles.pnlModePill, { backgroundColor: theme.surfaceHighlight }]}>
            <Text style={[styles.pnlModePillText, { color: theme.tint }]}>
              {isDaily ? 'Bugün' : 'Tüm Zamanlar'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Valuation Warning Notification */}
      {stats.valuationWarning && (
        <View style={[styles.valuationWarningRow, { backgroundColor: 'rgba(208, 165, 103, 0.08)' }]}>
          <IconSymbol size={13} name="exclamationmark.triangle.fill" color={theme.warning} />
          <Text style={[styles.valuationWarningText, { color: theme.warning }]}>
            {stats.valuationWarning}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wealthCard: {
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    marginBottom: 14,
  },
  wealthTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  wealthLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  wealthLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  partialBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  partialBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  chartIconButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wealthValue: {
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -1,
    marginVertical: 4,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
    gap: 12,
  },
  breakdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  breakdownLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  breakdownValue: {
    fontSize: 12,
    fontWeight: '700',
  },
  breakdownDivider: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(150, 150, 150, 0.3)',
  },
  setupLinkText: {
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  setupCtaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginVertical: 6,
  },
  setupCtaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  setupCtaText: {
    fontSize: 12,
    fontWeight: '700',
  },
  pnlInteractiveBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 14,
    padding: 12,
    marginTop: 6,
    borderWidth: 1,
  },
  pnlBoxLeft: {
    gap: 2,
  },
  pnlBoxLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  pnlBoxValue: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  pnlBoxRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pnlBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  pnlBadgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  pnlModePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pnlModePillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  valuationWarningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  valuationWarningText: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
});
