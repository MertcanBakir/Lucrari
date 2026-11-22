import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';

export function LoadingSkeleton({ label, variant = 'list' }: { label: string; variant?: 'portfolio' | 'list' }) {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme];
  const block = { backgroundColor: theme.surfaceHighlight };
  const card = { backgroundColor: theme.surface, borderColor: theme.border };
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }} style={styles.container}>
    <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={styles.container}>
      {variant === 'portfolio' && <>
        <View style={[styles.card, card]}>
          <View style={[styles.heading, block]} /><View style={[styles.total, block]} />
          <View style={styles.row}><View style={[styles.detail, block]} /><View style={[styles.detail, block]} /></View>
          <View style={[styles.line, block]} />
        </View>
        <View style={[styles.card, card]}><View style={[styles.heading, block]} /><View style={[styles.allocation, block]} /></View>
      </>}
      <View style={[styles.card, card]}>{[0, 1, 2].map(row => <View key={row} style={styles.row}>
        <View style={[styles.icon, block]} /><View style={styles.textLines}><View style={[styles.heading, block]} /><View style={[styles.line, block]} /></View>
        <View style={[styles.amount, block]} />
      </View>)}</View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  container: { gap: 14 }, label: { fontSize: 12, lineHeight: 18 },
  card: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 20 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heading: { width: '52%', height: 12, borderRadius: 6 }, total: { width: '72%', height: 36, borderRadius: 9 },
  detail: { flex: 1, height: 18, borderRadius: 6 }, line: { width: '80%', height: 10, borderRadius: 5 },
  allocation: { height: 52, borderRadius: 10 }, icon: { width: 38, height: 38, borderRadius: 12 },
  textLines: { flex: 1, gap: 10 }, amount: { width: '22%', height: 16, borderRadius: 6 },
});
