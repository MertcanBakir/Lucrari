import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import * as SplashScreen from 'expo-splash-screen';
import RootLayout from '@/app/_layout';
import TabLayout from '@/app/(tabs)/_layout';
import MenuScreen from '@/app/(tabs)/menu';
import ModalScreen from '@/app/modal';
import { useAuth } from '@/context/auth-context';
import { useAppTheme } from '@/context/theme-context';

jest.mock('@/context/auth-context', () => ({
  useAuth: jest.fn(), AuthProvider: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@/context/theme-context', () => ({
  useAppTheme: jest.fn(), ThemeProvider: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@/hooks/use-notifications', () => ({ useNotificationLifecycle: jest.fn() }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn().mockResolvedValue(undefined), hideAsync: jest.fn().mockResolvedValue(undefined), setOptions: jest.fn(),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  const Stack = Object.assign(({ children }: React.PropsWithChildren) => children, {
    Screen: ({ name }: { name: string }) => <Text>{name}</Text>,
  });
  const Tabs = Object.assign(({ children }: React.PropsWithChildren) => children, {
    Screen: ({ options }: { options: { tabBarLabel: string; tabBarIcon: (props: { color: string; focused: boolean }) => React.ReactNode } }) =>
      <><Text>{options.tabBarLabel}</Text>{options.tabBarIcon({ color: 'black', focused: false })}{options.tabBarIcon({ color: 'black', focused: true })}</>,
  });
  return { Stack, Tabs, useRouter: () => ({ push: mockPush }), Link: ({ children, href }: React.PropsWithChildren<{ href: string }>) =>
    <Text accessibilityRole="link" accessibilityLabel={href}>{children}</Text> };
});
jest.mock('@/components/health/analysis-health-menu-item', () => ({ AnalysisHealthMenuItem: () => null }));
jest.mock('@/components/health/supabase-health-menu-item', () => ({ SupabaseHealthMenuItem: () => null }));
jest.mock('@/components/system-health/system-health-menu-item', () => ({ SystemHealthMenuItem: () => null }));

jest.mock('expo-application', () => ({ __esModule: true, nativeApplicationVersion: null, nativeBuildVersion: null }));
jest.mock('expo-constants', () => ({ expoConfig: { version: 'test-version' } }));

const initialSplashOptions = jest.mocked(SplashScreen.setOptions).mock.calls[0]?.[0];
const auth = jest.mocked(useAuth);
const theme = jest.mocked(useAppTheme);
const setThemeMode = jest.fn();
const resetAccount = jest.fn();
const setAuth = (isAuthReady: boolean) => auth.mockReturnValue({
  isAuthReady, isAuthenticated: isAuthReady, user: { id: 'user-a' }, resetAccount,
} as unknown as ReturnType<typeof useAuth>);

beforeEach(() => {
  jest.clearAllMocks();
  resetAccount.mockReset();
  theme.mockReturnValue({ themeMode: 'system', colorScheme: 'light', setThemeMode, toggleTheme: jest.fn() } as ReturnType<typeof useAppTheme>);
  setAuth(true);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it('waits for auth before hiding splash and registers each root route', () => {
  setAuth(false);
  const view = render(<RootLayout />);
  expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
  for (const route of ['(tabs)', 'portfolio-activity', 'modal', 'system-health', 'supabase-health']) {
    expect(screen.getByText(route)).toBeOnTheScreen();
  }
  setAuth(true);
  view.rerender(<RootLayout />);
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
});

it('registers the four tab labels and provides the modal return link', () => {
  const view = render(<TabLayout />);
  for (const tab of ['Yatırımlarım', 'Home', 'Agent', 'Menü']) expect(screen.getByText(tab)).toBeOnTheScreen();
  view.unmount();
  render(<ModalScreen />);
  expect(screen.getByRole('link', { name: '/' })).toHaveTextContent('Go to home screen');
});

it('changes theme on request and resets only after confirmation', async () => {
  resetAccount.mockResolvedValue(undefined);
  render(<MenuScreen />);
  fireEvent.press(screen.getByLabelText(/Koyu temasını seç/));
  await waitFor(() => expect(setThemeMode).toHaveBeenCalledWith('dark'));
  fireEvent.press(screen.getByText('Sıfırla'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Hesabı ve Yatırımları Sıfırla', expect.any(String), expect.any(Array)));
  expect(resetAccount).not.toHaveBeenCalled();
  const confirmation = jest.mocked(Alert.alert).mock.lastCall?.[2]?.find((button) => button.style === 'destructive');
  await act(async () => confirmation?.onPress?.());
  expect(resetAccount).toHaveBeenCalledWith(expect.any(String));
  expect(Alert.alert).toHaveBeenLastCalledWith('Yatırımlar Sıfırlandı', expect.any(String));
});

it('reuses the same request ID after a failed reset with unknown server outcome', async () => {
  resetAccount.mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce(undefined);
  render(<MenuScreen />);
  fireEvent.press(screen.getByText('Sıfırla'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
  const confirm = jest.mocked(Alert.alert).mock.lastCall?.[2]?.find((button) => button.style === 'destructive');
  await act(async () => confirm?.onPress?.());
  const retry = jest.mocked(Alert.alert).mock.lastCall?.[2]?.find((button) => button.text === 'Tekrar Dene');
  await act(async () => retry?.onPress?.());
  expect(resetAccount).toHaveBeenCalledTimes(2);
  expect(resetAccount.mock.calls[0]).toEqual(resetAccount.mock.calls[1]);
});

it('shows the unauthenticated and starting states and falls back when app metadata is unavailable', () => {
  auth.mockReturnValue({ isAuthReady: false, isAuthenticated: false, user: null, resetAccount } as unknown as ReturnType<typeof useAuth>);
  const view = render(<MenuScreen />);
  expect(screen.getByText('Başlatılıyor...')).toBeOnTheScreen();
  expect(screen.getByText(/test-version/)).toBeOnTheScreen();
  auth.mockReturnValue({ isAuthReady: true, isAuthenticated: false, user: null, resetAccount } as unknown as ReturnType<typeof useAuth>);
  jest.replaceProperty(Constants, 'expoConfig', null);
  view.rerender(<MenuScreen />);
  expect(screen.getByText('Bağlantı Yok')).toBeOnTheScreen();
  expect(screen.getByText(/Sürüm —/)).toBeOnTheScreen();
  jest.replaceProperty(Application, 'nativeApplicationVersion', '2.0.0');
  jest.replaceProperty(Application, 'nativeBuildVersion', '123');
  view.rerender(<MenuScreen />);
  expect(screen.getByText(/2.0.0 \(123\)/)).toBeOnTheScreen();
});

it('switches the theme and handles a failed reset on web without haptics', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  jest.mocked(Haptics.selectionAsync).mockClear();
  jest.mocked(useAppTheme).mockReturnValue({
    themeMode: 'dark', colorScheme: 'dark', setThemeMode, toggleTheme: jest.fn(),
  } as ReturnType<typeof useAppTheme>);
  render(<MenuScreen />);
  expect(screen.getByLabelText(/Koyu temasını seç/)).toHaveProp('accessibilityState', { selected: true });
  fireEvent.press(screen.getByLabelText(/Açık temasını seç/));
  expect(setThemeMode).toHaveBeenCalledWith('light');
  expect(Haptics.selectionAsync).not.toHaveBeenCalled();

  let rejectReset!: (reason: string) => void;
  resetAccount.mockImplementationOnce(() => new Promise((_, reject) => { rejectReset = reject; }));
  fireEvent.press(screen.getByText('Sıfırla'));
  const confirm = jest.mocked(Alert.alert).mock.lastCall?.[2]?.find((button) => button.style === 'destructive');
  act(() => confirm?.onPress?.());
  expect(screen.queryByText('Sıfırla')).toBeNull();
  await act(async () => rejectReset('domain failure'));
  expect(Alert.alert).toHaveBeenLastCalledWith('İşlem Başarısız', 'Hesap sıfırlama işlemi başarısız oldu.', [{ text: 'Tamam' }]);
  expect(screen.getByText('Sıfırla')).toBeOnTheScreen();
});

it('finishes a confirmed reset on web', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  resetAccount.mockResolvedValue(undefined);
  render(<MenuScreen />);
  fireEvent.press(screen.getByText('Sıfırla'));
  const confirm = jest.mocked(Alert.alert).mock.lastCall?.[2]?.find((button) => button.style === 'destructive');
  await act(async () => confirm?.onPress?.());
  expect(Alert.alert).toHaveBeenLastCalledWith('Yatırımlar Sıfırlandı', expect.any(String));
});

it('registers the dark theme tab bar on Android', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  theme.mockReturnValue({ colorScheme: 'dark' } as ReturnType<typeof useAppTheme>);
  render(<TabLayout />);
  expect(screen.getByText('Yatırımlarım')).toBeOnTheScreen();
});

it('opens notification preferences from the menu', () => {
  render(<MenuScreen />);
  fireEvent.press(screen.getByLabelText('Bildirim ayarları'));
  expect(mockPush).toHaveBeenCalledWith('/notification-settings');
});

it('configures a short fade for the native splash transition', () => {
  expect(initialSplashOptions).toEqual({ duration: 300, fade: true });
});
