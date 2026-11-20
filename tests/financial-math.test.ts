/** Portfolio calculations, validation and request behavior for the simplified model. */

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
import type { PortfolioPosition } from '@/types/database';
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

describe('Optional cash and open-position valuation', () => {
  const position: PortfolioPosition = {
    instrument_id: 'asset', symbol: 'TEST', company_name: 'Test', market: 'BIST100', currency: 'TRY',
    is_visible: true, quantity: 10, remaining_cost_basis: 1500, average_cost: 150, realized_pnl: 1000,
    latest_price: 200, market_value: 2000, unrealized_pnl: 500, change_percent: 5, change_amount: 10,
    price_at: null, provider_code: null, price_is_stale: false, price_stale_reason: null,
  };
  const fx: FxRateInfo = { rate: 30, rateAt: null, isStale: false, staleReason: null, isAvailable: true, source: 'database' };
  it('values holdings without any cash setup', () => {
    const stats = calculatePortfolioStats([position], null, null);
    expect(stats.totalPortfolioValueTry).toBe(2000);
    expect(stats.unrealizedPnlTry).toBe(500);
    expect(stats.totalPnlPct).toBeCloseTo(100 / 3);
    expect(stats.isValuationComplete).toBe(true);
    expect(stats.valuationWarning).toBeNull();
  });
  it('adds optional manual cash without double-counting realized profit', () => {
    const stats = calculatePortfolioStats([position], { tryBalance: 500, usdBalance: 10 }, fx, { tryPnl: 1000, usdPnl: 5 });
    expect(stats.totalPortfolioValueTry).toBe(2800);
    expect(stats.totalRealizedPnlTry).toBe(1150);
    expect(stats.unrealizedPnlTry).toBe(500);
    expect(stats.dailyPnlTry).toBe(100);
  });
  it('keeps closed-position sale profit even with no open holdings', () => {
    const stats = calculatePortfolioStats([], null, null, { tryPnl: 1400, usdPnl: 0 });
    expect(stats.totalPortfolioValueTry).toBe(0);
    expect(stats.totalRealizedPnlTry).toBe(1400);
  });
  it('does not invent USD valuation when FX is missing', () => {
    const stats = calculatePortfolioStats([position], { tryBalance: 50, usdBalance: 10 }, null, { tryPnl: 0, usdPnl: 5 });
    expect(stats.totalPortfolioValueTry).toBeNull();
    expect(stats.cashValueTry).toBeNull();
    expect(stats.totalRealizedPnlTry).toBeNull();
    expect(stats.knownPortfolioValueTry).toBe(2050);
  });
  it('keeps absent prices distinct from zero and excludes empty cash allocations', () => {
    expect(calculatePortfolioStats([{ ...position, latest_price: null }], null, null).positionsMarketValueTry).toBeNull();
    const allocations = calculateAllocationItems(calculatePortfolioStats([position], null, null));
    expect(allocations.map(a => a.key)).toEqual(['BIST']);
    expect(calculateAllocationItems(calculatePortfolioStats([], { tryBalance: 500, usdBalance: 0 }, null))[0].key).toBe('CASH');
  });
});
