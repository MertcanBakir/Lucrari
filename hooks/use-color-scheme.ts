import { useAppTheme } from '@/context/theme-context';

export function useColorScheme(): 'dark' | 'light' {
  return useAppTheme().colorScheme;
}
