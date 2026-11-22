/**
 * Supabase Health Card Component
 * Theme: Executive Platinum & Champagne Amber
 * 
 * Displays rich financial-grade diagnostics for Supabase backend connectivity,
 * PostgREST database query reachability, and Auth service latency.
 */

import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { haptics as Haptics } from '@/services/feedback/haptics';
import { useSupabaseHealth } from '@/hooks/use-supabase-health';
import { formatLatency, formatDateTime, EMPTY_VALUE_PLACEHOLDER } from '@/utils/financial-formatters';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import type { HealthStatus, CheckStatus, ServiceCheckItem } from '@/types/health';

export interface SupabaseHealthCardProps {
  onRefreshCompleted?: () => void;
}

export function SupabaseHealthCard({ onRefreshCompleted }: SupabaseHealthCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const { report, isLoading, isRefetching, refetch, lastChecked } = useSupabaseHealth();

  const handleRefresh = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Haptic not supported or failed
      }
    }
    await refetch();
    onRefreshCompleted?.();
  };

  const getStatusBadge = (status?: HealthStatus) => {
    switch (status) {
      case 'healthy':
        return { label: 'SİSTEM SAĞLIKLI', bg: theme.positiveBg, border: theme.positiveBorder, text: theme.positive, dot: theme.positive };
      case 'degraded':
        return { label: 'KISITLI ERİŞİM', bg: theme.warningBg, border: theme.warning, text: theme.warning, dot: theme.warning };
      case 'unhealthy':
        return { label: 'BAĞLANTI HATASI', bg: theme.negativeBg, border: theme.negativeBorder, text: theme.negative, dot: theme.negative };
      case 'unconfigured':
      default:
        return { label: 'YAPILANDIRMA BEKLİYOR', bg: theme.surfaceHighlight, border: theme.border, text: theme.textSecondary, dot: theme.textMuted };
    }
  };

  const getCheckIcon = (status: CheckStatus) => {
    switch (status) {
      case 'pass':
        return { symbol: '✓', color: theme.positive };
      case 'warn':
        return { symbol: '!', color: theme.warning };
      case 'fail':
        return { symbol: '✕', color: theme.negative };
      case 'skipped':
      default:
        return { symbol: '—', color: theme.textMuted };
    }
  };

  const badge = getStatusBadge(report?.overallStatus);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {/* Card Header */}
      <View style={styles.headerRow}>
        <View style={styles.titleWrapper}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>
            Supabase Backend & DB
          </Text>
          <Text style={[styles.cardSubtitle, { color: theme.textSecondary }]}>
            Veritabanı ve API Sağlık Durumu
          </Text>
        </View>

        <View style={[styles.badge, { backgroundColor: badge.bg, borderColor: badge.border }]}>
          <View style={[styles.badgeDot, { backgroundColor: badge.dot }]} />
          <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
        </View>
      </View>

      {/* Metrics Row */}
      <View style={[styles.metricsContainer, { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }]}>
        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Ortalama Gecikme</Text>
          <Text style={[styles.metricValue, { color: theme.text }]}>
            {isLoading ? '...' : formatLatency(report?.averageLatencyMs)}
          </Text>
        </View>

        <View style={[styles.metricDivider, { backgroundColor: theme.border }]} />

        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Son Kontrol</Text>
          <Text style={[styles.metricValueSmall, { color: theme.text }]}>
            {lastChecked ? formatDateTime(lastChecked) : EMPTY_VALUE_PLACEHOLDER}
          </Text>
        </View>
      </View>

      {/* Unconfigured Alert Box */}
      {report && !report.isConfigured && (
        <View style={[styles.unconfiguredBox, { backgroundColor: theme.tintMuted, borderColor: theme.tintBorder }]}>
          <Text style={[styles.unconfiguredTitle, { color: theme.tint }]}>💡 Yapılandırma Gerekli</Text>
          <Text style={[styles.unconfiguredDesc, { color: theme.textSecondary }]}>
            Supabase projenizi bağlamak için proje kökündeki <Text style={[styles.codeText, { color: theme.tint }]}>.env</Text> dosyasına{' '}
            <Text style={[styles.codeText, { color: theme.tint }]}>EXPO_PUBLIC_SUPABASE_URL</Text> ve{' '}
            <Text style={[styles.codeText, { color: theme.tint }]}>EXPO_PUBLIC_SUPABASE_ANON_KEY</Text> değişkenlerini ekleyin.
          </Text>
        </View>
      )}

      {/* Diagnostics List */}
      {isLoading && !report ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={theme.tint} />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Bağlantı kontrolleri yapılıyor...</Text>
        </View>
      ) : (
        <View style={styles.checksList}>
          {report?.checks.map((item: ServiceCheckItem) => {
            const checkIcon = getCheckIcon(item.status);
            return (
              <View
                key={item.id}
                style={[
                  styles.checkRow,
                  { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }
                ]}
              >
                <View style={[styles.checkIconWrapper, { borderColor: checkIcon.color }]}>
                  <Text style={[styles.checkIconText, { color: checkIcon.color }]}>
                    {checkIcon.symbol}
                  </Text>
                </View>

                <View style={styles.checkContent}>
                  <View style={styles.checkTitleRow}>
                    <Text style={[styles.checkName, { color: theme.text }]}>
                      {item.name}
                    </Text>
                    {item.latencyMs !== null && (
                      <Text style={[styles.checkLatency, { color: theme.textSecondary }]}>
                        {formatLatency(item.latencyMs)}
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.checkMessage, { color: theme.textMuted }]} numberOfLines={2}>
                    {item.message}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Refresh Button */}
      <TouchableOpacity
        style={[
          styles.refreshButton,
          { backgroundColor: theme.tint },
          isRefetching && styles.refreshButtonDisabled,
        ]}
        onPress={handleRefresh}
        disabled={isLoading || isRefetching}
        activeOpacity={0.8}
      >
        {isRefetching ? (
          <ActivityIndicator size="small" color={isDark ? '#121316' : '#FFFFFF'} />
        ) : (
          <Text style={[styles.refreshButtonText, { color: isDark ? '#121316' : '#FFFFFF' }]}>
            Bağlantıyı Yeniden Kontrol Et
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 18,
    marginVertical: 12,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 6,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  titleWrapper: {
    flex: 1,
    paddingRight: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  metricsContainer: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricDivider: {
    width: 1,
    height: 28,
  },
  metricLabel: {
    fontSize: 11,
    marginBottom: 4,
    fontWeight: '500',
  },
  metricValue: {
    fontSize: 17,
    fontWeight: '700',
  },
  metricValueSmall: {
    fontSize: 13,
    fontWeight: '600',
  },
  unconfiguredBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  unconfiguredTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  unconfiguredDesc: {
    fontSize: 12,
    lineHeight: 18,
  },
  codeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '600',
  },
  loadingContainer: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
  },
  checksList: {
    gap: 8,
    marginBottom: 16,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  checkIconWrapper: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkIconText: {
    fontSize: 12,
    fontWeight: '800',
  },
  checkContent: {
    flex: 1,
  },
  checkTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  checkName: {
    fontSize: 13,
    fontWeight: '600',
  },
  checkLatency: {
    fontSize: 12,
    fontWeight: '500',
  },
  checkMessage: {
    fontSize: 11,
    marginTop: 2,
  },
  refreshButton: {
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButtonDisabled: {
    opacity: 0.6,
  },
  refreshButtonText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
