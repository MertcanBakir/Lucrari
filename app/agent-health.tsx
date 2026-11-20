import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentHealthCard } from '@/components/health/agent-health-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';
import { useAgentHealth } from '@/hooks/use-agent-health';

const messages = {
  checking: 'Agent servisi kontrol ediliyor…',
  online: 'API çevrimiçi',
  unreachable: 'Agent servisine erişilemiyor. Sunucu veya ağ bağlantısını kontrol edin.',
  forbidden: 'Kaynak ölçümleri yalnızca yapılandırılmış kişisel hesap sahibine açıktır.',
  unauthorized: 'Kaynak ölçümleri için geçerli bir oturum gerekli. Hesabınızla tekrar giriş yapın.',
  error: 'Agent sağlık bilgileri şu anda alınamıyor.',
};

export default function AgentHealthScreen() {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const health = useAgentHealth(true);

  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderSubtle }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Geri Dön" onPress={() => router.back()}
          style={[styles.button, { backgroundColor: theme.surfaceHighlight }]}>
          <IconSymbol name="chevron.left" size={18} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>Agent servisi</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Agent durumunu yenile" disabled={health.isRefreshing}
          onPress={() => { void health.refresh(); }} style={[styles.button, { backgroundColor: theme.surfaceHighlight }]}>
          {health.isRefreshing ? <ActivityIndicator color={theme.tint} /> : <IconSymbol name="arrow.clockwise" size={18} color={theme.tint} />}
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content} refreshControl={
        <RefreshControl refreshing={health.isRefreshing} onRefresh={() => { void health.refresh(); }} tintColor={theme.tint} />
      }>
        <Text accessibilityLiveRegion="polite" style={[styles.status, { color: health.status === 'unreachable' ? theme.negative : theme.text }]}>
          {messages[health.status]}
        </Text>
        {health.status === 'online' && <AgentHealthCard resources={health.report?.resources ?? null} />}
        {health.checkedAt && <Text style={[styles.detail, { color: theme.textSecondary }]}>
          Son kontrol {health.checkedAt.toLocaleTimeString('tr-TR')}
        </Text>}
        <Text style={[styles.detail, { color: theme.textSecondary }]}>
          Sayfa açıkken ve uygulama ön plandayken 12 saniyede bir yenilenir.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, gap: 12 },
  button: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800' },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  status: { fontSize: 16, fontWeight: '600', lineHeight: 24 },
  detail: { fontSize: 12, lineHeight: 18 },
});
