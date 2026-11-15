import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';
import type { AnalysisRecord } from '@/types/analysis';
import {
  ANALYSIS_HORIZON_LABELS,
  formatAnalysisDate,
  formatAnalysisStage,
  formatAnalysisStatus,
  isAnalysisActive,
  isAnalysisSuccessful,
} from '@/utils/analysis';
import { formatDateTime } from '@/utils/financial-formatters';

export function AnalysisHistoryCard({
  item,
  onPress,
}: {
  item: AnalysisRecord;
  onPress?: () => void;
}) {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const isActive = isAnalysisActive(item);
  const isSuccess = isAnalysisSuccessful(item);
  const tone = isActive
    ? { color: theme.info, background: theme.infoBg, border: theme.infoBorder }
    : isSuccess
      ? { color: theme.positive, background: theme.positiveBg, border: theme.positiveBorder }
      : { color: theme.negative, background: theme.negativeBg, border: theme.negativeBorder };

  const content = (
    <>
      <View style={styles.topRow}>
        <View style={[styles.symbolIcon, { backgroundColor: theme.tintMuted }]}>
          <IconSymbol name="brain.head.profile" size={20} color={theme.tint} />
        </View>
        <View style={styles.identity}>
          <Text style={[styles.symbol, { color: theme.text }]}>{item.ticker}</Text>
          <Text style={[styles.date, { color: theme.textSecondary }]}>
            {formatAnalysisDate(item.analysisDate)}
          </Text>
          {item.analysisHorizon && (
            <Text style={[styles.date, { color: theme.textSecondary }]}>
              {ANALYSIS_HORIZON_LABELS[item.analysisHorizon]}
            </Text>
          )}
        </View>
        <View style={[styles.badge, { backgroundColor: tone.background, borderColor: tone.border }]}>
          <Text style={[styles.badgeText, { color: tone.color }]}>{formatAnalysisStatus(item.status)}</Text>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.borderSubtle }]} />
      <View style={styles.bottomRow}>
        <View style={styles.stageRow}>
          <IconSymbol
            name={isActive ? 'arrow.triangle.2.circlepath' : isSuccess ? 'checkmark.circle.fill' : 'exclamationmark.triangle.fill'}
            size={15}
            color={tone.color}
          />
          <Text numberOfLines={1} style={[styles.stage, { color: theme.textSecondary }]}>
            {formatAnalysisStage(item.stage)}
          </Text>
        </View>
        <Text style={[styles.createdAt, { color: theme.textMuted }]}>
          {formatDateTime(item.createdAt)}
        </Text>
      </View>
    </>
  );

  const cardStyle = [
    styles.card,
    { backgroundColor: theme.surface, borderColor: theme.borderSubtle },
  ];

  if (!onPress) return <View style={cardStyle}>{content}</View>;
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${item.ticker} analizini aç`}
      onPress={onPress}
      style={cardStyle}
    >
      {content}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  symbolIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  identity: { flex: 1, gap: 2 },
  symbol: { fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
  date: { fontSize: 12.5, fontWeight: '500' },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  divider: { height: StyleSheet.hairlineWidth },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stageRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  stage: { flex: 1, fontSize: 12.5, fontWeight: '600' },
  createdAt: { fontSize: 11 },
});
