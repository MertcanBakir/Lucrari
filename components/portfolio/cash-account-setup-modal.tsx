/**
 * Lucrari — Cash Account Setup Modal
 * 
 * Enables legacy and uninitialized portfolio users to set their opening TRY and USD cash balances.
 * Complies with strict product rules:
 * - Opening balance is >= 0 (user can enter 0).
 * - Validates using locale-aware parseFinancialNumber.
 * - Explains that past transactions do not mutate this initial cash boundary.
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { parseFinancialNumber } from '@/utils/financial-parser';

import { formatPortfolioRpcError } from '@/utils/portfolio-errors';
import { generateUUID } from '@/utils/uuid';
import { getOrCreateMutationIntent, type MutationIntent } from '@/utils/mutation-intent';

export interface CashAccountSetupModalProps {
  visible: boolean;
  onClose: () => void;
  onInitialize: (tryBalance: number, usdBalance: number, clientRequestId?: string) => Promise<void>;
}

export function CashAccountSetupModal({
  visible,
  onClose,
  onInitialize,
}: CashAccountSetupModalProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const [tryInput, setTryInput] = useState<string>('0');
  const [usdInput, setUsdInput] = useState<string>('0');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const intentRef = React.useRef<MutationIntent | null>(null);

  const currentPayloadKey = `${tryInput}:${usdInput}`;

  const handleSave = async () => {
    Keyboard.dismiss();
    setValidationError(null);

    const tryParse = parseFinancialNumber(tryInput, { allowZero: true, allowNegative: false });
    if (!tryParse.isValid || tryParse.value === null) {
      setValidationError(`TRY Nakit: ${tryParse.errorMessage || 'Geçersiz tutar.'}`);
      return;
    }

    const usdParse = parseFinancialNumber(usdInput, { allowZero: true, allowNegative: false });
    if (!usdParse.isValid || usdParse.value === null) {
      setValidationError(`USD Nakit: ${usdParse.errorMessage || 'Geçersiz tutar.'}`);
      return;
    }

    const intent = getOrCreateMutationIntent(intentRef.current, currentPayloadKey, generateUUID);
    intentRef.current = intent;

    try {
      setIsSubmitting(true);
      await onInitialize(tryParse.value, usdParse.value, intent.clientRequestId);
      intentRef.current = null;
      Alert.alert(
        'Nakit Hesabı Kuruldu',
        'Nakit hesaplarınız başarıyla başlatıldı ve portföy toplamına dahil edildi.'
      );
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('portfolio_cash_account_already_initialized')) {
        Alert.alert('Bilgi', 'Nakit hesapları bu portföy için zaten kurulmuş.');
        intentRef.current = null;
        onClose();
      } else {
        Alert.alert('Hata', `Nakit hesabı kurulumu başarısız: ${formatPortfolioRpcError(err)}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardView}
          >
            <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              {/* Header */}
              <View style={styles.headerRow}>
                <View style={styles.headerTitleGroup}>
                  <View style={[styles.iconWrapper, { backgroundColor: theme.surfaceElevated }]}>
                    <IconSymbol size={20} name="banknote" color={theme.tint} />
                  </View>
                  <Text style={[styles.headerTitle, { color: theme.text }]}>
                    Nakit Bakiyesini Kur
                  </Text>
                </View>
                <TouchableOpacity onPress={onClose} hitSlop={10} disabled={isSubmitting}>
                  <IconSymbol size={20} name="xmark" color={theme.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Description */}
              <Text style={[styles.descriptionText, { color: theme.textSecondary }]}>
                Portföyünüzün güncel toplam değerini doğru hesaplamak için mevcut serbest nakdinizi girin. Bu işlem tek seferliktir; geçmiş işlemleriniz bu açılış nakdini etkilemez.
              </Text>

              {/* TRY Cash Input */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                  Mevcut TRY Nakit (₺)
                </Text>
                <View
                  style={[
                    styles.inputWrapper,
                    { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle },
                  ]}
                >
                  <Text style={[styles.currencyPrefix, { color: theme.textMuted }]}>₺</Text>
                  <TextInput
                    style={[styles.textInput, { color: theme.text }]}
                    keyboardType="numeric"
                    value={tryInput}
                    onChangeText={(val) => {
                      setTryInput(val);
                      setValidationError(null);
                    }}
                    placeholder="0"
                    placeholderTextColor={theme.textMuted}
                    editable={!isSubmitting}
                  />
                </View>
              </View>

              {/* USD Cash Input */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                  Mevcut USD Nakit ($)
                </Text>
                <View
                  style={[
                    styles.inputWrapper,
                    { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle },
                  ]}
                >
                  <Text style={[styles.currencyPrefix, { color: theme.textMuted }]}>$</Text>
                  <TextInput
                    style={[styles.textInput, { color: theme.text }]}
                    keyboardType="numeric"
                    value={usdInput}
                    onChangeText={(val) => {
                      setUsdInput(val);
                      setValidationError(null);
                    }}
                    placeholder="0"
                    placeholderTextColor={theme.textMuted}
                    editable={!isSubmitting}
                  />
                </View>
              </View>

              {/* Validation Error Banner */}
              {validationError && (
                <View style={[styles.errorBox, { backgroundColor: 'rgba(185, 78, 72, 0.1)' }]}>
                  <Text style={[styles.errorText, { color: theme.negative }]}>{validationError}</Text>
                </View>
              )}

              {/* Action Buttons */}
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.cancelButton, { borderColor: theme.borderSubtle }]}
                  onPress={onClose}
                  disabled={isSubmitting}
                >
                  <Text style={[styles.cancelButtonText, { color: theme.textSecondary }]}>İptal</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.saveButton,
                    { backgroundColor: theme.tint, opacity: isSubmitting ? 0.7 : 1 },
                  ]}
                  onPress={handleSave}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.saveButtonText}>Bakiyeleri Kaydet</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
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
  keyboardView: {
    width: '100%',
    maxWidth: 420,
  },
  modalCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  descriptionText: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  currencyPrefix: {
    fontSize: 16,
    fontWeight: '600',
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  errorBox: {
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1.6,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
