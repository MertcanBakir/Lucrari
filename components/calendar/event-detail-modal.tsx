/**
 * Lucrari — Calendar Event Detail Modal Component
 * 
 * Accessible modal displaying comprehensive event information:
 * - Symbol & Company Name / Indicator Name
 * - Date, Time & Session
 * - Fiscal Period & Market / Country
 * - Owned Portfolio Quantity (if owned, supporting micro/fractional assets)
 * - Watchlist Membership indicator (if watched)
 * - Single Event Apple Calendar Export Action
 * - Verified HTTPS-Only Source URL Link
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  isAppleCalendarSupported,
  exportEventsToAppleCalendar,
  openAppleCalendar,
} from '@/services/calendar/apple-calendar-service';
import {
  formatPortfolioQuantity,
  isValidSecureEventUrl,
  type CalendarEventViewModel,
  type CalendarFilter,
} from '@/utils/calendar-event-filter';

export interface EventDetailModalProps {
  visible: boolean;
  event: CalendarEventViewModel | null;
  activeFilter?: CalendarFilter;
  onClose: () => void;
}

export function EventDetailModal({
  visible,
  event,
  activeFilter = 'all',
  onClose,
}: EventDetailModalProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const [isExporting, setIsExporting] = useState<boolean>(false);

  if (!event) return null;

  const isEarnings = event.type === 'earnings';
  const isAppleSupported = isAppleCalendarSupported();
  const isWatchlistFilter = activeFilter === 'watchlist';

  // Validate source URL strictly with pure HTTPS validator
  const isSecureUrl = isValidSecureEventUrl(event.sourceUrl);

  const handleOpenSourceUrl = async () => {
    if (!event.sourceUrl || !isSecureUrl) return;
    try {
      if (Platform.OS !== 'web') {
        await Haptics.selectionAsync();
      }
      const canOpen = await Linking.canOpenURL(event.sourceUrl);
      if (canOpen) {
        await Linking.openURL(event.sourceUrl);
      } else {
        Alert.alert('Bağlantı Açılamadı', 'Web tarayıcısında açılamayan adres.');
      }
    } catch {
      Alert.alert('Hata', 'Kaynak adresi açılamadı.');
    }
  };

  const handleSingleAppleExport = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        // Fallback
      }
    }

    setIsExporting(true);
    const result = await exportEventsToAppleCalendar([event]);
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
        `"${event.title}" olayı takviminize başarıyla kaydedildi.`,
        [
          {
            text: 'Apple Takvimi Aç',
            onPress: () => {
              const eventDate = new Date(event.dateKey);
              openAppleCalendar(isNaN(eventDate.getTime()) ? new Date() : eventDate);
            },
          },
          {
            text: 'Tamam',
            style: 'default',
          },
        ]
      );
    } else {
      Alert.alert('Aktarım Yapılamadı', result.error || 'Takvim izinleri doğrulanamadı.');
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalContentCard,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          {/* Header Bar */}
          <View style={styles.modalHeader}>
            <View style={styles.headerLeftGroup}>
              {isWatchlistFilter ? (
                <View
                  style={[
                    styles.prominentBadge,
                    { backgroundColor: theme.tintMuted, borderColor: theme.tintBorder },
                  ]}
                >
                  <IconSymbol size={13} name="list.bullet" color={theme.tint} />
                  <Text style={[styles.prominentBadgeText, { color: theme.tint }]}>
                    İZLEME LİSTEMDE
                  </Text>
                </View>
              ) : event.isInPortfolio ? (
                <View
                  style={[
                    styles.prominentBadge,
                    { backgroundColor: theme.positiveBg, borderColor: theme.positiveBorder },
                  ]}
                >
                  <IconSymbol size={13} name="briefcase.fill" color={theme.positive} />
                  <Text style={[styles.prominentBadgeText, { color: theme.positive }]}>
                    PORTFÖYÜMDE
                  </Text>
                </View>
              ) : event.isInWatchlist ? (
                <View
                  style={[
                    styles.prominentBadge,
                    { backgroundColor: theme.tintMuted, borderColor: theme.tintBorder },
                  ]}
                >
                  <IconSymbol size={13} name="list.bullet" color={theme.tint} />
                  <Text style={[styles.prominentBadgeText, { color: theme.tint }]}>
                    İZLEME LİSTEMDE
                  </Text>
                </View>
              ) : (
                <View
                  style={[
                    styles.typeBadge,
                    {
                      backgroundColor: isEarnings ? theme.warningBg : theme.infoBg,
                      borderColor: isEarnings ? theme.warningBorder : theme.infoBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.typeBadgeText,
                      { color: isEarnings ? theme.warning : theme.info },
                    ]}
                  >
                    {isEarnings ? 'ŞİRKET BİLANÇOSU' : 'EKONOMİK GÖSTERGE'}
                  </Text>
                </View>
              )}

              {isEarnings && (event.isInPortfolio || isWatchlistFilter || event.isInWatchlist) && (
                <View
                  style={[
                    styles.typeBadgeSecondary,
                    { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle },
                  ]}
                >
                  <Text style={[styles.typeBadgeSecondaryText, { color: theme.textSecondary }]}>
                    Şirket Bilançosu
                  </Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: theme.surfaceElevated }]}
              onPress={onClose}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Kapat"
            >
              <Text style={[styles.closeButtonText, { color: theme.textSecondary }]}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {/* Title & Subtitle */}
            <View style={styles.titleSection}>
              <Text style={[styles.eventTitle, { color: theme.text }]}>{event.title}</Text>
              <Text style={[styles.eventSubtitle, { color: theme.textSecondary }]}>
                {event.subtitle}
              </Text>
            </View>

            <View style={[styles.divider, { backgroundColor: theme.borderSubtle }]} />

            {/* Details Grid */}
            <View style={styles.detailGrid}>
              <View style={[styles.detailItem, { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }]}>
                <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Tarih</Text>
                <Text style={[styles.detailValue, { color: theme.text }]}>{event.dateKey}</Text>
              </View>

              <View style={[styles.detailItem, { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }]}>
                <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Zaman / Seans</Text>
                <Text style={[styles.detailValue, { color: theme.text }]}>{event.timeLabel}</Text>
              </View>

              <View style={[styles.detailItem, { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }]}>
                <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Piyasa / Ülke</Text>
                <Text style={[styles.detailValue, { color: theme.text }]}>{event.marketOrCountry}</Text>
              </View>

              {event.period && (
                <View style={[styles.detailItem, { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }]}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Dönem</Text>
                  <Text style={[styles.detailValue, { color: theme.text }]}>{event.period}</Text>
                </View>
              )}

              {/* Portfolio Position Highlight */}
              {event.isInPortfolio && (
                <View
                  style={[
                    styles.portfolioDetailCard,
                    {
                      backgroundColor: theme.positiveBg,
                      borderColor: theme.positiveBorder,
                    },
                  ]}
                >
                  <View style={styles.portfolioCardHeader}>
                    <IconSymbol size={16} name="briefcase.fill" color={theme.positive} />
                    <Text style={[styles.portfolioCardLabel, { color: theme.positive }]}>
                      Portföydeki Açık Pozisyonunuz
                    </Text>
                  </View>
                  <Text style={[styles.portfolioQuantityValue, { color: theme.positive }]}>
                    {formatPortfolioQuantity(event.portfolioQuantity)}
                  </Text>
                </View>
              )}

              {/* Watchlist Highlight (No quantity) */}
              {event.isInWatchlist && !event.isInPortfolio && (
                <View
                  style={[
                    styles.portfolioDetailCard,
                    {
                      backgroundColor: theme.tintMuted,
                      borderColor: theme.tintBorder,
                    },
                  ]}
                >
                  <View style={styles.portfolioCardHeader}>
                    <IconSymbol size={16} name="list.bullet" color={theme.tint} />
                    <Text style={[styles.portfolioCardLabel, { color: theme.tint }]}>
                      İzleme Listenizde Bulunuyor
                    </Text>
                  </View>
                  <Text style={[styles.watchlistHintText, { color: theme.textSecondary }]}>
                    Bu şirketi ana sayfadaki izleme listenizden anlık olarak takip ediyorsunuz.
                  </Text>
                </View>
              )}
            </View>

            {/* Actions Section */}
            <View style={styles.actionsSection}>
              {isAppleSupported && (
                <TouchableOpacity
                  style={[
                    styles.actionButtonPrimary,
                    { backgroundColor: theme.tint, borderColor: theme.tintPressed },
                  ]}
                  onPress={handleSingleAppleExport}
                  disabled={isExporting}
                  activeOpacity={0.8}
                >
                  {isExporting ? (
                    <ActivityIndicator size="small" color={isDark ? '#171416' : '#FFFFFF'} />
                  ) : (
                    <>
                      <Text style={styles.appleLogoIcon}></Text>
                      <Text style={[styles.actionButtonPrimaryText, { color: isDark ? '#171416' : '#FFFFFF' }]}>
                        Apple Takvime Ekle
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              {isSecureUrl && (
                <TouchableOpacity
                  style={[
                    styles.actionButtonSecondary,
                    { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle },
                  ]}
                  onPress={handleOpenSourceUrl}
                  activeOpacity={0.7}
                >
                  <IconSymbol size={15} name="globe" color={theme.tint} />
                  <Text style={[styles.actionButtonSecondaryText, { color: theme.tint }]}>
                    Resmi Kaynağı / KAP Bildirimini İncele
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContentCard: {
    width: '100%',
    maxHeight: '85%',
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
  },
  headerLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  prominentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
  },
  prominentBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  typeBadgeSecondary: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  typeBadgeSecondaryText: {
    fontSize: 11,
    fontWeight: '600',
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  scrollContent: {
    gap: 14,
    paddingBottom: 4,
  },
  titleSection: {
    gap: 4,
  },
  eventTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  eventSubtitle: {
    fontSize: 14,
    lineHeight: 18,
  },
  divider: {
    height: 1,
  },
  detailGrid: {
    gap: 8,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  portfolioDetailCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    marginTop: 4,
  },
  portfolioCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  portfolioCardLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  portfolioQuantityValue: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  watchlistHintText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  actionsSection: {
    gap: 10,
    paddingTop: 6,
  },
  actionButtonPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  appleLogoIcon: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: -2,
  },
  actionButtonPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionButtonSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionButtonSecondaryText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
