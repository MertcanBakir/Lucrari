import { AccessibilityInfo } from 'react-native';

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' },
  NotificationFeedbackType: { Success: 'Success', Error: 'Error', Warning: 'Warning' },
}));
jest.mock('@/context/theme-context', () => ({
  useAppTheme: jest.fn(() => ({ colorScheme: 'light' })),
}));

// Keep animations off by default in interaction tests; motion behavior has dedicated tests.
jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
