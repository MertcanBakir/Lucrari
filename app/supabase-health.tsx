/**
 * Lucrari — Supabase Backend & Database Health Detail Screen
 * 
 * Production diagnostics view for Supabase infrastructure connectivity,
 * PostgREST database query reachability, and Auth service latency metrics.
 */

import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptics as Haptics } from '@/services/feedback/haptics';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SupabaseHealthCard } from '@/components/health/supabase-health-card';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSupabaseHealth } from '@/hooks/use-supabase-health';

export default function SupabaseHealthScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const { isRefetching, refetch } = useSupabaseHealth();

  const handleBack = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    router.back();
  };

  const handleManualRefresh = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Fallback
      }
    }
    await refetch();
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      {/* Header Bar */}
      <View style={[styles.headerBar, { borderBottomColor: theme.borderSubtle }]}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: theme.surfaceHighlight }]}
          onPress={handleBack}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Geri Dön"
        >
          <IconSymbol size={18} name="chevron.left" color={theme.text} />
        </TouchableOpacity>

        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
            Supabase Backend & DB
          </Text>
          <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
            Veritabanı ve API Sağlık Durumu
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.refreshBtn, { backgroundColor: theme.surfaceHighlight }]}
          onPress={handleManualRefresh}
          disabled={isRefetching}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Bağlantıyı Yenile"
        >
          {isRefetching ? (
            <ActivityIndicator size="small" color={theme.tint} />
          ) : (
            <IconSymbol size={16} name="arrow.clockwise" color={theme.tint} />
          )}
        </TouchableOpacity>
      </View>

      {/* Screen Body */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleManualRefresh}
            tintColor={theme.tint}
            colors={[theme.tint]}
          />
        }
      >
        <SupabaseHealthCard />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
});
