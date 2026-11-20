import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';
import { useAgentHealth } from '@/hooks/use-agent-health';
import { RESOURCE_STATUS_LABELS } from '@/utils/agent-health';

export function AnalysisHealthMenuItem() {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const router = useRouter();
  const health = useAgentHealth();
  const status = health.status;
  const resourceStatus = health.report?.resources?.status;
  const resourceColor = { ok: theme.positive, warning: theme.warning, critical: theme.negative, unknown: theme.textSecondary };
  const label = resourceStatus ? RESOURCE_STATUS_LABELS[resourceStatus] : 'Çevrimiçi';
  const visuals = {
    checking: { label: 'Kontrol ediliyor', color: theme.textSecondary, background: theme.surfaceHighlight, border: theme.border },
    online: { label, color: resourceStatus ? resourceColor[resourceStatus] : theme.positive, background: theme.surfaceHighlight, border: theme.border },
    forbidden: { label: 'Yetki gerekli', color: theme.warning, background: theme.warningBg, border: theme.warningBorder },
    unauthorized: { label: 'Oturum gerekli', color: theme.warning, background: theme.warningBg, border: theme.warningBorder },
    error: { label: 'Kontrol başarısız', color: theme.warning, background: theme.warningBg, border: theme.warningBorder },
    unreachable: { label: 'Erişilemiyor', color: theme.warning, background: theme.warningBg, border: theme.warningBorder },
  }[status];

  return (
    <TouchableOpacity onPress={() => router.push('/agent-health')} accessibilityRole="button" style={styles.row} accessible accessibilityLabel={`Agent servisi, ${visuals.label}`} accessibilityLiveRegion="polite">
      <View style={[styles.icon, { backgroundColor: visuals.background }]}>
        <IconSymbol name="brain.head.profile" size={18} color={visuals.color} />
      </View>
      <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>Agent servisi</Text>
      <View style={[styles.badge, { backgroundColor: visuals.background, borderColor: visuals.border }]}>
        {status === 'checking' ? (
          <ActivityIndicator size="small" color={visuals.color} />
        ) : (
          <View style={[styles.dot, { backgroundColor: visuals.color }]} />
        )}
        <Text style={[styles.badgeText, { color: visuals.color }]}>{visuals.label}</Text>
      </View>
      <IconSymbol name="chevron.right" size={14} color={theme.textSecondary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 14, fontWeight: '700', letterSpacing: -0.2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' },
});
