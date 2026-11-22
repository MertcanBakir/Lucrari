import { useReducedMotion } from '@/hooks/use-reduced-motion';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnalysisHistoryCard } from '@/components/analysis/analysis-history-card';
import { SafeMarkdown } from '@/components/analysis/safe-markdown';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';
import { getAnalysisFailureMessage } from '@/services/analysis/analysis-service';
import type { AnalysisRecord, AnalysisReport, AnalysisReportSection } from '@/types/analysis';
import {
  ANALYSIS_HORIZON_LABELS,
  formatAnalysisPartTitle,
  isAnalysisActive,
  isAnalysisSuccessful,
} from '@/utils/analysis';
import { createScopedLogger } from '@/utils/logger';

const log = createScopedLogger('AnalysisDetailModal');

interface AnalysisDetailModalProps {
  analysis: AnalysisRecord | null;
  report: AnalysisReport | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export function AnalysisDetailModal({
  analysis,
  report,
  isLoading,
  error,
  onClose,
  onRefresh,
}: AnalysisDetailModalProps) {
  const reducedMotion = useReducedMotion();
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const [openCodes, setOpenCodes] = useState<Set<string>>(new Set());
  const analysisId = analysis?.id ?? null;

  useEffect(() => {
    if (!analysisId) {
      setOpenCodes(new Set());
      return;
    }
    const initiallyOpen = report?.sections
      .filter((section) =>
        section.code === 'executive_summary' ||
        section.code === 'final_trade_decision' ||
        section.code === 'final_assessment' ||
        section.code === 'disclaimer'
      )
      .map((section) => section.code) ?? [];
    setOpenCodes(new Set(initiallyOpen));
  }, [analysisId, report]);

  const sections = report?.sections ?? [];
  const isActive = analysis ? isAnalysisActive(analysis) : false;
  const isSuccess = analysis ? isAnalysisSuccessful(analysis) : false;
  const configSummary = useMemo(() => {
    if (!report) return null;
    return `${report.effectiveConfig.quick.model} · ${report.effectiveConfig.deep.model}`;
  }, [report]);

  const toggleSection = (section: AnalysisReportSection) => {
    if (section.code === 'disclaimer') return;
    const willOpen = !openCodes.has(section.code);
    log.debug('analysis.section.toggled', {
      message: 'Analysis section toggled.',
      context: { analysisId, sectionCode: section.code, partCount: Object.keys(section.parts).length, hasMainContent: section.contentMarkdown !== null, isExpanded: willOpen }
    });
    setOpenCodes((previous) => {
      const next = new Set(previous);
      if (next.has(section.code)) next.delete(section.code);
      else next.add(section.code);
      return next;
    });
  };

  const renderSection = ({ item }: { item: AnalysisReportSection }) => {
    const isDisclaimer = item.code === 'disclaimer';
    const isOpen = isDisclaimer || openCodes.has(item.code);
    const parts = Object.entries(item.parts);
    const hasContent = item.contentMarkdown !== null || parts.length > 0;
    return (
      <View
        style={[
          styles.sectionCard,
          {
            backgroundColor: isDisclaimer ? theme.warningBg : theme.surface,
            borderColor: isDisclaimer ? theme.warningBorder : theme.borderSubtle,
          },
        ]}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${item.title} bölümünü ${isOpen ? 'daralt' : 'genişlet'}`}
          disabled={isDisclaimer}
          onPress={() => toggleSection(item)}
          style={styles.sectionHeader}
        >
          <View style={styles.sectionTitleRow}>
            <IconSymbol
              name={isDisclaimer ? 'exclamationmark.triangle.fill' : 'sparkles'}
              size={18}
              color={isDisclaimer ? theme.warning : theme.tint}
            />
            <Text style={[styles.sectionTitle, { color: theme.text }]}>{item.title}</Text>
            {!hasContent && (
              <View style={[styles.unavailableBadge, { backgroundColor: theme.backgroundSecondary }]}>
                <Text style={[styles.unavailableBadgeText, { color: theme.textMuted }]}>Çalıştırılmadı</Text>
              </View>
            )}
          </View>
          {!isDisclaimer && (
            <IconSymbol
              name={isOpen ? 'chevron.up' : 'chevron.down'}
              size={20}
              color={theme.textMuted}
            />
          )}
        </TouchableOpacity>
        {isOpen && (
          <View style={[styles.sectionBody, { borderTopColor: theme.borderSubtle }]}>
            {item.contentMarkdown && <SafeMarkdown source={item.contentMarkdown} />}

            {parts.map(([partCode, partContent]) => (
              <View
                key={partCode}
                style={[styles.partCard, { backgroundColor: theme.backgroundSecondary, borderColor: theme.borderSubtle }]}
              >
                <View style={styles.partHeader}>
                  <IconSymbol name="chevron.left.forwardslash.chevron.right" size={16} color={theme.tint} />
                  <Text style={[styles.partTitle, { color: theme.text }]}>
                    {formatAnalysisPartTitle(partCode)}
                  </Text>
                </View>
                <SafeMarkdown source={partContent} />
              </View>
            ))}

            {!hasContent && (
              <View style={styles.unavailableContent}>
                <IconSymbol name="pause.circle.fill" size={20} color={theme.textMuted} />
                <Text style={[styles.unavailableText, { color: theme.textSecondary }]}>Bu bölüm seçilen analiz uzmanları kapsamında çalıştırılmadı.</Text>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  if (!analysis) return null;

  return (
    <Modal visible animationType={reducedMotion ? 'none' : 'fade'} presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
        <View style={[styles.header, { borderBottomColor: theme.borderSubtle }]}>
          <View style={styles.headerText}>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>Analiz Raporu</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{analysis.ticker}</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Raporu kapat" onPress={onClose} style={styles.closeButton}>
            <IconSymbol name="xmark" size={24} color={theme.text} />
          </TouchableOpacity>
        </View>

        <FlatList
          data={sections}
          keyExtractor={(item, index) => `${item.code}:${index}`}
          renderItem={renderSection}
          contentContainerStyle={styles.content}
          extraData={openCodes}
          ListHeaderComponent={
            <View style={styles.headerContent}>
              <AnalysisHistoryCard item={analysis} />
              {analysis.models && (
                <View style={[styles.notice, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
                  <View style={styles.noticeCopy}>
                    <Text style={[styles.noticeTitle, { color: theme.text }]}>Analizde seçilen modeller</Text>
                    <Text style={[styles.noticeText, { color: theme.textSecondary }]}>
                      Hızlı · {analysis.models.quick.provider} · {analysis.models.quick.model}
                    </Text>
                    <Text style={[styles.noticeText, { color: theme.textSecondary }]}>
                      Derin · {analysis.models.deep.provider} · {analysis.models.deep.model}
                    </Text>
                  </View>
                </View>
              )}

              {isActive && (
                <View style={[styles.notice, { backgroundColor: theme.infoBg, borderColor: theme.infoBorder }]}>
                  <ActivityIndicator color={theme.info} />
                  <View style={styles.noticeCopy}>
                    <Text style={[styles.noticeTitle, { color: theme.text }]}>Analiz devam ediyor</Text>
                    <Text style={[styles.noticeText, { color: theme.textSecondary }]}>Bu ekran açıkken durum otomatik yenilenir. Uygulamadan çıksanız da işlem sunucuda devam eder.</Text>
                  </View>
                </View>
              )}

              {!isActive && !isSuccess && (
                <View style={[styles.notice, { backgroundColor: theme.negativeBg, borderColor: theme.negativeBorder }]}>
                  <IconSymbol name="exclamationmark.triangle.fill" size={20} color={theme.negative} />
                  <View style={styles.noticeCopy}>
                    <Text style={[styles.noticeTitle, { color: theme.text }]}>Analiz tamamlanamadı</Text>
                    <Text style={[styles.noticeText, { color: theme.textSecondary }]}>
                      {getAnalysisFailureMessage(analysis.errorCode) ?? 'Yeni bir analiz başlatabilir veya durumu yeniden kontrol edebilirsiniz.'}
                    </Text>
                  </View>
                </View>
              )}

              {error && (
                <View accessibilityRole="alert" style={[styles.errorCard, { backgroundColor: theme.negativeBg, borderColor: theme.negativeBorder }]}>
                  <Text style={[styles.noticeText, { color: theme.negative }]}>{error}</Text>
                  <TouchableOpacity accessibilityRole="button" disabled={isLoading} onPress={onRefresh}>
                    <Text style={[styles.retryText, { color: theme.tint }]}>Tekrar Dene</Text>
                  </TouchableOpacity>
                </View>
              )}

              {isLoading && !isActive && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={theme.tint} />
                  <Text style={[styles.noticeText, { color: theme.textSecondary }]}>Rapor yükleniyor…</Text>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            !isLoading && !isActive && isSuccess && !error ? (
              <View style={[styles.errorCard, { backgroundColor: theme.warningBg, borderColor: theme.warningBorder }]}>
                <Text style={[styles.noticeText, { color: theme.textSecondary }]}>Rapor bölümleri henüz alınamadı.</Text>
                <TouchableOpacity accessibilityRole="button" onPress={onRefresh}>
                  <Text style={[styles.retryText, { color: theme.tint }]}>Yenile</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
          ListFooterComponent={
            report ? (
              <View style={[styles.detailsCard, { backgroundColor: theme.backgroundSecondary, borderColor: theme.borderSubtle }]}>
                <Text style={[styles.detailsTitle, { color: theme.text }]}>Analiz ayrıntıları</Text>
                {report.analysisHorizon && !analysis.analysisHorizon && (
                  <Text style={[styles.detailsText, { color: theme.textSecondary }]}>
                    Analiz vadesi: {ANALYSIS_HORIZON_LABELS[report.analysisHorizon]}
                  </Text>
                )}
                <Text style={[styles.detailsText, { color: theme.textSecondary }]}>Modeller: {configSummary}</Text>
                <Text style={[styles.detailsText, { color: theme.textSecondary }]}>Araştırma turu: {report.effectiveConfig.researchRounds} · Risk turu: {report.effectiveConfig.riskRounds}</Text>
                <Text style={[styles.detailsText, { color: theme.textSecondary }]}>TradingAgents: {report.upstreamVersion}</Text>
              </View>
            ) : null
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  headerText: { flex: 1 },
  title: { fontSize: 21, fontWeight: '800' },
  subtitle: { fontSize: 13, marginTop: 2 },
  closeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  headerContent: { gap: 12, marginBottom: 2 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, borderWidth: 1, borderRadius: 14, padding: 13 },
  noticeCopy: { flex: 1, gap: 3 },
  noticeTitle: { fontSize: 14, fontWeight: '800' },
  noticeText: { fontSize: 13, lineHeight: 19 },
  errorCard: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 8 },
  retryText: { fontSize: 13, fontWeight: '800' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16 },
  sectionCard: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  sectionHeader: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  sectionTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: '800' },
  unavailableBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  unavailableBadgeText: { fontSize: 10.5, fontWeight: '700' },
  sectionBody: { borderTopWidth: StyleSheet.hairlineWidth, padding: 14, gap: 14 },
  partCard: { borderWidth: 1, borderRadius: 13, padding: 13, gap: 11 },
  partHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  partTitle: { flex: 1, fontSize: 13.5, fontWeight: '800' },
  unavailableContent: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 2 },
  unavailableText: { flex: 1, fontSize: 13, lineHeight: 19 },
  detailsCard: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 5, marginTop: 2 },
  detailsTitle: { fontSize: 14, fontWeight: '800', marginBottom: 3 },
  detailsText: { fontSize: 12.5, lineHeight: 18 },
});
