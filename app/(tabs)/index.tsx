import { useLocalSearchParams } from 'expo-router';
import { isValidUUID } from '@/utils/validation';
import { isNotificationDate } from '@/utils/notification-routing';
import React, { useState, useMemo, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { haptics as Haptics } from '@/services/feedback/haptics';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { MonthlyCalendar } from '@/components/calendar/monthly-calendar';
import { DayEventsList } from '@/components/calendar/day-events-list';
import { CalendarFilterChips } from '@/components/calendar/calendar-filter-chips';
import { HomeWatchlistSection } from '@/components/watchlist/home-watchlist-section';
import { useNotificationPreferences } from '@/hooks/use-notification-preferences';
import { useMonthlyCalendar } from '@/hooks/use-monthly-calendar';
import { usePortfolioCalendarOwnership } from '@/hooks/use-portfolio-calendar-ownership';
import { useWatchlistMembership } from '@/hooks/use-watchlist-membership';
import { useAppTheme } from '@/context/theme-context';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  isAppleCalendarSupported,
  exportEventsToAppleCalendar,
  openAppleCalendar,
} from '@/services/calendar/apple-calendar-service';
import { formatDateKey } from '@/utils/calendar-utils';
import {
  buildFilteredCalendarData,
  reconcileExportSelection,
  resolveCalendarViewState,
  type CalendarFilter,
  type CalendarEventViewModel,
} from '@/utils/calendar-event-filter';

export default function HomeScreen() {
  const { colorScheme } = useAppTheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const params = useLocalSearchParams<{ date?: string; filter?: string; instrument?: string; event?: string; economicEvent?: string; notification?: string }>();
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState<number>(() => today.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(() => today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date>(() => today);
  const [activeFilter, setActiveFilter] = useState<CalendarFilter>('all');

  const [focusedEvent, setFocusedEvent] = useState<{ type: 'earnings'; id: string; instrument: string } | { type: 'economic'; id: string } | null>(null);
  useEffect(() => {
    if (!isNotificationDate(params.date)) return;
    setFocusedEvent(isValidUUID(params.economicEvent) ? { type: 'economic', id: params.economicEvent }
      : isValidUUID(params.event) && isValidUUID(params.instrument) ? { type: 'earnings', id: params.event, instrument: params.instrument } : null);
    const date = new Date(`${params.date}T12:00:00`);
    setSelectedDate(date);
    setViewYear(date.getFullYear());
    setViewMonth(date.getMonth());
    setActiveFilter(params.filter === 'portfolio' ? 'portfolio' : params.filter === 'watchlist' ? 'watchlist' : params.filter === 'economic' ? 'economic' : 'earnings');
  }, [params.date, params.filter, params.notification, params.event, params.instrument, params.economicEvent]);

  // Apple Calendar Selection Mode state (iOS only)
  const [isExportMode, setIsExportMode] = useState<boolean>(false);
  const [selectedExportDates, setSelectedExportDates] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const isEconomicNotification = Boolean(params.notification && params.filter === 'economic' && isNotificationDate(params.date));
  const notificationPreferences = useNotificationPreferences(isEconomicNotification);
  // Fetch monthly calendar events from Supabase with in-memory caching
  const {
    eventsByDate: rawEventsByDate,
    isLoading: calendarLoading,
    error: calendarLoadError,
    hasLoadedSuccessfully: calendarHasLoaded,
    refetch: refetchCalendar,
  } = useMonthlyCalendar(viewYear, viewMonth, isEconomicNotification ? notificationPreferences.preferences?.timezone : undefined);
  const isCalendarLoading = calendarLoading || (isEconomicNotification && notificationPreferences.loading);
  const hasCalendarLoadedSuccessfully = calendarHasLoaded && (!isEconomicNotification || Boolean(notificationPreferences.preferences));
  const calendarError = calendarLoadError || (isEconomicNotification ? notificationPreferences.error : null);

  // Fetch lightweight owned portfolio positions for "Portföyüm" filtering (strictly user-isolated)
  const {
    ownedPositions,
    isLoading: isOwnershipLoading,
    isStale: isOwnershipStale,
    error: ownershipError,
    hasLoadedSuccessfully: hasOwnershipLoaded,
    refetch: refetchOwnership,
  } = usePortfolioCalendarOwnership();

  // Fetch lightweight watchlist membership for "İzleme Listesi" filtering (strictly user-isolated)
  const {
    watchedInstrumentIds,
    watchedCount,
    isLoading: isWatchlistLoading,
    isStale: isWatchlistStale,
    error: watchlistError,
    hasLoadedSuccessfully: hasWatchlistLoaded,
    refetch: refetchWatchlist,
  } = useWatchlistMembership();

  // Exact number of unique open positions
  const openPositionsCount = ownedPositions.size;

  // Recalculate filtered events & day indicators dynamically based on active filter
  const {
    eventsByDate: filteredEventsByDate,
    dayIndicators: filteredDayIndicators,
  } = useMemo(() => {
    return buildFilteredCalendarData(rawEventsByDate, activeFilter, ownedPositions, watchedInstrumentIds);
  }, [rawEventsByDate, activeFilter, ownedPositions, watchedInstrumentIds]);

  // Reconcile export selection automatically whenever filteredDayIndicators changes
  useEffect(() => {
    setSelectedExportDates((prev) => {
      const next = reconcileExportSelection(prev, filteredDayIndicators);
      if (next.size === prev.size && Array.from(next).every((k) => prev.has(k))) {
        return prev;
      }
      return next;
    });
  }, [filteredDayIndicators]);

  const selectedDayDateKey = useMemo(() => formatDateKey(selectedDate), [selectedDate]);
  const selectedDayEvents: CalendarEventViewModel[] = useMemo(() => {
    const events = filteredEventsByDate[selectedDayDateKey] || [];
    if (isEconomicNotification && !notificationPreferences.preferences) return [];
    if (focusedEvent && selectedDayDateKey === params.date) {
      return events.filter(event => focusedEvent.type === 'economic'
        ? event.id === `economic-${focusedEvent.id}`
        : event.id === `earnings-${focusedEvent.id}` && event.instrumentId === focusedEvent.instrument);
    }
    return events;
  }, [filteredEventsByDate, selectedDayDateKey, focusedEvent, params.date, isEconomicNotification, notificationPreferences.preferences]);

  // Unambiguous pure view-state resolution
  const viewStateResolution = useMemo(() => {
    return resolveCalendarViewState({
      activeFilter,
      isCalendarLoading,
      calendarError,
      hasCalendarLoadedSuccessfully,
      isOwnershipLoading,
      ownershipError,
      hasOwnershipLoaded,
      isOwnershipStale,
      openPositionsCount,
      isWatchlistLoading,
      watchlistError,
      hasWatchlistLoaded,
      isWatchlistStale,
      watchedCount,
      dayEventsCount: selectedDayEvents.length,
    });
  }, [
    activeFilter,
    isCalendarLoading,
    calendarError,
    hasCalendarLoadedSuccessfully,
    isOwnershipLoading,
    ownershipError,
    hasOwnershipLoaded,
    isOwnershipStale,
    openPositionsCount,
    isWatchlistLoading,
    watchlistError,
    hasWatchlistLoaded,
    isWatchlistStale,
    watchedCount,
    selectedDayEvents.length,
  ]);

  const handleFilterChange = (newFilter: CalendarFilter) => {
    setFocusedEvent(null);
    setActiveFilter(newFilter);
  };

  const handleMonthChange = (newYear: number, newMonth: number) => {
    setFocusedEvent(null);
    setViewYear(newYear);
    setViewMonth(newMonth);
    // Clear selection when month changes
    if (isExportMode) {
      setSelectedExportDates(new Set());
    }
  };

  const handleSelectDate = (date: Date) => {
    setFocusedEvent(null);
    setSelectedDate(date);
  };

  // Toggle single day in export mode
  const handleToggleDayForExport = (dateKey: string) => {
    setSelectedExportDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }
      return next;
    });
  };

  // All date keys in current month that have at least 1 visible filtered event
  const allEventDateKeysInMonth = useMemo(() => {
    return Object.keys(filteredDayIndicators).filter(
      (key) => (filteredDayIndicators[key]?.count ?? 0) > 0
    );
  }, [filteredDayIndicators]);

  // Select all days in current month with events
  const handleSelectAllMonth = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Fallback
      }
    }
    setSelectedExportDates(new Set(allEventDateKeysInMonth));
  };

  // Clear export selection
  const handleClearExportSelection = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    setSelectedExportDates(new Set());
  };

  // Toggle export mode
  const handleToggleExportMode = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        // Fallback
      }
    }
    if (isExportMode) {
      setIsExportMode(false);
      setSelectedExportDates(new Set());
    } else {
      setIsExportMode(true);
      // Auto-select selected date if it has events
      const indicator = filteredDayIndicators[selectedDayDateKey];
      if (indicator && indicator.count > 0) {
        setSelectedExportDates(new Set([selectedDayDateKey]));
      } else {
        setSelectedExportDates(new Set());
      }
    }
  };

  // Collect all events to export
  const eventsToExport: CalendarEventViewModel[] = useMemo(() => {
    const list: CalendarEventViewModel[] = [];
    for (const dateKey of selectedExportDates) {
      const dayEvents = filteredEventsByDate[dateKey] || [];
      list.push(...dayEvents);
    }
    return list;
  }, [selectedExportDates, filteredEventsByDate]);

  // Execute export to Apple Calendar
  const handleExecuteExport = async () => {
    if (eventsToExport.length === 0) {
      Alert.alert('Olay Seçilmedi', 'Lütfen takvime aktarmak istediğiniz günleri seçin.');
      return;
    }

    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        // Fallback
      }
    }

    setIsExporting(true);
    const result = await exportEventsToAppleCalendar(eventsToExport);
    setIsExporting(false);

    if (result.success) {
      if (Platform.OS !== 'web') {
        try {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          // Fallback
        }
      }

      Alert.alert(
        'Apple Takvime Eklendi! ',
        `${result.addedCount} finansal olay mevcut Apple Takviminize aktarıldı.`,
        [
          {
            text: 'Apple Takvimi Aç',
            onPress: () => openAppleCalendar(selectedDate),
          },
          {
            text: 'Tamam',
            style: 'default',
            onPress: () => {
              setIsExportMode(false);
              setSelectedExportDates(new Set());
            },
          },
        ]
      );
    } else {
      Alert.alert('Aktarım Tamamlanamadı', result.error || 'Takvim izinleri kontrol edilemedi.');
    }
  };

  const handleRefreshStale = () => {
    if (viewStateResolution.staleSource === 'calendar_and_ownership' || viewStateResolution.staleSource === 'both') {
      refetchOwnership();
      refetchCalendar();
    } else if (viewStateResolution.staleSource === 'calendar_and_watchlist') {
      refetchWatchlist();
      refetchCalendar();
    } else if (viewStateResolution.staleSource === 'ownership') {
      refetchOwnership();
    } else if (viewStateResolution.staleSource === 'watchlist') {
      refetchWatchlist();
    } else if (viewStateResolution.staleSource === 'calendar') {
      refetchCalendar();
    }
  };

  const isAppleSupported = isAppleCalendarSupported();

  return (
    <View style={styles.screenWrapper}>
      <ParallaxScrollView
        headerBackgroundColor={{ light: '#F8F6F7', dark: '#171416' }}
        headerImage={
          <View style={styles.headerGraphic}>
            <Image
              source={require('@/assets/images/Lucrari_logo_transparent.png')}
              style={styles.headerLogoImage}
              resizeMode="contain"
            />
          </View>
        }>
        {/* Screen Title & Executive Badge */}
        <View style={styles.titleContainer}>
          <View>
            <Text style={[styles.appTitle, { color: theme.text }]}>Lucrari</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Finansal Takvim & Piyasa Analizi
            </Text>
          </View>
        </View>

        {/* Apple Calendar Export Mode Controls (iOS Exclusive) */}
        {isAppleSupported && (
          <View style={styles.appleSyncSection}>
            {!isExportMode ? (
              <TouchableOpacity
                style={[
                  styles.appleExportTriggerButton,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
                onPress={handleToggleExportMode}
                activeOpacity={0.7}
              >
                <View style={styles.appleButtonLeft}>
                  <Text style={styles.appleLogoIcon}></Text>
                  <Text style={[styles.appleButtonTitle, { color: theme.text }]}>
                    Apple Takvime Aktar
                  </Text>
                </View>
                <View
                  style={[
                    styles.appleBadge,
                    { backgroundColor: theme.tintMuted, borderColor: theme.tintBorder },
                  ]}
                >
                  <Text style={[styles.appleBadgeText, { color: theme.tint }]}>Seç & Aktar</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={styles.exportModeGroup}>
                {/* 1. Header Selection Control Card */}
                <View
                  style={[
                    styles.selectionBannerCard,
                    { backgroundColor: theme.surfaceElevated, borderColor: theme.tintBorder },
                  ]}
                >
                  <View style={styles.selectionBannerHeader}>
                    <View style={styles.bannerTitleGroup}>
                      <Text style={styles.bannerAppleIcon}></Text>
                      <Text style={[styles.selectionBannerTitle, { color: theme.text }]}>
                        Apple Takvim Aktarım Modu
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.closeExportButton, { backgroundColor: theme.surface }]}
                      onPress={handleToggleExportMode}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Aktarım modunu kapat"
                    >
                      <IconSymbol size={16} name="xmark" color={theme.textSecondary} />
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.selectionBannerSubtitle, { color: theme.textSecondary }]}>
                    Takviminizden aktarmak istediğiniz günlere dokunarak çoklu seçim yapın.
                  </Text>

                  {/* Multi-Select Action Pills */}
                  <View style={styles.selectionActionsRow}>
                    <TouchableOpacity
                      style={[
                        styles.selectPillButton,
                        { backgroundColor: theme.surface, borderColor: theme.borderSubtle },
                      ]}
                      onPress={handleSelectAllMonth}
                      activeOpacity={0.7}
                    >
                      <IconSymbol size={13} name="checkmark.circle.fill" color={theme.tint} />
                      <Text style={[styles.selectPillText, { color: theme.tint }]}>
                        Tüm Ayı Seç ({allEventDateKeysInMonth.length} Gün)
                      </Text>
                    </TouchableOpacity>

                    {selectedExportDates.size > 0 && (
                      <TouchableOpacity
                        style={[
                          styles.selectPillButton,
                          { backgroundColor: theme.surface, borderColor: theme.borderSubtle },
                        ]}
                        onPress={handleClearExportSelection}
                        activeOpacity={0.7}
                      >
                        <IconSymbol size={13} name="xmark.circle.fill" color={theme.textMuted} />
                        <Text style={[styles.selectPillText, { color: theme.textSecondary }]}>
                          Seçimi Temizle
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {/* 2. Floating Action Execution Summary Bar */}
                <View
                  style={[
                    styles.exportSummaryBar,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                  ]}
                >
                  <View style={styles.summaryTextGroup}>
                    <Text style={[styles.summaryCountTitle, { color: theme.text }]}>
                      {selectedExportDates.size} Gün Seçildi
                    </Text>
                    <Text style={[styles.summarySubCount, { color: theme.textSecondary }]}>
                      Toplam {eventsToExport.length} finansal olay aktarılacak
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.exportExecuteButton,
                      eventsToExport.length === 0
                        ? { backgroundColor: theme.disabledBg, borderColor: theme.borderSubtle }
                        : { backgroundColor: theme.tint, borderColor: theme.tintPressed },
                    ]}
                    onPress={handleExecuteExport}
                    disabled={eventsToExport.length === 0 || isExporting}
                    activeOpacity={0.8}
                  >
                    {isExporting ? (
                      <ActivityIndicator size="small" color={isDark ? '#171416' : '#FFFFFF'} />
                    ) : (
                      <Text
                        style={[
                          styles.exportExecuteButtonText,
                          { color: eventsToExport.length === 0 ? theme.disabledText : (isDark ? '#171416' : '#FFFFFF') },
                        ]}
                      >
                        {eventsToExport.length > 0
                          ? ` Takvime Ekle (${eventsToExport.length})`
                          : 'Gün Seçin'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Calendar Category, Portfolio & Watchlist Filter Chips */}
        <CalendarFilterChips
          activeFilter={activeFilter}
          onFilterChange={handleFilterChange}
          ownedCount={openPositionsCount}
          watchedCount={watchedCount}
        />

        {/* Error Notices */}
        {viewStateResolution.ownershipErrorMessage && (
          <View style={[styles.errorBanner, { backgroundColor: theme.negativeBg, borderColor: theme.negativeBorder }]}>
            <View style={styles.errorBannerLeft}>
              <IconSymbol size={16} name="exclamationmark.triangle.fill" color={theme.negative} />
              <Text style={[styles.errorBannerText, { color: theme.negative }]}>
                {viewStateResolution.ownershipErrorMessage}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.retryButton, { backgroundColor: theme.negative }]}
              onPress={() => refetchOwnership()}
              activeOpacity={0.8}
            >
              <Text style={[styles.retryButtonText, { color: '#FFFFFF' }]}>Tekrar Dene</Text>
            </TouchableOpacity>
          </View>
        )}

        {viewStateResolution.watchlistErrorMessage && (
          <View style={[styles.errorBanner, { backgroundColor: theme.negativeBg, borderColor: theme.negativeBorder }]}>
            <View style={styles.errorBannerLeft}>
              <IconSymbol size={16} name="exclamationmark.triangle.fill" color={theme.negative} />
              <Text style={[styles.errorBannerText, { color: theme.negative }]}>
                {viewStateResolution.watchlistErrorMessage}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.retryButton, { backgroundColor: theme.negative }]}
              onPress={() => refetchWatchlist()}
              activeOpacity={0.8}
            >
              <Text style={[styles.retryButtonText, { color: '#FFFFFF' }]}>Tekrar Dene</Text>
            </TouchableOpacity>
          </View>
        )}

        {viewStateResolution.calendarErrorMessage && (
          <View style={[styles.errorBanner, { backgroundColor: theme.negativeBg, borderColor: theme.negativeBorder }]}>
            <View style={styles.errorBannerLeft}>
              <IconSymbol size={16} name="exclamationmark.triangle.fill" color={theme.negative} />
              <Text style={[styles.errorBannerText, { color: theme.negative }]}>
                {viewStateResolution.calendarErrorMessage}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.retryButton, { backgroundColor: theme.negative }]}
              onPress={() => { void refetchCalendar(); if (isEconomicNotification) void notificationPreferences.reload(); }}
              activeOpacity={0.8}
            >
              <Text style={[styles.retryButtonText, { color: '#FFFFFF' }]}>Tekrar Dene</Text>
            </TouchableOpacity>
          </View>
        )}

        {viewStateResolution.staleNoticeText && (
          <View style={[styles.staleBanner, { backgroundColor: theme.warningBg, borderColor: theme.warningBorder }]}>
            <View style={styles.staleBannerLeft}>
              <IconSymbol size={14} name="exclamationmark.triangle.fill" color={theme.warning} />
              <Text style={[styles.staleBannerText, { color: theme.warning }]}>
                {viewStateResolution.staleNoticeText}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.staleRefreshButton, { borderColor: theme.warning }]}
              onPress={handleRefreshStale}
              activeOpacity={0.8}
            >
              <Text style={[styles.staleRefreshText, { color: theme.warning }]}>Yenile</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 1-Month Interactive Calendar with 2-color indicator dots & Multi-Select */}
        <MonthlyCalendar
          year={viewYear}
          month={viewMonth}
          onMonthChange={handleMonthChange}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
          dayIndicators={filteredDayIndicators}
          isLoading={viewStateResolution.showCalendarSpinner}
          isSelectionMode={isExportMode}
          selectedDaysForExport={selectedExportDates}
          onToggleDayForExport={handleToggleDayForExport}
        />

        {/* Selected Day Agenda & Event Details List */}
        {!isExportMode && (viewStateResolution.showDayEventsContent || viewStateResolution.showDayEventsSpinner) && (
          <DayEventsList
            selectedDate={selectedDate}
            events={selectedDayEvents}
            isLoading={viewStateResolution.showDayEventsSpinner}
            activeFilter={activeFilter}
            hasOpenPositionsInPortfolio={openPositionsCount > 0}
            hasWatchlistItems={watchedCount > 0}
            emptyStateKind={viewStateResolution.emptyStateKind}
            showContent={viewStateResolution.showDayEventsContent}
          />
        )}

        {/* Watchlist Section */}
        <HomeWatchlistSection />
      </ParallaxScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
  },
  headerGraphic: {
    height: 220,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    bottom: 0,
  },
  headerLogoImage: {
    width: '75%',
    height: 160,
    opacity: 0.95,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
    fontWeight: '500',
  },
  appleSyncSection: {
    marginBottom: 6,
  },
  appleExportTriggerButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  appleButtonLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appleLogoIcon: {
    fontSize: 16,
    fontWeight: '700',
    color: '#007AFF',
  },
  appleButtonTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  appleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  appleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  exportModeGroup: {
    gap: 10,
  },
  selectionBannerCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  selectionBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bannerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bannerAppleIcon: {
    fontSize: 16,
    fontWeight: '700',
    color: '#007AFF',
  },
  selectionBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  closeExportButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionBannerSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  selectionActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  selectPillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  selectPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  exportSummaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  summaryTextGroup: {
    flex: 1,
    gap: 2,
  },
  summaryCountTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  summarySubCount: {
    fontSize: 11,
  },
  exportExecuteButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
  },
  exportExecuteButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginVertical: 4,
    gap: 8,
  },
  errorBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  errorBannerText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  retryButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 11,
    fontWeight: '700',
  },
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginVertical: 4,
    gap: 8,
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
  staleRefreshButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  staleRefreshText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
