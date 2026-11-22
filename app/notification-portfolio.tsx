import { Text, View, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAppTheme } from '@/context/theme-context';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { NotificationAction, NotificationCard, NotificationScreen } from '@/components/notifications/notification-screen';
import { useNotificationPortfolio } from '@/hooks/use-notification-portfolio';
import { formatCurrency, formatDateTime } from '@/utils/financial-formatters';

export default function NotificationPortfolioScreen() {
  const params = useLocalSearchParams();
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme];
  const { data, loading, error, retry } = useNotificationPortfolio(params);
  const pnlColor = data?.dailyPnl == null ? theme.textMuted : data.dailyPnl < 0 ? theme.negative : data.dailyPnl > 0 ? theme.positive : theme.textSecondary;
  return <NotificationScreen title="Günlük portföy özeti" subtitle="Bildirimdeki değerleme gününe ait kâr/zararını incele.">
    {loading && <NotificationCard><View style={styles.state}>
      <ActivityIndicator color={theme.tint} accessibilityLabel="Günlük özet yükleniyor" />
      <Text style={[styles.detail, { color: theme.textSecondary }]}>Portföy özeti hazırlanıyor…</Text>
    </View></NotificationCard>}
    {error && <NotificationCard>
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: theme.negativeBg }]}><IconSymbol name="wifi.exclamationmark" size={22} color={theme.negative} /></View>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Özet görüntülenemiyor</Text>
      </View>
      <Text accessibilityRole="alert" style={[styles.detail, { color: theme.negative }]}>{error}</Text>
      <NotificationAction title="Tekrar dene" onPress={retry} />
    </NotificationCard>}
    {data && <>
      <View style={styles.section}>
        <Text style={[styles.eyebrow, styles.sectionLabel, { color: theme.textSecondary }]}>GÜNLÜK PERFORMANS</Text>
        <NotificationCard>
          <View style={styles.heading}>
            <IconSymbol name="chart.line.uptrend.xyaxis" size={20} color={pnlColor} />
            <Text style={[styles.cardTitle, { color: theme.text }]}>Günlük kazanç / kayıp</Text>
            <View style={[styles.badge, { backgroundColor: theme.surfaceHighlight }]}><Text style={[styles.badgeText, { color: theme.tint }]}>{data.currency}</Text></View>
          </View>
          <Text style={[styles.detail, { color: theme.textSecondary }]}>Değerleme günü: {data.date}</Text>
          <Text style={[styles.pnl, { color: pnlColor }]}>{formatCurrency(data.dailyPnl, data.currency)}</Text>
          <Text style={[styles.detail, { color: theme.textSecondary }]}>
            {data.dailyPnl === null ? 'Karşılaştırılabilir önceki gün verisi bulunmuyor.' : 'Bir önceki günün karşılaştırılabilir kaydına göre hesaplanır.'}
          </Text>
        </NotificationCard>
      </View>
      <View style={[styles.metadata, { backgroundColor: theme.surfaceHighlight }]}>
        <IconSymbol name="calendar" size={18} color={theme.tint} />
        <View style={styles.grow}>
          <Text style={[styles.metadataTitle, { color: theme.tint }]}>Kayıt bilgisi</Text>
          <Text style={[styles.detail, { color: theme.textSecondary }]}>Kaydedilme: {formatDateTime(data.capturedAt)}</Text>
          <Text style={[styles.detail, { color: theme.textSecondary }]}>Bu özet yalnızca ilgili günün kâr/zararıdır; güncel fiyatlarla yeniden hesaplanmaz.</Text>
        </View>
      </View>
    </>}
  </NotificationScreen>;
}
const styles = StyleSheet.create({
  section: { gap: 8 }, sectionLabel: { paddingHorizontal: 4 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0 }, icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 }, cardTitle: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 21 },
  pnl: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }, badgeText: { fontSize: 11, fontWeight: '700' },
  detail: { fontSize: 12, lineHeight: 19 }, divider: { height: 1 }, state: { paddingVertical: 28, alignItems: 'center', gap: 12 },
  metadata: { flexDirection: 'row', alignItems: 'flex-start', padding: 16, borderRadius: 16, gap: 10 },
  metadataTitle: { fontSize: 12, fontWeight: '700', marginBottom: 3 },
});
