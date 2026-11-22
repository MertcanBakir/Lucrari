import { useEffect, useSyncExternalStore } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAppTheme } from '@/context/theme-context';
import { Colors } from '@/constants/theme';
import { dismissFeedback, getFeedbackSnapshot, subscribeFeedback, type FeedbackMessage } from '@/services/feedback/feedback-service';
import { MotionView } from './motion-view';

export function FeedbackToast() {
  const message = useSyncExternalStore(subscribeFeedback, getFeedbackSnapshot, () => null);
  return message ? <VisibleFeedback key={message.id} feedback={message} /> : null;
}
function VisibleFeedback({ feedback }: { feedback: FeedbackMessage }) {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  useEffect(() => {
    const timer = setTimeout(() => dismissFeedback(feedback.id), 4000);
    return () => clearTimeout(timer);
  }, [feedback.id]);
  return <View pointerEvents="box-none" style={[styles.overlay, { top: insets.top + 12 }]}>
    <MotionView rise style={[styles.toast, { backgroundColor: theme.surfaceElevated, borderColor: theme.positiveBorder }]}>
      <IconSymbol name="checkmark.circle.fill" size={21} color={theme.positive} />
      <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.message, { color: theme.text }]}>{feedback.message}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Mesajı kapat" hitSlop={8}
        style={styles.close} onPress={() => dismissFeedback(feedback.id)}>
        <IconSymbol name="xmark" size={16} color={theme.textSecondary} />
      </TouchableOpacity>
    </MotionView>
  </View>;
}
const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 18, right: 18, zIndex: 1000, alignItems: 'center' },
  toast: { width: '100%', maxWidth: 520, minHeight: 58, borderWidth: 1, borderRadius: 16, paddingLeft: 16, paddingRight: 8,
    paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10, elevation: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 12 },
  message: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 19 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
