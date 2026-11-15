import type { SymbolViewProps } from 'expo-symbols';

export interface TabItemConfig {
  name: string;
  title: string;
  tabBarLabel: string;
  icon: SymbolViewProps['name'];
  headerShown?: boolean;
}

/**
 * Centralized Tab Configuration
 * Order: Home -> Yatırımlarım -> Menü
 */
export const APP_TABS: TabItemConfig[] = [
  {
    name: 'index',
    title: 'Ana Sayfa',
    tabBarLabel: 'Home',
    icon: 'house.fill',
    headerShown: false,
  },
  {
    name: 'investments',
    title: 'Yatırımlarım',
    tabBarLabel: 'Yatırımlarım',
    icon: 'chart.pie.fill',
    headerShown: false,
  },
  {
    name: 'menu',
    title: 'Menü',
    tabBarLabel: 'Menü',
    icon: 'line.3.horizontal',
    headerShown: false,
  },
];
