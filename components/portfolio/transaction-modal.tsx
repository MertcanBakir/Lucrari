import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { showSuccess } from '@/services/feedback/feedback-service';
/** Original trade layout, using the simplified portfolio model. */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ActivityIndicator,
  Alert,
  ScrollView,
  FlatList,
} from 'react-native';
import Animated, {
  FadeInDown,
  FadeOutDown,
} from 'react-native-reanimated';
import { haptics as Haptics } from '@/services/feedback/haptics';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatCurrency } from '@/utils/financial-formatters';
import { parseFinancialNumber, calculateTradeTotal } from '@/utils/financial-parser';
import { formatPortfolioRpcError } from '@/utils/portfolio-errors';
import { formatTradePrice } from '@/utils/portfolio-trade';
import { generateUUID } from '@/utils/uuid';
import { getOrCreateMutationIntent, type MutationIntent } from '@/utils/mutation-intent';
import {
  searchInstrumentsDetailed,
  type InstrumentWithPrice,
} from '@/services/portfolio/instrument-service';
import { MARKET_TABS } from './market-filter-chips';
import type { ExtendedMarketType, TransactionType, PortfolioPosition } from '@/types/database';

export type TxModeType = TransactionType;

export interface TransactionModalProps {
  visible: boolean;
  initialType?: TxModeType;
  positions?: PortfolioPosition[];
  onClose: () => void;
  onSubmitTransaction: (params: {
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

interface OwnedInstrumentWithPrice extends InstrumentWithPrice {
  ownedQuantity: number;
}

const PAGE_SIZE = 20;

// Validates UUID v4 format
function isValidUUID(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
}

export function TransactionModal({
  visible,
  initialType = 'BUY',
  positions = [],
  onClose,
  onSubmitTransaction,
}: TransactionModalProps) {
  const reducedMotion = useReducedMotion();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const [txType, setTxType] = useState<TxModeType>(initialType);
  const [txCategory, setTxCategory] = useState<ExtendedMarketType>('BIST100');
  const [txSearchQuery, setTxSearchQuery] = useState<string>('');
  const [selectedInstrument, setSelectedInstrument] = useState<InstrumentWithPrice | null>(null);
  const [catalogInstruments, setCatalogInstruments] = useState<InstrumentWithPrice[]>([]);
  const [catalogOffset, setCatalogOffset] = useState<number>(0);
  const [hasMoreCatalog, setHasMoreCatalog] = useState<boolean>(true);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState<boolean>(false);
  const [isLoadingMoreCatalog, setIsLoadingMoreCatalog] = useState<boolean>(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [quantityInput, setQuantityInput] = useState<string>('100');
  const [priceInput, setPriceInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestIdRef = useRef<number>(0);

  // Intent tracking for network retry idempotency
  const intentRef = useRef<MutationIntent | null>(null);
  const submissionPendingRef = useRef(false);

  // Map owned positions to InstrumentWithPrice format
  const ownedInstruments: OwnedInstrumentWithPrice[] = useMemo(() => {
    if (!positions || positions.length === 0) return [];
    return positions
      .filter((p) => Number(p.quantity) > 0)
      .map((p) => ({
        id: p.instrument_id,
        market: p.market,
        symbol: p.symbol,
        companyName: p.company_name || p.symbol,
        assetType:
          p.market === 'CRYPTO'
            ? 'crypto'
            : p.market === 'TEFAS'
              ? 'fund'
              : p.market === 'FX'
                ? 'fx'
                : 'stock',
        currency: p.currency,
        price: p.latest_price != null ? Number(p.latest_price) : null,
        hasPrice: p.latest_price != null && Number(p.latest_price) > 0,
        priceAt: p.price_at,
        changePercent: p.change_percent != null ? Number(p.change_percent) : null,
        changeAmount: p.change_amount != null ? Number(p.change_amount) : null,
        isStale: Boolean(p.price_is_stale),
        staleReason: p.price_is_stale ? 'STALE_DATA' : null,
        ownedQuantity: Number(p.quantity),
      }));
  }, [positions]);

  // Filtered owned positions for SELL mode based on category & query
  const filteredOwnedInstruments = useMemo(() => {
    if (txType !== 'SELL') return [];
    let items = ownedInstruments;
    if (txCategory !== 'ALL') {
      items = items.filter((inst) => inst.market === txCategory);
    }
    if (txSearchQuery.trim()) {
      const q = txSearchQuery.trim().toUpperCase();
      items = items.filter(
        (inst) =>
          inst.symbol.toUpperCase().includes(q) ||
          inst.companyName.toUpperCase().includes(q)
      );
    }
    return items;
  }, [txType, ownedInstruments, txCategory, txSearchQuery]);

  // Matching owned position for the currently selected instrument
  const matchingOwnedPosition = useMemo(() => {
    if (txType !== 'SELL' || !selectedInstrument) return null;
    return ownedInstruments.find((o) => o.id === selectedInstrument.id) || null;
  }, [txType, selectedInstrument, ownedInstruments]);

  const maxOwnedQuantity = matchingOwnedPosition ? matchingOwnedPosition.ownedQuantity : 0;

  // Initialize defaults on open
  useEffect(() => {
    if (visible) {
      setTxType(initialType);
      intentRef.current = null;
      setTxSearchQuery('');

      if (initialType === 'SELL') {
        if (ownedInstruments.length > 0) {
          const first = ownedInstruments[0];
          setSelectedInstrument(first);
          setPriceInput(first.hasPrice && first.price !== null ? formatTradePrice(first.price, first.market) : '');
          setQuantityInput(String(first.ownedQuantity));
        } else {
          setSelectedInstrument(null);
          setPriceInput('');
          setQuantityInput('0');
        }
      } else if (initialType === 'BUY') {
        setQuantityInput('100');
      }
    }
  }, [visible, initialType, ownedInstruments]);

  // Load catalog instruments for the active category / search query with out-of-order race prevention
  const loadCatalog = useCallback(async (category: ExtendedMarketType, query: string) => {
    const currentRequestId = ++searchRequestIdRef.current;
    setIsLoadingCatalog(true);
    setCatalogError(null);

    try {
      const result = await searchInstrumentsDetailed(
        query,
        category === 'ALL' ? undefined : category,
        PAGE_SIZE,
        0
      );

      if (currentRequestId !== searchRequestIdRef.current) return;

      if (result.error) {
        setCatalogError(result.error);
        setCatalogInstruments([]);
        setSelectedInstrument(null);
        setHasMoreCatalog(false);
        return;
      }

      setCatalogInstruments(result.items);
      setCatalogOffset(result.items.length);
      setHasMoreCatalog(result.hasMore);

      if (result.items.length > 0) {
        setSelectedInstrument((prev) => {
          if (prev && result.items.some((r) => r.id === prev.id)) return prev;
          const first = result.items[0];
          setPriceInput(first.hasPrice && first.price !== null ? formatTradePrice(first.price, first.market) : '');
          return first;
        });
      } else {
        // Zero search results: clear previously selected instrument
        setSelectedInstrument(null);
        setPriceInput('');
      }
    } catch {
      if (currentRequestId === searchRequestIdRef.current) {
        setCatalogError('Piyasa verileri yüklenirken bir sorun oluştu.');
        setCatalogInstruments([]);
        setSelectedInstrument(null);
        setHasMoreCatalog(false);
      }
    } finally {
      if (currentRequestId === searchRequestIdRef.current) {
        setIsLoadingCatalog(false);
      }
    }
  }, []);

  // Trigger search when category or query changes (BUY mode only)
  useEffect(() => {
    if (!visible) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (txType === 'BUY') {
      searchDebounceRef.current = setTimeout(() => {
        loadCatalog(txCategory, txSearchQuery);
      }, 250);
    }

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [visible, txType, txCategory, txSearchQuery, loadCatalog]);

  const handleLoadMoreCatalog = async () => {
    if (isLoadingMoreCatalog || !hasMoreCatalog || txSearchQuery.trim() || txType === 'SELL') return;

    setIsLoadingMoreCatalog(true);
    try {
      const result = await searchInstrumentsDetailed(
        txSearchQuery,
        txCategory === 'ALL' ? undefined : txCategory,
        PAGE_SIZE,
        catalogOffset
      );
      setCatalogInstruments((prev) => [...prev, ...result.items]);
      setCatalogOffset((prev) => prev + result.items.length);
      setHasMoreCatalog(result.hasMore);
    } catch {
      // Ignore pagination errors
    } finally {
      setIsLoadingMoreCatalog(false);
    }
  };

  const handleSelectTxType = (type: TxModeType) => {
    if (Platform.OS !== 'web') {
      try {
        Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    setTxType(type);
    intentRef.current = null;
    setTxSearchQuery('');

    if (type === 'SELL') {
      if (ownedInstruments.length > 0) {
        const first = ownedInstruments[0];
        setSelectedInstrument(first);
        setPriceInput(first.hasPrice && first.price !== null ? formatTradePrice(first.price, first.market) : '');
        setQuantityInput(String(first.ownedQuantity));
      } else {
        setSelectedInstrument(null);
        setPriceInput('');
        setQuantityInput('0');
      }
    } else if (type === 'BUY') {
      setQuantityInput('100');
      loadCatalog(txCategory, '');
    }
  };

  const handleSelectCategory = (cat: ExtendedMarketType) => {
    if (Platform.OS !== 'web') {
      try {
        Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    setTxCategory(cat);
  };

  const handleSelectInstrument = (inst: InstrumentWithPrice) => {
    if (Platform.OS !== 'web') {
      try {
        Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    setSelectedInstrument(inst);
    setPriceInput(inst.hasPrice && inst.price !== null ? formatTradePrice(inst.price, inst.market) : '');
    
    if (txType === 'SELL') {
      const owned = ownedInstruments.find((o) => o.id === inst.id);
      setQuantityInput(owned ? String(owned.ownedQuantity) : '0');
    } else {
      setQuantityInput('100');
    }
    intentRef.current = null;
  };

  const handleQuickPercentage = (pct: number) => {
    if (Platform.OS !== 'web') {
      try {
        Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    if (maxOwnedQuantity <= 0) return;
    const computedQty = pct === 100 ? maxOwnedQuantity : Number(((maxOwnedQuantity * pct) / 100).toFixed(12));
    setQuantityInput(String(computedQty));
    intentRef.current = null;
  };

  const tradeCalc = calculateTradeTotal(quantityInput, priceInput);
  // Position sufficiency validation for SELL
  const isInsufficientPositionForSell =
    txType === 'SELL' &&
    (maxOwnedQuantity <= 0 || (tradeCalc.quantity !== null && tradeCalc.quantity > maxOwnedQuantity));

  const currentPayloadKey = `${txType}:${selectedInstrument?.id}:${quantityInput}:${priceInput}:${selectedInstrument?.currency}`;

  const handleExecute = async () => {
    if (submissionPendingRef.current) return;

    if (txType === 'BUY' || txType === 'SELL') {
      if (!selectedInstrument) {
        Alert.alert('Enstrüman Seçilmedi', 'Lütfen işlem yapmak istediğiniz bir enstrüman seçiniz.');
        return;
      }

      if (txType === 'SELL') {
        if (maxOwnedQuantity <= 0) {
          Alert.alert(
            'Satılabilir Varlık Yok',
            'Portföyünüzde bu varlıktan bulunmamaktadır.'
          );
          return;
        }
        if (tradeCalc.quantity !== null && tradeCalc.quantity > maxOwnedQuantity) {
          Alert.alert(
            'Yetersiz Pozisyon',
            `Portföyünüzde en fazla ${maxOwnedQuantity} adet ${selectedInstrument.symbol} bulunmaktadır.`
          );
          return;
        }
      }

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

      submissionPendingRef.current = true;
      // Maintain intent for retries; generate new intent if payload changed
      const intent = getOrCreateMutationIntent(intentRef.current, currentPayloadKey, generateUUID);
      intentRef.current = intent;

      setIsSubmitting(true);
      try {
        await onSubmitTransaction({
          instrumentId: selectedInstrument.id,
          transactionType: txType,
          quantity: qtyCheck.value,
          unitPrice: priceCheck.value,
          currency: selectedInstrument.currency,
          transactionAt: intent.timestamp,
          clientRequestId: intent.clientRequestId,
        });
        intentRef.current = null;
        showSuccess('İşlem kaydedildi.');
        onClose();
      } catch (err) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('İşlem Başarısız', formatPortfolioRpcError(err));
      } finally {
        submissionPendingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const isFormValid = Boolean(selectedInstrument && isValidUUID(selectedInstrument.id)) &&
    tradeCalc.isValid && !isInsufficientPositionForSell;

  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={onClose}>
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
          {/* Modal Header */}
          <View style={styles.modalHeaderRow}>
            <View>
              <Text style={[styles.modalTitle, { color: theme.text }]}>İşlem Kaydı</Text>
              <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
                Portföyünüze alım, satım veya nakit hareketi ekleyin
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

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.modalScrollableInner, { minHeight: 480 }]}
          >
            {/* 1. Action Type Selector Tabs (BUY / SELL) */}
            <View style={[styles.txTypeTabsContainer, { backgroundColor: theme.surfaceElevated }]}>
              {(['BUY', 'SELL'] as TxModeType[]).map((type) => {
                const isActive = txType === type;
                const label = type === 'BUY' ? 'Alış' : 'Satış';

                return (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.txTypeTab,
                      isActive && {
                        backgroundColor:
                          type === 'BUY'
                            ? theme.positive
                            : type === 'SELL'
                              ? theme.negative
                              : theme.tint,
                      },
                    ]}
                    onPress={() => handleSelectTxType(type)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.txTypeTabText,
                        {
                          color: isActive
                            ? isDark ? '#171416' : '#FFFFFF'
                            : theme.textSecondary,
                          fontWeight: isActive ? '800' : '600',
                        },
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Dynamic body transitions use the selected tab key and respect Reduce Motion */}
            <Animated.View
              key={`tab-content-${txType}`}
              entering={reducedMotion ? undefined : FadeInDown.duration(180)}
              exiting={reducedMotion ? undefined : FadeOutDown.duration(120)}
              style={styles.tabAnimatedContainer}
            >
              {/* 2. SELL Mode: Empty State when 0 owned positions */}
              {txType === 'SELL' && ownedInstruments.length === 0 && (
                <View style={[styles.emptyOwnedCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.borderSubtle }]}>
                  <View style={[styles.emptyOwnedIconCircle, { backgroundColor: theme.tintMuted }]}>
                    <IconSymbol size={32} name="tray" color={theme.tint} />
                  </View>
                  <Text style={[styles.emptyOwnedTitle, { color: theme.text }]}>
                    Portföyünüzde Satılabilir Varlık Yok
                  </Text>
                  <Text style={[styles.emptyOwnedSubtext, { color: theme.textSecondary }]}>
                    Satış yapabilmek için portföyünüzde en az bir açık pozisyon bulunmalıdır. Portföyünüze varlık eklemek için &quot;Alış&quot; sekmesini kullanabilirsiniz.
                  </Text>
                  <TouchableOpacity
                    style={[styles.emptyOwnedSwitchBtn, { backgroundColor: theme.tint }]}
                    onPress={() => handleSelectTxType('BUY')}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.emptyOwnedSwitchBtnText, { color: isDark ? '#171416' : '#FFFFFF' }]}>
                      + Alış İşlemlerine Geç
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* 3. SELL Mode: Owned Positions Horizontal List (when > 0 positions) */}
              {txType === 'SELL' && ownedInstruments.length > 0 && (
                <View style={styles.instrumentSearchSection}>
                  <Text style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>
                    Portföydeki Varlıklarınız ({filteredOwnedInstruments.length}):
                  </Text>

                  {/* Category Filter Pills (if multiple markets present) */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.categoryPillsScroll}
                  >
                    {MARKET_TABS.map((tab) => {
                      const isSelected = txCategory === tab.id;
                      return (
                        <TouchableOpacity
                          key={tab.id}
                          style={[
                            styles.categoryPill,
                            isSelected && { backgroundColor: theme.tint, borderColor: theme.tint },
                            !isSelected && {
                              backgroundColor: theme.surfaceElevated,
                              borderColor: theme.borderSubtle,
                            },
                          ]}
                          onPress={() => handleSelectCategory(tab.id)}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.categoryPillText,
                              {
                                color: isSelected
                                  ? isDark ? '#171416' : '#FFFFFF'
                                  : theme.textSecondary,
                              },
                            ]}
                          >
                            {tab.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {/* Search Input for filtering owned positions */}
                  <View
                    style={[
                      styles.searchInputWrapper,
                      { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
                    ]}
                  >
                    <IconSymbol size={15} name="magnifyingglass" color={theme.textMuted} />
                    <TextInput
                      style={[styles.searchInput, { color: theme.text }]}
                      placeholder="Portföyünüzdeki varlıklarda ara..."
                      placeholderTextColor={theme.textMuted}
                      value={txSearchQuery}
                      onChangeText={setTxSearchQuery}
                      autoCapitalize="characters"
                    />
                    {txSearchQuery.length > 0 && (
                      <TouchableOpacity onPress={() => setTxSearchQuery('')}>
                        <IconSymbol size={14} name="xmark.circle.fill" color={theme.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>

                  {filteredOwnedInstruments.length === 0 ? (
                    <View style={[styles.catalogStatusBox, { backgroundColor: theme.surfaceElevated }]}>
                      <Text style={[styles.catalogStatusText, { color: theme.textSecondary }]}>
                        Bu filtreye uygun portföy varlığı bulunamadı.
                      </Text>
                    </View>
                  ) : (
                    <FlatList
                      horizontal
                      data={filteredOwnedInstruments}
                      keyExtractor={(inst) => inst.id}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.catalogCardsScroll}
                      renderItem={({ item: inst }) => {
                        const isChosen = selectedInstrument?.id === inst.id;
                        return (
                          <TouchableOpacity
                            key={inst.id}
                            style={[
                              styles.catalogCard,
                              {
                                backgroundColor: isChosen ? theme.tintMuted : theme.surfaceElevated,
                                borderColor: isChosen ? theme.tint : theme.borderSubtle,
                              },
                            ]}
                            onPress={() => handleSelectInstrument(inst)}
                            activeOpacity={0.7}
                          >
                            <View style={styles.catalogCardTop}>
                              <Text style={[styles.catalogCardSymbol, { color: theme.text }]}>
                                {inst.symbol}
                              </Text>
                              <Text style={[styles.catalogCardMarket, { color: theme.tint }]}>
                                {inst.market}
                              </Text>
                            </View>
                            <Text
                              style={[styles.catalogCardName, { color: theme.textSecondary }]}
                              numberOfLines={1}
                            >
                              {inst.companyName}
                            </Text>

                            {/* Owned Quantity Badge */}
                            <View style={[styles.ownedQtyBadge, { backgroundColor: theme.surfaceHighlight }]}>
                              <Text style={[styles.ownedQtyBadgeText, { color: theme.tint }]}>
                                Mevcut: {inst.ownedQuantity} Adet
                              </Text>
                            </View>

                            <Text style={[styles.catalogCardPrice, { color: theme.text }]}>
                              {inst.hasPrice && inst.price !== null
                                ? formatCurrency(inst.price, inst.currency)
                                : '—'}
                            </Text>
                          </TouchableOpacity>
                        );
                      }}
                    />
                  )}
                </View>
              )}

              {/* 4. BUY Mode: Instrument Search & Global Catalog Selection */}
              {txType === 'BUY' && (
                <View style={styles.instrumentSearchSection}>
                  {/* Category Pills */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.categoryPillsScroll}
                  >
                    {MARKET_TABS.map((tab) => {
                      const isSelected = txCategory === tab.id;
                      return (
                        <TouchableOpacity
                          key={tab.id}
                          style={[
                            styles.categoryPill,
                            isSelected && { backgroundColor: theme.tint, borderColor: theme.tint },
                            !isSelected && {
                              backgroundColor: theme.surfaceElevated,
                              borderColor: theme.borderSubtle,
                            },
                          ]}
                          onPress={() => handleSelectCategory(tab.id)}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.categoryPillText,
                              {
                                color: isSelected
                                  ? isDark ? '#171416' : '#FFFFFF'
                                  : theme.textSecondary,
                              },
                            ]}
                          >
                            {tab.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {/* Search Input */}
                  <View
                    style={[
                      styles.searchInputWrapper,
                      { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
                    ]}
                  >
                    <IconSymbol size={15} name="magnifyingglass" color={theme.textMuted} />
                    <TextInput
                      style={[styles.searchInput, { color: theme.text }]}
                      placeholder="Sembol veya şirket adı ara..."
                      placeholderTextColor={theme.textMuted}
                      value={txSearchQuery}
                      onChangeText={setTxSearchQuery}
                      autoCapitalize="characters"
                    />
                    {txSearchQuery.length > 0 && (
                      <TouchableOpacity onPress={() => setTxSearchQuery('')}>
                        <IconSymbol size={14} name="xmark.circle.fill" color={theme.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Catalog Search States: Error, Loading, Empty, or List */}
                  {catalogError ? (
                    <View style={[styles.catalogStatusBox, { backgroundColor: theme.surfaceElevated }]}>
                      <Text style={[styles.catalogStatusText, { color: theme.negative }]}>
                        {catalogError}
                      </Text>
                      <TouchableOpacity
                        style={[styles.retryBtn, { backgroundColor: theme.surfaceHighlight }]}
                        onPress={() => loadCatalog(txCategory, txSearchQuery)}
                      >
                        <Text style={[styles.retryBtnText, { color: theme.tint }]}>Tekrar Dene</Text>
                      </TouchableOpacity>
                    </View>
                  ) : isLoadingCatalog ? (
                    <View style={[styles.catalogStatusBox, { backgroundColor: theme.surfaceElevated }]}>
                      <ActivityIndicator size="small" color={theme.tint} />
                      <Text style={[styles.catalogStatusText, { color: theme.textSecondary }]}>
                        Enstrümanlar aranıyor...
                      </Text>
                    </View>
                  ) : catalogInstruments.length === 0 ? (
                    <View style={[styles.catalogStatusBox, { backgroundColor: theme.surfaceElevated }]}>
                      <Text style={[styles.catalogStatusText, { color: theme.textSecondary }]}>
                        {txSearchQuery.trim() ? 'Aramanızla eşleşen sonuç bulunamadı.' : 'Bu kategoride listelenecek enstrüman bulunamadı.'}
                      </Text>
                    </View>
                  ) : (
                    <FlatList
                      horizontal
                      data={catalogInstruments}
                      keyExtractor={(inst) => inst.id}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.catalogCardsScroll}
                      onEndReached={handleLoadMoreCatalog}
                      onEndReachedThreshold={0.5}
                      ListFooterComponent={
                        isLoadingMoreCatalog ? (
                          <View style={styles.catalogLoadingMoreWrapper}>
                            <ActivityIndicator size="small" color={theme.tint} />
                          </View>
                        ) : null
                      }
                      renderItem={({ item: inst }) => {
                        const isChosen = selectedInstrument?.id === inst.id;
                        return (
                          <TouchableOpacity
                            key={inst.id}
                            style={[
                              styles.catalogCard,
                              {
                                backgroundColor: isChosen ? theme.tintMuted : theme.surfaceElevated,
                                borderColor: isChosen ? theme.tint : theme.borderSubtle,
                              },
                            ]}
                            onPress={() => handleSelectInstrument(inst)}
                            activeOpacity={0.7}
                          >
                            <View style={styles.catalogCardTop}>
                              <Text style={[styles.catalogCardSymbol, { color: theme.text }]}>
                                {inst.symbol}
                              </Text>
                              <Text style={[styles.catalogCardMarket, { color: theme.tint }]}>
                                {inst.market}
                              </Text>
                            </View>
                            <Text
                              style={[styles.catalogCardName, { color: theme.textSecondary }]}
                              numberOfLines={1}
                            >
                              {inst.companyName}
                            </Text>
                            <Text style={[styles.catalogCardPrice, { color: theme.text }]}>
                              {inst.hasPrice && inst.price !== null
                                ? formatCurrency(inst.price, inst.currency)
                                : '—'}
                            </Text>
                            {inst.isStale && (
                              <Text style={[styles.catalogStaleHint, { color: theme.warning }]}>
                                Eski Fiyat
                              </Text>
                            )}
                          </TouchableOpacity>
                        );
                      }}
                    />
                  )}
                </View>
              )}

              {/* 5. Inputs & Calculation Form (hidden if SELL with 0 positions) */}
              {!(txType === 'SELL' && ownedInstruments.length === 0) && (
                <View style={styles.formInputsContainer}>
                  {/* Quantity & Unit Price Inputs */}
                  <View style={styles.inputRow}>
                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                        Miktar (Adet)
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
                        onChangeText={(val) => {
                          setQuantityInput(val);
                          intentRef.current = null;
                        }}
                        keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
                        placeholder="0"
                        placeholderTextColor={theme.textMuted}
                      />
                    </View>

                    {(txType === 'BUY' || txType === 'SELL') && (
                      <View style={[styles.inputGroup, { flex: 1 }]}>
                        <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                          İşlem Fiyatı ({selectedInstrument?.currency ?? 'TRY'})
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
                          onChangeText={(val) => {
                            setPriceInput(val);
                            intentRef.current = null;
                          }}
                          keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
                          placeholder={
                            selectedInstrument?.hasPrice && selectedInstrument.price !== null
                              ? formatTradePrice(selectedInstrument.price, selectedInstrument.market)
                              : '0.00'
                          }
                          placeholderTextColor={theme.textMuted}
                        />
                      </View>
                    )}
                  </View>

                  {/* Quick Percentage Buttons for SELL Mode */}
                  {txType === 'SELL' && maxOwnedQuantity > 0 && (
                    <View style={styles.quickPercentageSection}>
                      <View style={styles.percentageButtonsRow}>
                        {[25, 50, 75, 100].map((pct) => (
                          <TouchableOpacity
                            key={pct}
                            style={[
                              styles.percentageBtn,
                              {
                                backgroundColor: theme.surfaceElevated,
                                borderColor: theme.borderSubtle,
                              },
                            ]}
                            onPress={() => handleQuickPercentage(pct)}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.percentageBtnText, { color: theme.tint }]}>
                              {pct === 100 ? 'Tümü (%100)' : `%${pct}`}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Insufficient Position Warning for SELL Mode */}
                  {isInsufficientPositionForSell && (
                    <View style={[styles.positionWarningBox, { backgroundColor: 'rgba(185, 78, 72, 0.12)', marginBottom: 12 }]}>
                      <IconSymbol size={13} name="exclamationmark.triangle.fill" color={theme.negative} />
                      <Text style={[styles.positionWarningText, { color: theme.negative }]}>
                        Yetersiz Pozisyon: Portföyünüzde en fazla {maxOwnedQuantity} adet {selectedInstrument?.symbol} bulunmaktadır.
                      </Text>
                    </View>
                  )}

                  {/* Total Calculation Preview */}
                  <View style={[styles.txTotalPreview, { backgroundColor: theme.surfaceHighlight }]}>
                    <Text style={[styles.txTotalLabel, { color: theme.textSecondary }]}>
                      {txType === 'SELL'
                          ? 'Tahmini Satış Geliri:'
                          : 'Hesaplanan Toplam Tutar:'}
                    </Text>
                    <Text style={[styles.txTotalValue, { color: theme.text }]}>
                      {tradeCalc.isValid && tradeCalc.total !== null
                          ? formatCurrency(tradeCalc.total, selectedInstrument?.currency ?? 'TRY')
                          : '—'}
                    </Text>
                  </View>

                  {/* Submit CTA */}
                  <TouchableOpacity
                    style={[
                      styles.submitTxButton,
                      {
                        backgroundColor:
                          txType === 'SELL' ? theme.negative : theme.tint,
                        borderColor: theme.tintPressed,
                      },
                      (!isFormValid || isSubmitting) && { opacity: 0.5 },
                    ]}
                    onPress={handleExecute}
                    disabled={!isFormValid || isSubmitting}
                    activeOpacity={0.8}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator size="small" color={isDark ? '#171416' : '#FFFFFF'} />
                    ) : (
                      <Text
                        style={[
                          styles.submitTxButtonText,
                          { color: isDark ? '#171416' : '#FFFFFF' },
                        ]}
                      >
                        ✓{' '}
                        {txType === 'BUY' ? 'Alış İşlemini Kaydet' : 'Satış İşlemini Kaydet'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </Animated.View>
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
    maxHeight: '90%',
    paddingBottom: 20,
  },
  modalScrollableInner: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  tabAnimatedContainer: {
    minHeight: 380,
  },
  formInputsContainer: {
    marginTop: 4,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  modalSubtitle: {
    fontSize: 12,
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
  txTypeTabsContainer: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 4,
    marginBottom: 16,
  },
  txTypeTab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txTypeTabText: {
    fontSize: 12,
    letterSpacing: 0.1,
  },
  instrumentSearchSection: {
    marginBottom: 14,
  },
  sectionSubtitle: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  categoryPillsScroll: {
    gap: 8,
    paddingBottom: 10,
  },
  categoryPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  categoryPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    padding: 0,
  },
  catalogStatusBox: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 4,
  },
  catalogStatusText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  retryBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  catalogCardsScroll: {
    gap: 8,
    paddingVertical: 4,
  },
  catalogCard: {
    width: 132,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 3,
  },
  catalogCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  catalogCardSymbol: {
    fontSize: 13,
    fontWeight: '800',
  },
  catalogCardMarket: {
    fontSize: 9,
    fontWeight: '800',
  },
  catalogCardName: {
    fontSize: 10,
    fontWeight: '500',
  },
  ownedQtyBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  ownedQtyBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  catalogCardPrice: {
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  catalogStaleHint: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 1,
  },
  catalogLoadingMoreWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 40,
    height: 75,
  },
  emptyOwnedCard: {
    padding: 28,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginVertical: 16,
    minHeight: 240,
  },
  emptyOwnedIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyOwnedTitle: {
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyOwnedSubtext: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  emptyOwnedSwitchBtn: {
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 12,
    marginTop: 8,
  },
  emptyOwnedSwitchBtnText: {
    fontSize: 13,
    fontWeight: '800',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
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
  quickPercentageSection: {
    marginBottom: 12,
  },
  percentageButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  percentageBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percentageBtnText: {
    fontSize: 11,
    fontWeight: '800',
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
  },
  positionWarningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: 8,
    flexWrap: 'wrap',
  },
  positionWarningText: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
});
