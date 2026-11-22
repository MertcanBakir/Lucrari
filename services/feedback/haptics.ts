import { Platform } from 'react-native';
import * as NativeHaptics from 'expo-haptics';

async function safely(action: () => Promise<void>): Promise<void> {
  if (Platform.OS === 'web') return;
  try { await action(); } catch {
    // Haptics are optional; hardware/settings failures must never block an action.
  }
}

// Selection for choices, light impact for opening content, notification for outcomes.
export const haptics = {
  ImpactFeedbackStyle: NativeHaptics.ImpactFeedbackStyle,
  NotificationFeedbackType: NativeHaptics.NotificationFeedbackType,
  selectionAsync: () => safely(() => NativeHaptics.selectionAsync()),
  impactAsync: (style = NativeHaptics.ImpactFeedbackStyle.Light) => safely(() => NativeHaptics.impactAsync(style)),
  notificationAsync: (type = NativeHaptics.NotificationFeedbackType.Success) => safely(() => NativeHaptics.notificationAsync(type)),
};
