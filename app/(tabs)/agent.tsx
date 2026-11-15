import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnalysisAccountModal } from '@/components/analysis/analysis-account-modal';
import { AnalysisCreateModal } from '@/components/analysis/analysis-create-modal';
import { AnalysisConnectionsModal } from '@/components/analysis/analysis-connections-modal';
import { AnalysisDetailModal } from '@/components/analysis/analysis-detail-modal';
import { AnalysisHistoryCard } from '@/components/analysis/analysis-history-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useAppTheme } from '@/context/theme-context';
import { useAnalysis } from '@/hooks/use-analysis';
import type { AnalysisRecord } from '@/types/analysis';

export default function AgentScreen() {
  const { user } = useAuth();
  return <AgentSessionScreen key={user?.id ?? 'signed-out'} isGuest={user?.is_anonymous === true} />;
}

function AgentSessionScreen({ isGuest }: { isGuest: boolean }) {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const [createOwner, setCreateOwner] = useState<string | null>(null);
  const [connectionsOwner, setConnectionsOwner] = useState<string | null>(null);
  const [isAccountVisible, setIsAccountVisible] = useState(false);
  const [isCatalogExpanded, setIsCatalogExpanded] = useState(false);
  const analysis = useAnalysis();
  const needsRegisteredAccount = isGuest && analysis.isAccessDenied;

  const isRefreshing = analysis.isHistoryRefreshing || analysis.isProvidersLoading;
  const apiProviders = analysis.providers?.providers.filter(
    (provider) => provider.authType === 'api_key' && provider.modelOptions.length > 0
  ) ?? [];
  const catalog = [
    ...(analysis.modelSelection ? [{ provider: 'ChatGPT', modelOptions: analysis.modelSelection.availableModels }] : []),
    ...apiProviders,
  ];
  const modelCount = catalog.reduce((total, provider) => total + provider.modelOptions.length, 0);
  const canCreate =
    analysis.isAuthenticated &&
    (analysis.canRetryStart || (
      !analysis.isProvidersLoading && !analysis.providersError &&
      (analysis.modelSelection !== null ||
        (!analysis.connections.isLoading && !analysis.connections.error &&
          analysis.connections.items.some((item) => apiProviders.some((provider) => provider.provider === item.provider))))
    ));
  const renderHeader = () => (
    <View style={styles.headerContent}>
      <View>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>Agent</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Finansal çoklu ajan analizleri</Text>
      </View>

      <View style={[styles.introCard, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
        <View style={[styles.agentIcon, { backgroundColor: theme.tintMuted }]}>
          <IconSymbol name="brain.head.profile" size={30} color={theme.tint} />
        </View>
        <View style={styles.introCopy}>
          <Text style={[styles.introTitle, { color: theme.text }]}>Yeni bir analiz oluştur</Text>
          <Text style={[styles.introText, { color: theme.textSecondary }]}>Teknik, temel, haber ve sosyal uzman ajanları tek raporda birleştir.</Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Yeni analiz oluştur"
          disabled={!canCreate}
          onPress={() => setCreateOwner(analysis.userId)}
          style={[styles.createButton, { backgroundColor: canCreate ? theme.tint : theme.disabledBg }]}
        >
          <IconSymbol name="plus" size={22} color={canCreate ? '#FFFFFF' : theme.disabledText} />
        </TouchableOpacity>
      </View>

      {needsRegisteredAccount && (
        <View style={[styles.alertCard, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
          <Text style={[styles.introTitle, { color: theme.text }]}>Agent için hesabınla giriş yap</Text>
          <Text style={[styles.alertText, { color: theme.textSecondary }]}>
            Kayıtlı hesabınla API bağlantısı ekleyebilir ve analiz oluşturabilirsin.
          </Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => setIsAccountVisible(true)}>
            <Text style={[styles.retryText, { color: theme.tint }]}>Giriş Yap veya Hesap Oluştur</Text>
          </TouchableOpacity>
        </View>
      )}

      {analysis.isAuthenticated && analysis.providersError && !needsRegisteredAccount && (
        <View accessibilityRole="alert" style={[styles.alertCard, { backgroundColor: theme.warningBg, borderColor: theme.warningBorder }]}>
          <Text style={[styles.alertText, { color: theme.textSecondary }]}>{analysis.providersError}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={analysis.refreshProviders}>
            <Text style={[styles.retryText, { color: theme.tint }]}>Yenile</Text>
          </TouchableOpacity>
        </View>
      )}

      {analysis.isAuthenticated && !analysis.isAccessDenied && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => {
            setConnectionsOwner(analysis.userId);
            void analysis.connections.refresh();
          }}
          style={[styles.introCard, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}
        >
          <View style={styles.introCopy}>
            <Text style={[styles.introTitle, { color: theme.text }]}>API Bağlantıları</Text>
            <Text style={[styles.introText, { color: theme.textSecondary }]}>
              {analysis.connections.isLoading
                ? 'Bağlantılar yükleniyor…'
                : analysis.connections.error
                  ? 'Bağlantı durumunu görüntüleyin'
                  : `${analysis.connections.items.length} etkin bağlantı · Ekle ve yönet`}
            </Text>
          </View>
          <IconSymbol name="chevron.right" size={18} color={theme.tint} />
        </TouchableOpacity>
      )}

      {modelCount > 0 && !analysis.isProvidersLoading && (
        <View style={[styles.modelCard, { backgroundColor: theme.backgroundSecondary, borderColor: theme.borderSubtle }]}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Kullanılabilir AI modelleri, ${modelCount} model`}
            accessibilityState={{ expanded: isCatalogExpanded }}
            onPress={() => setIsCatalogExpanded((expanded) => !expanded)}
            style={styles.modelHeading}
          >
            <Text style={[styles.modelTitle, { color: theme.text }]}>Kullanılabilir AI modelleri</Text>
            <Text style={[styles.modelCountText, { color: theme.textSecondary }]}>{modelCount} model</Text>
            <IconSymbol name={isCatalogExpanded ? 'chevron.up' : 'chevron.down'} size={16} color={theme.tint} />
          </TouchableOpacity>
          {isCatalogExpanded && (
            <View style={[styles.modelGroups, { borderTopColor: theme.borderSubtle }]}>
              {catalog.map(({ provider, modelOptions }) => (
                <View key={provider} style={styles.modelGroup}>
                  <Text accessibilityRole="header" style={[styles.modelGroupTitle, { color: theme.text }]}>
                    {provider === 'google' ? 'Google Gemini' : provider === 'openai' ? 'OpenAI' : provider}
                  </Text>
                  <View style={styles.modelCatalog}>
                    {modelOptions.map((model) => (
                      <View key={model.id} style={[styles.modelCatalogItem, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
                        <Text style={[styles.modelCatalogText, { color: theme.textSecondary }]}>{model.name}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {!analysis.isAuthReady && (
        <View style={styles.centerState}>
          <ActivityIndicator color={theme.tint} />
          <Text style={[styles.stateText, { color: theme.textSecondary }]}>Oturum hazırlanıyor…</Text>
        </View>
      )}

      {analysis.isAuthReady && !analysis.isAuthenticated && (
        <View accessibilityRole="alert" style={[styles.alertCard, { backgroundColor: theme.negativeBg, borderColor: theme.negativeBorder }]}>
          <Text style={[styles.alertText, { color: theme.negative }]}>Analiz geçmişi için oturum doğrulanamadı.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={analysis.retryAuth}>
            <Text style={[styles.retryText, { color: theme.tint }]}>Tekrar Dene</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={() => setIsAccountVisible(true)}>
            <Text style={[styles.retryText, { color: theme.tint }]}>Giriş Yap veya Hesap Oluştur</Text>
          </TouchableOpacity>
        </View>
      )}

      {analysis.historyError && analysis.history.length > 0 && (
        <View accessibilityRole="alert" style={[styles.alertCard, { backgroundColor: theme.warningBg, borderColor: theme.warningBorder }]}>
          <Text style={[styles.alertText, { color: theme.textSecondary }]}>{analysis.historyError}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={analysis.refreshDashboard}>
            <Text style={[styles.retryText, { color: theme.tint }]}>Tekrar Dene</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.sectionHeading}>
        <View>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Analiz Geçmişi</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.textMuted }]}>
            {analysis.historyTotalCount === null ? 'Geçmiş ve devam eden raporlar' : `${analysis.historyTotalCount} analiz`}
          </Text>
        </View>
      </View>
    </View>
  );

  const renderEmpty = () => {
    if (analysis.isAccessDenied) return null;
    if (!analysis.isAuthReady || !analysis.isAuthenticated || analysis.isHistoryLoading) {
      return analysis.isHistoryLoading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={theme.tint} />
          <Text style={[styles.stateText, { color: theme.textSecondary }]}>Analiz geçmişi yükleniyor…</Text>
        </View>
      ) : null;
    }
    if (analysis.historyError) {
      return (
        <View accessibilityRole="alert" style={[styles.emptyCard, { backgroundColor: theme.negativeBg, borderColor: theme.negativeBorder }]}>
          <IconSymbol name="exclamationmark.triangle.fill" size={24} color={theme.negative} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>Geçmiş yüklenemedi</Text>
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>{analysis.historyError}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={analysis.refreshDashboard}>
            <Text style={[styles.retryText, { color: theme.tint }]}>Tekrar Dene</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={[styles.emptyCard, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
        <IconSymbol name="brain.head.profile" size={32} color={theme.tint} />
        <Text style={[styles.emptyTitle, { color: theme.text }]}>Henüz analiz yok</Text>
        <Text style={[styles.emptyText, { color: theme.textSecondary }]}>İlk çoklu ajan raporunu oluşturduğunuzda burada görünecek.</Text>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={!canCreate}
          onPress={() => setCreateOwner(analysis.userId)}
          style={[styles.emptyAction, { backgroundColor: canCreate ? theme.tint : theme.disabledBg }]}
        >
          <Text style={[styles.emptyActionText, { color: canCreate ? '#FFFFFF' : theme.disabledText }]}>Yeni Analiz</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderFooter = () => {
    if (analysis.isLoadingMore) return <ActivityIndicator style={styles.footer} color={theme.tint} />;
    if (analysis.loadMoreError) {
      return (
        <View style={[styles.footerError, { backgroundColor: theme.warningBg, borderColor: theme.warningBorder }]}>
          <Text style={[styles.alertText, { color: theme.textSecondary }]}>{analysis.loadMoreError}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={analysis.loadMoreHistory}>
            <Text style={[styles.retryText, { color: theme.tint }]}>Tekrar Dene</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return null;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      <FlatList<AnalysisRecord>
        data={analysis.history}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <AnalysisHistoryCard item={item} onPress={() => analysis.openAnalysis(item)} />}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={analysis.refreshDashboard} tintColor={theme.tint} />}
        onEndReached={() => {
          if (analysis.hasMoreHistory) analysis.loadMoreHistory();
        }}
        onEndReachedThreshold={0.35}
        showsVerticalScrollIndicator={false}
      />

      <AnalysisCreateModal
        key={analysis.userId}
        visible={analysis.isAuthenticated && createOwner !== null && createOwner === analysis.userId}
        modelSelection={analysis.modelSelection}
        apiProviders={apiProviders}
        connections={analysis.connections}
        isProvidersLoading={analysis.isProvidersLoading}
        providersError={analysis.providersError}
        isStarting={analysis.isStarting}
        startError={analysis.startError}
        canRetryStart={analysis.canRetryStart}
        onClose={() => setCreateOwner(null)}
        onStart={analysis.startNewAnalysis}
        onRetry={analysis.retryStart}
        onRefreshProviders={analysis.refreshProviders}
        onClearStartError={analysis.clearStartError}
      />

      {analysis.isAuthenticated && !analysis.isAccessDenied && connectionsOwner !== null && connectionsOwner === analysis.userId && (
        <AnalysisConnectionsModal
          providers={apiProviders}
          isProvidersLoading={analysis.isProvidersLoading}
          providersError={analysis.providersError}
          onRefreshProviders={analysis.refreshProviders}
          connections={analysis.connections}
          onClose={() => setConnectionsOwner(null)}
        />
      )}

      {isAccountVisible && <AnalysisAccountModal onClose={() => setIsAccountVisible(false)} />}

      <AnalysisDetailModal
        analysis={analysis.selectedAnalysis}
        report={analysis.selectedReport}
        isLoading={analysis.isSelectedLoading}
        error={analysis.selectedError}
        onClose={analysis.closeAnalysis}
        onRefresh={analysis.refreshSelected}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 42, flexGrow: 1 },
  headerContent: { gap: 14, paddingTop: 10, paddingBottom: 12 },
  title: { fontSize: 31, fontWeight: '900', letterSpacing: -0.7 },
  subtitle: { fontSize: 14, marginTop: 2 },
  introCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 18, padding: 15 },
  agentIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  introCopy: { flex: 1, gap: 3 },
  introTitle: { fontSize: 15.5, fontWeight: '800' },
  introText: { fontSize: 12.5, lineHeight: 18 },
  createButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  alertCard: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 8 },
  alertText: { fontSize: 13, lineHeight: 19 },
  retryText: { fontSize: 13, fontWeight: '800' },
  modelCard: { borderWidth: 1, borderRadius: 12 },
  modelHeading: { minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
  modelTitle: { flex: 1, fontSize: 13, fontWeight: '700' },
  modelCountText: { fontSize: 12, fontWeight: '600' },
  modelGroups: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 14 },
  modelGroup: { gap: 7 },
  modelGroupTitle: { fontSize: 13, fontWeight: '800' },
  modelCatalog: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  modelCatalogItem: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  modelCatalogText: { fontSize: 11.5, fontWeight: '700' },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 6 },
  sectionTitle: { fontSize: 20, fontWeight: '800' },
  sectionSubtitle: { fontSize: 12.5, marginTop: 2 },
  centerState: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 28 },
  stateText: { fontSize: 13 },
  emptyCard: { alignItems: 'center', borderWidth: 1, borderRadius: 18, padding: 24, gap: 9 },
  emptyTitle: { fontSize: 17, fontWeight: '800', textAlign: 'center' },
  emptyText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  emptyAction: { marginTop: 4, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 },
  emptyActionText: { fontSize: 13, fontWeight: '800' },
  separator: { height: 10 },
  footer: { paddingVertical: 22 },
  footerError: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 7, marginTop: 10 },
});
