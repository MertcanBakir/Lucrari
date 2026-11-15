/**
 * Lucrari — Watchlist Search & Add Modal Component
 * 
 * Allows users to search the complete asset catalog across all markets (BIST, NASDAQ, Crypto, TEFAS, FX),
 * view live prices, and add/remove instruments directly to/from their watchlist with horizontal cards and batch membership tracking.
 * 
 * STRICT COMPLIANCE:
 * - Single-row horizontal scrollable category tabs (NO flexWrap).
 * - Horizontal scrollable result cards (horizontal FlatList).
 * - Debounced 250ms search with generation/requestId protection.
 * - Search callback is completely decoupled from offset state.
 * - Multi-page accumulation (20 -> 40 -> 60) without duplicate instruments.
 * - Real Supabase prices and fail-closed actions.
 * - Atomic state/ref commit prevents duplicate in-flight requests on concurrent onEndReached.
 * - Modal close lifecycle strictly resets search state and cancels pending generations.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ActivityIndicator,
  FlatList,
  ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatCurrency, formatPercentage } from '@/utils/financial-formatters';
import { searchInstrumentsDetailed } from '@/services/portfolio/instrument-service';
import type { ExtendedMarketType } from '@/types/database';
import type { WatchlistMembershipResult, ToggleWatchlistActionResult } from '@/types/watchlist';
import {
  createInitialSearchState,
  startSearchQueryOrCategory,
  startSearchLoadMore,
  applySearchSuccess,
  applySearchFailure,
  type WatchlistSearchState,
} from '@/utils/watchlist-search-controller';

export interface WatchlistSearchModalProps {
  visible: boolean;
  watchedInstrumentIds: Set<string>;
  isMembershipLoading?: boolean;
  isMembershipStale?: boolean;
  membershipError?: string | null;
  pendingInstrumentIds?: Set<string>;
  onClose: () => void;
  onToggleWatchlist: (instrumentId: string, isWatched: boolean) => Promise<ToggleWatchlistActionResult>;
  onLoadMembership: (forceRefresh?: boolean) => Promise<WatchlistMembershipResult>;
}

export const CATEGORY_TABS: { id: ExtendedMarketType; label: string }[] = [
  { id: 'ALL', label: 'Tümü' },
  { id: 'BIST100', label: 'BIST' },
  { id: 'NASDAQ100', label: 'ABD' },
  { id: 'CRYPTO', label: 'Kripto' },
  { id: 'TEFAS', label: 'Fon' },
  { id: 'FX', label: 'Döviz' },
];

const SEARCH_PAGE_SIZE = 20;

export function WatchlistSearchModal({
  visible,
  watchedInstrumentIds,
  isMembershipLoading = false,
  isMembershipStale = false,
  membershipError = null,
  pendingInstrumentIds = new Set(),
  onClose,
  onToggleWatchlist,
  onLoadMembership,
}: WatchlistSearchModalProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeCategory, setActiveCategory] = useState<ExtendedMarketType>('ALL');
  const [mutationError, setMutationError] = useState<string | null>(null);

  const [searchState, setSearchState] = useState<WatchlistSearchState>(() =>
    createInitialSearchState('', 'ALL')
  );

  const searchStateRef = useRef<WatchlistSearchState>(searchState);
  const lifecycleTokenRef = useRef<number>(1);
  const activeRequestIdRef = useRef<number>(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Synchronously commits state to both Ref and React state
  const commitSearchState = useCallback((nextState: WatchlistSearchState) => {
    searchStateRef.current = nextState;
    setSearchState(nextState);
  }, []);

  // Modal close lifecycle reset: strictly increments monotonic lifecycle token
  const resetSearchLifecycle = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const nextLifecycle = ++lifecycleTokenRef.current;
    ++activeRequestIdRef.current;
    commitSearchState(createInitialSearchState('', 'ALL', nextLifecycle));
    setSearchQuery('');
    setActiveCategory('ALL');
    setMutationError(null);
  }, [commitSearchState]);

  // Handle visibility changes from outside
  useEffect(() => {
    if (visible) {
      setMutationError(null);
      onLoadMembership(false).catch(() => {});
    } else {
      resetSearchLifecycle();
    }
  }, [visible, onLoadMembership, resetSearchLifecycle]);

  // Execute search function - Blocked load-more calls NEVER mutate tokens or state
  const runSearch = useCallback(
    async (query: string, market: ExtendedMarketType, isLoadMore = false) => {
      let lifecycleToken: number;
      let requestId: number;
      let targetOffset: number;

      if (isLoadMore) {
        // 1. Guard check BEFORE incrementing any token
        lifecycleToken = lifecycleTokenRef.current;
        const { canLoad, state: nextState, targetOffset: offset } =
          startSearchLoadMore(searchStateRef.current, lifecycleToken);
        if (!canLoad) return;

        // 2. Only increment requestId when request is genuinely dispatched
        requestId = ++activeRequestIdRef.current;
        targetOffset = offset;
        commitSearchState(nextState);
      } else {
        // Initial search or category change: advances lifecycle token and requestId
        lifecycleToken = ++lifecycleTokenRef.current;
        requestId = ++activeRequestIdRef.current;
        const { state: nextState, targetOffset: offset } =
          startSearchQueryOrCategory(searchStateRef.current, query, market, lifecycleToken);
        targetOffset = offset;
        commitSearchState(nextState);
      }

      try {
        const result = await searchInstrumentsDetailed(
          query,
          market,
          SEARCH_PAGE_SIZE,
          targetOffset
        );

        // Discard if lifecycle changed, a newer request started, or modal closed
        if (
          lifecycleTokenRef.current !== lifecycleToken ||
          activeRequestIdRef.current !== requestId
        ) {
          return;
        }

        if (result.error) {
          commitSearchState(
            applySearchFailure(searchStateRef.current, lifecycleToken, result.error || 'Arama başarısız')
          );
        } else {
          commitSearchState(
            applySearchSuccess(
              searchStateRef.current,
              lifecycleToken,
              targetOffset,
              result.items,
              result.hasMore
            )
          );
        }
      } catch (err) {
        if (
          lifecycleTokenRef.current === lifecycleToken &&
          activeRequestIdRef.current === requestId
        ) {
          commitSearchState(
            applySearchFailure(
              searchStateRef.current,
              lifecycleToken,
              err instanceof Error ? err.message : 'Arama sırasında hata oluştu'
            )
          );
        }
      }
    },
    [commitSearchState]
  );

  // Debounced search on query or category change
  useEffect(() => {
    if (!visible) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      runSearch(searchQuery, activeCategory, false);
    }, 250);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery, activeCategory, visible, runSearch]);

  const handleClose = () => {
    resetSearchLifecycle();
    onClose();
  };

  const handleCategoryPress = async (cat: ExtendedMarketType) => {
    setMutationError(null);
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    setActiveCategory(cat);
  };

  const handleLoadMore = () => {
    runSearch(searchQuery, activeCategory, true);
  };

  const handleToggleItem = async (instrumentId: string) => {
    if (pendingInstrumentIds.has(instrumentId) || isMembershipLoading) return;

    const isCurrentlyWatched = watchedInstrumentIds.has(instrumentId);
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Fallback
      }
    }
    const res = await onToggleWatchlist(instrumentId, !isCurrentlyWatched);
    if (!res.success) {
      setMutationError(res.error);
    } else {
      setMutationError(null);
    }
  };

  const isActionDisabled = isMembershipLoading || isMembershipStale;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlay}>
        {/* Backdrop tap dismisses keyboard and closes modal when touching outside the modal card */}
        <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); handleClose(); }}>
          <View style={StyleSheet.absoluteFillObject} />
        </TouchableWithoutFeedback>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalKeyboardAvoid}
          pointerEvents="box-none"
        >
          <View
            style={[
              styles.modalContainer,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.headerTitleGroup}>
                <IconSymbol size={20} name="plus" color={theme.tint} />
                <Text style={[styles.modalTitle, { color: theme.text }]}>Varlık Ekle</Text>
              </View>

              <TouchableOpacity
                style={[styles.closeButton, { backgroundColor: theme.surfaceElevated }]}
                onPress={handleClose}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Arama modalını kapat"
              >
                <IconSymbol size={16} name="xmark" color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Mutation Error Banner (Safe Localized Turkish Notice) */}
            {mutationError && (
              <View
                style={[
                  styles.mutationErrorBanner,
                  { backgroundColor: theme.negativeBg, borderColor: theme.negativeBorder },
                ]}
              >
                <View style={styles.mutationErrorLeft}>
                  <IconSymbol size={14} name="exclamationmark.triangle.fill" color={theme.negative} />
                  <Text style={[styles.mutationErrorText, { color: theme.negative }]}>
                    {mutationError}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setMutationError(null)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Hata uyarısını kapat"
                >
                  <IconSymbol size={14} name="xmark" color={theme.negative} />
                </TouchableOpacity>
              </View>
            )}

            {/* Membership Stale / Error Warning Banner */}
            {(membershipError || isMembershipStale) && (
              <View
                style={[
                  styles.membershipWarningBanner,
                  { backgroundColor: theme.warningBg, borderColor: theme.warningBorder },
                ]}
              >
                <IconSymbol size={14} name="exclamationmark.triangle.fill" color={theme.warning} />
                <Text style={[styles.membershipWarningText, { color: theme.warning }]}>
                  {membershipError || 'İzleme listesi üyelik verisi güncel olmayabilir.'}
                </Text>
                <TouchableOpacity
                  style={[styles.membershipRetryBtn, { borderColor: theme.warning }]}
                  onPress={() => onLoadMembership(true)}
                >
                  <Text style={[styles.membershipRetryText, { color: theme.warning }]}>
                    Yenile
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Category Filter Chips - STRICT SINGLE-ROW HORIZONTAL SCROLLVIEW */}
            <View style={styles.categoryScrollWrapper}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled={true}
                directionalLockEnabled={true}
                contentContainerStyle={styles.categoryScrollContent}
              >
                {CATEGORY_TABS.map((tab) => {
                  const isSelected = activeCategory === tab.id;
                  return (
                    <TouchableOpacity
                      key={tab.id}
                      style={[
                        styles.categoryPill,
                        {
                          backgroundColor: isSelected ? theme.tint : theme.surfaceElevated,
                          borderColor: isSelected ? theme.tintPressed : theme.borderSubtle,
                        },
                      ]}
                      onPress={() => handleCategoryPress(tab.id)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`${tab.label} kategorisi`}
                    >
                      <Text
                        style={[
                          styles.categoryText,
                          { color: isSelected ? (isDark ? '#171416' : '#FFFFFF') : theme.text },
                        ]}
                      >
                        {tab.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Search Input Box */}
            <View
              style={[
                styles.searchInputWrapper,
                { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle },
              ]}
            >
              <IconSymbol size={16} name="magnifyingglass" color={theme.textMuted} />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                placeholder="Sembol veya şirket adı ara..."
                placeholderTextColor={theme.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
              {searchQuery.length > 0 && Platform.OS !== 'ios' && (
                <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.7}>
                  <IconSymbol size={16} name="xmark.circle.fill" color={theme.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {/* Search Results - STRICT HORIZONTAL LIST OF SMALL CARDS */}
            {searchState.isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={theme.tint} />
                <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
                  Varlıklar aranıyor...
                </Text>
              </View>
            ) : searchState.error ? (
              <View style={styles.emptyContainer}>
                <Text style={[styles.emptyTitle, { color: theme.negative }]}>
                  {searchState.error}
                </Text>
                <TouchableOpacity
                  style={[styles.retryBtn, { backgroundColor: theme.negativeBg }]}
                  onPress={() => runSearch(searchQuery, activeCategory, false)}
                >
                  <Text style={[styles.retryBtnText, { color: theme.negative }]}>Tekrar Dene</Text>
                </TouchableOpacity>
              </View>
            ) : searchState.items.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={[styles.emptyTitle, { color: theme.text }]}>Sonuç Bulunamadı</Text>
                <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
                  Arama kriterinize uygun finansal varlık bulunamadı.
                </Text>
              </View>
            ) : (
              <View style={styles.horizontalListContainer}>
                <FlatList
                  horizontal
                  data={searchState.items}
                  keyExtractor={(item) => item.id}
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled={true}
                  directionalLockEnabled={true}
                  scrollEnabled={true}
                  contentContainerStyle={styles.horizontalListContent}
                  onEndReached={handleLoadMore}
                  onEndReachedThreshold={0.5}
                    renderItem={({ item }) => {
                      const isWatched = watchedInstrumentIds.has(item.id);
                      const isPending = pendingInstrumentIds.has(item.id);

                      const formattedPrice =
                        item.hasPrice && item.price !== null
                          ? formatCurrency(item.price, item.currency)
                          : '—';

                      const isPositive = typeof item.changePercent === 'number' && item.changePercent > 0;
                      const isNegative = typeof item.changePercent === 'number' && item.changePercent < 0;
                      const changeColor = isPositive
                        ? theme.positive
                        : isNegative
                          ? theme.negative
                          : theme.textSecondary;

                      const formattedChange =
                        typeof item.changePercent === 'number' && Number.isFinite(item.changePercent)
                          ? formatPercentage(item.changePercent, true)
                          : null;

                      return (
                        <View
                          style={[
                            styles.horizontalCard,
                            {
                              backgroundColor: isWatched ? theme.tintMuted : theme.surfaceElevated,
                              borderColor: isWatched ? theme.tintBorder : theme.borderSubtle,
                            },
                          ]}
                        >
                          {/* Card Header: Symbol & Market Pill */}
                          <View style={styles.cardHeader}>
                            <Text style={[styles.cardSymbol, { color: theme.text }]} numberOfLines={1}>
                              {item.symbol}
                            </Text>
                            <View
                              style={[
                                styles.cardMarketPill,
                                { backgroundColor: theme.surfaceHighlight },
                              ]}
                            >
                              <Text style={[styles.cardMarketText, { color: theme.tint }]}>
                                {item.market}
                              </Text>
                            </View>
                          </View>

                          {/* Company Name */}
                          <Text
                            style={[styles.cardCompany, { color: theme.textSecondary }]}
                            numberOfLines={1}
                          >
                            {item.companyName}
                          </Text>

                          {/* Card Body: Price & Daily Change */}
                          <View style={styles.cardPriceRow}>
                            <Text style={[styles.cardPrice, { color: theme.text }]}>
                              {formattedPrice}
                            </Text>
                            {formattedChange && (
                              <Text style={[styles.cardChange, { color: changeColor }]}>
                                {formattedChange}
                              </Text>
                            )}
                          </View>

                          {/* Action Button: Ekle / Ekli */}
                          <TouchableOpacity
                            style={[
                              styles.cardActionButton,
                              isWatched
                                ? { backgroundColor: theme.tint, borderColor: theme.tintPressed }
                                : { backgroundColor: theme.surface, borderColor: theme.border },
                              isActionDisabled && { opacity: 0.6 },
                            ]}
                            onPress={() => handleToggleItem(item.id)}
                            disabled={isPending || isActionDisabled}
                            activeOpacity={0.8}
                            accessibilityRole="button"
                            accessibilityLabel={
                              isWatched
                                ? `${item.symbol} izlemeden çıkar`
                                : `${item.symbol} izlemeye ekle`
                            }
                          >
                            {isPending || isMembershipLoading ? (
                              <ActivityIndicator
                                size="small"
                                color={isWatched ? (isDark ? '#171416' : '#FFFFFF') : theme.tint}
                              />
                            ) : isWatched ? (
                              <View style={styles.actionInner}>
                                <IconSymbol
                                  size={13}
                                  name="checkmark"
                                  color={isDark ? '#171416' : '#FFFFFF'}
                                />
                                <Text
                                  style={[
                                    styles.actionText,
                                    { color: isDark ? '#171416' : '#FFFFFF' },
                                  ]}
                                >
                                  Ekli
                                </Text>
                              </View>
                            ) : (
                              <View style={styles.actionInner}>
                                <IconSymbol size={13} name="plus" color={theme.tint} />
                                <Text style={[styles.actionText, { color: theme.tint }]}>
                                  Ekle
                                </Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        </View>
                      );
                    }}
                    ListFooterComponent={
                      searchState.isLoadingMore ? (
                        <View style={styles.footerLoading}>
                          <ActivityIndicator size="small" color={theme.tint} />
                        </View>
                      ) : null
                    }
                  />
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalKeyboardAvoid: {
    width: '100%',
    maxHeight: '90%',
  },
  modalContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: 520,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 4,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  membershipWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  membershipWarningText: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  membershipRetryBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  membershipRetryText: {
    fontSize: 11,
    fontWeight: '700',
  },
  mutationErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  mutationErrorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  mutationErrorText: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  categoryScrollWrapper: {
    flexDirection: 'row',
  },
  categoryScrollContent: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 12,
  },
  categoryPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '700',
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    padding: 0,
  },
  loadingContainer: {
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '500',
  },
  emptyContainer: {
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  emptySubtext: {
    fontSize: 12,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 6,
  },
  retryBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  horizontalListContainer: {
    paddingVertical: 6,
  },
  horizontalListContent: {
    gap: 12,
    paddingRight: 16,
    paddingBottom: 8,
  },
  horizontalCard: {
    width: 200,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  cardSymbol: {
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
  },
  cardMarketPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  cardMarketText: {
    fontSize: 10,
    fontWeight: '700',
  },
  cardCompany: {
    fontSize: 11,
    fontWeight: '500',
  },
  cardPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  cardPrice: {
    fontSize: 13,
    fontWeight: '700',
  },
  cardChange: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardActionButton: {
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  actionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  footerLoading: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
