import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';
import type { AgentResources, ResourceStatus } from '@/types/agent-health';
import { formatHostUptime, formatResourceBytes, RESOURCE_STATUS_LABELS } from '@/utils/agent-health';

function ResourceMetric({ title, value, status, detail }: {
  title: string; value: number | null; status: ResourceStatus; detail: string;
}) {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme];
  const color = { ok: theme.positive, warning: theme.warning, critical: theme.negative, unknown: theme.textSecondary }[status];
  return (
    <View style={[styles.metric, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.label, { color }]}>{RESOURCE_STATUS_LABELS[status]}</Text>
      </View>
      <Text style={[styles.value, { color: theme.text }]}>
        {value === null ? '—' : `%${value.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`}
      </Text>
      <View style={[styles.track, { backgroundColor: theme.surfaceHighlight }]}
        accessible accessibilityRole="progressbar" accessibilityLabel={`${title} kullanımı`}
        accessibilityValue={value === null ? { text: 'Ölçüm mevcut değil' } : { min: 0, max: 100, now: value }}>
        {value !== null && <View style={[styles.fill, { width: `${value}%`, backgroundColor: color }]} />}
      </View>
      <Text style={[styles.detail, { color: theme.textSecondary }]}>{detail}</Text>
    </View>
  );
}

export function AgentHealthCard({ resources }: { resources: AgentResources | null }) {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme];
  if (!resources) {
    return <View style={[styles.metric, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.title, { color: theme.text }]}>API çevrimiçi</Text>
      <Text style={[styles.detail, { color: theme.textSecondary }]}>
        Kaynak ölçümleri bu yanıtta bulunmuyor. Backend sürümünü ve kaynak izleme yapılandırmasını kontrol edin.
      </Text>
    </View>;
  }

  const { cpu, memory } = resources;
  return (
    <View style={styles.content}>
      <View style={[styles.metric, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]}>
          {resources.scope === 'host' ? 'Sunucu kaynakları' : 'Sistem kaynakları'}
        </Text>
        <Text style={[styles.detail, { color: theme.textSecondary }]}>
          {resources.scope === 'host'
            ? 'Ölçümler sunucudaki tüm iş yüklerini kapsar.'
            : 'Ölçümler API ortamından gelir. EC2 sunucusunun tamamını kapsadığı doğrulanmamıştır.'}
        </Text>
        <Text style={[styles.label, { color: theme.text }]}>{RESOURCE_STATUS_LABELS[resources.status]}</Text>
        <Text style={[styles.detail, { color: theme.textSecondary }]}>
          Ölçüm zamanı {resources.sampledAt === null ? '—' : new Date(resources.sampledAt).toLocaleString('tr-TR')}
        </Text>
      </View>
      <ResourceMetric title="CPU" value={cpu.usedPercent} status={cpu.status}
        detail={`${cpu.logicalCores ?? '—'} mantıksal çekirdek · Ölçüm aralığı ${cpu.sampleWindowSeconds ?? '—'} sn. Tüm çekirdeklerin ortalama kullanımı. Uyarı %90, kritik %98.`} />
      {cpu.usedPercent === null && <Text style={[styles.detail, { color: theme.textSecondary }]}>
        İlk CPU ölçümü hazırlanıyor veya sistem sayaçları kullanılamıyor. Sonraki yenilemede tekrar kontrol edilir.
      </Text>}
      <ResourceMetric title="Bellek" value={memory.usedPercent} status={memory.status}
        detail={`Kullanılan ${formatResourceBytes(memory.usedBytes)} / Toplam ${formatResourceBytes(memory.totalBytes)}\nKullanılabilir ${formatResourceBytes(memory.availableBytes)}\nGeri kazanılabilir önbellek kullanılabilir belleğe dahildir. Uyarı %85, kritik %95.`} />
      <View style={[styles.metric, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]}>
          {resources.scope === 'host' ? 'Sunucu çalışma süresi' : 'Sistem çalışma süresi'}
        </Text>
        <Text style={[styles.uptime, { color: theme.text }]}>{formatHostUptime(resources.uptimeSeconds)}</Text>
      </View>
      <Text style={[styles.detail, { color: theme.textSecondary }]}>
        Bu kontrol API erişimini ve kaynak kullanımını gösterir. Arka plan işleri, veritabanı, ChatGPT oturumları, model kullanılabilirliği, disk, EC2 CPU kredileri ve AWS durum kontrolleri ayrıca izlenmelidir.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  metric: { padding: 18, borderRadius: 18, borderWidth: 1, gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 16, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '600' },
  value: { fontSize: 36, fontWeight: '700', fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  detail: { fontSize: 13, lineHeight: 20 },
  uptime: { fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
