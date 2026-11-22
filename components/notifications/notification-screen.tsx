import type { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';

export function NotificationScreen({ title, subtitle, footer, children }: PropsWithChildren<{
  title: string; subtitle: string; footer?: ReactNode;
}>) {
  const router = useRouter();
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme];
  return <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
    <View style={[styles.header, { borderBottomColor: theme.borderSubtle }]}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Geri Dön" onPress={() => router.back()}
        activeOpacity={0.7} style={[styles.back, { backgroundColor: theme.surfaceHighlight }]}>
        <IconSymbol name="chevron.left" size={18} color={theme.text} />
      </TouchableOpacity>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{title}</Text>
      <View style={styles.headerBalance} />
    </View>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
        {children}
      </ScrollView>
      {footer && <View style={[styles.footer, { backgroundColor: theme.background, borderTopColor: theme.borderSubtle }]}>
        <View style={styles.footerContent}>{footer}</View>
      </View>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export function NotificationCard({ children }: PropsWithChildren) {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme];
  return <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>{children}</View>;
}

export function NotificationAction({ title, onPress, disabled = false, primary = false, busy = false }: {
  title: string; onPress: () => void; disabled?: boolean; primary?: boolean; busy?: boolean;
}) {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme];
  const foreground = disabled ? theme.disabledText : primary ? theme.background : theme.tint;
  return <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled, busy }} disabled={disabled}
    onPress={onPress} activeOpacity={0.75} style={[styles.action, {
      backgroundColor: disabled ? theme.disabledBg : primary ? theme.tint : theme.surfaceHighlight,
      borderColor: disabled ? theme.borderSubtle : primary ? theme.tint : theme.tintBorder,
    }]}>
    {busy && <ActivityIndicator size="small" color={foreground} />}
    <Text style={[styles.actionText, { color: foreground }]}>{title}</Text>
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, gap: 12 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerBalance: { width: 36 },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800' },
  content: { padding: 18, paddingBottom: 32, gap: 20, maxWidth: 680, width: '100%', alignSelf: 'center' },
  subtitle: { fontSize: 13, lineHeight: 20 },
  card: { padding: 16, borderRadius: 18, borderWidth: 1, gap: 16 },
  footer: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 8, borderTopWidth: 1 },
  footerContent: { maxWidth: 644, width: '100%', alignSelf: 'center', gap: 10 },
  action: { borderRadius: 12, borderWidth: 1, minHeight: 46, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionText: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
});
