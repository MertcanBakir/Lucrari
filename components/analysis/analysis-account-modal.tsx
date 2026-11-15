import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';
import { authenticateRegisteredAccount } from '@/services/auth/auth-service';

export function AnalysisAccountModal({ onClose }: { onClose: () => void }) {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const isSignUp = mode === 'sign-up';

  const submit = async () => {
    if (pending.current || !email.trim() || !password) return;
    pending.current = true;
    setIsPending(true);
    setError(null);
    setNotice(null);
    setPassword('');
    try {
      const result = await authenticateRegisteredAccount(mode, email, password);
      if (result === 'signed-in') {
        onClose();
      } else {
        setMode('sign-in');
        setNotice('E-posta doğrulaması gerekiyor. Doğrulama bağlantısını açtıktan sonra buradan giriş yapabilirsin.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İşlem tamamlanamadı. Tekrar deneyin.');
    } finally {
      pending.current = false;
      setIsPending(false);
    }
  };

  const close = () => {
    if (!pending.current) onClose();
  };

  const inputStyle = [styles.input, { borderColor: theme.border, color: theme.text }];
  const canSubmit = Boolean(email.trim() && password && !isPending);
  const title = isSignUp ? 'Hesap Oluştur' : 'Giriş Yap';
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <TouchableOpacity accessibilityRole="button" disabled={isPending} onPress={close} style={styles.action}>
              <Text style={{ color: theme.tint }}>Kapat</Text>
            </TouchableOpacity>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{title}</Text>
            <Text style={{ color: theme.textSecondary }}>
              Giriş yaptığında Lucrari kayıtlı hesabına geçer. Misafir portföyü, izleme listesi ve Agent geçmişi misafir oturumuna bağlı kalır.
            </Text>
            <TextInput
              accessibilityLabel="E-posta"
              placeholder="E-posta"
              placeholderTextColor={theme.textMuted}
              style={inputStyle}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
              editable={!isPending}
            />
            <TextInput
              accessibilityLabel="Parola"
              placeholder="Parola"
              placeholderTextColor={theme.textMuted}
              style={inputStyle}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={password}
              onChangeText={setPassword}
              editable={!isPending}
            />
            {notice && <Text accessibilityRole="alert" style={{ color: theme.textSecondary }}>{notice}</Text>}
            {error && <Text accessibilityRole="alert" style={{ color: theme.negative }}>{error}</Text>}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit, busy: isPending }}
              disabled={!canSubmit}
              onPress={submit}
              style={[styles.action, styles.submit, { backgroundColor: canSubmit ? theme.tint : theme.disabledBg }]}
            >
              {isPending ? <ActivityIndicator color={theme.tint} /> : (
                <Text style={{ color: canSubmit ? '#FFFFFF' : theme.disabledText, fontWeight: '700' }}>{title}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={isPending}
              onPress={() => {
                setMode(isSignUp ? 'sign-in' : 'sign-up');
                setPassword('');
                setError(null);
                setNotice(null);
              }}
              style={styles.action}
            >
              <Text style={{ color: theme.tint }}>{isSignUp ? 'Zaten hesabım var' : 'Yeni hesap oluştur'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, gap: 14 },
  title: { fontSize: 24, fontWeight: '800' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 16 },
  action: { minHeight: 44, justifyContent: 'center' },
  submit: { alignItems: 'center', borderRadius: 12 },
});
