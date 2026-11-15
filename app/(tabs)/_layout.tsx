import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  return (
    <Tabs
      initialRouteName="index"
      screenOptions={{
        tabBarActiveTintColor: theme.tabIconSelected,
        tabBarInactiveTintColor: theme.tabIconDefault,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: theme.tabBarBackground,
          borderTopColor: theme.tabBarBorder,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.2,
        },
      }}>
      <Tabs.Screen
        name="investments"
        options={{
          title: 'Yatırımlarım',
          tabBarLabel: 'Yatırımlarım',
          headerShown: false,
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol
              size={focused ? 25 : 23}
              name="chart.pie.fill"
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Ana Sayfa',
          tabBarLabel: 'Home',
          headerShown: false,
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol
              size={focused ? 25 : 23}
              name="house.fill"
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="agent"
        options={{
          title: 'Agent',
          tabBarLabel: 'Agent',
          headerShown: false,
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol
              size={focused ? 25 : 23}
              name="brain.head.profile"
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'Menü',
          tabBarLabel: 'Menü',
          headerShown: false,
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol
              size={focused ? 25 : 23}
              name="line.3.horizontal"
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
