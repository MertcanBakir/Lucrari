import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, Text, View } from 'react-native';
import { haptics as Haptics } from '@/services/feedback/haptics';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useAppTheme } from '@/context/theme-context';
import { Colors } from '@/constants/theme';
import { buildChartGeometry, chartDateLabel, closestChartIndex } from '@/utils/portfolio-chart';
import { formatCurrency } from '@/utils/financial-formatters';
import type { PortfolioChartPoint, ChartMetric } from '@/types/portfolio-chart';
import type { CurrencyCode } from '@/types/database';

const HEIGHT = 240;
export function PortfolioLineChart({ points, currency, metric }: { points: PortfolioChartPoint[]; currency: CurrencyCode; metric: ChartMetric }) {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const geometry = useMemo(() => buildChartGeometry(points, width, HEIGHT, metric === 'PNL'), [points, width, metric]);
  const xs = useMemo(() => geometry?.coordinates.map(p => p.x) ?? [], [geometry]);
  const selectedRef = useRef<number | null>(null);
  const gestureOrigin = useRef(0);
  const lastHapticAt = useRef(-Infinity);
  const hapticPending = useRef(false);
  const responder = useMemo(() => {
    const selectAt = (location: number) => {
      const next = closestChartIndex(xs, location);
      if (next < 0 || next === selectedRef.current) return;
      selectedRef.current = next;
      setSelected(next);
      const now = Date.now();
      if (Platform.OS !== 'web' && !hapticPending.current && now - lastHapticAt.current >= 60) {
        lastHapticAt.current = now;
        hapticPending.current = true;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}).finally(() => { hapticPending.current = false; });
      }
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => xs.length > 0 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: event => {
        gestureOrigin.current = event.nativeEvent.locationX;
        selectAt(gestureOrigin.current);
      },
      onPanResponderMove: (_, gesture) => selectAt(gestureOrigin.current + gesture.moveX - gesture.x0),
      // Keep the inspected date on release; parent scrolling must not steal scrubbing.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    });
  }, [xs]);
  const index = selected === null ? points.length - 1 : Math.max(0, Math.min(selected, points.length - 1));
  const point = points[index];
  const coordinate = geometry?.coordinates[index];
  const zeroY = geometry && geometry.minimum <= 0 && geometry.maximum >= 0
    ? 12 + (geometry.maximum / (geometry.maximum - geometry.minimum)) * (HEIGHT - 24)
    : null;
  const color = metric === 'VALUE' ? theme.tint : (point?.value ?? 0) < 0 ? theme.negative : theme.positive;

  return <View style={styles.container}>
    <Text style={[styles.date, { color: theme.textSecondary }]}>{point ? chartDateLabel(point.date, true) : '—'}</Text>
    <Text testID="chart-selected-value" style={[styles.value, { color: theme.text }]}>{formatCurrency(point?.value, currency)}</Text>
    <View style={styles.plotRow}>
      <View style={styles.axis}>
        <Text style={[styles.axisLabel, { color: theme.textSecondary }]}>{formatCurrency(geometry?.maximum, currency)}</Text>
        <Text style={[styles.axisLabel, { color: theme.textSecondary }]}>{formatCurrency(geometry?.minimum, currency)}</Text>
      </View>
      <View testID="portfolio-chart-plot" style={styles.plot} onLayout={event => setWidth(event.nativeEvent.layout.width)} {...responder.panHandlers}
        accessible accessibilityRole="adjustable" accessibilityLabel="Portföy geçmiş grafiği"
        accessibilityValue={{ min: 0, max: Math.max(0, points.length - 1), now: index, text: point ? `${chartDateLabel(point.date, true)}, ${formatCurrency(point.value, currency)}` : 'Veri yok' }}
        accessibilityActions={[{ name: 'increment', label: 'Sonraki tarih' }, { name: 'decrement', label: 'Önceki tarih' }]}
        onAccessibilityAction={event => setSelected(Math.max(0, Math.min(points.length - 1, index + (event.nativeEvent.actionName === 'increment' ? 1 : -1))))}>
        {geometry && <Svg pointerEvents="none" width={width} height={HEIGHT}>
          {[12, HEIGHT / 2, HEIGHT - 12].map(y => <Line key={y} x1={0} x2={width} y1={y} y2={y} stroke={theme.borderSubtle} strokeDasharray="3 5" />)}
          {zeroY !== null && <Line x1={0} x2={width} y1={zeroY} y2={zeroY} stroke={theme.textMuted} strokeOpacity={0.65} strokeWidth={1.25} strokeDasharray="4 5" />}
          <Path d={geometry.path} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          {geometry.coordinates.map((p, i) => p.y !== null && (points.length === 1 || geometry.coordinates[i - 1]?.y == null || geometry.coordinates[i + 1]?.y == null)
            ? <Circle key={points[i].date} cx={p.x} cy={p.y} r={3} fill={color} /> : null)}
          {coordinate?.y != null && <>
            <Line x1={coordinate.x} x2={coordinate.x} y1={12} y2={HEIGHT - 12} stroke={theme.textMuted} strokeDasharray="3 4" />
            <Circle cx={coordinate.x} cy={coordinate.y} r={5} fill={color} stroke={theme.surface} strokeWidth={2} />
          </>}
        </Svg>}
      </View>
    </View>
    <View style={styles.dates}>
      <Text style={[styles.axisLabel, { color: theme.textSecondary }]}>{points[0] && chartDateLabel(points[0].date)}</Text>
      <Text style={[styles.axisLabel, { color: theme.textSecondary }]}>{point && chartDateLabel(points[points.length - 1].date)}</Text>
    </View>
    <Text style={[styles.hint, { color: theme.textMuted }]}>Tarihleri incelemek için grafiğe dokunup kaydırın.</Text>
  </View>;
}
const styles = StyleSheet.create({
  container: { gap: 8 }, date: { fontSize: 13 }, value: { fontSize: 29, fontWeight: '800' },
  plotRow: { flexDirection: 'row', gap: 8, marginTop: 16 }, axis: { justifyContent: 'space-between', paddingVertical: 10, maxWidth: 100 },
  axisLabel: { fontSize: 10, fontVariant: ['tabular-nums'] }, plot: { flex: 1, height: HEIGHT },
  dates: { flexDirection: 'row', justifyContent: 'space-between' }, hint: { fontSize: 11, marginTop: 8 },
});
