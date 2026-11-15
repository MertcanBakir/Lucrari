/**
 * Lucrari — System Health Menu Item Component
 * 
 * Integrated menu row displaying live high-level system status and last check time,
 * with navigation to the detailed system health view.
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
import * as Haptics from 'expo-haptics';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSystemHealth } from '@/hooks/use-system-health';
import { formatSystemHealthDateTime } from '@/utils/system-health-formatters';
import type { OverallHealthStatus } from '@/types/system-health';

export function SystemHealthMenuItem() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];
  const router = useRouter();

  const { report, isLoading, error } = useSystemHealth();

  const handlePress = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    router.push('/system-health' as Href);
  };

  const getStatusVisuals = (status?: OverallHealthStatus) => {
    switch (status) {
      case 'healthy':
        return {
          label: 'Normal',
          bg: theme.positiveBg,
          border: theme.positiveBorder,
          text: theme.positive,
          dot: theme.positive,
        };
      case 'warning':
        return {
          label: 'Dikkat',
          bg: theme.warningBg,
          border: theme.warningBorder,
          text: theme.warning,
          dot: theme.warning,
        };
      case 'critical':
        return {
          label: 'Kritik',
          bg: theme.negativeBg,
          border: theme.negativeBorder,
          text: theme.negative,
          dot: theme.negative,
        };
      case 'running':
        return {
          label: 'Çalışıyor',
          bg: theme.infoBg,
          border: theme.infoBorder,
          text: theme.info,
          dot: theme.info,
        };
      case 'unknown':
      default:
        return {
          label: 'Bekleniyor',
          bg: theme.surfaceHighlight,
          border: theme.border,
          text: theme.textSecondary,
          dot: theme.textMuted,
        };
    }
  };

  const visuals = getStatusVisuals(report?.overall.status);

  // Subtitle text construction
  let subtitleText = 'Tüm sistemler normal';
  if (isLoading && !report) {
    subtitleText = 'Durum kontrol ediliyor...';
  } else if (error && !report) {
    subtitleText = 'Durum bilgisi alınamadı';
  } else if (report) {
    if (report.overall.status === 'healthy') {
      subtitleText = report.overall.checkedAt
        ? `Son kontrol: ${formatSystemHealthDateTime(report.overall.checkedAt)}`
        : 'Tüm sistemler normal';
    } else {
      subtitleText = report.overall.subtitle || report.overall.title;
    }
  }

  return (
    <TouchableOpacity
      style={styles.menuRow}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Sistem ve Veri Durumu ekranını aç. Durum: ${visuals.label}, ${subtitleText}`}
    >
      <View style={styles.menuRowLeft}>
        <View
          style={[
            styles.iconWrapper,
            { backgroundColor: visuals.bg },
          ]}
        >
          <IconSymbol
            size={18}
            name="server.rack"
            color={visuals.text}
          />
        </View>
        <View style={styles.textContainer}>
          <Text style={[styles.menuRowTitle, { color: theme.text }]}>
            Sistem ve Veri Durumu
          </Text>
          <Text
            style={[styles.menuRowSubtitle, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {subtitleText}
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
              { backgroundColor: visuals.bg, borderColor: visuals.border },
            ]}
          >
            <View style={[styles.statusDot, { backgroundColor: visuals.dot }]} />
            <Text style={[styles.statusBadgeText, { color: visuals.text }]}>
              {visuals.label}
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
