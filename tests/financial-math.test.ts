/**
 * Automated Unit Tests for Pure Financial Mathematics & Portfolio Valuation
 * 
 * Validates:
 * - Currency conversions with live FX rates (and null handling when rate is missing)
 * - Position metrics (live price vs missing price)
 * - Strict product cash model: Total Portfolio Value = Positions Market Value + Available Cash
 * - BUY/SELL composition shifts without double-counting realized PnL
 * - DEPOSIT/WITHDRAWAL effects on total portfolio value
 * - Dynamic USD/TRY rate effects on USD assets and USD cash
 * - Uninitialized cash account handling
 * - Asset allocation ensuring uninitialized/zero cash does not create false slices
 */

import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';
import {
  convertUsdToTry,
  convertTryToUsd,
  convertPositionMonetaryValue,
  formatConvertedCurrency,
  formatConvertedPnlAmount,
  computePositionMetrics,
  calculatePortfolioStats,
  calculateAllocationItems,
} from '@/utils/financial-math';
import type { PortfolioPosition, PortfolioCashState } from '@/types/database';
import type { FxRateInfo } from '@/services/portfolio/fx-rate-service';

describe('Financial Math & Portfolio Valuation Engine', () => {
  describe('convertUsdToTry & convertTryToUsd', () => {
    it('should convert USD to TRY accurately using live rate', () => {
      const result = convertUsdToTry(100, 35.50);
      assert.equal(result, 3550);
    });

    it('should convert TRY to USD accurately using live rate', () => {
      const result = convertTryToUsd(3550, 35.50);
      assert.equal(result, 100);
    });

    it('should return null when rate is null, zero, negative or NaN', () => {
      assert.equal(convertUsdToTry(100, null), null);
      assert.equal(convertUsdToTry(100, 0), null);
      assert.equal(convertUsdToTry(100, -35), null);
      assert.equal(convertUsdToTry(100, NaN), null);

      assert.equal(convertTryToUsd(3500, null), null);
      assert.equal(convertTryToUsd(3500, 0), null);
      assert.equal(convertTryToUsd(3500, -35), null);
    });
  });

  describe('computePositionMetrics', () => {
    const validTryPosition: PortfolioPosition = {
      instrument_id: 'pos-1',
      symbol: 'THYAO',
      company_name: 'Türk Hava Yolları',
      market: 'BIST100',
      currency: 'TRY',
      is_visible: true,
      quantity: 100,
      remaining_cost_basis: 30000,
      average_cost: 300,
      realized_pnl: 0,
      latest_price: 340,
      change_percent: 2.5,
      change_amount: 8.5,
      price_at: '2026-08-26T10:00:00Z',
      price_is_stale: false,
      price_stale_reason: null,
      provider_code: null,
      market_value: 34000,
      unrealized_pnl: 4000,
    };

    it('should compute complete metrics when latest_price is present', () => {
      const metrics = computePositionMetrics(validTryPosition, 'TOTAL', 'TRY', 35.0);

      assert.equal(metrics.hasMarketPrice, true);
      assert.equal(metrics.marketValueNative, 34000);
      assert.equal(metrics.unrealizedPnlNative, 4000);
      assert.equal(metrics.unrealizedPnlPct?.toFixed(2), '13.33');
      assert.equal(metrics.isPositive, true);
    });

    it('should NOT use average_cost as market price when latest_price is null', () => {
      const positionWithoutPrice: PortfolioPosition = {
        ...validTryPosition,
        latest_price: null,
        market_value: null,
        unrealized_pnl: null,
      };

      const metrics = computePositionMetrics(positionWithoutPrice, 'TOTAL', 'TRY', 35.0);

      assert.equal(metrics.hasMarketPrice, false);
      assert.equal(metrics.latestPrice, null);
      assert.equal(metrics.marketValueNative, null, 'Must NOT fabricate market value from average cost');
      assert.equal(metrics.unrealizedPnlNative, null);
      assert.equal(metrics.marketValueDisplay, '—');
      assert.equal(metrics.totalCostNative, 30000, 'Cost basis must still be preserved');
    });
  });

  describe('calculatePortfolioStats — Product Cash Model Rules', () => {
    const fxInfo35: FxRateInfo = {
      rate: 35.0,
      rateAt: '2026-08-26T10:00:00Z',
      isStale: false,
      staleReason: null,
      isAvailable: true,
      source: 'database',
    };

    const tryPosition: PortfolioPosition = {
      instrument_id: 'p1',
      symbol: 'ASELS',
      company_name: 'Aselsan',
      market: 'BIST100',
      currency: 'TRY',
      is_visible: true,
      quantity: 1000,
      remaining_cost_basis: 50000,
      average_cost: 50,
      realized_pnl: 0,
      latest_price: 60,
      change_percent: 2.0,
      change_amount: 1.2,
      price_at: '2026-08-26T10:00:00Z',
      price_is_stale: false,
      price_stale_reason: null,
      provider_code: null,
      market_value: 60000,
      unrealized_pnl: 10000,
    };

    const usdPosition: PortfolioPosition = {
      instrument_id: 'p2',
      symbol: 'AAPL',
      company_name: 'Apple',
      market: 'NASDAQ100',
      currency: 'USD',
      is_visible: true,
      quantity: 10,
      remaining_cost_basis: 2000,
      average_cost: 200,
      realized_pnl: 0,
      latest_price: 220,
      change_percent: 1.0,
      change_amount: 2.2,
      price_at: '2026-08-26T10:00:00Z',
      price_is_stale: false,
      price_stale_reason: null,
      provider_code: null,
      market_value: 2200,
      unrealized_pnl: 200,
    };

    it('Scenario 1: Positions 1,000,000 + Cash 150,000 = Total Portfolio Value 1,150,000', () => {
      const largePos: PortfolioPosition = {
        ...tryPosition,
        quantity: 10000,
        latest_price: 100,
        market_value: 1000000,
        remaining_cost_basis: 800000,
      };

      const cashState: PortfolioCashState = {
        portfolioId: 'port-1',
        isInitialized: true,
        balances: [
          { currency: 'TRY', openingBalance: 150000, currentBalance: 150000, initializedAt: '2026-08-26' },
          { currency: 'USD', openingBalance: 0, currentBalance: 0, initializedAt: '2026-08-26' },
        ],
      };

      const stats = calculatePortfolioStats([largePos], cashState, fxInfo35);

      assert.equal(stats.isValuationComplete, true);
      assert.equal(stats.positionsMarketValueTry, 1000000);
      assert.equal(stats.cashValueTry, 150000);
      assert.equal(stats.totalPortfolioValueTry, 1150000, 'Total must equal positions + cash');
      assert.equal(stats.totalCostTry, 800000, 'Cost basis must NOT include cash');
      assert.equal(stats.unrealizedPnlTry, 200000);
    });

    it('Scenario 2: After 100,000 BUY, Positions 1,100,000 + Cash 50,000 = Total Portfolio Value 1,150,000', () => {
      // Buying 100k increases position by 100k and decreases cash by 100k
      const largerPos: PortfolioPosition = {
        ...tryPosition,
        quantity: 11000,
        latest_price: 100,
        market_value: 1100000,
        remaining_cost_basis: 900000,
      };

      const cashStateAfterBuy: PortfolioCashState = {
        portfolioId: 'port-1',
        isInitialized: true,
        balances: [
          { currency: 'TRY', openingBalance: 150000, currentBalance: 50000, initializedAt: '2026-08-26' },
          { currency: 'USD', openingBalance: 0, currentBalance: 0, initializedAt: '2026-08-26' },
        ],
      };

      const stats = calculatePortfolioStats([largerPos], cashStateAfterBuy, fxInfo35);

      assert.equal(stats.positionsMarketValueTry, 1100000);
      assert.equal(stats.cashValueTry, 50000);
      assert.equal(stats.totalPortfolioValueTry, 1150000, 'Total net worth remains 1,150,000 after buy');
    });

    it('Scenario 3: DEPOSIT increases cash and total portfolio value', () => {
      // Depositing 50,000 increases cash to 200,000 and total portfolio to 1,200,000
      const largePos: PortfolioPosition = {
        ...tryPosition,
        quantity: 10000,
        latest_price: 100,
        market_value: 1000000,
        remaining_cost_basis: 800000,
      };

      const cashStateAfterDeposit: PortfolioCashState = {
        portfolioId: 'port-1',
        isInitialized: true,
        balances: [
          { currency: 'TRY', openingBalance: 150000, currentBalance: 200000, initializedAt: '2026-08-26' },
          { currency: 'USD', openingBalance: 0, currentBalance: 0, initializedAt: '2026-08-26' },
        ],
      };

      const stats = calculatePortfolioStats([largePos], cashStateAfterDeposit, fxInfo35);

      assert.equal(stats.positionsMarketValueTry, 1000000);
      assert.equal(stats.cashValueTry, 200000);
      assert.equal(stats.totalPortfolioValueTry, 1200000);
    });

    it('Scenario 4: WITHDRAWAL decreases cash and total portfolio value', () => {
      const largePos: PortfolioPosition = {
        ...tryPosition,
        quantity: 10000,
        latest_price: 100,
        market_value: 1000000,
        remaining_cost_basis: 800000,
      };

      const cashStateAfterWithdrawal: PortfolioCashState = {
        portfolioId: 'port-1',
        isInitialized: true,
        balances: [
          { currency: 'TRY', openingBalance: 150000, currentBalance: 100000, initializedAt: '2026-08-26' },
          { currency: 'USD', openingBalance: 0, currentBalance: 0, initializedAt: '2026-08-26' },
        ],
      };

      const stats = calculatePortfolioStats([largePos], cashStateAfterWithdrawal, fxInfo35);

      assert.equal(stats.positionsMarketValueTry, 1000000);
      assert.equal(stats.cashValueTry, 100000);
      assert.equal(stats.totalPortfolioValueTry, 1100000);
    });

    it('Scenario 5: Realized PnL is NOT added a second time to total portfolio value', () => {
      // If a position was sold with 25,000 realized PnL, the proceeds are already in cash (e.g. 175,000).
      // Total portfolio value is simply positions (0) + cash (175,000) = 175,000.
      // Realized PnL must NOT be added again to make it 200,000!
      const closedPosition: PortfolioPosition = {
        ...tryPosition,
        quantity: 0,
        market_value: 0,
        realized_pnl: 25000,
      };

      const cashState: PortfolioCashState = {
        portfolioId: 'port-1',
        isInitialized: true,
        balances: [
          { currency: 'TRY', openingBalance: 150000, currentBalance: 175000, initializedAt: '2026-08-26' },
          { currency: 'USD', openingBalance: 0, currentBalance: 0, initializedAt: '2026-08-26' },
        ],
      };

      const stats = calculatePortfolioStats([closedPosition], cashState, fxInfo35);

      assert.equal(stats.totalRealizedPnlTry, 25000);
      assert.equal(stats.positionsMarketValueTry, 0);
      assert.equal(stats.cashValueTry, 175000);
      assert.equal(stats.totalPortfolioValueTry, 175000, 'Total portfolio value must NOT double-count realized PnL');
    });

    it('Scenario 6: TRY and USD cash combined accurately using live FX rate', () => {
      const cashState: PortfolioCashState = {
        portfolioId: 'port-1',
        isInitialized: true,
        balances: [
          { currency: 'TRY', openingBalance: 10000, currentBalance: 10000, initializedAt: '2026-08-26' },
          { currency: 'USD', openingBalance: 500, currentBalance: 500, initializedAt: '2026-08-26' }, // 500 * 35 = 17500 TRY
        ],
      };

      // Try pos = 60,000 TRY
      // Usd pos = 2,200 USD * 35 = 77,000 TRY
      // Positions Total = 137,000 TRY
      // Cash Total = 10,000 + 17,500 = 27,500 TRY
      // Total Portfolio Value = 137,000 + 27,500 = 164,500 TRY

      const stats = calculatePortfolioStats([tryPosition, usdPosition], cashState, fxInfo35);

      assert.equal(stats.isValuationComplete, true);
      assert.equal(stats.positionsMarketValueTry, 137000);
      assert.equal(stats.cashValueTry, 27500);
      assert.equal(stats.totalPortfolioValueTry, 164500);
    });

    it('Scenario 7: Uninitialized cash accounts produce partial valuation and warning', () => {
      const uninitializedCashState: PortfolioCashState = {
        portfolioId: 'port-legacy',
        isInitialized: false,
        balances: [
          { currency: 'TRY', openingBalance: null, currentBalance: null, initializedAt: null },
          { currency: 'USD', openingBalance: null, currentBalance: null, initializedAt: null },
        ],
      };

      const stats = calculatePortfolioStats([tryPosition], uninitializedCashState, fxInfo35);

      assert.equal(stats.isCashInitialized, false);
      assert.equal(stats.isValuationComplete, false);
      assert.equal(stats.cashValueTry, null);
      assert.equal(stats.totalPortfolioValueTry, null, 'Total portfolio value must be null when cash is uninitialized');
      assert.equal(stats.knownPositionsMarketValueTry, 60000);
      assert.ok(stats.valuationWarning?.includes('Nakit bakiyesi kurulumu gerekli'));
    });

    it('Scenario 8: Missing FX rate produces partial valuation for USD cash and USD positions', () => {
      const cashWithUsd: PortfolioCashState = {
        portfolioId: 'port-1',
        isInitialized: true,
        balances: [
          { currency: 'TRY', openingBalance: 10000, currentBalance: 10000, initializedAt: '2026-08-26' },
          { currency: 'USD', openingBalance: 500, currentBalance: 500, initializedAt: '2026-08-26' },
        ],
      };

      const stats = calculatePortfolioStats([tryPosition, usdPosition], cashWithUsd, null);

      assert.equal(stats.isValuationComplete, false);
      assert.equal(stats.cashValueTry, null);
      assert.equal(stats.totalPortfolioValueTry, null);
      assert.ok(stats.valuationWarning?.includes('USD/TRY kuru'));
    });
  });

  describe('calculateAllocationItems', () => {
    it('should include positive CASH slice in asset allocation when initialized', () => {
      const stats = calculatePortfolioStats(
        [
          {
            instrument_id: 'p1',
            symbol: 'THYAO',
            company_name: 'THY',
            market: 'BIST100',
            currency: 'TRY',
            is_visible: true,
            quantity: 100,
            remaining_cost_basis: 10000,
            average_cost: 100,
            realized_pnl: 0,
            latest_price: 100,
            change_percent: 0,
            change_amount: 0,
            price_at: null,
            price_is_stale: false,
            price_stale_reason: null,
            provider_code: null,
            market_value: 10000,
            unrealized_pnl: 0,
          },
        ],
        {
          portfolioId: 'port-1',
          isInitialized: true,
          balances: [
            { currency: 'TRY', openingBalance: 10000, currentBalance: 10000, initializedAt: '2026-08-26' },
            { currency: 'USD', openingBalance: 0, currentBalance: 0, initializedAt: '2026-08-26' },
          ],
        },
        null
      );

      const items = calculateAllocationItems(stats);

      assert.equal(items.length, 2);
      assert.equal(items[0].key, 'BIST');
      assert.equal(items[0].pct, 50);
      assert.equal(items[1].key, 'CASH');
      assert.equal(items[1].pct, 50);
    });

    it('should NOT include CASH slice when cash is uninitialized or zero', () => {
      const stats = calculatePortfolioStats(
        [
          {
            instrument_id: 'p1',
            symbol: 'THYAO',
            company_name: 'THY',
            market: 'BIST100',
            currency: 'TRY',
            is_visible: true,
            quantity: 100,
            remaining_cost_basis: 10000,
            average_cost: 100,
            realized_pnl: 0,
            latest_price: 100,
            change_percent: 0,
            change_amount: 0,
            price_at: null,
            price_is_stale: false,
            price_stale_reason: null,
            provider_code: null,
            market_value: 10000,
            unrealized_pnl: 0,
          },
        ],
        {
          portfolioId: 'port-1',
          isInitialized: false,
          balances: [],
        },
        null
      );

      const items = calculateAllocationItems(stats);

      assert.equal(items.length, 1);
      assert.equal(items[0].key, 'BIST');
      assert.equal(items[0].pct, 100);
      assert.ok(!items.some((i) => i.key === 'CASH'));
    });
  });

  describe('convertPositionMonetaryValue, formatConvertedCurrency & formatConvertedPnlAmount', () => {
    it('convertPositionMonetaryValue should handle native match, conversion, zero and missing rates', () => {
      // Matching currency returns raw value directly
      assert.equal(convertPositionMonetaryValue(500, 'TRY', 'TRY', null), 500);
      assert.equal(convertPositionMonetaryValue(0, 'TRY', 'TRY', null), 0);
      assert.equal(convertPositionMonetaryValue(100, 'USD', 'USD', null), 100);

      // USD to TRY with valid rate
      assert.equal(convertPositionMonetaryValue(100, 'USD', 'TRY', 35.0), 3500);

      // TRY to USD with valid rate
      assert.equal(convertPositionMonetaryValue(3500, 'TRY', 'USD', 35.0), 100);

      // Cross currency with missing rate returns null
      assert.equal(convertPositionMonetaryValue(100, 'USD', 'TRY', null), null);
      assert.equal(convertPositionMonetaryValue(3500, 'TRY', 'USD', null), null);
      assert.equal(convertPositionMonetaryValue(null, 'USD', 'TRY', 35.0), null);
    });

    it('should return "—" for TRY position when displayed in USD mode with missing FX rate', () => {
      // 3500 TRY position with null FX rate
      const formattedValue = formatConvertedCurrency(3500, 'TRY', 'USD', null);
      assert.equal(formattedValue, '—');

      const formattedPnl = formatConvertedPnlAmount(500, 'TRY', 'USD', null, 'G');
      assert.equal(formattedPnl, '—');
    });

    it('should return "—" for USD position when displayed in TRY mode with missing FX rate', () => {
      // 100 USD position with null FX rate
      const formattedValue = formatConvertedCurrency(100, 'USD', 'TRY', null);
      assert.equal(formattedValue, '—');

      const formattedPnl = formatConvertedPnlAmount(10, 'USD', 'TRY', null, 'T');
      assert.equal(formattedPnl, '—');
    });

    it('should format real zero PnL accurately without converting to "—"', () => {
      // Real zero PnL in native TRY
      const tryZero = formatConvertedPnlAmount(0, 'TRY', 'TRY', null, 'G');
      assert.equal(tryZero, 'G: +₺0,00');

      // Real zero PnL in USD with valid rate
      const usdZero = formatConvertedPnlAmount(0, 'USD', 'TRY', 35.0, 'T');
      assert.equal(usdZero, 'T: +₺0,00');
    });

    it('should distinguish missing FX rate from real zero PnL', () => {
      // Missing FX rate must return "—", never "+₺0,00" or "+$0.00"
      const missingTryToUsd = formatConvertedPnlAmount(0, 'TRY', 'USD', null, 'G');
      assert.equal(missingTryToUsd, '—');

      const missingUsdToTry = formatConvertedPnlAmount(0, 'USD', 'TRY', null, 'T');
      assert.equal(missingUsdToTry, '—');
    });

    it('should correctly convert and format monetary values with valid FX rate', () => {
      // 100 USD at 35.50 FX rate converted to TRY
      const tryFormatted = formatConvertedCurrency(100, 'USD', 'TRY', 35.50);
      assert.equal(tryFormatted, '₺3.550,00');

      // 3550 TRY at 35.50 FX rate converted to USD
      const usdFormatted = formatConvertedCurrency(3550, 'TRY', 'USD', 35.50);
      assert.equal(usdFormatted, '$100,00');

      // Positive PnL
      const pnlFormatted = formatConvertedPnlAmount(50, 'USD', 'TRY', 35.0, 'G');
      assert.equal(pnlFormatted, 'G: +₺1.750,00');

      // Negative PnL
      const lossFormatted = formatConvertedPnlAmount(-50, 'USD', 'TRY', 35.0, 'T');
      assert.equal(lossFormatted, 'T: -₺1.750,00');
    });
  });
});
