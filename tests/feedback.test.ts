import { Platform } from 'react-native';
import * as ExpoHaptics from 'expo-haptics';
import { haptics } from '@/services/feedback/haptics';
import { showSuccess, dismissFeedback, getFeedbackSnapshot, subscribeFeedback } from '@/services/feedback/feedback-service';
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(), impactAsync: jest.fn(), notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' },
  NotificationFeedbackType: { Success: 'Success', Error: 'Error', Warning: 'Warning' },
}));
beforeEach(() => {
  jest.clearAllMocks(); dismissFeedback();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  jest.mocked(ExpoHaptics.selectionAsync).mockResolvedValue(undefined);
  jest.mocked(ExpoHaptics.impactAsync).mockResolvedValue(undefined);
  jest.mocked(ExpoHaptics.notificationAsync).mockResolvedValue(undefined);
});
it('uses the same native feedback vocabulary and contains native failures', async () => {
  await haptics.selectionAsync(); await haptics.impactAsync();
  await haptics.notificationAsync(haptics.NotificationFeedbackType.Error);
  expect(ExpoHaptics.impactAsync).toHaveBeenCalledWith(ExpoHaptics.ImpactFeedbackStyle.Light);
  expect(ExpoHaptics.notificationAsync).toHaveBeenCalledWith(ExpoHaptics.NotificationFeedbackType.Error);
  jest.mocked(ExpoHaptics.selectionAsync).mockRejectedValueOnce(Error('unavailable'));
  await expect(haptics.selectionAsync()).resolves.toBeUndefined();
  jest.mocked(ExpoHaptics.impactAsync).mockImplementationOnce(() => { throw Error('unsupported'); });
  await expect(haptics.impactAsync(haptics.ImpactFeedbackStyle.Medium)).resolves.toBeUndefined();
});
it('does not vibrate in a browser', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'web' });
  await haptics.selectionAsync(); await haptics.impactAsync(); await haptics.notificationAsync();
  expect(ExpoHaptics.selectionAsync).not.toHaveBeenCalled();
  expect(ExpoHaptics.impactAsync).not.toHaveBeenCalled();
  expect(ExpoHaptics.notificationAsync).not.toHaveBeenCalled();
});
it('replaces success messages, notifies subscribers and ignores an old dismissal', () => {
  const listener = jest.fn(); const unsubscribe = subscribeFeedback(listener);
  expect(getFeedbackSnapshot()).toBeNull();
  showSuccess('Nakit güncellendi.'); const old = getFeedbackSnapshot()!;
  expect(old.message).toBe('Nakit güncellendi.');
  showSuccess('İşlem kaydedildi.'); const current = getFeedbackSnapshot()!;
  expect(current.id).not.toBe(old.id);
  dismissFeedback(old.id); expect(getFeedbackSnapshot()).toBe(current);
  dismissFeedback(current.id); expect(getFeedbackSnapshot()).toBeNull();
  expect(listener).toHaveBeenCalledTimes(3);
  expect(ExpoHaptics.notificationAsync).toHaveBeenCalledWith(ExpoHaptics.NotificationFeedbackType.Success);
  unsubscribe(); showSuccess('Tamamlandı.'); expect(listener).toHaveBeenCalledTimes(3);
});
