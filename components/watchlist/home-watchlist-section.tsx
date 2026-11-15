/**
 * Lucrari — Home Watchlist Section Component
 * 
 * Main watchlist section on the home screen.
 * Displays compact view (5 items) with bottom footer toggle to expand/collapse (20 items per page),
 * clean non-overlapping header with count badge and Add button, swipe-to-reveal removal with mutual exclusion,
 * event-driven swipe reducer in production, pagination controls in expanded mode, stale and error recovery banners,
 * and integration with the search modal.
 */

import React, { useState, useCallback, useReducer } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useWatchlist } from '@/hooks/use-watchlist';
import { formatPaginationRangeText } from '@/utils/watchlist-view-state';
import { swipeRowReducer } from '@/utils/watchlist-swipe-helper';
import { WatchlistEmptyCard } from './watchlist-empty-card';
import { WatchlistRow } from './watchlist-row';
import { WatchlistSearchModal } from './watchlist-search-modal';

export function HomeWatchlistSection() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const [isSearchModalOpen, setIsSearchModalOpen] = useState<boolean>(false);
  const [activeOpenRowId, dispatchSwipeState] = useReducer(swipeRowReducer, null);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    items,
    allItemsOnPage,
    totalCount,
    pageIndex,
    pageSize,
    totalPages,
    isExpanded,
    isPageLoading,
    viewState,
    watchedInstrumentIds,
    isMembershipLoading,
    isMembershipStale,
    membershipError,
    pendingInstrumentIds,
    expand,
    collapse,
    nextPage,
    prevPage,
    refetch,
    retryPage,
    toggleWatchlistItem,
    loadMembership,
  } = useWatchlist();

  const handleToggleExpand = async () => {
    dispatchSwipeState({ type: 'dismiss' });
    setActionError(null);
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Fallback
      }
    }
    if (isExpanded) {
      collapse();
    } else {
      expand();
    }
  };

  const handleOpenSearchModal = async () => {
    dispatchSwipeState({ type: 'dismiss' });
    setActionError(null);
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Fallback
      }
    }
    setIsSearchModalOpen(true);
  };

  const handleNextPage = async () => {
    dispatchSwipeState({ type: 'dismiss' });
    setActionError(null);
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    await nextPage();
  };

  const handlePrevPage = async () => {
    dispatchSwipeState({ type: 'dismiss' });
    setActionError(null);
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    await prevPage();
  };

  const handleRemoveRow = useCallback(
    async (instrumentId: string) => {
      dispatchSwipeState({ type: 'dismiss' });
      setActionError(null);
      const result = await toggleWatchlistItem(instrumentId, false);
      if (!result.success) {
        setActionError(result.error);
      }
    },
    [toggleWatchlistItem]
  );

  return (
    <View style={styles.wrapper}>
      {/* 1. Initial / Auth Loading Spinner */}
      {viewState.showInitialSpinner && (
        <View style={[styles.loadingCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ActivityIndicator size="small" color={theme.tint} />
          <Text style={[styles.loadingCardText, { color: theme.textSecondary }]}>
            İzleme listesi yükleniyor...
          </Text>
        </View>
      )}

      {/* 2. Initial Error / Auth Failed Banner */}
      {(viewState.state === 'initial_error' || viewState.state === 'auth_failed') && (
        <View style={[styles.errorCard, { backgroundColor: theme.negativeBg, borderColor: theme.negativeBorder }]}>
          <View style={styles.errorCardLeft}>
            <IconSymbol size={16} name="exclamationmark.triangle.fill" color={theme.negative} />
            <Text style={[styles.errorCardText, { color: theme.negative }]}>
              {viewState.errorMessage}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: theme.negative }]}
            onPress={() => refetch()}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Tekrar Dene"
          >
            <Text style={styles.retryBtnText}>Tekrar Dene</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 3. True Empty Watchlist Card */}
      {viewState.showEmptyCard && (
        <WatchlistEmptyCard onOpenAddModal={handleOpenSearchModal} />
      )}

      {/* 4. Normal Watchlist Content Card */}
      {viewState.showContentList && (
        <View style={[styles.container, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {/* Header Row: Title + Count Badge on left, Add Button on right */}
          <View style={styles.headerRow}>
            <View style={styles.titleGroup}>
              <IconSymbol size={18} name="list.bullet" color={theme.tint} />
              <Text style={[styles.titleText, { color: theme.text }]} numberOfLines={1}>
                İzleme Listesi
              </Text>
              <View style={[styles.countBadge, { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }]}>
                <Text style={[styles.countBadgeText, { color: theme.tint }]}>
                  {totalCount} Varlık
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.addIconBtn, { backgroundColor: theme.tint, borderColor: theme.tintPressed }]}
              onPress={handleOpenSearchModal}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Varlık Ekle"
            >
              <IconSymbol size={14} name="plus" color={isDark ? '#171416' : '#FFFFFF'} />
              <Text style={[styles.addIconBtnText, { color: isDark ? '#171416' : '#FFFFFF' }]}>
                Ekle
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.borderSubtle }]} />

          {/* Action Error Banner (e.g. Failed Delete Mutation) */}
          {actionError && (
            <View style={[styles.actionErrorBanner, { backgroundColor: theme.negativeBg, borderColor: theme.negativeBorder }]}>
              <View style={styles.actionErrorLeft}>
                <IconSymbol size={14} name="exclamationmark.triangle.fill" color={theme.negative} />
                <Text style={[styles.actionErrorText, { color: theme.negative }]}>
                  {actionError}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setActionError(null)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Hata uyarısını kapat"
              >
                <IconSymbol size={14} name="xmark" color={theme.negative} />
              </TouchableOpacity>
            </View>
          )}

          {/* Stale Warning Banner */}
          {viewState.showStaleBanner && (
            <View style={[styles.staleBanner, { backgroundColor: theme.warningBg, borderColor: theme.warningBorder }]}>
              <View style={styles.staleBannerLeft}>
                <IconSymbol size={14} name="exclamationmark.triangle.fill" color={theme.warning} />
                <Text style={[styles.staleBannerText, { color: theme.warning }]}>
                  {viewState.staleNoticeText}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.staleRefreshBtn, { borderColor: theme.warning }]}
                onPress={() => refetch()}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Yenile"
              >
                <Text style={[styles.staleRefreshText, { color: theme.warning }]}>Yenile</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Page Error Banner (Retains previous page items) */}
          {viewState.state === 'page_error' && (
            <View style={[styles.pageErrorBanner, { backgroundColor: theme.negativeBg, borderColor: theme.negativeBorder }]}>
              <View style={styles.pageErrorBannerLeft}>
                <IconSymbol size={14} name="exclamationmark.triangle.fill" color={theme.negative} />
                <Text style={[styles.pageErrorBannerText, { color: theme.negative }]}>
                  {viewState.errorMessage}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.pageErrorRetryBtn, { borderColor: theme.negative }]}
                onPress={() => retryPage()}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Tekrar Dene"
              >
                <Text style={[styles.pageErrorRetryText, { color: theme.negative }]}>Tekrar Dene</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Page Transition Loading Overlay */}
          {viewState.showPageLoadingOverlay && (
            <View style={styles.pageLoadingBar}>
              <ActivityIndicator size="small" color={theme.tint} />
              <Text style={[styles.pageLoadingText, { color: theme.textSecondary }]}>
                Sayfa yükleniyor...
              </Text>
            </View>
          )}

          {/* Items List */}
          <View style={styles.rowsList}>
            {items.map((item) => (
              <WatchlistRow
                key={item.watchlistId || item.instrumentId}
                item={item}
                isOpen={activeOpenRowId === item.instrumentId}
                isAnyRowOpen={activeOpenRowId !== null}
                isPendingMutation={pendingInstrumentIds.has(item.instrumentId)}
                onRemove={handleRemoveRow}
                onSwipeOpen={(id) => {
                  setActionError(null);
                  dispatchSwipeState({ type: 'open', instrumentId: id });
                }}
                onSwipeClose={() => {
                  dispatchSwipeState({ type: 'close', instrumentId: item.instrumentId });
                }}
                onDismissOpenRows={() => {
                  dispatchSwipeState({ type: 'dismiss' });
                }}
              />
            ))}
          </View>

          {/* Expanded View Pagination Controls (Shown when expanded and totalCount > pageSize) */}
          {isExpanded && totalCount > pageSize && (
            <View style={[styles.paginationRow, { borderTopColor: theme.borderSubtle }]}>
              <TouchableOpacity
                style={[
                  styles.pageNavBtn,
                  pageIndex === 0
                    ? { backgroundColor: theme.disabledBg, borderColor: theme.borderSubtle }
                    : { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
                ]}
                onPress={handlePrevPage}
                disabled={pageIndex === 0 || isPageLoading}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Önceki 20 varlık"
              >
                <Text
                  style={[
                    styles.pageNavText,
                    { color: pageIndex === 0 ? theme.disabledText : theme.text },
                  ]}
                >
                  ← Önceki {pageSize}
                </Text>
              </TouchableOpacity>

              <View style={styles.pageInfoCol}>
                <Text style={[styles.pageRangeText, { color: theme.text }]}>
                  {formatPaginationRangeText(pageIndex, pageSize, totalCount, allItemsOnPage.length)}
                </Text>
                <Text style={[styles.pageIndexText, { color: theme.textSecondary }]}>
                  Sayfa {pageIndex + 1} / {totalPages}
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.pageNavBtn,
                  (pageIndex + 1) * pageSize >= totalCount
                    ? { backgroundColor: theme.disabledBg, borderColor: theme.borderSubtle }
                    : { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
                ]}
                onPress={handleNextPage}
                disabled={(pageIndex + 1) * pageSize >= totalCount || isPageLoading}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Sonraki 20 varlık"
              >
                <Text
                  style={[
                    styles.pageNavText,
                    { color: (pageIndex + 1) * pageSize >= totalCount ? theme.disabledText : theme.text },
                  ]}
                >
                  Sonraki {pageSize} →
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Footer Expansion Toggle: "Tümünü Gör" / "Daralt" (Shown only when totalCount > 5) */}
          {totalCount > 5 && (
            <TouchableOpacity
              style={[
                styles.footerToggleBtn,
                {
                  backgroundColor: theme.surfaceElevated,
                  borderColor: theme.borderSubtle,
                },
              ]}
              onPress={handleToggleExpand}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={isExpanded ? 'Listeyi Daralt' : 'Tümünü Gör'}
            >
              <Text style={[styles.footerToggleText, { color: theme.text }]}>
                {isExpanded ? 'Daralt' : 'Tümünü Gör'}
              </Text>
              <IconSymbol
                size={14}
                name={isExpanded ? 'chevron.up' : 'chevron.down'}
                color={theme.textSecondary}
              />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Watchlist Search & Add Modal */}
      <WatchlistSearchModal
        visible={isSearchModalOpen}
        watchedInstrumentIds={watchedInstrumentIds}
        isMembershipLoading={isMembershipLoading}
        isMembershipStale={isMembershipStale}
        membershipError={membershipError}
        pendingInstrumentIds={pendingInstrumentIds}
        onClose={() => setIsSearchModalOpen(false)}
        onToggleWatchlist={toggleWatchlistItem}
        onLoadMembership={loadMembership}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginVertical: 6,
  },
  container: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  loadingCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    marginVertical: 8,
  },
  loadingCardText: {
    fontSize: 13,
    fontWeight: '500',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginVertical: 8,
    gap: 8,
  },
  errorCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  errorCardText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  retryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  retryBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    flexShrink: 1,
  },
  titleText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  addIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  addIconBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    marginHorizontal: -16,
  },
  actionErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  actionErrorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  actionErrorText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  staleBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  staleBannerText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  staleRefreshBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  staleRefreshText: {
    fontSize: 11,
    fontWeight: '700',
  },
  pageErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  pageErrorBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  pageErrorBannerText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  pageErrorRetryBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  pageErrorRetryText: {
    fontSize: 11,
    fontWeight: '700',
  },
  pageLoadingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  pageLoadingText: {
    fontSize: 12,
    fontWeight: '500',
  },
  rowsList: {
    gap: 8,
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 8,
  },
  pageNavBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  pageNavText: {
    fontSize: 12,
    fontWeight: '700',
  },
  pageInfoCol: {
    alignItems: 'center',
    gap: 2,
  },
  pageRangeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  pageIndexText: {
    fontSize: 11,
    fontWeight: '500',
  },
  footerToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  footerToggleText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
