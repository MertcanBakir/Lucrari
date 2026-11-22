/**
 * Lucrari — Portfolio Activity Header Component
 * 
 * Top section of the Portfolio Activity screen featuring back navigation,
 * screen title, search input with clear button, and category filter chips.
 */

import React, { memo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { haptics as Haptics } from '@/services/feedback/haptics';
import { useAppTheme } from '@/context/theme-context';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  PortfolioActivityFilterChips,
} from './portfolio-activity-filter-chips';
import type { PortfolioActivityFilter } from '@/types/portfolio-activity';

export interface PortfolioActivityHeaderProps {
  portfolioName?: string | null;
  searchQuery: string;
  onSearchChange: (text: string) => void;
  activeFilter: PortfolioActivityFilter;
  onSelectFilter: (filter: PortfolioActivityFilter) => void;
  disabled?: boolean;
}

export const PortfolioActivityHeader = memo(function PortfolioActivityHeader({
  portfolioName,
  searchQuery,
  onSearchChange,
  activeFilter,
  onSelectFilter,
  disabled = false,
}: PortfolioActivityHeaderProps) {
  const router = useRouter();
  const { colorScheme } = useAppTheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const handleBack = useCallback(async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    router.back();
  }, [router]);

  const handleClearSearch = useCallback(async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    onSearchChange('');
  }, [onSearchChange]);

  return (
    <View style={[styles.headerWrapper, { backgroundColor: theme.background }]}>
      {/* Top Action Bar */}
      <View style={styles.topRow}>
        <Pressable
          style={({ pressed }) => [
            styles.backButton,
            { backgroundColor: theme.surface, borderColor: theme.border },
            pressed && { opacity: 0.7 },
          ]}
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Geri dön"
          hitSlop={8}
        >
          <IconSymbol size={20} name="chevron.left" color={theme.text} />
        </Pressable>

        <View style={styles.titleContainer}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            Portföy Hareketleri
          </Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
            {portfolioName ? `${portfolioName} • ` : ''}İşlem ve Nakit Geçmişi
          </Text>
        </View>

        <View style={styles.rightPlaceholder} />
      </View>

      {/* Search Input Bar */}
      <View style={styles.searchRow}>
        <View
          style={[
            styles.searchBox,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
            },
          ]}
        >
          <IconSymbol size={18} name="magnifyingglass" color={theme.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Sembol veya şirket ara..."
            placeholderTextColor={theme.textMuted}
            value={searchQuery}
            onChangeText={onSearchChange}
            maxLength={100}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="never"
            returnKeyType="search"
            editable={!disabled}
          />
          {searchQuery.length > 0 && (
            <Pressable
              onPress={handleClearSearch}
              style={styles.clearSearchButton}
              accessibilityRole="button"
              accessibilityLabel="Aramayı temizle"
              hitSlop={6}
            >
              <IconSymbol size={16} name="xmark.circle.fill" color={theme.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Category Filter Chips */}
      <PortfolioActivityFilterChips
        activeFilter={activeFilter}
        onSelectFilter={onSelectFilter}
        disabled={disabled}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  headerWrapper: {
    paddingTop: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(150, 150, 150, 0.15)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 1,
  },
  rightPlaceholder: {
    width: 38,
  },
  searchRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 2,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '400',
  },
  clearSearchButton: {
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
