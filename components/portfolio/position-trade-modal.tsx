/**
 * Position Trade Modal Component (Modal 6)
 * 
 * Dedicated quick Alış/Satış modal for an existing portfolio position.
 * Features locked instrument metadata, fast action toggle, quick percentage sell chips,
 * and robust financial input parsing and total validation.
 * 
 * STRICT COMPLIANCE:
 * - NO fallback '100' prices.
 * - Leaves price empty if market price is missing, enabling manual user entry.
 * - Stale price warning badge.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatCurrency } from '@/utils/financial-formatters';
import { parseFinancialNumber, calculateTradeTotal } from '@/utils/financial-parser';
import { formatPortfolioRpcError } from '@/utils/portfolio-errors';
import { formatTradePrice } from '@/utils/portfolio-trade';
import { generateUUID } from '@/utils/uuid';
import { getOrCreateMutationIntent, type MutationIntent } from '@/utils/mutation-intent';
import type { PortfolioPosition, TransactionType } from '@/types/database';

export interface PositionTradeModalProps {
  visible: boolean;
  position: PortfolioPosition | null;
  initialAction?: 'BUY' | 'SELL';
  onClose: () => void;
  onSubmit: (params: {
    instrumentId: string;
    transactionType: TransactionType;
    quantity: number;
    unitPrice: number;
    currency: 'TRY' | 'USD';
    transactionAt?: string;
    clientRequestId?: string;
    notes?: string | null;
  }) => Promise<void>;
}

export function PositionTradeModal({
  visible,
  position,
  initialAction = 'BUY',
  onClose,
  onSubmit,
}: PositionTradeModalProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const [tradeAction, setTradeAction] = useState<'BUY' | 'SELL'>(initialAction);
  const [quantityInput, setQuantityInput] = useState<string>('100');
  const [priceInput, setPriceInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Intent tracking for retry idempotency
  const intentRef = useRef<MutationIntent | null>(null);
  const submissionPendingRef = useRef(false);

  useEffect(() => {
    if (position) {
      const rawLatest = position.latest_price;
      const numLatest = rawLatest != null ? Number(rawLatest) : null;
      const hasLivePrice = numLatest != null && Number.isFinite(numLatest) && numLatest > 0;
      const currentQty = Number(position.quantity) || 0;

      setTradeAction(initialAction);
      setPriceInput(hasLivePrice && numLatest !== null ? formatTradePrice(numLatest, position.market) : '');
      intentRef.current = null;

      if (initialAction === 'SELL') {
        const defaultSell = Math.min(currentQty, 100);
        setQuantityInput(defaultSell > 0 ? String(defaultSell) : '1');
      } else {
        setQuantityInput('100');
      }
    }
  }, [position, initialAction]);

  if (!position) return null;

  const currentAvailableQty = Number(position.quantity) || 0;
  const isStale = Boolean(position.price_is_stale);
  const rawLatest = position.latest_price;
  const numLatest = rawLatest != null ? Number(rawLatest) : null;
  const hasMarketPrice = numLatest != null && Number.isFinite(numLatest) && numLatest > 0;

  const tradeCalc = calculateTradeTotal(quantityInput, priceInput);

  const currentPayloadKey = `${tradeAction}:${position.instrument_id}:${quantityInput}:${priceInput}:${position.currency}`;

  const handleSetPercent = async (pct: number) => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    const calculatedQty = (currentAvailableQty * pct) / 100;
    const formatted = Number.isInteger(calculatedQty)
      ? String(calculatedQty)
      : parseFloat(calculatedQty.toFixed(12)).toString();
    setQuantityInput(formatted);
    intentRef.current = null;
  };

  const handleExecuteTrade = async () => {
    if (submissionPendingRef.current) return;

    const qtyCheck = parseFinancialNumber(quantityInput, { allowZero: false, allowNegative: false });
    if (!qtyCheck.isValid || qtyCheck.value === null) {
      Alert.alert('Geçersiz Miktar', qtyCheck.errorMessage || 'Lütfen geçerli bir miktar giriniz.');
      return;
    }

    const priceCheck = parseFinancialNumber(priceInput, { allowZero: false, allowNegative: false });
    if (!priceCheck.isValid || priceCheck.value === null) {
      Alert.alert('Geçersiz Fiyat', priceCheck.errorMessage || 'Lütfen geçerli bir işlem birim fiyatı giriniz.');
      return;
    }

    if (tradeAction === 'SELL' && qtyCheck.value > currentAvailableQty) {
      Alert.alert(
        'Yetersiz Bakiye',
        `Satış miktarı (${qtyCheck.value}) mevcut pozisyon miktarından (${currentAvailableQty}) fazla olamaz.`
      );
      return;
    }

    submissionPendingRef.current = true;

    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        // Fallback
      }
    }

    // Resolve intent: preserve on retry, create new on payload change
    const intent = getOrCreateMutationIntent(intentRef.current, currentPayloadKey, generateUUID);
    intentRef.current = intent;

    setIsSubmitting(true);
    try {
      await onSubmit({
        instrumentId: position.instrument_id,
        transactionType: tradeAction,
        quantity: qtyCheck.value,
        unitPrice: priceCheck.value,
        currency: position.currency || 'TRY',
        transactionAt: intent.timestamp,
        clientRequestId: intent.clientRequestId,
      });
      intentRef.current = null;
      onClose();
    } catch (err) {
      Alert.alert('İşlem Başarısız', formatPortfolioRpcError(err));
    } finally {
      submissionPendingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalBackdropDismiss} />
        </TouchableWithoutFeedback>

        <View
          style={[
            styles.modalContentCard,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
            contentContainerStyle={styles.modalScrollableInner}
          >
            {/* Header: Fixed Instrument Header */}
            <View style={styles.modalHeaderRow}>
              <View>
                <View style={styles.symbolRow}>
                  <Text style={[styles.modalSymbol, { color: theme.text }]}>
                    {position.symbol}
                  </Text>
                  <View style={[styles.marketTagBadge, { backgroundColor: theme.tintMuted }]}>
                    <Text style={[styles.marketTagText, { color: theme.tint }]}>
                      {position.market}
                    </Text>
                  </View>
                  {isStale && (
                    <View style={[styles.staleBadge, { backgroundColor: 'rgba(208, 165, 103, 0.15)' }]}>
                      <Text style={[styles.staleBadgeText, { color: theme.warning }]}>Eski Fiyat</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.modalCompanyName, { color: theme.textSecondary }]}>
                  {position.company_name}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.modalCloseBtn, { backgroundColor: theme.surfaceHighlight }]}
                onPress={onClose}
                activeOpacity={0.7}
              >
                <IconSymbol size={16} name="xmark" color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Fast Action Switcher: Alış vs Satış */}
            <View style={styles.positionTradeActionSwitcher}>
              <TouchableOpacity
                style={[
                  styles.positionTradeActionBtn,
                  tradeAction === 'BUY'
                    ? { backgroundColor: theme.positive, borderColor: theme.positive }
                    : { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle },
                ]}
                onPress={() => setTradeAction('BUY')}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.positionTradeActionBtnText,
                    { color: tradeAction === 'BUY' ? '#FFFFFF' : theme.textSecondary },
                  ]}
                >
                  + Alış Yap
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.positionTradeActionBtn,
                  tradeAction === 'SELL'
                    ? { backgroundColor: theme.negative, borderColor: theme.negative }
                    : { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle },
                ]}
                onPress={() => setTradeAction('SELL')}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.positionTradeActionBtnText,
                    { color: tradeAction === 'SELL' ? '#FFFFFF' : theme.textSecondary },
                  ]}
                >
                  - Satış Yap
                </Text>
              </TouchableOpacity>
            </View>

            {/* Position Summary Context Box */}
            <View
              style={[
                styles.positionContextBox,
                { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle },
              ]}
            >
              <View style={styles.positionContextCol}>
                <Text style={[styles.positionContextLabel, { color: theme.textSecondary }]}>
                  Mevcut Miktar
                </Text>
                <Text style={[styles.positionContextVal, { color: theme.text }]}>
                  {position.quantity} Adet
                </Text>
              </View>
              <View style={styles.positionContextCol}>
                <Text style={[styles.positionContextLabel, { color: theme.textSecondary }]}>
                  Ortalama Maliyet
                </Text>
                <Text style={[styles.positionContextVal, { color: theme.text }]}>
                  {formatCurrency(Number(position.average_cost) || 0, position.currency)}
                </Text>
              </View>
              <View style={styles.positionContextCol}>
                <Text style={[styles.positionContextLabel, { color: theme.textSecondary }]}>
                  Piyasa Fiyatı
                </Text>
                <Text style={[styles.positionContextVal, { color: theme.tint }]}>
                  {hasMarketPrice && numLatest !== null
                    ? formatCurrency(numLatest, position.currency)
                    : '—'}
                </Text>
              </View>
            </View>

            {/* Quick Percentage Chips for SELL Action */}
            {tradeAction === 'SELL' && (
              <View style={styles.quickPercentRow}>
                <Text style={[styles.quickPercentHint, { color: theme.textMuted }]}>
                  Hızlı Seçim:
                </Text>
                {[25, 50, 75, 100].map((pct) => (
                  <TouchableOpacity
                    key={pct}
                    style={[
                      styles.quickPercentPill,
                      { backgroundColor: theme.surfaceHighlight, borderColor: theme.borderSubtle },
                    ]}
                    onPress={() => handleSetPercent(pct)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.quickPercentPillText, { color: theme.text }]}>
                      {pct === 100 ? 'Tümü' : `%${pct}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Quantity & Unit Price Inputs */}
            <View style={styles.inputRow}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                  İşlem Miktarı (Adet)
                </Text>
                <TextInput
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: theme.surfaceElevated,
                      color: theme.text,
                      borderColor: theme.border,
                    },
                  ]}
                  accessibilityLabel="Adet"
                  value={quantityInput}
                  onChangeText={setQuantityInput}
                  keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
                  placeholder="0"
                  placeholderTextColor={theme.textMuted}
                />
              </View>

              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                  İşlem Fiyatı ({position.currency})
                </Text>
                <TextInput
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: theme.surfaceElevated,
                      color: theme.text,
                      borderColor: theme.border,
                    },
                  ]}
                  accessibilityLabel="Birim fiyat"
                  value={priceInput}
                  onChangeText={setPriceInput}
                  keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
                  placeholder={hasMarketPrice && numLatest !== null ? formatTradePrice(numLatest, position.market) : '0.00'}
                  placeholderTextColor={theme.textMuted}
                />
              </View>
            </View>

            {/* Total Calculation Preview */}
            <View style={[styles.txTotalPreview, { backgroundColor: theme.surfaceHighlight }]}>
              <Text style={[styles.txTotalLabel, { color: theme.textSecondary }]}>
                Hesaplanan Toplam Tutar:
              </Text>
              <Text style={[styles.txTotalValue, { color: theme.text }]}>
                {tradeCalc.isValid && tradeCalc.total !== null
                  ? formatCurrency(tradeCalc.total, position.currency)
                  : '—'}
              </Text>
            </View>

            {/* Submit CTA */}
            <TouchableOpacity
              style={[
                styles.submitTxButton,
                {
                  backgroundColor: tradeAction === 'BUY' ? theme.positive : theme.negative,
                  borderColor: tradeAction === 'BUY' ? theme.positive : theme.negative,
                },
                (!tradeCalc.isValid || isSubmitting || (tradeAction === 'SELL' && (tradeCalc.quantity ?? 0) > currentAvailableQty)) && { opacity: 0.6 },
              ]}
              onPress={handleExecuteTrade}
              disabled={!tradeCalc.isValid || isSubmitting || (tradeAction === 'SELL' && (tradeCalc.quantity ?? 0) > currentAvailableQty)}
              activeOpacity={0.8}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.submitTxButtonText}>
                  {tradeAction === 'BUY' ? 'Alış İşlemini Kaydet' : 'Satış İşlemini Kaydet'}
                </Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalBackdropDismiss: {
    flex: 1,
  },
  modalContentCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    maxHeight: '88%',
    paddingBottom: 24,
  },
  modalScrollableInner: {
    padding: 20,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  modalSymbol: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  marketTagBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  marketTagText: {
    fontSize: 10,
    fontWeight: '800',
  },
  staleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  staleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  modalCompanyName: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  positionTradeActionSwitcher: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  positionTradeActionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  positionTradeActionBtnText: {
    fontSize: 14,
    fontWeight: '800',
  },
  positionContextBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  positionContextCol: {
    flex: 1,
    alignItems: 'center',
  },
  positionContextLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 3,
  },
  positionContextVal: {
    fontSize: 13,
    fontWeight: '800',
  },
  quickPercentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  quickPercentHint: {
    fontSize: 12,
    fontWeight: '600',
  },
  quickPercentPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  quickPercentPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  textInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '700',
  },
  txTotalPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  txTotalLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  txTotalValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  submitTxButton: {
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  submitTxButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
