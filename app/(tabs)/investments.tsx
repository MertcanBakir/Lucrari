import { LoadingSkeleton } from '@/components/feedback/loading-skeleton';
/** Investment tracking with moving average cost and optional manual cash. */

import React, { useState, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  RefreshControl,
  Platform,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { haptics as Haptics } from '@/services/feedback/haptics';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useAppTheme } from '@/context/theme-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { usePortfolio } from '@/hooks/use-portfolio';
import { PortfolioHeader } from '@/components/portfolio/portfolio-header';
import { PortfolioSummaryCard } from '@/components/portfolio/portfolio-summary-card';
import { PortfolioAllocationCard } from '@/components/portfolio/portfolio-allocation-card';
import { PortfolioActivityEntryCard } from '@/components/portfolio/portfolio-activity-entry-card';
import { MarketFilterChips } from '@/components/portfolio/market-filter-chips';
import { PositionCard } from '@/components/portfolio/position-card';
import { PositionDetailModal } from '@/components/portfolio/position-detail-modal';
import { PositionTradeModal } from '@/components/portfolio/position-trade-modal';
import { TransactionModal, type TxModeType } from '@/components/portfolio/transaction-modal';
import { CashBalanceModal } from '@/components/portfolio/cash-balance-modal';
import { StaleDataBanner } from '@/components/portfolio/stale-data-banner';
import { PortfolioErrorView } from '@/components/portfolio/portfolio-error-view';
import { type CurrencyMode, type PnlMode } from '@/utils/financial-math';
import { shouldRefreshOnFocus, FOCUS_REFETCH_STALE_TTL_MS } from '@/utils/focus-refresh';
import { resolvePortfolioViewState } from '@/utils/portfolio-view-state';
import type { ExtendedMarketType, PortfolioPosition, TransactionType } from '@/types/database';

export default function InvestmentsScreen() {
  const { userId } = useAuth();
  return <InvestmentsSessionScreen key={userId ?? 'signed-out'} />;
}

function InvestmentsSessionScreen() {
  const router = useRouter();
  const { colorScheme } = useAppTheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  // Live Supabase Portfolio Hook
  const {
    portfolio,
    positions,
    stats,
    allocationItems,
    usdTryRate,
    cash,
    isLoading,
    isRefreshing,
    isStale,
    error,
    lastFetchedTimestamp,
    refreshPortfolio,
    updateCash,
    addTransaction,
  } = usePortfolio();

  // Currency Mode ('TRY' | 'USD') and PnL Mode ('DAILY' | 'TOTAL')
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('TRY');
  const [pnlMode, setPnlMode] = useState<PnlMode>('DAILY');
  const [activeMarket, setActiveMarket] = useState<ExtendedMarketType>('ALL');

  // Modal States
  const [selectedPosition, setSelectedPosition] = useState<PortfolioPosition | null>(null);
  const [tradePosition, setTradePosition] = useState<PortfolioPosition | null>(null);
  const [tradeAction, setTradeAction] = useState<'BUY' | 'SELL'>('BUY');
  const [isTxModalVisible, setIsTxModalVisible] = useState<boolean>(false);
  const [txModalInitialType, setTxModalInitialType] = useState<TxModeType>('BUY');
  const [isCashModalVisible, setIsCashModalVisible] = useState<boolean>(false);

  // Smart Focus Refetch: Uses pure shouldRefreshOnFocus helper
  useFocusEffect(
    useCallback(() => {
      if (
        shouldRefreshOnFocus({
          isLoading,
          isRefreshing,
          error,
          lastFetchedTimestamp,
          ttlMs: FOCUS_REFETCH_STALE_TTL_MS,
        })
      ) {
        refreshPortfolio();
      }
    }, [error, isLoading, isRefreshing, lastFetchedTimestamp, refreshPortfolio])
  );

  // Filtered Positions based on Active Market Tab
  const filteredPositions = useMemo(() => {
    if (activeMarket === 'ALL') return positions;
    return positions.filter((p) => p.market === activeMarket);
  }, [positions, activeMarket]);

  // Actions
  const handleToggleCurrency = useCallback(async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    setCurrencyMode((prev) => (prev === 'TRY' ? 'USD' : 'TRY'));
  }, []);

  const handleTogglePnlMode = useCallback(async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    setPnlMode((prev) => (prev === 'DAILY' ? 'TOTAL' : 'DAILY'));
  }, []);

  const handleOpenTransactionModal = useCallback((type: TxModeType) => {
    if (Platform.OS !== 'web') {
      try {
        Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    setTxModalInitialType(type);
    setIsTxModalVisible(true);
  }, []);

  const handleOpenPositionDetails = useCallback((position: PortfolioPosition) => {
    setSelectedPosition(position);
  }, []);

  const handleOpenPositionTrade = useCallback(
    (action: 'BUY' | 'SELL') => {
      if (Platform.OS !== 'web') {
        try {
          Haptics.selectionAsync();
        } catch {
          // Fallback
        }
      }
      setTradePosition(selectedPosition);
      setSelectedPosition(null);
      setTradeAction(action);
    },
    [selectedPosition]
  );

  const handleOpenChart = useCallback(() => {
    if (Platform.OS !== 'web') {
      try {
        Haptics.selectionAsync();
      } catch {
        // Fallback
      }
    }
    router.push({ pathname: '/portfolio-chart', params: { currency: currencyMode, market: activeMarket } });
  }, [router, currencyMode, activeMarket]);

  const handleExecuteTransaction = useCallback(
    async (params: {
      instrumentId: string;
      transactionType: TransactionType;
      quantity: number;
      unitPrice: number;
      currency: 'TRY' | 'USD';
      transactionAt?: string;
      clientRequestId?: string;
      notes?: string | null;
    }) => {
      await addTransaction(params);
    },
    [addTransaction]
  );

  // Pure View State Resolution: differentiates initial load errors from stale cached data (even cash-only)
  const { isInitialLoading, isInitialError } = resolvePortfolioViewState({
    isLoading,
    isRefreshing,
    error,
    hasLoadedSuccessfully: lastFetchedTimestamp > 0,
  });
  const isReady = Boolean(portfolio && !isInitialLoading && !isInitialError);

  // List Header Component
  const renderListHeader = useCallback(() => {
    return (
      <View>
        {/* Stale Data Notification */}
        {isStale && (
          <StaleDataBanner onRefresh={refreshPortfolio} isRefreshing={isRefreshing} />
        )}

        {/* Screen Header */}
        <PortfolioHeader
          portfolioName={portfolio?.name}
          currencyMode={currencyMode}
          onToggleCurrency={handleToggleCurrency}
          onAddTransaction={() => handleOpenTransactionModal('BUY')}
          disabled={!isReady}
        />

        {/* Initial Loading Spinner */}
        {isInitialLoading && (
          <LoadingSkeleton variant="portfolio" label="Portföy verileri yükleniyor..." />
        )}

        {/* Initial Load Error View */}
        {isInitialError && (
          <PortfolioErrorView
            error={error}
            onRetry={refreshPortfolio}
            isLoading={isRefreshing || isLoading}
          />
        )}

        {/* Main Dashboard Cards (Shown when data is loaded) */}
        {!isInitialError && !isInitialLoading && (
          <>
            {/* 1. Main Wealth Summary Card */}
            <PortfolioSummaryCard
              stats={stats}
              currencyMode={currencyMode}
              pnlMode={pnlMode}
              usdTryRate={usdTryRate}
              onTogglePnlMode={handleTogglePnlMode}
              onToggleCurrency={handleToggleCurrency}
              onOpenChart={handleOpenChart}
              onEditCash={() => setIsCashModalVisible(true)}
            />

            {/* 2. Asset Allocation Breakdown Card */}
            <PortfolioAllocationCard
              allocationItems={allocationItems}
              currencyMode={currencyMode}
              usdTryRate={usdTryRate}
            />

            {/* 3. Market Filters */}
            <MarketFilterChips
              activeMarket={activeMarket}
              onSelectMarket={setActiveMarket}
            />

            {/* 4. Section Title & PnL Mode Indicator */}
            <View style={styles.holdingsHeaderRow}>
              <Text style={[styles.holdingsSectionTitle, { color: theme.textSecondary }]}>
                POZİSYONLAR ({filteredPositions.length})
              </Text>
              <View
                style={[
                  styles.holdingsHeaderBadge,
                  { backgroundColor: theme.surfaceHighlight, borderColor: theme.borderSubtle },
                ]}
              >
                <Text style={[styles.holdingsHeaderCurrencyHint, { color: theme.textSecondary }]}>
                  {pnlMode === 'DAILY' ? 'Günlük Değişim' : 'Açık K/Z'} • {currencyMode}
                </Text>
              </View>
            </View>
          </>
        )}
      </View>
    );
  }, [
    isStale,
    isRefreshing,
    refreshPortfolio,
    portfolio?.name,
    currencyMode,
    handleToggleCurrency,
    handleOpenTransactionModal,
    isReady,
    isInitialLoading,
    theme,
    isInitialError,
    error,
    isLoading,
    stats,
    pnlMode,
    usdTryRate,
    handleTogglePnlMode,
    handleOpenChart,
    allocationItems,
    activeMarket,
    filteredPositions.length,
  ]);

  // List Empty Component
  const renderListEmpty = useCallback(() => {
    if (isInitialLoading || isInitialError) return null;


    return (
      <View style={[styles.emptyPositionsCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={[styles.emptyIconBadge, { backgroundColor: theme.surfaceElevated }]}>
          <IconSymbol size={22} name="briefcase.fill" color={theme.tint} />
        </View>
        <Text style={[styles.emptyPositionsTitle, { color: theme.text }]}>
          Açık Pozisyon Bulunmuyor
        </Text>
        <Text style={[styles.emptyPositionsSubtitle, { color: theme.textSecondary }]}>
          İlk yatırımınızı kaydetmek için yukarıdaki &apos;İşlem Ekle&apos; butonunu kullanabilirsiniz.
        </Text>
      </View>
    );
  }, [isInitialLoading, isInitialError, theme]);

  // List Footer Component (Placed under positions / at the very bottom)
  const renderListFooter = useCallback(() => {
    if (isInitialLoading || isInitialError) return null;

    return (
      <View style={styles.footerContainer}>
        <PortfolioActivityEntryCard disabled={!isReady} />
      </View>
    );
  }, [isInitialLoading, isInitialError, isReady]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        data={!isInitialLoading && !isInitialError ? filteredPositions : []}
        keyExtractor={(item) => item.instrument_id}
        renderItem={({ item }) => (
          <PositionCard
            position={item}
            pnlMode={pnlMode}
            currencyMode={currencyMode}
            usdTryRate={usdTryRate}
            onPress={handleOpenPositionDetails}
          />
        )}
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={renderListEmpty}
        ListFooterComponent={renderListFooter}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refreshPortfolio}
            tintColor={theme.tint}
          />
        }
      />

      {/* Modal 5: Holding Detail Inspection Modal */}
      <PositionDetailModal
        visible={Boolean(selectedPosition)}
        position={selectedPosition}
        currencyMode={currencyMode}
        usdTryRate={usdTryRate}
        onClose={() => setSelectedPosition(null)}
        onTrade={handleOpenPositionTrade}
      />

      {/* Modal 6: Fast Dedicated Position Trade Modal */}
      <PositionTradeModal
        visible={Boolean(tradePosition)}
        position={tradePosition}
        initialAction={tradeAction}
        onClose={() => setTradePosition(null)}
        onSubmit={handleExecuteTransaction}
      />

      {/* Modal 1: General trade form */}
      <TransactionModal
        visible={isTxModalVisible}
        initialType={txModalInitialType}
        positions={positions}
        onClose={() => setIsTxModalVisible(false)}
        onSubmitTransaction={handleExecuteTransaction}
      />

      {/* Optional cash editor */}
      <CashBalanceModal
        visible={isCashModalVisible}
        onClose={() => setIsCashModalVisible(false)}
        tryBalance={cash?.tryBalance ?? 0}
        usdBalance={cash?.usdBalance ?? 0}
        onSave={updateCash}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingBottom: 100,
  },
  holdingsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  holdingsSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  holdingsHeaderBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  holdingsHeaderCurrencyHint: {
    fontSize: 11,
    fontWeight: '600',
  },
  emptyPositionsCard: {
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  emptyIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyPositionsTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  emptyPositionsSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  footerContainer: {
    marginTop: 4,
    marginBottom: 8,
  },
});
