/**
 * Lucrari — System and Data Health Detail Screen
 * 
 * Production diagnostics view grouping background data pipelines and market feeds
 * into structured categories (Prices, Calendars, Portfolio, Summaries) with overall status metrics.
 */

import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  SectionList,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptics as Haptics } from '@/services/feedback/haptics';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SystemHealthOverallCard } from '@/components/system-health/system-health-overall-card';
import { SystemHealthJobCard } from '@/components/system-health/system-health-job-card';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSystemHealth } from '@/hooks/use-system-health';
import type { NormalizedJobHealthItem, SystemHealthSection } from '@/types/system-health';

export default function SystemHealthScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const { report, isLoading, isRefreshing, isStale, error, refetch } = useSystemHealth();

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
    await refetch(true);
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
            Sistem ve Veri Durumu
          </Text>
          <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
            Arka plan veri güncellemeleri
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.refreshBtn, { backgroundColor: theme.surfaceHighlight }]}
          onPress={handleManualRefresh}
          disabled={isRefreshing}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Durumu Yenile"
        >
          {isRefreshing ? (
            <ActivityIndicator size="small" color={theme.tint} />
          ) : (
            <IconSymbol size={16} name="arrow.clockwise" color={theme.tint} />
          )}
        </TouchableOpacity>
      </View>

      {/* Screen Body */}
      {isLoading && !report ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.tint} />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
            Sistem durumu kontrol ediliyor...
          </Text>
        </View>
      ) : error && !report ? (
        <View style={styles.errorContainer}>
          <View style={[styles.errorIconCircle, { backgroundColor: theme.negativeBg }]}>
            <IconSymbol size={32} name="wifi.exclamationmark" color={theme.negative} />
          </View>
          <Text style={[styles.errorTitle, { color: theme.text }]}>
            Durum Bilgisi Alınamadı
          </Text>
          <Text style={[styles.errorSubtitle, { color: theme.textSecondary }]}>
            {error}
          </Text>
          <TouchableOpacity
            style={[
              styles.retryBtn,
              { backgroundColor: theme.tint, opacity: isRefreshing ? 0.7 : 1 },
            ]}
            onPress={handleManualRefresh}
            disabled={isRefreshing}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Tekrar Dene"
          >
            {isRefreshing ? (
              <ActivityIndicator size="small" color={isDark ? '#171416' : '#FFFFFF'} />
            ) : (
              <Text style={[styles.retryBtnText, { color: isDark ? '#171416' : '#FFFFFF' }]}>
                Tekrar Dene
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <SectionList<NormalizedJobHealthItem, SystemHealthSection>
          sections={report?.sections || []}
          keyExtractor={(item) => item.jobCode}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleManualRefresh}
              tintColor={theme.tint}
              colors={[theme.tint]}
            />
          }
          ListHeaderComponent={
            report?.overall ? (
              <SystemHealthOverallCard
                overall={report.overall}
                isStale={isStale}
                isIncomplete={report.isIncomplete}
              />
            ) : null
          }
          renderSectionHeader={({ section: { title } }) => (
            <View style={[styles.sectionHeader, { backgroundColor: theme.background }]}>
              <Text style={[styles.sectionHeaderTitle, { color: theme.textSecondary }]}>
                {title.toUpperCase()}
              </Text>
            </View>
          )}
          renderItem={({ item }) => <SystemHealthJobCard item={item} />}
          ListEmptyComponent={
            <View style={[styles.emptyContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                Listelenecek servis durumu bulunamadı.
              </Text>
            </View>
          }
        />
      )}
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
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  sectionHeader: {
    paddingVertical: 8,
    marginBottom: 4,
  },
  sectionHeaderTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '600',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  errorIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 18,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 8,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: {
    fontSize: 13,
    fontWeight: '800',
  },
  emptyContainer: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
