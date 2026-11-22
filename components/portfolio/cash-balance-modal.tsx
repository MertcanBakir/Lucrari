import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { haptics as Haptics } from '@/services/feedback/haptics';
import { showSuccess } from '@/services/feedback/feedback-service';
import React, { useState, useEffect } from 'react';
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

export interface CashBalanceModalProps {
  visible: boolean;
  tryBalance: number;
  usdBalance: number;
  onClose: () => void;
  onSave: (tryBalance: number, usdBalance: number) => Promise<void>;
}

export function CashBalanceModal({
  visible,
  tryBalance,
  usdBalance,
  onClose,
  onSave,
}: CashBalanceModalProps) {
  const reducedMotion = useReducedMotion();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const [tryInput, setTryInput] = useState<string>('0');
  const [usdInput, setUsdInput] = useState<string>('0');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const inFlight = React.useRef(false);
  useEffect(() => {
    if (visible) { setTryInput(String(tryBalance)); setUsdInput(String(usdBalance)); setValidationError(null); }
  }, [visible, tryBalance, usdBalance]);

  const handleSave = async () => {
    if (inFlight.current) return;
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

    try {
      inFlight.current = true;
      setIsSubmitting(true);
      await onSave(tryParse.value, usdParse.value);
      showSuccess('Nakit güncellendi.');
      onClose();
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Hata', formatPortfolioRpcError(err));
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={() => { if (!isSubmitting) onClose(); }}>
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
                    Nakit Tutarını Düzenle
                  </Text>
                </View>
                <TouchableOpacity onPress={onClose} hitSlop={10} disabled={isSubmitting}>
                  <IconSymbol size={20} name="xmark" color={theme.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Description */}
              <Text style={[styles.descriptionText, { color: theme.textSecondary }]}>
                İsterseniz boşta duran TL ve dolarınızı portföy toplamına ekleyebilirsiniz. Alış ve satış kayıtları bu tutarları değiştirmez; değiştikçe buradan güncelleyebilirsiniz.
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
