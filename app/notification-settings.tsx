import { haptics } from '@/services/feedback/haptics';
import { Text, View, Switch, ActivityIndicator, Linking, StyleSheet, TouchableOpacity } from 'react-native';
import { useAppTheme } from '@/context/theme-context';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { NotificationAction, NotificationCard, NotificationScreen } from '@/components/notifications/notification-screen';
import { useNotificationPreferences } from '@/hooks/use-notification-preferences';
import { useNotificationDevice } from '@/hooks/use-notifications';
import type { NotificationDeviceStatus } from '@/types/notifications';

const statuses: Record<NotificationDeviceStatus, { title: string; description: string }> = {
  loading: { title: 'Kontrol ediliyor', description: 'Cihaz kaydı kontrol ediliyor…' },
  registered: { title: 'Bildirimler hazır', description: 'Bu cihaz bildirimlere kayıtlı.' },
  denied: { title: 'İzin gerekli', description: 'Telefon ayarlarında bildirim izni kapalı.' },
  unsupported: { title: 'Cihaz gerekli', description: 'Bildirimler için gerçek cihazda development veya preview build kullanın.' },
  error: { title: 'Bağlantı kurulamadı', description: 'Cihaz kaydı tamamlanamadı. Tekrar deneyin.' },
};
const groups = [
  { title: 'PORTFÖY BİLDİRİMLERİ', options: [
    { key: 'earnings_morning', label: 'Sabah portföy bilançoları', detail: 'Portföyündeki bugünkü bilanço takvimi. Güncel kaynakta etkinlik yoksa da bilgi verir.', icon: 'sun.max.fill' },
    { key: 'earnings_midday', label: 'Şirket bazlı bilanço hatırlatmaları', detail: 'Portföyünde bilanço açıklaması beklenen şirketler için ayrı hatırlatma.', icon: 'calendar' },
    { key: 'daily_portfolio', label: 'Günlük portföy özeti', detail: 'Yalnızca dünkü kâr/zararın. Toplam portföy değeri paylaşılmaz.', icon: 'chart.pie.fill' },
    { key: 'watchlist_earnings', label: 'Takip listesi bilançoları', detail: 'Takip listenin bugünkü bilanço özeti. Şirket hatırlatmaları açıksa portföyündeki şirketler tekrarlanmaz.', icon: 'star.fill' },
  ] },
  { title: 'GENEL BİLDİRİMLER', options: [
    { key: 'economic_reminders', label: 'Ekonomik olay hatırlatmaları', detail: 'Etkinlik öncesinde üç hatırlatma. Ülke ve önem tercihlerin uygulanır.', icon: 'globe' },
    { key: 'earnings_today', label: 'Bugünün bilançoları', detail: 'FinBot’un takip ettiği şirketlerin bugünkü bilanço takvimi. Güncel kaynakta etkinlik yoksa da özet gelir.', icon: 'calendar' },
    { key: 'earnings_tomorrow', label: 'Yarının bilançoları', detail: 'Yarın bilanço açıklaması beklenen şirketler. Liste boşsa bildirim gönderilmez.', icon: 'clock.arrow.circlepath' },
  ] },
] as const;
const importance = [
  { level: 1, label: 'Tümü', detail: '1 ve üzeri' },
  { level: 2, label: 'Önemli', detail: '2 ve üzeri' },
  { level: 3, label: 'Yüksek', detail: 'Yalnızca 3' },
];

export default function NotificationSettingsScreen() {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme];
  const { status, retry } = useNotificationDevice();
  const { preferences: p, loading, error, saving, saved, update, save, reload, authenticated } = useNotificationPreferences();
  const updatePreference = (preferences: Parameters<typeof update>[0]) => {
    void haptics.selectionAsync();
    update(preferences);
  };
  const statusColor = status === 'registered' ? theme.positive : status === 'error' ? theme.negative : theme.textSecondary;
  const trackColor = { false: theme.border, true: theme.tint };
  return <NotificationScreen title="Bildirimler" subtitle="Portföyün ve piyasalar için almak istediğin bildirimleri seç."
    footer={p && <>
      {saved && <Text accessibilityRole="alert" style={[styles.saved, { color: theme.positive }]}>Tercihler kaydedildi.</Text>}
      <NotificationAction title={saving ? 'Kaydediliyor…' : 'Tercihleri kaydet'} disabled={saving} busy={saving} primary onPress={save} />
    </>}>
    <NotificationCard>
      <View style={styles.statusRow}>
        <View style={[styles.statusIcon, { backgroundColor: status === 'registered' ? theme.positiveBg : theme.surfaceHighlight }]}>
          {status === 'loading' ? <ActivityIndicator color={theme.tint} /> : <IconSymbol
            name={status === 'registered' ? 'checkmark.circle.fill' : 'exclamationmark.triangle.fill'} size={24} color={statusColor} />}
        </View>
        <View style={styles.grow}>
          <Text style={[styles.cardTitle, { color: statusColor }]}>{statuses[status].title}</Text>
          <Text style={[styles.detail, { color: theme.textSecondary }]}>{statuses[status].description}</Text>
        </View>
      </View>
      {status === 'denied' && <NotificationAction title="Telefon ayarlarını aç" onPress={() => { void Linking.openSettings().catch(() => {}); }} />}
      {(status === 'error' || status === 'denied') && <NotificationAction title="Cihaz kaydını tekrar dene" disabled={!authenticated} onPress={retry} />}
    </NotificationCard>
    {!authenticated ? <NotificationCard><Text style={[styles.detail, { color: theme.textSecondary }]}>Bildirim tercihleri için oturum bekleniyor.</Text></NotificationCard>
      : loading ? <NotificationCard><ActivityIndicator color={theme.tint} accessibilityLabel="Tercihler yükleniyor" /></NotificationCard> : null}
    {error && <View style={[styles.error, { backgroundColor: theme.negativeBg, borderColor: theme.negativeBorder }]}>
      <Text accessibilityRole="alert" style={[styles.detail, { color: theme.negative }]}>{error}</Text>
      {!p && <NotificationAction title="Tekrar dene" onPress={reload} />}
    </View>}
    {p && <>
      {groups.map(group => <View key={group.title} style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>{group.title}</Text>
        <NotificationCard>
          {group.options.map(({ key, label, detail, icon }, index) => <View key={key}>
            {index > 0 && <View style={[styles.divider, { backgroundColor: theme.borderSubtle }]} />}
            <View style={styles.preferenceRow}>
              <View style={[styles.icon, { backgroundColor: theme.surfaceHighlight }]}><IconSymbol name={icon} size={18} color={theme.tint} /></View>
              <View style={styles.grow}>
                <Text style={[styles.rowTitle, { color: theme.text }]}>{label}</Text>
                <Text style={[styles.detail, { color: theme.textSecondary }]}>{detail}</Text>
              </View>
              <Switch accessibilityLabel={label} value={p[key]} disabled={saving} trackColor={trackColor}
                ios_backgroundColor={theme.border} onValueChange={value => updatePreference({ ...p, [key]: value })} />
            </View>
          </View>)}
        </NotificationCard>
      </View>)}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>TAKVİM & BÖLGE</Text>
        <NotificationCard>
          <Text style={[styles.rowTitle, { color: theme.text }]}>Ekonomik takvim ülkeleri</Text>
          {(['TR', 'US'] as const).map(country => <View key={country} style={styles.preferenceRow}>
            <View style={[styles.countryCode, { backgroundColor: theme.surfaceHighlight }]}><Text style={[styles.code, { color: theme.tint }]}>{country}</Text></View>
            <Text style={[styles.grow, styles.rowTitle, { color: theme.text }]}>{country === 'TR' ? 'Türkiye' : 'ABD'}</Text>
            <Switch accessibilityLabel={country} value={p.countries.includes(country)} disabled={saving} trackColor={trackColor}
              ios_backgroundColor={theme.border} onValueChange={enabled => updatePreference({ ...p, countries: enabled ? [...p.countries, country] : p.countries.filter(value => value !== country) })} />
          </View>)}
        </NotificationCard>
      </View>
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>EKONOMİK OLAY ÖNEMİ</Text>
        <NotificationCard>
          <Text style={[styles.detail, { color: theme.textSecondary }]}>Ekonomik olay hatırlatmaları, seçtiğin seviye ve üzerindeki etkinlikleri kapsar.</Text>
          <View style={styles.importanceRow}>{importance.map(({ level, label, detail }) => {
            const selected = p.min_importance === level;
            return <TouchableOpacity key={level} accessibilityRole="button" accessibilityLabel={`Minimum önem ${level}`}
              accessibilityState={{ selected, disabled: saving }} disabled={saving} activeOpacity={0.7}
              onPress={() => { if (!selected) updatePreference({ ...p, min_importance: level }); }}
              style={[styles.importance, { backgroundColor: selected ? theme.surfaceHighlight : theme.surfaceElevated, borderColor: selected ? theme.tintBorder : theme.borderSubtle }]}>
              <Text style={[styles.rowTitle, { color: selected ? theme.tint : theme.textSecondary }]}>{label}</Text>
              <Text style={[styles.importanceDetail, { color: theme.textSecondary }]}>{detail}</Text>
            </TouchableOpacity>;
          })}</View>
        </NotificationCard>
      </View>
      <View style={[styles.info, { backgroundColor: theme.surfaceHighlight }]}>
        <IconSymbol name="clock.arrow.circlepath" size={18} color={theme.tint} />
        <View style={styles.grow}>
          <Text style={[styles.rowTitle, { color: theme.tint }]}>Gönderim hakkında</Text>
          <Text style={[styles.detail, { color: theme.textSecondary }]}>Şirket bazlı portföy hatırlatmaları 15 dakika arayla gönderilir. Ekonomik hatırlatmalar etkinlik saatine göre hazırlanır.</Text>
          <Text style={[styles.detail, { color: theme.textSecondary }]}>Bilanço bildirimleri açıklama günü hatırlatmasıdır; sonuçların yayımlandığı anlamına gelmez. Günlük özet yalnızca dünkü kâr/zararı içerir ve tutar bildirimde görünür.</Text>
        </View>
      </View>
    </>}
  </NotificationScreen>;
}
const styles = StyleSheet.create({
  section: { gap: 8 }, sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, paddingHorizontal: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, statusIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '700' }, grow: { flex: 1, minWidth: 0 },
  preferenceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 13, fontWeight: '600', lineHeight: 19 }, detail: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  divider: { height: 1, marginBottom: 16 },
  countryCode: { width: 34, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, code: { fontSize: 11, fontWeight: '800' },
  importanceRow: { flexDirection: 'row', gap: 8 }, importance: { flex: 1, alignItems: 'center', paddingHorizontal: 6, paddingVertical: 13, borderRadius: 12, borderWidth: 1, gap: 4 },
  importanceDetail: { fontSize: 10, textAlign: 'center' }, info: { flexDirection: 'row', padding: 16, borderRadius: 16, gap: 10 },
  error: { padding: 16, borderRadius: 16, borderWidth: 1, gap: 12 }, saved: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
