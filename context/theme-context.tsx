import React, { createContext, useContext, useState } from 'react';
import { useColorScheme as useDeviceColorScheme } from 'react-native';
import { createScopedLogger } from '@/utils/logger';

const log = createScopedLogger('ThemeContext');

export type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeContextType {
  colorScheme: 'dark' | 'light';
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  colorScheme: 'dark',
  themeMode: 'system',
  setThemeMode: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const deviceColorScheme = useDeviceColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');

  const setThemeMode = (mode: ThemeMode) => {
    log.info('Tema değişti', { mod: mode });
    setThemeModeState(mode);
  };

  const resolvedColorScheme: 'dark' | 'light' =
    themeMode === 'system'
      ? deviceColorScheme === 'light'
        ? 'light'
        : 'dark'
      : themeMode;

  const toggleTheme = () => {
    setThemeMode(resolvedColorScheme === 'dark' ? 'light' : 'dark');
  };

  return (
    <ThemeContext.Provider
      value={{
        colorScheme: resolvedColorScheme,
        themeMode,
        setThemeMode,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme(): ThemeContextType {
  return useContext(ThemeContext);
}
