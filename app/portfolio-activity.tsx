/**
 * Lucrari — Portfolio Activity Screen
 * 
 * Full-screen route for exploring historical transactions and cash flows with
 * keyset cursor pagination, search filter, and read-only detail inspection.
 */

import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  SectionList,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '@/context/theme-context';
import { Colors } from '@/constants/theme';
import { usePortfolioActivity } from '@/hooks/use-portfolio-activity';
import { PortfolioActivityHeader } from '@/components/portfolio-activity/portfolio-activity-header';
import { PortfolioActivityItemCard } from '@/components/portfolio-activity/portfolio-activity-item-card';
import { PortfolioActivitySectionHeader } from '@/components/portfolio-activity/portfolio-activity-section-header';
import { PortfolioActivityEmptyView } from '@/components/portfolio-activity/portfolio-activity-empty-view';
import { PortfolioActivityFooter } from '@/components/portfolio-activity/portfolio-activity-footer';
import { PortfolioActivityDetailModal } from '@/components/portfolio-activity/portfolio-activity-detail-modal';
import { StaleDataBanner } from '@/components/portfolio/stale-data-banner';
import { IconSymbol } from '@/components/ui/icon-symbol';
import type { PortfolioActivityItem } from '@/types/portfolio-activity';

export default function PortfolioActivityScreen() {
  const { colorScheme } = useAppTheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const {
    sections,
    activeFilter,
    searchQuery,
    debouncedSearch,
    isRefreshing,
    isLoadingMore,
    isStale,
    initialError,
    loadMoreError,
    portfolioResolutionError,
    viewState,
    portfolioId,
    portfolioName,
    setFilter,
    setSearchQuery,
    refresh,
    loadMore,
    retryLoadMore,
    retryAuth,
    retryPortfolioResolution,
  } = usePortfolioActivity();

  const [selectedItem, setSelectedItem] = useState<PortfolioActivityItem | null>(null);

  const handleOpenDetail = useCallback((item: PortfolioActivityItem) => {
    setSelectedItem(item);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedItem(null);
  }, []);

  const isInitialLoadingState = viewState === 'initial_loading' || viewState === 'auth_not_ready';
  const isInitialErrorState = viewState === 'initial_error' || viewState === 'auth_failed';

  const handleRetry = useCallback(() => {
    if (viewState === 'auth_failed') {
      retryAuth();
    } else if (portfolioResolutionError || !portfolioId) {
      retryPortfolioResolution();
    } else {
      refresh();
    }
  }, [viewState, portfolioResolutionError, portfolioId, retryAuth, retryPortfolioResolution, refresh]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      {/* Top Header */}
      <PortfolioActivityHeader
        portfolioName={portfolioName}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeFilter={activeFilter}
        onSelectFilter={setFilter}
        disabled={isInitialLoadingState}
      />

      {/* Stale Cache Notice */}
      {isStale && (
        <StaleDataBanner onRefresh={refresh} isRefreshing={isRefreshing} />
      )}

      {/* Main Content Area */}
      {isInitialLoadingState ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.tint} />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
            Portföy hareketleri yükleniyor...
          </Text>
        </View>
      ) : isInitialErrorState ? (
        <View style={styles.centerContainer}>
          <View
            style={[
              styles.errorIconCircle,
              { backgroundColor: isDark ? 'rgba(255, 107, 107, 0.12)' : 'rgba(220, 53, 69, 0.08)' },
            ]}
          >
            <IconSymbol size={32} name="exclamationmark.triangle.fill" color={isDark ? '#FF6B6B' : '#DC3545'} />
          </View>
          <Text style={[styles.errorTitle, { color: theme.text }]}>
            {viewState === 'auth_failed'
              ? 'Oturum Açılamadı'
              : portfolioResolutionError || !portfolioId
                ? 'Portföy Bilgisi Alınamadı'
                : 'Hareketler Yüklenemedi'}
          </Text>
          <Text style={[styles.errorDescription, { color: theme.textSecondary }]}>
            {portfolioResolutionError ||
              initialError ||
              (viewState === 'auth_failed'
                ? 'Portföy hareketlerine erişmek için oturum doğrulanmalıdır.'
                : 'Portföy hareket verileri alınırken bir sorun oluştu.')}
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.retryButton,
              { backgroundColor: theme.tint },
              pressed && { opacity: 0.8 },
            ]}
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Tekrar dene"
          >
            <Text style={[styles.retryButtonText, { color: isDark ? '#000000' : '#FFFFFF' }]}>
              Tekrar Dene
            </Text>
          </Pressable>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.compositeKey}
          renderItem={({ item }) => (
            <PortfolioActivityItemCard item={item} onPress={handleOpenDetail} />
          )}
          renderSectionHeader={({ section }) => (
            <PortfolioActivitySectionHeader title={section.title} count={section.data.length} />
          )}
          ListEmptyComponent={
            <PortfolioActivityEmptyView
              isFiltered={activeFilter !== 'ALL' || debouncedSearch.length > 0}
            />
          }
          ListFooterComponent={
            <PortfolioActivityFooter
              isLoadingMore={isLoadingMore}
              loadMoreError={loadMoreError}
              onRetry={retryLoadMore}
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refresh}
              tintColor={theme.tint}
              colors={[theme.tint]}
            />
          }
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Detail Modal */}
      <PortfolioActivityDetailModal
        visible={Boolean(selectedItem)}
        item={selectedItem}
        onClose={handleCloseDetail}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 12,
  },
  errorIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  errorDescription: {
    fontSize: 13,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 24,
  },
});
