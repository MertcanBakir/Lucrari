import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';
import type { useAnalysisConnections } from '@/hooks/use-analysis-connections';
import {
  ANALYSIS_HORIZONS,
  ANALYST_CODES,
  type AnalysisAuthType,
  type AnalysisCreateInput,
  type AnalysisHorizon,
  type AnalysisLanguage,
  type AnalysisModelSelection,
  type AnalysisProvider,
  type AnalystCode,
} from '@/types/analysis';
import {
  ANALYSIS_HORIZON_LABELS,
  createLocalAnalysisDate,
  isFutureAnalysisDate,
  isValidAnalysisDate,
  isValidAnalysisTicker,
  normalizeTicker,
  reconcileSelectedModelId,
} from '@/utils/analysis';

const ANALYST_LABELS: Record<AnalystCode, string> = {
  market: 'Teknik',
  macro: 'Makro Analist',
  news: 'Haber',
  fundamentals: 'Temel',
};

export interface AnalysisCreateModalProps {
  visible: boolean;
  modelSelection: AnalysisModelSelection | null;
  apiProviders: AnalysisProvider[];
  connections: ReturnType<typeof useAnalysisConnections>;
  isProvidersLoading: boolean;
  providersError: string | null;
  isStarting: boolean;
  startError: string | null;
  canRetryStart: boolean;
  onClose: () => void;
  onStart: (input: AnalysisCreateInput) => Promise<boolean>;
  onRetry: () => Promise<boolean>;
  onRefreshProviders: () => Promise<void>;
  onClearStartError: () => void;
}

export function AnalysisCreateModal({
  visible,
  modelSelection,
  apiProviders,
  connections,
  isProvidersLoading,
  providersError,
  isStarting,
  startError,
  canRetryStart,
  onClose,
  onStart,
  onRetry,
  onRefreshProviders,
  onClearStartError,
}: AnalysisCreateModalProps) {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const [ticker, setTicker] = useState('');
  const [analysisDate, setAnalysisDate] = useState(createLocalAnalysisDate());
  const [analysisHorizon, setAnalysisHorizon] = useState<AnalysisHorizon | null>(null);
  const [language, setLanguage] = useState<AnalysisLanguage>('tr');
  const [analysts, setAnalysts] = useState<AnalystCode[]>([...ANALYST_CODES]);
  const [preferredAuth, setPreferredAuth] = useState<AnalysisAuthType | null>(null);
  const [quickModelId, setQuickModel] = useState('');
  const [deepModelId, setDeepModel] = useState('');
  const [quickConnectionId, setQuickConnection] = useState('');
  const [deepConnectionId, setDeepConnection] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const authType = preferredAuth ?? (modelSelection ? 'personal_chatgpt' : 'api_key');
  const isApiKey = authType === 'api_key';
  const eligibleConnections = connections.items.filter((connection) =>
    apiProviders.some((provider) => provider.provider === connection.provider)
  );
  const quickConnection = eligibleConnections.find((item) => item.id === quickConnectionId);
  const deepConnection = eligibleConnections.find((item) => item.id === deepConnectionId);
  const modelsFor = (providerName?: string) => isApiKey
    ? apiProviders.find((provider) => provider.provider === providerName)?.modelOptions ?? []
    : modelSelection?.availableModels ?? [];
  const quickModels = modelsFor(quickConnection?.provider);
  const deepModels = modelsFor(deepConnection?.provider);
  const quickModel = reconcileSelectedModelId(quickModelId, quickModels);
  const deepModel = reconcileSelectedModelId(deepModelId, deepModels);
  const canSubmit = Boolean(
    analysisHorizon && !isProvidersLoading && !providersError && !isStarting && !canRetryStart && analysts.length && quickModel && deepModel &&
    (!isApiKey || (quickConnection && deepConnection && !connections.isLoading && !connections.error))
  );

  const renderChoices = (
    items: { id: string; name: string }[],
    selectedId: string | undefined,
    onSelect: (id: string) => void
  ) => (
    <ScrollView horizontal keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modelRow}>
      {items.map(({ id, name }) => (
        <TouchableOpacity
          key={id}
          accessibilityRole="button"
          accessibilityState={{ selected: selectedId === id, disabled: isStarting }}
          disabled={isStarting}
          onPress={() => {
            onSelect(id);
            onClearStartError();
          }}
          style={[
            styles.modelChip,
            {
              backgroundColor: selectedId === id ? theme.tintMuted : theme.surface,
              borderColor: selectedId === id ? theme.tintBorder : theme.border,
            },
          ]}
        >
          <Text style={[styles.modelText, { color: selectedId === id ? theme.tint : theme.textSecondary }]}>{name}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const toggleAnalyst = (analyst: AnalystCode) => {
    setValidationError(null);
    onClearStartError();
    setAnalysts((current) =>
      current.includes(analyst)
        ? current.filter((item) => item !== analyst)
        : [...current, analyst]
    );
  };

  const handleSubmit = async () => {
    if (!canSubmit || !analysisHorizon) return;
    const normalizedTicker = normalizeTicker(ticker);
    if (!isValidAnalysisTicker(normalizedTicker)) {
      setValidationError('Geçerli bir sembol girin (ör. AAPL).');
      return;
    }
    if (!isValidAnalysisDate(analysisDate)) {
      setValidationError('Analiz tarihi YYYY-AA-GG biçiminde olmalıdır.');
      return;
    }
    if (isFutureAnalysisDate(analysisDate)) {
      setValidationError('Gelecek bir tarih için analiz başlatılamaz.');
      return;
    }
    if (analysts.length === 0) {
      setValidationError('En az bir analiz uzmanı seçin.');
      return;
    }
    setValidationError(null);
    const request = {
      ticker: normalizedTicker,
      analysisDate,
      analysisHorizon,
      language,
      analysts,
    };
    if (isApiKey && (!quickConnection || !deepConnection)) return;
    const succeeded = await onStart(isApiKey && quickConnection && deepConnection
      ? {
          ...request,
          authType: 'api_key',
          quick: { connectionId: quickConnection.id, model: quickModel },
          deep: { connectionId: deepConnection.id, model: deepModel },
        }
      : { ...request, authType: 'personal_chatgpt', quickModel, deepModel });
    if (succeeded) finish();
  };

  const handleRetry = async () => {
    const succeeded = await onRetry();
    if (succeeded) finish();
  };

  const finish = () => {
    setTicker('');
    setAnalysisDate(createLocalAnalysisDate());
    setAnalysisHorizon(null);
    setLanguage('tr');
    setAnalysts([...ANALYST_CODES]);
    setValidationError(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <View style={[styles.header, { borderBottomColor: theme.borderSubtle }]}>
            <View>
              <Text style={[styles.headerTitle, { color: theme.text }]}>Yeni AI Analizi</Text>
              <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>Finansal çoklu ajan raporu</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Kapat" onPress={onClose} style={styles.closeButton}>
              <IconSymbol name="xmark" size={23} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>SEMBOL</Text>
              <TextInput
                value={ticker}
                editable={!isStarting}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={20}
                placeholder="AAPL"
                placeholderTextColor={theme.textMuted}
                onChangeText={(value) => {
                  setTicker(value.toUpperCase());
                  setValidationError(null);
                  onClearStartError();
                }}
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border },
                ]}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>ANALİZ TARİHİ</Text>
              <TextInput
                value={analysisDate}
                editable={!isStarting}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
                placeholder="YYYY-AA-GG"
                placeholderTextColor={theme.textMuted}
                onChangeText={(value) => {
                  setAnalysisDate(value);
                  setValidationError(null);
                  onClearStartError();
                }}
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border },
                ]}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>ANALİZ VADESİ</Text>
              <View style={styles.wrappingChips}>
                {ANALYSIS_HORIZONS.map((horizon) => {
                  const selected = analysisHorizon === horizon;
                  return (
                    <TouchableOpacity
                      key={horizon}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: isStarting }}
                      disabled={isStarting}
                      onPress={() => {
                        if (selected) return;
                        setAnalysisHorizon(horizon);
                        setValidationError(null);
                        onClearStartError();
                      }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: selected ? theme.tintMuted : theme.surface,
                          borderColor: selected ? theme.tintBorder : theme.border,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: selected ? theme.tint : theme.textSecondary }]}>
                        {ANALYSIS_HORIZON_LABELS[horizon]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>RAPOR DİLİ</Text>
              <View style={styles.chipRow}>
                {(['tr', 'en'] as const).map((value) => {
                  const selected = language === value;
                  return (
                    <TouchableOpacity
                      key={value}
                      disabled={isStarting}
                      onPress={() => {
                        setLanguage(value);
                        setValidationError(null);
                        onClearStartError();
                      }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: selected ? theme.tintMuted : theme.surface,
                          borderColor: selected ? theme.tintBorder : theme.border,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: selected ? theme.tint : theme.textSecondary }]}>
                        {value === 'tr' ? 'Türkçe' : 'English'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>UZMAN AJANLAR</Text>
              <View style={styles.wrappingChips}>
                {ANALYST_CODES.map((analyst) => {
                  const selected = analysts.includes(analyst);
                  return (
                    <TouchableOpacity
                      key={analyst}
                      accessibilityRole="button"
                      accessibilityLabel={ANALYST_LABELS[analyst]}
                      accessibilityState={{ selected, disabled: isStarting }}
                      disabled={isStarting}
                      onPress={() => toggleAnalyst(analyst)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: selected ? theme.tintMuted : theme.surface,
                          borderColor: selected ? theme.tintBorder : theme.border,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: selected ? theme.tint : theme.textSecondary }]}>
                        {ANALYST_LABELS[analyst]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>MODELLER</Text>
              {isProvidersLoading ? (
                <ActivityIndicator color={theme.tint} />
              ) : providersError ? (
                <View accessibilityRole="alert" style={styles.fieldGroup}>
                  <Text style={{ color: theme.negative }}>{providersError}</Text>
                  <TouchableOpacity onPress={onRefreshProviders} accessibilityRole="button">
                    <Text style={[styles.retryText, { color: theme.tint }]}>Yeniden Dene</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {renderChoices(
                    [
                      ...(modelSelection ? [{ id: 'personal_chatgpt', name: 'Kişisel ChatGPT' }] : []),
                      ...(apiProviders.length ? [{ id: 'api_key', name: 'API bağlantıları' }] : []),
                    ],
                    authType,
                    (id) => {
                      setPreferredAuth(id === 'api_key' ? 'api_key' : 'personal_chatgpt');
                      setQuickModel('');
                      setDeepModel('');
                    }
                  )}
                  {isApiKey && connections.isLoading ? (
                    <ActivityIndicator color={theme.tint} />
                  ) : isApiKey && connections.error ? (
                    <View accessibilityRole="alert" style={styles.fieldGroup}>
                      <Text style={{ color: theme.negative }}>{connections.error}</Text>
                      <TouchableOpacity accessibilityRole="button" onPress={connections.refresh}>
                        <Text style={[styles.retryText, { color: theme.tint }]}>Yeniden Dene</Text>
                      </TouchableOpacity>
                    </View>
                  ) : !isApiKey && !modelSelection ? (
                    <Text style={[styles.helpText, { color: theme.textMuted }]}>Kişisel ChatGPT kataloğu şu anda kullanılamıyor.</Text>
                  ) : isApiKey && eligibleConnections.length === 0 ? (
                    <Text style={[styles.helpText, { color: theme.textMuted }]}>
                      Agent ekranındaki API Bağlantıları bölümünden etkin bir sağlayıcı bağlantısı ekleyin.
                    </Text>
                  ) : (
                    <>
                      {isApiKey && (!quickConnection || !deepConnection) && (
                        <Text style={[styles.helpText, { color: theme.textMuted }]}>Hızlı ve derin modeller için birer bağlantı seçin. Aynı bağlantıyı iki seçimde de kullanabilirsiniz.</Text>
                      )}
                      <Text style={[styles.modelLabel, { color: theme.textSecondary }]}>Hızlı model</Text>
                      {isApiKey && renderChoices(
                        eligibleConnections.map(({ id, name, provider }) => ({ id, name: name ? `${name} · ${provider}` : provider })),
                        quickConnection?.id,
                        (id) => { setQuickConnection(id); setQuickModel(''); }
                      )}
                      {renderChoices(quickModels, quickModel, setQuickModel)}
                      <Text style={[styles.modelLabel, { color: theme.textSecondary }]}>Derin model</Text>
                      {isApiKey && renderChoices(
                        eligibleConnections.map(({ id, name, provider }) => ({ id, name: name ? `${name} · ${provider}` : provider })),
                        deepConnection?.id,
                        (id) => { setDeepConnection(id); setDeepModel(''); }
                      )}
                      {renderChoices(deepModels, deepModel, setDeepModel)}
                    </>
                  )}
                </>
              )}
            </View>

            <View style={[styles.disclaimer, { backgroundColor: theme.warningBg, borderColor: theme.warningBorder }]}>
              <IconSymbol name="exclamationmark.triangle.fill" size={18} color={theme.warning} />
              <Text style={[styles.disclaimerText, { color: theme.textSecondary }]}>Bu rapor yapay zekâ tarafından üretilir ve yatırım tavsiyesi değildir.</Text>
            </View>

            {(validationError || startError) && (
              <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: theme.negativeBg, borderColor: theme.negativeBorder }]}>
                <Text style={[styles.noticeText, { color: theme.negative }]}>{validationError ?? startError}</Text>
                {startError && canRetryStart && (
                  <TouchableOpacity disabled={isStarting} onPress={handleRetry} accessibilityRole="button">
                    <Text style={[styles.retryText, { color: theme.tint }]}>Aynı İstekle Tekrar Dene</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <TouchableOpacity
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={handleSubmit}
              style={[
                styles.submitButton,
                { backgroundColor: canSubmit ? theme.tint : theme.disabledBg },
              ]}
            >
              {isStarting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <IconSymbol name="brain.head.profile" size={20} color="#FFFFFF" />
                  <Text style={styles.submitText}>Analizi Başlat</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 21, fontWeight: '800' },
  headerSubtitle: { fontSize: 12.5, marginTop: 2 },
  closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 40, gap: 20 },
  fieldGroup: { gap: 9 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  input: { height: 50, borderWidth: 1, borderRadius: 13, paddingHorizontal: 14, fontSize: 16, fontWeight: '600' },
  chipRow: { flexDirection: 'row', gap: 9 },
  wrappingChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { fontSize: 13, fontWeight: '700' },
  modelLabel: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  modelRow: { gap: 8, paddingRight: 16 },
  modelChip: { borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 9 },
  modelText: { fontSize: 12.5, fontWeight: '700' },
  helpText: { fontSize: 13 },
  disclaimer: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderWidth: 1, borderRadius: 13, padding: 12 },
  disclaimerText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
  notice: { borderWidth: 1, borderRadius: 13, padding: 12, gap: 9 },
  noticeText: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  retryText: { fontSize: 13, fontWeight: '800' },
  submitButton: { height: 52, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  submitText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
