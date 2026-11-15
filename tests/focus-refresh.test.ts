/**
 * Lucrari — Focus Refresh Decision Engine Unit Tests
 * 
 * Tests pure focus refresh evaluation and boundary conditions:
 * - Loading state prevents focus refetch
 * - Refreshing state prevents focus refetch
 * - Error state prevents focus refetch loops
 * - Initial load (lastFetchedTimestamp <= 0) prevents double fetch on focus
 * - Fresh data (within TTL) prevents unnecessary network requests
 * - Stale data (beyond TTL) triggers focus refresh
 */

import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';
import { shouldRefreshOnFocus, FOCUS_REFETCH_STALE_TTL_MS } from '../utils/focus-refresh';

describe('Focus Refresh Decision Engine', () => {
  const baseParams = {
    isLoading: false,
    isRefreshing: false,
    error: null,
    lastFetchedTimestamp: 100000,
    now: 140000, // 40s later (> 30s TTL)
    ttlMs: FOCUS_REFETCH_STALE_TTL_MS,
  };

  it('should return true when data is stale and no errors/loading', () => {
    const result = shouldRefreshOnFocus(baseParams);
    assert.strictEqual(result, true);
  });

  it('should return false when currently loading (prevents double fetch during initial load)', () => {
    const result = shouldRefreshOnFocus({
      ...baseParams,
      isLoading: true,
      lastFetchedTimestamp: 0,
    });
    assert.strictEqual(result, false);
  });

  it('should return false when initial fetch is pending (lastFetchedTimestamp = 0)', () => {
    const result = shouldRefreshOnFocus({
      ...baseParams,
      lastFetchedTimestamp: 0,
    });
    assert.strictEqual(result, false);
  });

  it('should return false when lastFetchedTimestamp is negative', () => {
    const result = shouldRefreshOnFocus({
      ...baseParams,
      lastFetchedTimestamp: -1,
    });
    assert.strictEqual(result, false);
  });

  it('should return false when currently pull-refreshing', () => {
    const result = shouldRefreshOnFocus({
      ...baseParams,
      isRefreshing: true,
    });
    assert.strictEqual(result, false);
  });

  it('should return false when in error state (prevents infinite tab switch error loops)', () => {
    const resultStringError = shouldRefreshOnFocus({
      ...baseParams,
      error: 'Network request failed',
    });
    assert.strictEqual(resultStringError, false);

    const resultObjError = shouldRefreshOnFocus({
      ...baseParams,
      error: new Error('Database offline'),
    });
    assert.strictEqual(resultObjError, false);
  });

  it('should return false when data is fresh (elapsed < TTL)', () => {
    const result = shouldRefreshOnFocus({
      ...baseParams,
      now: 115000, // 15s elapsed (< 30s TTL)
    });
    assert.strictEqual(result, false);
  });

  it('should return true exactly at TTL threshold boundary', () => {
    const result = shouldRefreshOnFocus({
      ...baseParams,
      now: 130000, // exactly 30s elapsed
    });
    assert.strictEqual(result, true);
  });
});
