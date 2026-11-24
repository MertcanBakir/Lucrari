import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';
import type { useServerManagement } from '@/hooks/use-server-management';

export function ServerManagementCard({ server }: { server: ReturnType<typeof useServerManagement> }) {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme];

  const labels = { stopped: 'Sunucu kapalı', pending: 'Sunucu açılıyor', running: server.apiReady ? 'API çevrimiçi' : 'Sunucu açılıyor', stopping: 'Sunucu kapanıyor' };
  const lastStateLabels = { stopped: 'Sunucu kapalı', pending: 'Sunucu açılıyor', running: 'Sunucu çalışıyor', stopping: 'Sunucu kapanıyor' };
  const statusLabel = server.state ? (server.error ? `Son doğrulanan: ${lastStateLabels[server.state]}` : server.apiMessage ?? labels[server.state]) : server.error ? 'Sunucu durumu doğrulanamadı.' : 'Sunucu durumu kontrol ediliyor…';
  const transitioning = server.state === 'pending' || server.state === 'stopping';
  const disabled = server.busy || transitioning || !!server.error;
  const stop = () => Alert.alert('Sunucuyu durdur', 'FinBot sunucusu kapatılacak. Devam etmek istiyor musunuz?', [
    { text: 'Vazgeç', style: 'cancel' },
    { text: 'Durdur', style: 'destructive', onPress: () => { void server.changeState('stop'); } },
  ]);

  const ready = server.hasSession && !server.error && server.state === 'running' && server.apiReady;
  const statusColor = server.error ? theme.warning : ready ? theme.positive : transitioning ? theme.warning : theme.textSecondary;
  const statusBackground = server.error ? theme.warningBg : ready ? theme.positiveBg : transitioning ? theme.warningBg : theme.backgroundSecondary;
  const badge = server.error ? 'Kontrol gerekli' : ready ? 'Çevrimiçi' : transitioning ? 'Geçiş sürüyor' : server.state === 'stopped' ? 'Kapalı' : 'Bekleniyor';
  const stoppingAction = server.state === 'running';
  const actionColor = disabled ? theme.disabledText : stoppingAction ? theme.negative : '#FFFFFF';

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
      <View style={styles.header}>
        <View style={[styles.serverIcon, { backgroundColor: theme.tintMuted }]}>
          <IconSymbol name="server.rack" size={24} color={theme.tint} />
        </View>
        <View style={styles.heading}>
          <Text style={[styles.eyebrow, { color: theme.textSecondary }]}>SUNUCU YÖNETİMİ</Text>
          <Text style={[styles.title, { color: theme.text }]}>FinBot sunucusu</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: statusBackground }]}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <Text style={[styles.badgeText, { color: statusColor }]}>{badge}</Text>
        </View>
      </View>

      <View style={styles.summary}>
        <Text accessibilityLiveRegion="polite" style={[styles.status, { color: theme.text }]}>
          {!server.hasSession ? 'Sunucu yönetimi için oturum gerekli.' : statusLabel}
        </Text>
        {server.busy && <ActivityIndicator accessibilityLabel="Sunucu kontrol ediliyor" color={theme.tint} size="small" />}
      </View>

      <View style={styles.metrics}>
        <View style={[styles.metric, { backgroundColor: theme.backgroundSecondary }]}>
          <View style={styles.metricHeading}>
            <IconSymbol name="cloud.fill" size={15} color={theme.textSecondary} />
            <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>EC2 durumu</Text>
          </View>
          <Text style={[styles.metricValue, { color: theme.text }]}>{server.state ? {
            stopped: 'Kapalı', pending: 'Başlatılıyor', running: 'Çalışıyor', stopping: 'Durduruluyor',
          }[server.state] : '—'}</Text>
          <Text style={[styles.metricCaption, { color: theme.textMuted }]}>{server.error ? 'Son doğrulanan bilgi' : 'Sunucu yaşam döngüsü'}</Text>
        </View>
        <View style={[styles.metric, { backgroundColor: theme.backgroundSecondary }]}>
          <View style={styles.metricHeading}>
            <IconSymbol name="server.rack" size={15} color={theme.textSecondary} />
            <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Analiz API’si</Text>
          </View>
          <Text style={[styles.metricValue, { color: ready ? theme.positive : theme.text }]}>
            {server.error ? 'Doğrulanamadı' : ready ? 'Hazır' : server.state === 'running' || server.state === 'pending' ? 'Hazırlanıyor' : '—'}
          </Text>
          <Text style={[styles.metricCaption, { color: theme.textMuted }]}>Bağımsız sağlık kontrolü</Text>
        </View>
      </View>

      {(server.error || server.apiMessage) && <View style={[styles.error, { backgroundColor: theme.warningBg, borderColor: theme.warningBorder }]}>
        <IconSymbol name="exclamationmark.triangle.fill" size={18} color={theme.warning} />
        <Text accessibilityRole="alert" style={[styles.errorText, { color: theme.text }]}>{server.error ?? server.apiMessage}</Text>
      </View>}

      <View style={styles.actions}>
        {server.hasSession && !server.denied && (server.state === 'stopped' || server.state === 'running' || transitioning) &&
          <TouchableOpacity accessibilityRole="button" disabled={disabled} activeOpacity={0.75}
            onPress={server.state === 'stopped' ? () => { void server.changeState('start'); } : stop}
            style={[styles.button, {
              backgroundColor: disabled ? theme.disabledBg : stoppingAction ? theme.negativeBg : theme.tint,
              borderColor: disabled ? theme.borderSubtle : stoppingAction ? theme.negativeBorder : theme.tint,
            }]}>
            <Text style={[styles.buttonText, { color: actionColor }]}>
              {transitioning ? 'İşlem sürüyor' : server.state === 'stopped' ? 'Sunucuyu başlat' : 'Sunucuyu durdur'}
            </Text>
          </TouchableOpacity>}
        {server.hasSession && <TouchableOpacity accessibilityRole="button" disabled={server.busy} activeOpacity={0.65}
          onPress={() => { void server.refresh(); }} style={styles.retry}>
          <IconSymbol name="arrow.clockwise" size={16} color={server.busy ? theme.disabledText : theme.tint} />
          <Text style={[styles.retryText, { color: server.busy ? theme.disabledText : theme.tint }]}>
            {server.error || server.apiMessage ? 'Yeniden dene' : 'Sunucu durumunu yenile'}
          </Text>
        </TouchableOpacity>}
      </View>
      <View style={[styles.footer, { borderTopColor: theme.borderSubtle }]}>
        <Text style={[styles.note, { color: theme.textSecondary }]}>EC2 durumu ve analiz API’sinin hazır olması ayrı kontrol edilir. Hata sonrası gösterilen EC2 durumu son doğrulanmış bilgidir.</Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { padding: 20, borderRadius: 22, borderWidth: 1, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  serverIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1, minWidth: 130, gap: 4 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  title: { fontSize: 17, fontWeight: '700' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  status: { flex: 1, fontSize: 21, lineHeight: 29, fontWeight: '700', letterSpacing: -0.4 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { flex: 1, flexBasis: 120, borderRadius: 15, padding: 14, gap: 7 },
  metricHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metricLabel: { fontSize: 11, fontWeight: '500', flexShrink: 1 },
  metricValue: { fontSize: 16, fontWeight: '700' },
  metricCaption: { fontSize: 10, lineHeight: 15 },
  error: { flexDirection: 'row', alignItems: 'flex-start', padding: 13, borderRadius: 13, borderWidth: 1, gap: 9 },
  errorText: { flex: 1, fontSize: 13, lineHeight: 20 },
  actions: { gap: 6 },
  button: { borderRadius: 14, minHeight: 50, padding: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, fontWeight: '700' },
  retry: { flexDirection: 'row', gap: 7, minHeight: 44, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 12, fontWeight: '600' },
  footer: { borderTopWidth: 1, paddingTop: 14 },
  note: { fontSize: 11, lineHeight: 17 },
});
