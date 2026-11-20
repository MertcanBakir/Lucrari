import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { ThemeProvider as AppThemeProvider, useAppTheme } from '@/context/theme-context';
import { AuthProvider, useAuth } from '@/context/auth-context';

SplashScreen.preventAutoHideAsync().catch(() => {});

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

function RootContent() {
  const { colorScheme } = useAppTheme();
  const { isAuthReady } = useAuth();

  useEffect(() => {
    // Hide splash screen smoothly once the root layout, theme, and auth bootstrap are ready
    if (isAuthReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isAuthReady]);

  return (
    <NavigationThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="portfolio-chart" options={{ headerShown: false }} />
        <Stack.Screen name="portfolio-activity" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        <Stack.Screen name="system-health" options={{ headerShown: false }} />
        <Stack.Screen name="supabase-health" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <AuthProvider>
        <RootContent />
      </AuthProvider>
    </AppThemeProvider>
  );
}
