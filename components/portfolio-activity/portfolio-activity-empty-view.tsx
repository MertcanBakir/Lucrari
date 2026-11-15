/**
 * Lucrari — Portfolio Activity Empty State Component
 * 
 * Accurately models true empty portfolio history versus filter/search results empty.
 */

import React, { memo } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useAppTheme } from '@/context/theme-context';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';

export interface PortfolioActivityEmptyViewProps {
  isFiltered?: boolean;
}

export const PortfolioActivityEmptyView = memo(function PortfolioActivityEmptyView({
  isFiltered = false,
}: PortfolioActivityEmptyViewProps) {
  const { colorScheme } = useAppTheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const title = isFiltered
    ? 'Bu Filtrede Hareket Bulunamadı'
    : 'Henüz Portföy Hareketi Yok';

  const description = isFiltered
    ? 'Filtreyi veya arama metnini değiştirerek tekrar deneyebilirsiniz.'
    : 'Alış, satış veya nakit işlemi eklediğinizde burada görüntülenecek.';

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.iconCircle,
          {
            backgroundColor: isDark ? 'rgba(78, 205, 196, 0.1)' : 'rgba(10, 126, 164, 0.08)',
          },
        ]}
      >
        <IconSymbol
          size={32}
          name={isFiltered ? 'magnifyingglass' : 'clock.arrow.circlepath'}
          color={theme.tint}
        />
      </View>

      <Text style={[styles.title, { color: theme.text }]}>
        {title}
      </Text>

      <Text style={[styles.description, { color: theme.textSecondary }]}>
        {description}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 56,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  description: {
    fontSize: 13,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 19,
  },
});
