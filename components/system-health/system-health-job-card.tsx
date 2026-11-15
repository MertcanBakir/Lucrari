/**
 * Lucrari — System Health Job Card Component
 * 
 * Detailed presentation card for an individual background job / data pipeline,
 * including health badges, execution status, timestamps, duration, and localized explanations.
 */

import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  formatJobExecutionStatus,
  formatJobMessageCode,
  formatDurationSeconds,
  formatSystemHealthDateTime,
} from '@/utils/system-health-formatters';
import type { NormalizedJobHealthItem, JobHealthStatus } from '@/types/system-health';

export interface SystemHealthJobCardProps {
  item: NormalizedJobHealthItem;
}

export function SystemHealthJobCard({ item }: SystemHealthJobCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const getHealthVisuals = (health: JobHealthStatus): {
    icon: IconSymbolName;
    bg: string;
    border: string;
    color: string;
    label: string;
  } => {
    switch (health) {
      case 'healthy':
        return {
          icon: 'checkmark.circle.fill',
          bg: theme.positiveBg,
          border: theme.positiveBorder,
          color: theme.positive,
          label: 'Normal',
        };
      case 'warning':
        return {
          icon: 'exclamationmark.triangle.fill',
          bg: theme.warningBg,
          border: theme.warningBorder,
          color: theme.warning,
          label: item.isOverdue ? 'Gecikmiş' : 'Dikkat',
        };
      case 'critical':
        return {
          icon: 'xmark.circle.fill',
          bg: theme.negativeBg,
          border: theme.negativeBorder,
          color: theme.negative,
          label: 'Kritik',
        };
      case 'running':
        return {
          icon: 'arrow.triangle.2.circlepath',
          bg: theme.infoBg,
          border: theme.infoBorder,
          color: theme.info,
          label: 'Çalışıyor',
        };
      case 'inactive':
        return {
          icon: 'pause.circle.fill',
          bg: theme.surfaceHighlight,
          border: theme.border,
          color: theme.textSecondary,
          label: 'Planlı Beklemede',
        };
      case 'unknown':
      default:
        return {
          icon: 'questionmark.circle.fill',
          bg: theme.surfaceHighlight,
          border: theme.border,
          color: theme.textMuted,
          label: 'Bekleniyor',
        };
    }
  };

  const visuals = getHealthVisuals(item.healthStatus);
  const messageExplanation = formatJobMessageCode(item.messageCode);
  const executionStatusLabel = formatJobExecutionStatus(item.executionStatus);
  const durationFormatted = formatDurationSeconds(item.durationSeconds);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`${item.displayName}, Sağlık Durumu: ${visuals.label}, ${messageExplanation}`}
    >
      {/* Top Header: Display Name + Health Badge */}
      <View style={styles.headerRow}>
        <View style={styles.titleContainer}>
          <Text style={[styles.jobTitle, { color: theme.text }]} numberOfLines={1}>
            {item.displayName}
          </Text>
        </View>

        <View
          style={[
            styles.badgePill,
            { backgroundColor: visuals.bg, borderColor: visuals.border },
          ]}
        >
          <IconSymbol size={11} name={visuals.icon} color={visuals.color} />
          <Text style={[styles.badgeText, { color: visuals.color }]}>
            {visuals.label}
          </Text>
        </View>
      </View>

      {/* Message Explanation */}
      <View
        style={[
          styles.messageBox,
          { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle },
        ]}
      >
        <Text style={[styles.messageText, { color: theme.textSecondary }]}>
          {messageExplanation}
        </Text>
      </View>

      {/* Execution Details Grid */}
      <View style={styles.detailsGrid}>
        <View style={styles.detailItem}>
          <Text style={[styles.detailLabel, { color: theme.textMuted }]}>
            Son Çalışma
          </Text>
          <Text style={[styles.detailValue, { color: theme.text }]}>
            {formatSystemHealthDateTime(item.lastStartedAt)}
          </Text>
        </View>

        <View style={styles.detailItem}>
          <Text style={[styles.detailLabel, { color: theme.textMuted }]}>
            Son Başarılı
          </Text>
          <Text style={[styles.detailValue, { color: theme.text }]}>
            {formatSystemHealthDateTime(item.lastSuccessAt)}
          </Text>
        </View>

        <View style={styles.detailItem}>
          <Text style={[styles.detailLabel, { color: theme.textMuted }]}>
            Son Durum
          </Text>
          <Text style={[styles.detailValue, { color: theme.text }]}>
            {executionStatusLabel}
          </Text>
        </View>

        {durationFormatted !== '—' && (
          <View style={styles.detailItem}>
            <Text style={[styles.detailLabel, { color: theme.textMuted }]}>
              Çalışma Süresi
            </Text>
            <Text style={[styles.detailValue, { color: theme.text }]}>
              {durationFormatted}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    marginBottom: 10,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleContainer: {
    flex: 1,
  },
  jobTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  messageBox: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  messageText: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 16,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 8,
    columnGap: 12,
    marginTop: 2,
  },
  detailItem: {
    minWidth: '45%',
    flex: 1,
    gap: 2,
  },
  detailLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  detailValue: {
    fontSize: 12,
    fontWeight: '700',
  },
});
