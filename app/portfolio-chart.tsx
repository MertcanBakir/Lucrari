import React, { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth-context';
import { useAppTheme } from '@/context/theme-context';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { MarketFilterChips, MARKET_TABS } from '@/components/portfolio/market-filter-chips';
import { PortfolioLineChart } from '@/components/portfolio-chart/portfolio-line-chart';
import { usePortfolioChart } from '@/hooks/use-portfolio-chart';
import { formatDateTime } from '@/utils/financial-formatters';
import { CHART_RANGES, type ChartMetric, type ChartRange } from '@/types/portfolio-chart';
import type { CurrencyCode, ExtendedMarketType } from '@/types/database';

export default function PortfolioChartScreen() {
  const { userId } = useAuth();
  return <PortfolioChartSession key={userId ?? 'signed-out'} />;
}
function PortfolioChartSession() {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const { retryAuth, userId } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ currency?: string; market?: string }>();
  const [currency, setCurrency] = useState<CurrencyCode>(params.currency === 'USD' ? 'USD' : 'TRY');
  const [market, setMarket] = useState<ExtendedMarketType>(MARKET_TABS.find(t => t.id === params.market)?.id ?? 'ALL');
  const [range, setRange] = useState<ChartRange>('1M');
  const [metric, setMetric] = useState<ChartMetric>('VALUE');
  const { points, name, isLoading, error, refresh, isStale } = usePortfolioChart({ currency, market, range, metric });
  const hasValue = points.some(p => p.value !== null);
  const retry = () => { if (!userId) void retryAuth(); else refresh(); };
  const optionStyle = (active: boolean) => [styles.option, { backgroundColor: active ? theme.tint : theme.surfaceElevated, borderColor: active ? theme.tint : theme.border }];
  const optionText = (active: boolean) => ({ color: active ? colorScheme === 'dark' ? '#171416' : '#fff' : theme.textSecondary, fontWeight: '600' as const });
  return <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Geri dön" style={styles.back}><IconSymbol name="chevron.left" size={20} color={theme.text} /></TouchableOpacity>
      <View style={styles.heading}><Text style={[styles.title, { color: theme.text }]}>Portföy Grafiği</Text><Text style={{ color: theme.textSecondary }}>{name || 'Yatırım geçmişiniz'}</Text></View>
      <TouchableOpacity onPress={() => setCurrency(c => c === 'TRY' ? 'USD' : 'TRY')} accessibilityRole="button" accessibilityLabel="Grafik para birimini değiştir" style={optionStyle(true)}>
        <Text style={optionText(true)}>{currency === 'TRY' ? '₺ TL' : '$ USD'}</Text>
      </TouchableOpacity>
    </View>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={isLoading && points.length > 0} onRefresh={refresh} tintColor={theme.tint} />}>
      <MarketFilterChips activeMarket={market} onSelectMarket={setMarket} />
      <View style={styles.row}>{(['VALUE', 'PNL'] as const).map(type => <TouchableOpacity key={type} onPress={() => setMetric(type)} accessibilityRole="button" accessibilityState={{ selected: metric === type }} style={[optionStyle(metric === type), styles.metric]}>
        <Text style={optionText(metric === type)}>{type === 'VALUE' ? 'Portföy Değeri' : 'Kâr / Zarar'}</Text>
      </TouchableOpacity>)}</View>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {isLoading && !points.length ? <View style={styles.empty}><ActivityIndicator color={theme.tint} /><Text style={{ color: theme.textSecondary }}>Grafik yükleniyor…</Text></View>
          : hasValue ? <PortfolioLineChart key={`${currency}:${market}:${range}:${metric}`} points={points} currency={currency} metric={metric} />
          : <View style={styles.empty}><IconSymbol name="chart.line.uptrend.xyaxis" size={32} color={theme.textMuted} /><Text style={[styles.emptyTitle, { color: theme.text }]}>{error ? 'Grafik yüklenemedi' : 'Bu seçim için grafik verisi yok'}</Text><Text style={[styles.note, { color: theme.textSecondary }]}>{points.some(p => p.missingMarketPnl) ? 'Bu piyasanın toplam kâr/zarar geçmişi yeni günlük kayıtlarla başlayacak.' : points.some(p => p.missingFx) ? 'Bu dönem için geçmiş dolar kuru bulunamadı. TL görünümünü deneyebilirsiniz.' : 'Farklı bir tarih aralığı veya piyasa seçebilirsiniz. Yeni kayıtlar otomatik olarak eklenecek.'}</Text></View>}
        <View style={styles.ranges}>{CHART_RANGES.map(item => <TouchableOpacity key={item.id} onPress={() => setRange(item.id)} accessibilityRole="button" accessibilityLabel={`Dönem: ${item.label}`} accessibilityState={{ selected: range === item.id }} style={optionStyle(range === item.id)}><Text style={optionText(range === item.id)}>{item.label}</Text></TouchableOpacity>)}</View>
      </View>
      {error && <View style={[styles.card, { backgroundColor: theme.warningBg, borderColor: theme.warningBorder }]}><Text style={{ color: theme.text }}>{isStale ? 'Son yüklenen grafik gösteriliyor. ' : ''}{error}</Text><TouchableOpacity onPress={retry} accessibilityRole="button"><Text style={[styles.retry, { color: theme.tint }]}>Tekrar Dene</Text></TouchableOpacity></View>}
      {!isLoading && points[points.length - 1]?.capturedAt && <Text style={[styles.note, { color: theme.textMuted }]}>Son kayıt: {formatDateTime(points[points.length - 1].capturedAt)}</Text>}
      {!isLoading && (points[0]?.sourceCount ?? 0) > points.length && <Text style={[styles.note, { color: theme.textMuted }]}>Uzun geçmişte başlangıç, bitiş ve uç değerleri koruyan seçili günlük noktalar gösterilir.</Text>}
      {!isLoading && points.some(p => p.calculationVersion < 2) && <Text style={[styles.note, { color: theme.textSecondary }]}>Geçmiş kayıtlar korunmuştur. Eski dönemin kâr/zararı önceki maliyet yöntemiyle, yeni kayıtlar ortalama maliyetle hesaplanır.</Text>}
      {!isLoading && points.some(p => p.missingMarketPnl || p.missingFx) && <Text style={[styles.note, { color: theme.warning }]}>Geçmiş kur veya piyasa bazında kâr/zarar bilgisi eksik olan günler grafikte boş bırakılır.</Text>}
      {!isLoading && points.some(p => p.isPartial && p.calculationVersion >= 2) && <Text style={[styles.note, { color: theme.warning }]}>Bazı kayıtlarda güncel olmayan fiyatlar kullanılmış olabilir.</Text>}
      <Text style={[styles.note, { color: theme.textMuted }]}>{metric === 'VALUE' ? 'Değer değişimi, eklediğiniz ve sattığınız varlıkları da içerir; yatırım getirisi değildir.' : 'Satışlardan gerçekleşen kâr/zarar ile açık yatırımların kâr/zararının toplamıdır. Dönem getirisi yüzdesi değildir.'} {market === 'ALL' && metric === 'VALUE' ? 'Elle girilen nakit dahildir.' : 'Nakit dahil değildir.'} Dolar görünümü kayıt gününün kurunu kullanır.</Text>
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 10 },
  back: { padding: 8 }, heading: { flex: 1, gap: 4 }, title: { fontSize: 22, fontWeight: '800' },
  content: { padding: 18, paddingTop: 4, paddingBottom: 45, gap: 16 }, row: { flexDirection: 'row', gap: 10 },
  option: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1 }, metric: { flex: 1, alignItems: 'center' },
  card: { padding: 16, borderRadius: 20, borderWidth: 1 }, ranges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 22 },
  empty: { minHeight: 280, alignItems: 'center', justifyContent: 'center', gap: 15 }, emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  note: { fontSize: 12, lineHeight: 19 }, retry: { fontWeight: '700', marginTop: 12 },
});
