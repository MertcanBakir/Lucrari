/**
 * Lucrari — System Health Overall Card Component
 * 
 * Top banner card displaying aggregated system health status, key counts,
 * last check timestamp, stale-data notification banners, and incomplete pipeline warnings.
 */

import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatSystemHealthDateTime } from '@/utils/system-health-formatters';
import type { OverallHealthEvaluation } from '@/types/system-health';

export interface SystemHealthOverallCardProps {
  overall: OverallHealthEvaluation;
  isStale?: boolean;
  isIncomplete?: boolean;
}

export function SystemHealthOverallCard({
  overall,
  isStale,
  isIncomplete,
}: SystemHealthOverallCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const getStatusVisuals = (): {
    icon: IconSymbolName;
    bg: string;
    border: string;
    color: string;
    label: string;
  } => {
    switch (overall.status) {
      case 'healthy':
        return {
          icon: 'checkmark.circle.fill',
          bg: theme.positiveBg,
          border: theme.positiveBorder,
          color: theme.positive,
          label: 'SİSTEM SAĞLIKLI',
        };
      case 'warning':
        return {
          icon: 'exclamationmark.triangle.fill',
          bg: theme.warningBg,
          border: theme.warningBorder,
          color: theme.warning,
          label: 'DİKKAT / KISMİ DURUM',
        };
      case 'critical':
        return {
          icon: 'xmark.octagon.fill',
          bg: theme.negativeBg,
          border: theme.negativeBorder,
          color: theme.negative,
          label: 'KRİTİK HATA / ÇALIŞMIYOR',
        };
      case 'running':
        return {
          icon: 'arrow.triangle.2.circlepath',
          bg: theme.infoBg,
          border: theme.infoBorder,
          color: theme.info,
          label: 'GÜNCELLEME DEVAM EDİYOR',
        };
      case 'unknown':
      default:
        return {
          icon: 'questionmark.circle.fill',
          bg: theme.surfaceHighlight,
          border: theme.border,
          color: theme.textSecondary,
          label: 'DURUM BEKLENİYOR',
        };
    }
  };

  const visuals = getStatusVisuals();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
      accessibilityRole="summary"
    >
      {/* Top Banner Row */}
      <View style={styles.topRow}>
        <View style={[styles.iconCircle, { backgroundColor: visuals.bg }]}>
          <IconSymbol size={26} name={visuals.icon} color={visuals.color} />
        </View>

        <View style={styles.titleWrapper}>
          <View style={styles.badgeRow}>
            <View
              style={[
                styles.statusPill,
                { backgroundColor: visuals.bg, borderColor: visuals.border },
              ]}
            >
              <Text style={[styles.statusPillText, { color: visuals.color }]}>
                {visuals.label}
              </Text>
            </View>
          </View>

          <Text style={[styles.title, { color: theme.text }]}>
            {overall.title}
          </Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            {overall.subtitle}
          </Text>
        </View>
      </View>

      {/* Metrics Row */}
      <View
        style={[
          styles.metricsRow,
          { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle },
        ]}
      >
        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Toplam Servis</Text>
          <Text style={[styles.metricValue, { color: theme.text }]}>
            {overall.totalJobCount}
          </Text>
        </View>

        <View style={[styles.metricDivider, { backgroundColor: theme.borderSubtle }]} />

        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Başarısız</Text>
          <Text
            style={[
              styles.metricValue,
              { color: overall.failedCount > 0 ? theme.negative : theme.text },
            ]}
          >
            {overall.failedCount}
          </Text>
        </View>

        <View style={[styles.metricDivider, { backgroundColor: theme.borderSubtle }]} />

        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Gecikmiş</Text>
          <Text
            style={[
              styles.metricValue,
              { color: overall.overdueCount > 0 ? theme.warning : theme.text },
            ]}
          >
            {overall.overdueCount}
          </Text>
        </View>

        <View style={[styles.metricDivider, { backgroundColor: theme.borderSubtle }]} />

        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>
            {overall.unknownCount > 0 ? 'Bekleyen' : 'Çalışan'}
          </Text>
          <Text
            style={[
              styles.metricValue,
              {
                color:
                  overall.unknownCount > 0
                    ? theme.textMuted
                    : overall.runningCount > 0
                    ? theme.info
                    : theme.text,
              },
            ]}
          >
            {overall.unknownCount > 0 ? overall.unknownCount : overall.runningCount}
          </Text>
        </View>
      </View>

      {/* Incomplete Pipeline Warning Banner */}
      {isIncomplete && (
        <View
          style={[
            styles.banner,
            { backgroundColor: theme.warningBg, borderColor: theme.warningBorder },
          ]}
          accessibilityRole="alert"
          accessibilityLabel="Bazı servislerin durum bilgisi alınamadı."
        >
          <IconSymbol size={14} name="exclamationmark.triangle.fill" color={theme.warning} />
          <Text style={[styles.bannerText, { color: theme.warning }]}>
            Bazı servislerin durum bilgisi alınamadı.
          </Text>
        </View>
      )}

      {/* Stale Data Warning Banner */}
      {isStale && (
        <View
          style={[
            styles.banner,
            { backgroundColor: theme.warningBg, borderColor: theme.warningBorder },
          ]}
          accessibilityRole="alert"
          accessibilityLabel="Ağ bağlantısı sağlanamadı. Önceki kontrol verisi gösteriliyor."
        >
          <IconSymbol size={14} name="wifi.exclamationmark" color={theme.warning} />
          <Text style={[styles.bannerText, { color: theme.warning }]}>
            Ağ bağlantısı sağlanamadı. Önceki kontrol verisi gösteriliyor.
          </Text>
        </View>
      )}

      {/* Footer Timestamp */}
      {overall.checkedAt && (
        <View style={styles.footerRow}>
          <Text style={[styles.footerText, { color: theme.textMuted }]}>
            Son Sunucu Kontrolü: {formatSystemHealthDateTime(overall.checkedAt)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
    gap: 14,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrapper: {
    flex: 1,
    gap: 3,
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  metricItem: {
    alignItems: 'center',
    gap: 2,
    flex: 1,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  metricValue: {
    fontSize: 15,
    fontWeight: '800',
  },
  metricDivider: {
    width: 1,
    height: 24,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerText: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  footerRow: {
    alignItems: 'center',
  },
  footerText: {
    fontSize: 11,
    fontWeight: '500',
  },
});
