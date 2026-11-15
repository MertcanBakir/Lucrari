/**
 * Lucrari — Portfolio View State Decision Engine Tests
 * 
 * Validates dashboard display state resolution across all lifecycle scenarios:
 * 1. Initial load error -> shows full PortfolioErrorView
 * 2. Background refresh error on portfolio with positions -> displays stale data, does NOT show full error screen
 * 3. Background refresh error on cash-only portfolio (0 positions) -> displays stale data, does NOT show full error screen
 * 4. Background refresh error on fully empty portfolio -> displays stale data, does NOT show full error screen
 */

import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';
import { resolvePortfolioViewState } from '../utils/portfolio-view-state';

describe('Portfolio View State Resolution', () => {
  it('Scenario 1: Initial load failure should trigger full error view', () => {
    const state = resolvePortfolioViewState({
      isLoading: false,
      isRefreshing: false,
      error: 'Bağlantı kurulamadı.',
      hasLoadedSuccessfully: false,
    });

    assert.strictEqual(state.isInitialError, true);
    assert.strictEqual(state.isInitialLoading, false);
    assert.strictEqual(state.showStaleBanner, false);
    assert.strictEqual(state.isReady, false);
  });

  it('Scenario 2: Refresh failure on portfolio with positions should retain view and show stale banner', () => {
    const state = resolvePortfolioViewState({
      isLoading: false,
      isRefreshing: false,
      error: 'Ağ hatası: Veriler güncellenemedi.',
      hasLoadedSuccessfully: true,
    });

    assert.strictEqual(state.isInitialError, false);
    assert.strictEqual(state.isInitialLoading, false);
    assert.strictEqual(state.showStaleBanner, true);
    assert.strictEqual(state.isReady, true);
  });

  it('Scenario 3: Refresh failure on cash-only portfolio (0 positions) should retain view and show stale banner', () => {
    // Portfolios with 0 positions but positive cash must NOT revert to initial error screen
    const state = resolvePortfolioViewState({
      isLoading: false,
      isRefreshing: false,
      error: 'Ağ zaman aşımına uğradı.',
      hasLoadedSuccessfully: true,
    });

    assert.strictEqual(state.isInitialError, false);
    assert.strictEqual(state.isInitialLoading, false);
    assert.strictEqual(state.showStaleBanner, true);
    assert.strictEqual(state.isReady, true);
  });

  it('Scenario 4: Refresh failure on freshly created empty portfolio should retain view and show stale banner', () => {
    const state = resolvePortfolioViewState({
      isLoading: false,
      isRefreshing: false,
      error: 'Geçici sunucu hatası.',
      hasLoadedSuccessfully: true,
    });

    assert.strictEqual(state.isInitialError, false);
    assert.strictEqual(state.isInitialLoading, false);
    assert.strictEqual(state.showStaleBanner, true);
    assert.strictEqual(state.isReady, true);
  });

  it('Normal loading state before first data arrives', () => {
    const state = resolvePortfolioViewState({
      isLoading: true,
      isRefreshing: false,
      error: null,
      hasLoadedSuccessfully: false,
    });

    assert.strictEqual(state.isInitialLoading, true);
    assert.strictEqual(state.isInitialError, false);
    assert.strictEqual(state.isReady, false);
  });

  it('Normal active state with fresh data', () => {
    const state = resolvePortfolioViewState({
      isLoading: false,
      isRefreshing: false,
      error: null,
      hasLoadedSuccessfully: true,
    });

    assert.strictEqual(state.isInitialLoading, false);
    assert.strictEqual(state.isInitialError, false);
    assert.strictEqual(state.showStaleBanner, false);
    assert.strictEqual(state.isReady, true);
  });
});
