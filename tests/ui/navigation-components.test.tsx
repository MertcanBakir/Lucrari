import { useAppTheme } from '@/context/theme-context';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { openBrowserAsync } from 'expo-web-browser';
import { ExternalLink } from '@/components/external-link';
import { HapticTab } from '@/components/haptic-tab';
import ParallaxScrollView from '@/components/parallax-scroll-view';

jest.mock('expo-router', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Link: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) =>
      <Text accessibilityRole="link" onPress={onPress}>{children}</Text>,
  };
});
jest.mock('@react-navigation/elements', () => {
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  return { PlatformPressable: Pressable };
});
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(),
  WebBrowserPresentationStyle: { AUTOMATIC: 'automatic' },
}));

it('shows the visible header and content in the scrolling view', () => {
  render(<ParallaxScrollView headerImage={<Text>Header image</Text>}
    headerBackgroundColor={{ light: 'white', dark: 'black' }}>
    <Text>Portfolio content</Text>
  </ParallaxScrollView>);
  expect(screen.getByText('Header image')).toBeOnTheScreen();
  expect(screen.getByText('Portfolio content')).toBeOnTheScreen();
});

it('opens an external URL in the native in-app browser', async () => {
  const open = jest.mocked(openBrowserAsync);
  open.mockClear();
  const preventDefault = jest.fn();
  render(<ExternalLink href="https://example.com">Documentation</ExternalLink>);
  fireEvent.press(screen.getByRole('link', { name: 'Documentation' }), { preventDefault });
  expect(preventDefault).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(open).toHaveBeenCalledWith('https://example.com', { presentationStyle: 'automatic' }));
});

it('forwards the tab press-in event and gives tactile feedback on iOS', () => {
  jest.mocked(Haptics.impactAsync).mockClear();
  const onPressIn = jest.fn();
  render(<HapticTab onPressIn={onPressIn}><Text>Takvim</Text></HapticTab>);
  const event = { nativeEvent: {} };
  fireEvent(screen.getByText('Takvim'), 'pressIn', event);
  expect(onPressIn).toHaveBeenCalledWith(event);
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
});

afterEach(() => {
  jest.mocked(useAppTheme).mockClear();
  jest.restoreAllMocks();
});

it('renders the scrolling content in dark mode', () => {
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'dark' } as ReturnType<typeof useAppTheme>);
  render(<ParallaxScrollView headerImage={<Text>Header</Text>}
    headerBackgroundColor={{ light: 'white', dark: 'black' }}>
    <Text>Dark content</Text>
  </ParallaxScrollView>);
  expect(screen.getByText('Dark content')).toBeOnTheScreen();
});
