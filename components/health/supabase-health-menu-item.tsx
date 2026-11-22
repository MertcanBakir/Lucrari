/**
 * Lucrari — Supabase Health Menu Item Component
 * 
 * Interactive menu row displaying live backend/DB connectivity status,
 * average latency, and navigation to the dedicated Supabase diagnostics screen.
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
import { useRouter, type Href } from 'expo-router';
import { haptics as Haptics } from '@/services/feedback/haptics';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSupabaseHealth } from '@/hooks/use-supabase-health';
import { formatLatency } from '@/utils/financial-formatters';
import type { HealthStatus } from '@/types/health';

export function SupabaseHealthMenuItem() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];
  const router = useRouter();

  const { report, isLoading } = useSupabaseHealth();

  const handlePress = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    router.push('/supabase-health' as Href);
  };

  const getStatusBadge = (status?: HealthStatus) => {
    switch (status) {
      case 'healthy':
        return {
          label: 'Sağlıklı',
          bg: theme.positiveBg,
          border: theme.positiveBorder,
          text: theme.positive,
          dot: theme.positive,
        };
      case 'degraded':
        return {
          label: 'Kısıtlı',
          bg: theme.warningBg,
          border: theme.warningBorder,
          text: theme.warning,
          dot: theme.warning,
        };
      case 'unhealthy':
        return {
          label: 'Hata',
          bg: theme.negativeBg,
          border: theme.negativeBorder,
          text: theme.negative,
          dot: theme.negative,
        };
      case 'unconfigured':
      default:
        return {
          label: 'Bekliyor',
          bg: theme.surfaceHighlight,
          border: theme.border,
          text: theme.textSecondary,
          dot: theme.textMuted,
        };
    }
  };

  const badge = getStatusBadge(report?.overallStatus);

  let subtitle = 'Veritabanı ve API Sağlık Durumu';
  if (isLoading && !report) {
    subtitle = 'Bağlantı kontrol ediliyor...';
  } else if (report) {
    if (report.overallStatus === 'healthy') {
      subtitle = report.averageLatencyMs !== null
        ? `Ortalama Gecikme: ${formatLatency(report.averageLatencyMs)}`
        : 'Veritabanı ve Auth API erişilebilir';
    } else if (report.overallStatus === 'degraded') {
      subtitle = 'Bazı servislerde gecikme veya kısıtlı erişim';
    } else if (report.overallStatus === 'unhealthy') {
      subtitle = 'Veritabanı bağlantı hatası';
    } else if (report.overallStatus === 'unconfigured') {
      subtitle = 'Supabase yapılandırması bekleniyor';
    }
  }

  return (
    <TouchableOpacity
      style={styles.menuRow}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Supabase Backend ve Veritabanı sağlık durumu ekranını aç. Durum: ${badge.label}, ${subtitle}`}
    >
      <View style={styles.menuRowLeft}>
        <View style={[styles.iconWrapper, { backgroundColor: badge.bg }]}>
          <IconSymbol size={18} name="cloud.fill" color={badge.text} />
        </View>
        <View style={styles.textContainer}>
          <Text style={[styles.menuRowTitle, { color: theme.text }]}>
            Supabase Backend & DB
          </Text>
          <Text
            style={[styles.menuRowSubtitle, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        </View>
      </View>

      <View style={styles.menuRowRight}>
        {isLoading && !report ? (
          <ActivityIndicator size="small" color={theme.textMuted} />
        ) : (
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: badge.bg, borderColor: badge.border },
            ]}
          >
            <View style={[styles.statusDot, { backgroundColor: badge.dot }]} />
            <Text style={[styles.statusBadgeText, { color: badge.text }]}>
              {badge.label}
            </Text>
          </View>
        )}
        <IconSymbol size={14} name="chevron.right" color={theme.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    paddingRight: 8,
  },
  iconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  menuRowTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  menuRowSubtitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  menuRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
