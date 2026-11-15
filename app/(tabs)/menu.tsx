import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { AnalysisHealthMenuItem } from '@/components/health/analysis-health-menu-item';
import { SupabaseHealthMenuItem } from '@/components/health/supabase-health-menu-item';
import { SystemHealthMenuItem } from '@/components/system-health/system-health-menu-item';
import { Colors } from '@/constants/theme';
import { useAppTheme, ThemeMode } from '@/context/theme-context';
import { useAuth } from '@/context/auth-context';
import { generateUUID } from '@/utils/uuid';
import { createResetIntent } from '@/utils/mutation-intent';
import { isRetryablePortfolioTransportError } from '@/utils/portfolio-errors';

export default function MenuScreen() {
  const { colorScheme, themeMode, setThemeMode } = useAppTheme();
  const { user, isAuthenticated, isAuthReady, resetAccount } = useAuth();
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];
  const appVersion = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '—';
  const buildVersion = Application.nativeBuildVersion;

  const handleSelectThemeMode = async (mode: ThemeMode) => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    setThemeMode(mode);
  };

  const executeResetWithIntent = async (clientRequestId: string) => {
    setIsResetting(true);
    try {
      await resetAccount(clientRequestId);

      if (Platform.OS !== 'web') {
        try {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          // Fallback
        }
      }

      Alert.alert(
        'Yatırımlar Sıfırlandı',
        'Tüm yatırım işlemleriniz ve pozisyonlarınız başarıyla sıfırlandı. Mevcut oturumunuz korunarak portföyünüz temizlendi.'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Hesap sıfırlama işlemi başarısız oldu.';
      const isRetryable = isRetryablePortfolioTransportError(err);

      if (isRetryable) {
        Alert.alert('İşlem Başarısız', msg, [
          { text: 'Vazgeç', style: 'cancel' },
          {
            text: 'Tekrar Dene',
            onPress: () => {
              executeResetWithIntent(clientRequestId);
            },
          },
        ]);
      } else {
        // Non-transport / domain error -> only "Tamam"; fresh intent needed for any new attempt
        Alert.alert('İşlem Başarısız', msg, [{ text: 'Tamam' }]);
      }
    } finally {
      setIsResetting(false);
    }
  };

  const handleResetAccount = async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        // Fallback
      }
    }

    Alert.alert(
      'Hesabı ve Yatırımları Sıfırla',
      'Mevcut tüm portföy varlıklarınız, açık pozisyonlarınız ve işlem geçmişiniz kalıcı olarak sıfırlanacaktır. Bu işlem geri alınamaz.\n\nDevam etmek istiyor musunuz?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Evet, Sıfırla',
          style: 'destructive',
          onPress: () => {
            const intent = createResetIntent(generateUUID);
            executeResetWithIntent(intent.clientRequestId);
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Screen Header */}
        <View style={styles.header}>
          <View style={styles.titleWrapper}>
            <Text style={[styles.title, { color: theme.text }]}>Menü</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Ayarlar, Tercihler & Sistem
            </Text>
          </View>
        </View>

        {/* Görünüm / Tema Tercihi Kartı */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>GÖRÜNÜM & TEMA</Text>
          <View
            style={[
              styles.segmentedCard,
              { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle },
            ]}
          >
            {(
              [
                { id: 'light', label: 'Açık', icon: 'sun.max.fill' as const },
                { id: 'dark', label: 'Koyu', icon: 'moon.fill' as const },
                { id: 'system', label: 'Sistem', icon: 'circle.lefthalf.filled' as const },
              ] as const
            ).map((option) => {
              const isSelected = themeMode === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.segmentButton,
                    isSelected && [
                      styles.segmentButtonActive,
                      {
                        backgroundColor: theme.surface,
                        borderColor: theme.border,
                        shadowColor: isDark ? '#000000' : '#000000',
                      },
                    ],
                  ]}
                  onPress={() => handleSelectThemeMode(option.id)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${option.label} temasını seç`}
                  accessibilityState={{ selected: isSelected }}
                >
                  <IconSymbol
                    size={16}
                    name={option.icon}
                    color={isSelected ? theme.tint : theme.textSecondary}
                  />
                  <Text
                    style={[
                      styles.segmentButtonText,
                      {
                        color: isSelected ? theme.text : theme.textSecondary,
                        fontWeight: isSelected ? '700' : '500',
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Uygulama Tercihleri */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>UYGULAMA TERCİHLERİ</Text>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.menuRow}>
              <View style={styles.menuRowLeft}>
                <View style={[styles.iconWrapper, { backgroundColor: theme.surfaceHighlight }]}>
                  <IconSymbol size={18} name="dollarsign.circle.fill" color={theme.tint} />
                </View>
                <View>
                  <Text style={[styles.menuRowTitle, { color: theme.text }]}>Varsayılan Para Birimi</Text>
                  <Text style={[styles.menuRowSubtitle, { color: theme.textSecondary }]}>TRY (₺) / USD ($)</Text>
                </View>
              </View>
              <Text style={[styles.menuRowValue, { color: theme.textSecondary }]}>TRY (₺)</Text>
            </View>

            <View style={[styles.divider, { backgroundColor: theme.borderSubtle }]} />

            <View style={styles.menuRow}>
              <View style={styles.menuRowLeft}>
                <View style={[styles.iconWrapper, { backgroundColor: theme.surfaceHighlight }]}>
                  <IconSymbol size={18} name="calendar" color={theme.tint} />
                </View>
                <View>
                  <Text style={[styles.menuRowTitle, { color: theme.text }]}>Bilanço Takvimi Bildirimleri</Text>
                  <Text style={[styles.menuRowSubtitle, { color: theme.textSecondary }]}>Takip edilen hisseler için bildirim</Text>
                </View>
              </View>
              <View style={[styles.badgeActive, { backgroundColor: theme.positiveBg, borderColor: theme.positiveBorder }]}>
                <Text style={[styles.badgeActiveText, { color: theme.positive }]}>Açık</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Hesap & Veri Yönetimi (Hesabı / Yatırımları Sıfırla) */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>HESAP & VERİ YÖNETİMİ</Text>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <TouchableOpacity
              style={styles.menuRow}
              onPress={handleResetAccount}
              disabled={isResetting}
              activeOpacity={0.7}
            >
              <View style={styles.menuRowLeft}>
                <View style={[styles.iconWrapper, { backgroundColor: theme.negativeBg }]}>
                  <IconSymbol size={18} name="trash.fill" color={theme.negative} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.menuRowTitle, { color: theme.negative, fontWeight: '700' }]}>
                    Hesabı ve Yatırımları Sıfırla
                  </Text>
                  <Text style={[styles.menuRowSubtitle, { color: theme.textSecondary }]}>
                    Tüm portföy, açık pozisyonlar ve nakit geçmişini temizler
                  </Text>
                </View>
              </View>
              {isResetting ? (
                <ActivityIndicator size="small" color={theme.negative} />
              ) : (
                <View style={[styles.destructivePill, { backgroundColor: theme.negativeBg, borderColor: theme.negativeBorder }]}>
                  <Text style={[styles.destructivePillText, { color: theme.negative }]}>Sıfırla</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Veri & Supabase Altyapı Kartı */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>SİSTEM & GÜNLÜK KAYITLARI (LOGS)</Text>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginBottom: 12 }]}>
            <View style={styles.menuRow}>
              <View style={styles.menuRowLeft}>
                <View style={[styles.iconWrapper, { backgroundColor: theme.surfaceHighlight }]}>
                  <IconSymbol size={18} name="chevron.left.forwardslash.chevron.right" color={theme.tint} />
                </View>
                <View>
                  <Text style={[styles.menuRowTitle, { color: theme.text }]}>Uygulama Günlükleri (Logger)</Text>
                  <Text style={[styles.menuRowSubtitle, { color: theme.textSecondary }]}>
                    Leveled & Scoped Telemetry Aktif
                  </Text>
                </View>
              </View>
              <View style={[styles.badgeActive, { backgroundColor: theme.positiveBg, borderColor: theme.positiveBorder }]}>
                <Text style={[styles.badgeActiveText, { color: theme.positive }]}>Aktif</Text>
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: theme.borderSubtle }]} />

            <View style={styles.menuRow}>
              <View style={styles.menuRowLeft}>
                <View style={[styles.iconWrapper, { backgroundColor: theme.surfaceHighlight }]}>
                  <IconSymbol size={18} name="person.crop.circle" color={theme.tint} />
                </View>
                <View>
                  <Text style={[styles.menuRowTitle, { color: theme.text }]}>Anonim Oturum (Anonymous Auth)</Text>
                  <Text style={[styles.menuRowSubtitle, { color: theme.textSecondary }]}>
                    {user?.id ? `Kullanıcı ID: ${user.id.slice(0, 8)}...${user.id.slice(-4)}` : (isAuthReady ? 'Bağlantı Yok' : 'Başlatılıyor...')}
                  </Text>
                </View>
              </View>
              <View
                style={[
                  styles.badgeActive,
                  {
                    backgroundColor: isAuthenticated ? theme.positiveBg : theme.surfaceHighlight,
                    borderColor: isAuthenticated ? theme.positiveBorder : theme.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.badgeActiveText,
                    { color: isAuthenticated ? theme.positive : theme.textSecondary },
                  ]}
                >
                  {isAuthenticated ? 'Aktif' : 'Hazırlanıyor'}
                </Text>
              </View>
            </View>
          </View>

          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>SİSTEM & VERİ DURUMU</Text>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <SystemHealthMenuItem />
            <View style={[styles.divider, { backgroundColor: theme.borderSubtle }]} />
            <AnalysisHealthMenuItem />
            <View style={[styles.divider, { backgroundColor: theme.borderSubtle }]} />
            <SupabaseHealthMenuItem />
          </View>
        </View>

        {/* Uygulama Bilgisi */}
        <View style={styles.appInfoWrapper}>
          <Image
            source={require('@/assets/images/icon.png')}
            style={styles.appInfoLogo}
            resizeMode="contain"
          />
          <Text style={[styles.appInfoName, { color: theme.text }]}>Lucrari</Text>
          <Text style={[styles.appInfoVersion, { color: theme.textMuted }]}> 
            Sürüm {appVersion}{buildVersion ? ` (${buildVersion})` : ''}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  titleWrapper: {
    flex: 1,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
    fontWeight: '500',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 6,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  segmentedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
  },
  segmentButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 8,
  },
  segmentButtonActive: {
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
      web: {
        boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
      },
    }),
  },
  segmentButtonText: {
    fontSize: 13,
    letterSpacing: -0.1,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  menuRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    paddingRight: 10,
  },
  iconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuRowTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  menuRowSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  menuRowValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    marginVertical: 10,
  },
  badgeActive: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  badgeActiveText: {
    fontSize: 11,
    fontWeight: '700',
  },
  destructivePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  destructivePillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  appInfoWrapper: {
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 24,
    gap: 4,
  },
  appInfoLogo: {
    width: 52,
    height: 52,
    borderRadius: 14,
    marginBottom: 6,
  },
  appInfoName: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  appInfoVersion: {
    fontSize: 12,
    fontWeight: '500',
  },
});
