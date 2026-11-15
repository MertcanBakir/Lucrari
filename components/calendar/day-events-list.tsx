/**
 * Day Events List Component
 * 
 * Displays the detailed agenda of financial events (earnings & economic releases)
 * for the selected date with high-contrast cards, prominent PORTFÖYÜMDE & İZLEME LİSTEMDE badges,
 * and tap-to-inspect detail modals with single event Apple Calendar export.
 * Suppresses rendering when showContent is false or emptyStateKind is 'none' with zero events.
 */

import React, { useState, useMemo } from 'react';
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
import { EventDetailModal } from './event-detail-modal';
import type { CalendarEventViewModel, CalendarFilter } from '@/utils/calendar-event-filter';

export interface DayEventsListProps {
  selectedDate: Date;
  events: CalendarEventViewModel[];
  isLoading?: boolean;
  activeFilter?: CalendarFilter;
  hasOpenPositionsInPortfolio?: boolean;
  hasWatchlistItems?: boolean;
  emptyStateKind?: 'none' | 'empty_portfolio' | 'empty_watchlist' | 'empty_day_events' | 'empty_watchlist_events' | 'empty_filter';
  showContent?: boolean;
}

export function DayEventsList({
  selectedDate,
  events,
  isLoading = false,
  activeFilter = 'all',
  hasOpenPositionsInPortfolio = true,
  hasWatchlistItems = true,
  emptyStateKind,
  showContent = true,
}: DayEventsListProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const [selectedEventForDetail, setSelectedEventForDetail] = useState<CalendarEventViewModel | null>(null);

  const formattedDateText = useMemo(() => {
    return selectedDate.toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      weekday: 'long',
    });
  }, [selectedDate]);

  const portfolioOwnedCount = useMemo(
    () => events.filter((e) => e.isInPortfolio).length,
    [events]
  );

  const watchlistWatchedCount = useMemo(
    () => events.filter((e) => e.isInWatchlist).length,
    [events]
  );

  const handleCardPress = async (item: CalendarEventViewModel) => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    setSelectedEventForDetail(item);
  };

  // If loading is false and showContent is false, or emptyStateKind is 'none' with no events, suppress render
  if (!isLoading && (!showContent || (events.length === 0 && emptyStateKind === 'none'))) {
    return null;
  }

  const isTrulyEmptyPortfolio = emptyStateKind
    ? emptyStateKind === 'empty_portfolio'
    : !hasOpenPositionsInPortfolio && activeFilter === 'portfolio';

  const isTrulyEmptyWatchlist = emptyStateKind
    ? emptyStateKind === 'empty_watchlist'
    : !hasWatchlistItems && activeFilter === 'watchlist';

  return (
    <View style={[styles.container, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {/* Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.titleGroup}>
          <IconSymbol size={18} name="calendar" color={theme.tint} />
          <Text style={[styles.dateTitleText, { color: theme.text }]}>
            {formattedDateText}
          </Text>
        </View>

        <View style={styles.headerBadgesRow}>
          {activeFilter !== 'portfolio' && portfolioOwnedCount > 0 && (
            <View
              style={[
                styles.portfolioCountBadge,
                {
                  backgroundColor: theme.positiveBg,
                  borderColor: theme.positiveBorder,
                },
              ]}
            >
              <IconSymbol size={11} name="briefcase.fill" color={theme.positive} />
              <Text style={[styles.portfolioCountText, { color: theme.positive }]}>
                {portfolioOwnedCount} Portföyümde
              </Text>
            </View>
          )}

          {activeFilter !== 'watchlist' && activeFilter !== 'portfolio' && watchlistWatchedCount > 0 && (
            <View
              style={[
                styles.portfolioCountBadge,
                {
                  backgroundColor: theme.tintMuted,
                  borderColor: theme.tintBorder,
                },
              ]}
            >
              <IconSymbol size={11} name="list.bullet" color={theme.tint} />
              <Text style={[styles.portfolioCountText, { color: theme.tint }]}>
                {watchlistWatchedCount} İzlemede
              </Text>
            </View>
          )}

          <View
            style={[
              styles.countBadge,
              {
                backgroundColor: events.length > 0 ? theme.tintMuted : theme.surfaceElevated,
                borderColor: events.length > 0 ? theme.tintBorder : theme.borderSubtle,
              },
            ]}
          >
            <Text
              style={[
                styles.countBadgeText,
                { color: events.length > 0 ? theme.tint : theme.textMuted },
              ]}
            >
              {events.length} Olay
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.borderSubtle }]} />

      {/* Content Area */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={theme.tint} />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
            Finansal olaylar yükleniyor...
          </Text>
        </View>
      ) : events.length === 0 ? (
        <View style={styles.emptyState}>
          {activeFilter === 'portfolio' ? (
            <>
              <View style={[styles.emptyIconCircle, { backgroundColor: theme.surfaceElevated }]}>
                <IconSymbol size={28} name="briefcase.fill" color={theme.tint} />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                {isTrulyEmptyPortfolio
                  ? 'Portföyünüzde Açık Pozisyon Bulunmuyor'
                  : 'Portföyünüzde Bilanço Olayı Yok'}
              </Text>
              <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
                {isTrulyEmptyPortfolio
                  ? 'Yatırımlar sekmesinden hisse alımı eklediğinizde, ilgili şirketlerin bilanço tarihleri burada listelenecektir.'
                  : 'Seçili tarihte açık pozisyonunuz bulunan şirketlere ait bir bilanço açıklaması bulunmuyor.'}
              </Text>
            </>
          ) : activeFilter === 'watchlist' ? (
            <>
              <View style={[styles.emptyIconCircle, { backgroundColor: theme.surfaceElevated }]}>
                <IconSymbol size={28} name="list.bullet" color={theme.tint} />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                {isTrulyEmptyWatchlist
                  ? 'İzleme Listeniz Boş'
                  : 'İzleme Listenizde Takvim Olayı Yok'}
              </Text>
              <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
                {isTrulyEmptyWatchlist
                  ? 'Ana sayfanın altındaki İzleme Listesi bölümünden varlık ekleyebilirsiniz.'
                  : 'Bu tarihte izleme listenizdeki şirketlere ait bir bilanço açıklaması bulunmuyor.'}
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                {activeFilter === 'all'
                  ? 'Bu tarihte planlanan finansal bildirim bulunmuyor'
                  : 'Seçili filtreye uygun bildirim yok'}
              </Text>
              <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
                BIST 100 & NASDAQ 100 şirketlerinin KAP bilanço takvimi veya resmi ekonomik göstergeler
                açıklandıkça anlık olarak bu alanda listelenecektir.
              </Text>
            </>
          )}
        </View>
      ) : (
        <View style={styles.eventsList}>
          {events.map((item) => {
            const isEarnings = item.type === 'earnings';
            const isOwned = item.isInPortfolio;
            const isWatchlistFilter = activeFilter === 'watchlist';

            let badgeBg = isEarnings ? theme.warningBg : theme.infoBg;
            let badgeBorder = isEarnings ? theme.warningBorder : theme.infoBorder;
            let badgeColor = isEarnings ? theme.warning : theme.info;
            let badgeLabel = isEarnings ? 'ŞİRKET BİLANÇOSU' : 'EKONOMİK GÖSTERGE';
            let badgeIcon: 'briefcase.fill' | 'list.bullet' | null = null;

            if (isWatchlistFilter) {
              // In Watchlist filter, Watchlist badge is primary
              badgeBg = theme.tintMuted;
              badgeBorder = theme.tintBorder;
              badgeColor = theme.tint;
              badgeLabel = 'İZLEME LİSTEMDE';
              badgeIcon = 'list.bullet';
            } else if (isOwned) {
              // In other filters, Owned badge is primary
              badgeBg = theme.positiveBg;
              badgeBorder = theme.positiveBorder;
              badgeColor = theme.positive;
              badgeLabel = 'PORTFÖYÜMDE';
              badgeIcon = 'briefcase.fill';
            }

            const cardBorderColor = isWatchlistFilter
              ? theme.tintBorder
              : isOwned
              ? theme.positiveBorder
              : theme.borderSubtle;

            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.eventCard,
                  {
                    backgroundColor: theme.surfaceElevated,
                    borderColor: cardBorderColor,
                  },
                ]}
                onPress={() => handleCardPress(item)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`${item.title} detaylarını aç`}
              >
                {/* Event Top Meta Row */}
                <View style={styles.eventMetaRow}>
                  <View style={styles.metaLeftGroup}>
                    <View style={[styles.typeBadge, { backgroundColor: badgeBg, borderColor: badgeBorder }]}>
                      {badgeIcon && (
                        <IconSymbol size={11} name={badgeIcon} color={badgeColor} />
                      )}
                      <Text style={[styles.typeBadgeText, { color: badgeColor }]}>{badgeLabel}</Text>
                    </View>

                    {isEarnings && (isOwned || isWatchlistFilter) && (
                      <View
                        style={[
                          styles.secondaryBadge,
                          { backgroundColor: theme.surfaceHighlight, borderColor: theme.borderSubtle },
                        ]}
                      >
                        <Text style={[styles.secondaryBadgeText, { color: theme.textSecondary }]}>
                          Şirket Bilançosu
                        </Text>
                      </View>
                    )}

                    {isWatchlistFilter && isOwned && (
                      <View
                        style={[
                          styles.secondaryBadge,
                          { backgroundColor: theme.positiveBg, borderColor: theme.positiveBorder },
                        ]}
                      >
                        <Text style={[styles.secondaryBadgeText, { color: theme.positive }]}>
                          Portföyde
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.timeTag}>
                    <IconSymbol size={12} name="calendar" color={theme.textMuted} />
                    <Text style={[styles.timeTagText, { color: theme.textSecondary }]}>
                      {item.timeLabel}
                    </Text>
                  </View>
                </View>

                {/* Event Main Content */}
                <View style={styles.eventMainRow}>
                  <View style={styles.eventTitleWrapper}>
                    <Text style={[styles.eventTitle, { color: theme.text }]}>
                      {item.title}
                    </Text>
                    <Text
                      style={[styles.eventSubtitle, { color: theme.textSecondary }]}
                      numberOfLines={2}
                    >
                      {item.subtitle}
                    </Text>
                  </View>

                  <View style={[styles.marketPillTag, { backgroundColor: theme.surfaceHighlight }]}>
                    <Text style={[styles.marketPillText, { color: theme.tint }]}>
                      {item.marketOrCountry}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Detailed Event Inspection Modal */}
      <EventDetailModal
        visible={Boolean(selectedEventForDetail)}
        event={selectedEventForDetail}
        activeFilter={activeFilter}
        onClose={() => setSelectedEventForDetail(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginVertical: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  dateTitleText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  countBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  portfolioCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  portfolioCountText: {
    fontSize: 11,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    marginHorizontal: -16,
  },
  loadingContainer: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '500',
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  emptySubtext: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  eventsList: {
    gap: 10,
    paddingTop: 12,
  },
  eventCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
  },
  eventMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  secondaryBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  secondaryBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  timeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeTagText: {
    fontSize: 11,
    fontWeight: '500',
  },
  eventMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  eventTitleWrapper: {
    flex: 1,
    gap: 2,
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  eventSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  marketPillTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  marketPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
