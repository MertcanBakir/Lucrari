import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';
import type { useAnalysisConnections } from '@/hooks/use-analysis-connections';
import type { AnalysisProvider } from '@/types/analysis';

interface Props {
  providers: AnalysisProvider[];
  isProvidersLoading: boolean;
  providersError: string | null;
  onRefreshProviders: () => Promise<void>;
  connections: ReturnType<typeof useAnalysisConnections>;
  onClose: () => void;
}

export function AnalysisConnectionsModal({
  providers, isProvidersLoading, providersError, onRefreshProviders, connections, onClose,
}: Props) {
  const reducedMotion = useReducedMotion();
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const [providerChoice, setProvider] = useState('');
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [enteredKey, setEnteredKey] = useState<{ provider: string | undefined; value: string } | null>(null);
  const provider = providers.find((item) => item.provider === providerChoice)?.provider ?? providers[0]?.provider;
  const loading = connections.isLoading;

  const clearKey = () => {
    setEnteredKey(null);
  };

  const close = () => {
    clearKey();
    onClose();
  };

  const add = async () => {
    if (loading || isProvidersLoading || providersError || !provider || connections.items.length >= 10) return;
    const key = enteredKey?.provider === provider ? enteredKey.value.trim() : '';
    const trimmedName = name.trim();
    if (!key || trimmedName.length > 80 || [...trimmedName].some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })) {
      setFormError('API anahtarını ve bağlantı adını kontrol edin.');
      return;
    }
    clearKey();
    setFormError(null);
    await connections.create(provider, trimmedName, key);
  };

  const action = (label: string, onPress: () => void, disabled = false, destructive = false) => (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.action}
    >
      <Text style={[styles.actionText, { color: disabled ? theme.disabledText : destructive ? theme.negative : theme.tint }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible animationType={reducedMotion ? 'none' : 'fade'} presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.heading, { borderBottomColor: theme.borderSubtle }]}>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>API Bağlantıları</Text>
            {action('Kapat', close)}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <Text style={{ color: theme.textSecondary }}>
              Sağlayıcı hesabınızın model erişimi ve API ücretleri geçerlidir. Bağlantı kontrolü sağlayıcının model listesine erişimi sınar.
            </Text>
            {connections.error && (
              <View accessibilityRole="alert">
                <Text style={{ color: theme.negative }}>{connections.error}</Text>
                {action('Listeyi Yenile', connections.refresh, loading)}
              </View>
            )}
            {loading && <ActivityIndicator accessibilityLabel="Bağlantılar güncelleniyor" color={theme.tint} />}
            {!loading && !connections.error && connections.items.length === 0 && (
              <Text style={{ color: theme.textSecondary }}>Henüz API bağlantınız yok.</Text>
            )}
            {connections.items.map((item) => (
              <View key={item.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.actionText, { color: theme.text }]}>{item.name || item.provider}</Text>
                <Text style={{ color: theme.textSecondary }}>
                  {item.provider} · {item.verifiedAt ? `Son kontrol: ${new Date(item.verifiedAt).toLocaleString('tr-TR')}` : 'Kontrol zamanı yok'}
                </Text>
                <View style={styles.row}>
                  {removingId === item.id ? (
                    <>
                      {action('Kaldırmayı Onayla', () => {
                        setRemovingId(null);
                        void connections.remove(item.id);
                      }, loading, true)}
                      {action('Vazgeç', () => setRemovingId(null))}
                    </>
                  ) : (
                    <>
                      {action('Bağlantıyı Kontrol Et', () => void connections.verify(item.id), loading)}
                      {action('Kaldır', () => setRemovingId(item.id), loading, true)}
                    </>
                  )}
                </View>
              </View>
            ))}
            <View style={styles.form}>
              <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>Bağlantı Ekle</Text>
              {isProvidersLoading ? (
                <ActivityIndicator accessibilityLabel="Sağlayıcılar yükleniyor" color={theme.tint} />
              ) : connections.items.length >= 10 ? (
                <Text style={{ color: theme.textSecondary }}>En fazla 10 etkin bağlantı eklenebilir.</Text>
              ) : providersError || !provider ? (
                <>
                  <Text style={{ color: theme.textSecondary }}>
                    {providersError ?? 'Backend şu anda API anahtarıyla kullanılabilecek bir sağlayıcı sunmuyor.'}
                  </Text>
                  {action('Sağlayıcıları Yenile', () => {
                    clearKey();
                    void onRefreshProviders();
                  })}
                </>
              ) : (
                <>
                  <View style={styles.row}>
                    {providers.map((item) => (
                      <TouchableOpacity
                        key={item.provider}
                        accessibilityRole="button"
                        accessibilityState={{ selected: provider === item.provider, disabled: loading }}
                        disabled={loading}
                        onPress={() => { clearKey(); setProvider(item.provider); setFormError(null); }}
                        style={[styles.chip, { backgroundColor: provider === item.provider ? theme.tintMuted : theme.surface, borderColor: theme.border }]}
                      >
                        <Text style={{ color: theme.text }}>{item.provider}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    accessibilityLabel="Bağlantı adı"
                    placeholder="Bağlantı adı (isteğe bağlı)"
                    placeholderTextColor={theme.textMuted}
                    style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                    value={name}
                    onChangeText={setName}
                    editable={!loading}
                    maxLength={80}
                  />
                  <TextInput
                    accessibilityLabel="API anahtarı"
                    placeholder="API anahtarı"
                    placeholderTextColor={theme.textMuted}
                    style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    editable={!loading}
                    value={enteredKey?.provider === provider ? enteredKey?.value ?? '' : ''}
                    onChangeText={(value) => setEnteredKey({ provider, value })}
                  />
                  {formError && <Text accessibilityRole="alert" style={{ color: theme.negative }}>{formError}</Text>}
                  {action('Kontrol Et ve Ekle', () => void add(), loading)}
                </>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 19, fontWeight: '800' },
  content: { padding: 18, gap: 14 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 5 },
  form: { gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  actionText: { fontSize: 14, fontWeight: '700' },
  chip: { borderWidth: 1, borderRadius: 12, padding: 10 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 16 },
});
