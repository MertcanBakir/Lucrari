/**
 * Lucrari — System and Data Health Comprehensive Unit & Service Behavior Tests
 * 
 * Validates:
 * 1. RPC name is strictly 'get_mobile_system_health'.
 * 2. Operational tables ('refresh_runs', 'provider_run_results') are NEVER queried.
 * 3. 3 concurrent calls share 1 auth/RPC in-flight request.
 * 4. Force refresh does not bypass an active in-flight promise.
 * 5. Fresh cache within TTL serves data with zero new RPC calls.
 * 6. Post-TTL calls trigger a fresh RPC call.
 * 7. Manual force refresh triggers a fresh RPC call even when cache is fresh.
 * 8. RPC error with no cache throws safe sanitized user error.
 * 9. Auth failure with no cache throws safe sanitized auth error.
 * 10. RPC error with existing cache returns stale report and updates cache snapshot without advancing timestamp.
 * 11. Subsequent cache-hit within TTL returns stale data from cache.
 * 12. Subsequent successful retry clears stale status and updates cache snapshot.
 * 13. Failed in-flight request is cleared so subsequent retry succeeds.
 * 14. Non-array response throws controlled contract error.
 * 15. Single unknown message_code with healthy other fields fails closed to unknown, sets isIncomplete=true, and forces overall unknown.
 * 16. Invalid checked_at, health_status, execution_status, non-boolean is_overdue fail closed.
 * 17. Valid never_run item is not treated as a contract error (isIncomplete=false).
 * 18. Missing expected jobs are synthesized as unknown with isIncomplete=true.
 * 19. Unknown extra jobs outside catalog allowlist are ignored.
 * 20. Duplicate job codes are deterministically resolved by newest checked_at.
 * 21. healthy + never_run evaluates to overall unknown.
 * 22. healthy + skipped/inactive evaluates to overall healthy.
 * 23. Warning + failed job does not label failed job as "Kısmi".
 * 24. All required system health icons exist in ICON_MAPPING with valid Material Icons.
 * 25. Subscribers receive cache updates across screens (Menu <-> Detail sync).
 * 26. Section grouping orders categories correctly.
 * 27. Duration and date formatters handle edge cases gracefully.
 */

import { describe, it, beforeEach, afterEach } from '@jest/globals';
import assert from 'node:assert/strict';
import {
  EXPECTED_JOBS_CATALOG,
  normalizeSystemHealthResponse,
  normalizeJobHealthItem,
  evaluateOverallHealth,
  groupJobsIntoSections,
  formatJobExecutionStatus,
  formatJobMessageCode,
  formatDurationSeconds,
  formatSystemHealthDateTime,
} from '../utils/system-health-formatters';
import {
  fetchSystemHealth,
  clearSystemHealthCache,
  subscribeSystemHealth,
  getSystemHealthCacheSnapshot,
  SYSTEM_HEALTH_CACHE_TTL_MS,
} from '../services/system-health/system-health-service';
import {
  setSupabaseClientForTesting,
  resetSupabaseClientForTesting,
} from '../services/supabase/client';
import { resetAuthLock } from '../services/auth/auth-service';
import { ICON_MAPPING } from '../constants/icon-mapping';
import type { NormalizedJobHealthItem } from '../types/system-health';

describe('System and Data Health Comprehensive Test Suite', () => {
  const sampleValidRpcData = EXPECTED_JOBS_CATALOG.map((job) => ({
    job_code: job.jobCode,
    category: job.category,
    display_name: job.displayName,
    sort_order: job.sortOrder,
    execution_status: 'success' as const,
    health_status: 'healthy' as const,
    last_started_at: '2026-08-29T10:00:00Z',
    last_finished_at: '2026-08-29T10:00:42Z',
    last_success_at: '2026-08-29T10:00:42Z',
    duration_seconds: 42,
    is_overdue: false,
    message_code: 'JOB_OK' as const,
    checked_at: '2026-08-29T10:05:00Z',
  }));

  beforeEach(() => {
    clearSystemHealthCache();
    resetAuthLock();
    resetSupabaseClientForTesting();
  });

  afterEach(() => {
    clearSystemHealthCache();
    resetAuthLock();
    resetSupabaseClientForTesting();
  });

  it('normalizes invalid, missing and numeric-string durations without changing job health', () => {
    const raw = sampleValidRpcData[0];
    for (const duration of [null, undefined, {}, ' ', 'bad', '-1', -1, Infinity]) {
      const item = normalizeJobHealthItem({ ...raw, duration_seconds: duration });
      assert.equal(item?.durationSeconds, null);
      assert.equal(item?.healthStatus, 'healthy');
    }
    assert.equal(normalizeJobHealthItem({ ...raw, duration_seconds: ' 0 ' })?.durationSeconds, 0);
    assert.equal(normalizeJobHealthItem({ ...raw, duration_seconds: ' 42.5 ' })?.durationSeconds, 42.5);
    for (const invalid of [null, false, {}, { job_code: 42 }, { job_code: 'UNKNOWN' }]) {
      assert.equal(normalizeJobHealthItem(invalid), null);
    }
    const normalized = normalizeSystemHealthResponse([
      null, false, {}, { job_code: 42 }, ...sampleValidRpcData,
    ]);
    assert.equal(normalized.isIncomplete, false);
    assert.equal(normalized.items.length, sampleValidRpcData.length);
  });

  it('prefers a valid fresh result over older or undated duplicates', () => {
    const raw = sampleValidRpcData[0];
    const invalid = { ...raw, checked_at: ' ' };
    const older = { ...raw, checked_at: '2026-08-28T10:05:00Z', health_status: 'critical' };
    const normalized = normalizeSystemHealthResponse([
      invalid, ...sampleValidRpcData, older, invalid,
    ]);
    assert.equal(normalized.isIncomplete, false);
    const result = normalized.items.find((item) => item.jobCode === raw.job_code);
    assert.equal(result?.healthStatus, 'healthy');
    assert.equal(result?.checkedAt, raw.checked_at);
  });

  it('distinguishes overall failure, overdue, running, and empty dashboard messages', () => {
    const [first, second] = normalizeSystemHealthResponse(sampleValidRpcData).items;
    const failure = { ...first, executionStatus: 'failed', healthStatus: 'critical' } as const;
    const overdue = { ...second, messageCode: 'JOB_OVERDUE', healthStatus: 'warning' } as const;
    const combined = evaluateOverallHealth([failure, overdue]);
    assert.equal(combined.status, 'critical');
    assert.deepEqual([combined.failedCount, combined.overdueCount], [1, 1]);
    assert.equal(combined.subtitle, '1 işlem başarısız, 1 veri kaynağı gecikmiş');
    assert.equal(evaluateOverallHealth([failure]).subtitle, '1 işlem başarısız');
    assert.equal(evaluateOverallHealth([overdue]).subtitle, '1 veri kaynağı gecikmiş');
    const running = evaluateOverallHealth([{ ...first, executionStatus: 'running' }]);
    assert.equal(running.status, 'running');
    assert.equal(running.runningCount, 1);
    assert.equal(evaluateOverallHealth([], first.checkedAt).status, 'unknown');
    assert.match(evaluateOverallHealth([], first.checkedAt).subtitle, /^Son kontrol:/);
    assert.equal(evaluateOverallHealth([]).subtitle, 'Henüz durum verisi bulunmuyor.');
    assert.equal(evaluateOverallHealth([first]).subtitle, 'Tüm veri akışları sağlıklı');
  });

  it('describes backend job outcomes and renders whole-minute durations', () => {
    const labels = {
      JOB_OK: 'Veriler güncel.',
      JOB_PARTIAL: 'İşlem tamamlandı ancak bazı veriler güncellenemedi.',
      JOB_FAILED: 'Son güncelleme tamamlanamadı.',
      JOB_OVERDUE: 'Beklenen güncelleme gecikmiş görünüyor.',
      JOB_RUNNING: 'Güncelleme şu anda devam ediyor.',
      JOB_SKIPPED: 'Bu çalışma planlı olarak atlandı.',
      JOB_NEVER_RUN: 'İlk çalışma sonucu henüz oluşmadı.',
      JOB_STATUS_UNAVAILABLE: 'Bu servis için durum bilgisi doğrulanamadı.',
    } as const;
    for (const code of Object.keys(labels) as (keyof typeof labels)[]) {
      assert.equal(formatJobMessageCode(code), labels[code]);
    }
    assert.equal(formatDurationSeconds(120), '2 dk');
    assert.equal(formatDurationSeconds(undefined), '—');
    assert.equal(formatDurationSeconds(Infinity), '—');
  });

  describe('Service Architecture, Security & Deduplication', () => {
    it('1. RPC name called must be strictly get_mobile_system_health', async () => {
      const rpcCalls: string[] = [];

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: 'usr-1' } } },
            error: null,
          }),
        },
        rpc: async (fnName: string) => {
          rpcCalls.push(fnName);
          return { data: sampleValidRpcData, error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      await fetchSystemHealth();

      assert.strictEqual(rpcCalls.length, 1);
      assert.strictEqual(rpcCalls[0], 'get_mobile_system_health');
    });

    it('2. Operational tables (refresh_runs, provider_run_results) are NEVER queried', async () => {
      const fromCalls: string[] = [];

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: 'usr-1' } } },
            error: null,
          }),
        },
        from: (tableName: string) => {
          fromCalls.push(tableName);
          return { select: () => Promise.resolve({ data: [], error: null }) };
        },
        rpc: async () => ({ data: sampleValidRpcData, error: null }),
      };

      setSupabaseClientForTesting(mockClient);

      await fetchSystemHealth();

      assert.strictEqual(fromCalls.length, 0, 'No direct table access should occur');
    });

    it('3. Three concurrent calls share exactly 1 auth/RPC in-flight request', async () => {
      let rpcCount = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: 'usr-1' } } },
            error: null,
          }),
        },
        rpc: async () => {
          rpcCount++;
          await new Promise((r) => setTimeout(r, 10));
          return { data: sampleValidRpcData, error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      const [r1, r2, r3] = await Promise.all([
        fetchSystemHealth(),
        fetchSystemHealth(),
        fetchSystemHealth(),
      ]);

      assert.strictEqual(rpcCount, 1);
      assert.strictEqual(r1.items.length, 8);
      assert.strictEqual(r2.items.length, 8);
      assert.strictEqual(r3.items.length, 8);
    });

    it('4. Force refresh does not bypass an active in-flight request', async () => {
      let rpcCount = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: 'usr-1' } } },
            error: null,
          }),
        },
        rpc: async () => {
          rpcCount++;
          await new Promise((r) => setTimeout(r, 20));
          return { data: sampleValidRpcData, error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      const p1 = fetchSystemHealth();
      const p2 = fetchSystemHealth({ forceRefresh: true });

      await Promise.all([p1, p2]);

      assert.strictEqual(rpcCount, 1);
    });

    it('5. Fresh cache within TTL serves data with zero new RPC calls', async () => {
      let rpcCount = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: 'usr-1' } } },
            error: null,
          }),
        },
        rpc: async () => {
          rpcCount++;
          return { data: sampleValidRpcData, error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      await fetchSystemHealth();
      assert.strictEqual(rpcCount, 1);

      const report2 = await fetchSystemHealth();
      assert.strictEqual(rpcCount, 1);
      assert.strictEqual(report2.items.length, 8);
    });

    it('6. Post-TTL calls trigger a fresh RPC call', async () => {
      let rpcCount = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: 'usr-1' } } },
            error: null,
          }),
        },
        rpc: async () => {
          rpcCount++;
          return { data: sampleValidRpcData, error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      await fetchSystemHealth();
      assert.strictEqual(rpcCount, 1);

      const originalNow = Date.now;
      try {
        Date.now = () => originalNow() + SYSTEM_HEALTH_CACHE_TTL_MS + 1000;
        await fetchSystemHealth();
        assert.strictEqual(rpcCount, 2);
      } finally {
        Date.now = originalNow;
      }
    });

    it('7. Manual force refresh triggers a fresh RPC call even when cache is fresh', async () => {
      let rpcCount = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: 'usr-1' } } },
            error: null,
          }),
        },
        rpc: async () => {
          rpcCount++;
          return { data: sampleValidRpcData, error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      await fetchSystemHealth();
      assert.strictEqual(rpcCount, 1);

      await fetchSystemHealth({ forceRefresh: true });
      assert.strictEqual(rpcCount, 2);
    });

    it('8. RPC error with no cache throws safe sanitized user error without leaking internal details', async () => {
      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: 'usr-1' } } },
            error: null,
          }),
        },
        rpc: async () => ({
          data: null,
          error: {
            code: 'PGRST116',
            message: 'database connection timeout at postgres://internal:5432/db',
          },
        }),
      };

      setSupabaseClientForTesting(mockClient);

      await assert.rejects(
        async () => {
          await fetchSystemHealth();
        },
        (err: Error) => {
          assert.strictEqual(err.message, 'Sistem durumu bilgisi alınamadı.');
          assert.ok(!err.message.includes('postgres'));
          assert.ok(!err.message.includes('PGRST116'));
          return true;
        }
      );
    });

    it('9. Auth failure with no cache throws safe sanitized auth error', async () => {
      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: null },
            error: null,
          }),
          signInAnonymously: async () => ({
            data: { session: null, user: null },
            error: { message: 'JWT expired eyJhbGciOiJIUzI1Ni...' },
          }),
        },
        rpc: async () => ({ data: sampleValidRpcData, error: null }),
      };

      setSupabaseClientForTesting(mockClient);

      await assert.rejects(
        async () => {
          await fetchSystemHealth();
        },
        (err: Error) => {
          assert.strictEqual(err.message, 'Oturum doğrulanamadı. Lütfen tekrar deneyin.');
          assert.ok(!err.message.includes('JWT'));
          return true;
        }
      );
    });

    it('10-12. Stale cache consistency: error reflects stale in return, snapshot & subsequent cache-hit, then clears on retry', async () => {
      let succeed = true;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: 'usr-1' } } },
            error: null,
          }),
        },
        rpc: async () => {
          if (succeed) {
            return { data: sampleValidRpcData, error: null };
          }
          return { data: null, error: { message: 'network down' } };
        },
      };

      setSupabaseClientForTesting(mockClient);

      // Step 1: Initial successful fetch
      const firstReport = await fetchSystemHealth();
      assert.strictEqual(firstReport.isStale, false);
      const initialSnapshot = getSystemHealthCacheSnapshot();
      assert.ok(initialSnapshot);
      assert.strictEqual(initialSnapshot.report.isStale, false);
      const initialTimestamp = initialSnapshot.timestamp;

      // Step 2: Subsequent forced refresh fails
      succeed = false;
      const staleReport = await fetchSystemHealth({ forceRefresh: true });
      assert.strictEqual(staleReport.isStale, true);

      // Verify cache snapshot is updated to isStale=true without advancing timestamp
      const staleSnapshot = getSystemHealthCacheSnapshot();
      assert.ok(staleSnapshot);
      assert.strictEqual(staleSnapshot.report.isStale, true);
      assert.strictEqual(staleSnapshot.timestamp, initialTimestamp, 'Timestamp must not advance on stale transition');

      // Step 3: Subsequent cache-hit within TTL returns stale data from cache
      const cacheHitReport = await fetchSystemHealth();
      assert.strictEqual(cacheHitReport.isStale, true);

      // Step 4: Subsequent successful retry clears stale status
      succeed = true;
      const retryReport = await fetchSystemHealth({ forceRefresh: true });
      assert.strictEqual(retryReport.isStale, false);

      const refreshedSnapshot = getSystemHealthCacheSnapshot();
      assert.ok(refreshedSnapshot);
      assert.strictEqual(refreshedSnapshot.report.isStale, false);
      assert.ok(refreshedSnapshot.timestamp >= initialTimestamp);
    });

    it('13. Failed in-flight request is cleared so subsequent retry succeeds', async () => {
      let attempt = 0;

      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: 'usr-1' } } },
            error: null,
          }),
        },
        rpc: async () => {
          attempt++;
          if (attempt === 1) {
            return { data: null, error: { message: 'temporary server error' } };
          }
          return { data: sampleValidRpcData, error: null };
        },
      };

      setSupabaseClientForTesting(mockClient);

      await assert.rejects(async () => {
        await fetchSystemHealth();
      });

      const report = await fetchSystemHealth();
      assert.strictEqual(report.items.length, 8);
      assert.strictEqual(attempt, 2);
    });
  });

  describe('Fail-Closed Normalization & Catalog Validation', () => {
    it('14. Non-array response throws controlled contract error', () => {
      assert.throws(() => {
        normalizeSystemHealthResponse(null);
      }, /Sistem durumu bilgisi alınamadı/);

      assert.throws(() => {
        normalizeSystemHealthResponse({ job_code: 'BIST_PRICES' });
      }, /Sistem durumu bilgisi alınamadı/);

      assert.throws(() => {
        normalizeSystemHealthResponse('invalid');
      }, /Sistem durumu bilgisi alınamadı/);
    });

    it('15. Single unknown message_code with healthy other fields fails closed to unknown, sets isIncomplete=true, and forces overall unknown', () => {
      // 8 catalog rows: 7 completely valid and healthy, 1 has invalid message_code but health_status='healthy'
      const corruptedData = sampleValidRpcData.map((job, idx) => {
        if (idx === 0) {
          return {
            ...job,
            health_status: 'healthy' as const,
            message_code: 'UNKNOWN_NEW_CORRUPTED_CODE' as any,
          };
        }
        return job;
      });

      const result = normalizeSystemHealthResponse(corruptedData);
      assert.strictEqual(result.isIncomplete, true, 'Report must be marked incomplete when message_code is invalid');

      const corruptedJob = result.items.find((j) => j.jobCode === 'BIST_PRICES');
      assert.ok(corruptedJob);
      assert.strictEqual(corruptedJob.healthStatus, 'unknown', 'Health status must fail closed to unknown');
      assert.strictEqual(corruptedJob.messageCode, 'JOB_STATUS_UNAVAILABLE');
      assert.strictEqual(corruptedJob.executionStatus, 'never_run');
      assert.strictEqual(corruptedJob.isOverdue, false);

      // Overall health evaluation MUST be unknown, never healthy
      const overall = evaluateOverallHealth(result.items);
      assert.strictEqual(overall.status, 'unknown', 'Overall status must be unknown due to contract violation item');
      assert.notStrictEqual(overall.status, 'healthy');
    });

    it('16. Invalid checked_at, health_status, execution_status, non-boolean is_overdue fail closed to unknown and set isIncomplete=true', () => {
      // Invalid checked_at
      const invalidCheckedAt = sampleValidRpcData.map((job, idx) =>
        idx === 0 ? { ...job, checked_at: 'not-a-date' } : job
      );
      const res1 = normalizeSystemHealthResponse(invalidCheckedAt);
      assert.strictEqual(res1.isIncomplete, true);
      assert.strictEqual(res1.items[0].healthStatus, 'unknown');
      assert.strictEqual(res1.items[0].messageCode, 'JOB_STATUS_UNAVAILABLE');

      // Invalid health_status
      const invalidHealthStatus = sampleValidRpcData.map((job, idx) =>
        idx === 0 ? { ...job, health_status: 'SUPER_HEALTHY' as any } : job
      );
      const res2 = normalizeSystemHealthResponse(invalidHealthStatus);
      assert.strictEqual(res2.isIncomplete, true);
      assert.strictEqual(res2.items[0].healthStatus, 'unknown');

      // Invalid execution_status
      const invalidExecutionStatus = sampleValidRpcData.map((job, idx) =>
        idx === 0 ? { ...job, execution_status: 'SUPER_RUNNING' as any } : job
      );
      const res3 = normalizeSystemHealthResponse(invalidExecutionStatus);
      assert.strictEqual(res3.isIncomplete, true);
      assert.strictEqual(res3.items[0].healthStatus, 'unknown');

      // Non-boolean is_overdue (e.g. "false", 1, null)
      const nonBooleanOverdue = sampleValidRpcData.map((job, idx) =>
        idx === 0 ? { ...job, is_overdue: 'false' as any } : job
      );
      const res4 = normalizeSystemHealthResponse(nonBooleanOverdue);
      assert.strictEqual(res4.isIncomplete, true);
      assert.strictEqual(res4.items[0].healthStatus, 'unknown');
      assert.strictEqual(res4.items[0].isOverdue, false);
    });

    it('17. Valid never_run item is not treated as a contract error (isIncomplete=false)', () => {
      // 8 catalog rows: 7 healthy, 1 valid never_run with valid checked_at and is_overdue boolean
      const validNeverRunData = sampleValidRpcData.map((job, idx) => {
        if (idx === 0) {
          return {
            ...job,
            execution_status: 'never_run' as const,
            health_status: 'unknown' as const,
            message_code: 'JOB_NEVER_RUN' as const,
            is_overdue: false,
            checked_at: '2026-08-29T10:05:00Z',
          };
        }
        return job;
      });

      const result = normalizeSystemHealthResponse(validNeverRunData);
      assert.strictEqual(result.isIncomplete, false, 'Valid never_run item must not be marked incomplete');
      assert.strictEqual(result.items[0].healthStatus, 'unknown');
      assert.strictEqual(result.items[0].messageCode, 'JOB_NEVER_RUN');

      // Overall health evaluates to unknown because of priority rules (never_run/unknown > healthy)
      const overall = evaluateOverallHealth(result.items);
      assert.strictEqual(overall.status, 'unknown');
    });

    it('18. Missing expected jobs are synthesized as unknown with isIncomplete=true', () => {
      const partialData = [
        sampleValidRpcData[0],
        sampleValidRpcData[1],
        sampleValidRpcData[2],
      ];

      const result = normalizeSystemHealthResponse(partialData);
      assert.strictEqual(result.isIncomplete, true);
      assert.strictEqual(result.items.length, 8);

      const missingJob = result.items.find((j) => j.jobCode === 'TEFAS_PRICES');
      assert.ok(missingJob);
      assert.strictEqual(missingJob.healthStatus, 'unknown');
      assert.strictEqual(missingJob.executionStatus, 'never_run');
      assert.strictEqual(missingJob.messageCode, 'JOB_STATUS_UNAVAILABLE');
      assert.strictEqual(missingJob.durationSeconds, null);
      assert.strictEqual(missingJob.checkedAt, null);
    });

    it('19. Unknown extra jobs outside catalog allowlist are ignored', () => {
      const dataWithUnknown = [
        ...sampleValidRpcData,
        {
          job_code: 'UNAUTHORIZED_CUSTOM_JOB',
          category: 'unknown',
          display_name: 'Hack Job',
          sort_order: 99,
          execution_status: 'failed',
          health_status: 'critical',
          message_code: 'JOB_FAILED',
        },
      ];

      const result = normalizeSystemHealthResponse(dataWithUnknown);
      assert.strictEqual(result.items.length, 8);
      assert.ok(!result.items.some((j) => j.jobCode === 'UNAUTHORIZED_CUSTOM_JOB'));
    });

    it('20. Duplicate job codes are deterministically resolved by newest checked_at', () => {
      const dataWithDuplicates = [
        {
          job_code: 'BIST_PRICES',
          category: 'prices',
          display_name: 'Borsa İstanbul Fiyatları (Eski)',
          sort_order: 1,
          execution_status: 'failed',
          health_status: 'critical',
          checked_at: '2026-08-29T08:00:00Z',
          message_code: 'JOB_FAILED',
          is_overdue: false,
        },
        {
          job_code: 'BIST_PRICES',
          category: 'prices',
          display_name: 'Borsa İstanbul Fiyatları (Yeni)',
          sort_order: 1,
          execution_status: 'success',
          health_status: 'healthy',
          checked_at: '2026-08-29T10:00:00Z',
          message_code: 'JOB_OK',
          is_overdue: false,
        },
        ...sampleValidRpcData.slice(1),
      ];

      const result = normalizeSystemHealthResponse(dataWithDuplicates);
      const bistJob = result.items.find((j) => j.jobCode === 'BIST_PRICES');
      assert.ok(bistJob);
      assert.strictEqual(bistJob.healthStatus, 'healthy');
      assert.strictEqual(bistJob.checkedAt, '2026-08-29T10:00:00Z');
    });
  });

  describe('Overall Priority & Badge Semantics', () => {
    const createItem = (overrides: Partial<NormalizedJobHealthItem>): NormalizedJobHealthItem => ({
      jobCode: 'BIST_PRICES',
      category: 'prices',
      categoryKey: 'prices',
      categoryTitle: 'Fiyat Verileri',
      displayName: 'Borsa İstanbul Fiyatları',
      sortOrder: 1,
      executionStatus: 'success',
      healthStatus: 'healthy',
      lastStartedAt: '2026-08-29T10:00:00Z',
      lastFinishedAt: '2026-08-29T10:00:42Z',
      lastSuccessAt: '2026-08-29T10:00:42Z',
      durationSeconds: 42,
      isOverdue: false,
      messageCode: 'JOB_OK',
      checkedAt: '2026-08-29T10:05:00Z',
      ...overrides,
    });

    it('21. healthy + never_run evaluates to overall unknown', () => {
      const items: NormalizedJobHealthItem[] = [
        createItem({ jobCode: 'BIST_PRICES', healthStatus: 'healthy', executionStatus: 'success' }),
        createItem({ jobCode: 'NASDAQ_PRICES', healthStatus: 'healthy', executionStatus: 'success' }),
        createItem({ jobCode: 'CRYPTO_PRICES', healthStatus: 'healthy', executionStatus: 'success' }),
        createItem({ jobCode: 'TEFAS_PRICES', healthStatus: 'unknown', executionStatus: 'never_run' }),
        createItem({ jobCode: 'USDTRY_PRICE', healthStatus: 'unknown', executionStatus: 'never_run' }),
        createItem({ jobCode: 'EARNINGS_CALENDAR', healthStatus: 'unknown', executionStatus: 'never_run' }),
        createItem({ jobCode: 'ECONOMIC_CALENDAR', healthStatus: 'unknown', executionStatus: 'never_run' }),
        createItem({ jobCode: 'PORTFOLIO_SNAPSHOTS', healthStatus: 'unknown', executionStatus: 'never_run' }),
      ];

      const overall = evaluateOverallHealth(items);
      assert.strictEqual(overall.status, 'unknown');
      assert.strictEqual(overall.title, 'İlk çalışma sonuçları bekleniyor.');
      assert.strictEqual(overall.unknownCount, 5);
      assert.strictEqual(overall.subtitle, '5 servis ilk çalışma sonucunu bekliyor');
    });

    it('22. healthy + skipped/inactive evaluates to overall healthy', () => {
      const items: NormalizedJobHealthItem[] = [
        createItem({ jobCode: 'BIST_PRICES', healthStatus: 'healthy', executionStatus: 'success' }),
        createItem({ jobCode: 'TEFAS_PRICES', healthStatus: 'inactive', executionStatus: 'skipped' }),
      ];

      const overall = evaluateOverallHealth(items);
      assert.strictEqual(overall.status, 'healthy');
      assert.strictEqual(overall.title, 'Tüm sistemler normal.');
    });

    it('23. Warning + failed job does not label failed job as "Kısmi"', () => {
      const failedJob = createItem({
        jobCode: 'BIST_PRICES',
        healthStatus: 'warning',
        executionStatus: 'failed',
        messageCode: 'JOB_FAILED',
      });

      assert.strictEqual(formatJobExecutionStatus(failedJob.executionStatus), 'Başarısız');
      assert.notStrictEqual(formatJobExecutionStatus(failedJob.executionStatus), 'Kısmi tamamlandı');
    });
  });

  describe('Icon System & Cross-Screen Sync', () => {
    it('24. All required system health icons exist in ICON_MAPPING with valid Material Icons', () => {
      const requiredIcons = [
        'server.rack',
        'checkmark.circle.fill',
        'exclamationmark.triangle.fill',
        'xmark.circle.fill',
        'xmark.octagon.fill',
        'arrow.triangle.2.circlepath',
        'pause.circle.fill',
        'questionmark.circle.fill',
        'wifi.exclamationmark',
        'arrow.clockwise',
        'cloud.fill',
      ];

      for (const icon of requiredIcons) {
        const mapped = ICON_MAPPING[icon as keyof typeof ICON_MAPPING];
        assert.ok(mapped, `Icon ${icon} must be mapped`);
        assert.notStrictEqual(mapped, 'help-outline', `Icon ${icon} must not fallback to help-outline`);
      }
    });

    it('25. Subscribers receive cache updates across screens (Menu <-> Detail sync)', async () => {
      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: 'usr-1' } } },
            error: null,
          }),
        },
        rpc: async () => ({ data: sampleValidRpcData, error: null }),
      };

      setSupabaseClientForTesting(mockClient);

      const receivedReports: string[] = [];
      const unsubscribe = subscribeSystemHealth((report) => {
        receivedReports.push(report.overall.status);
      });

      await fetchSystemHealth();

      assert.strictEqual(receivedReports.length, 1);
      assert.strictEqual(receivedReports[0], 'healthy');

      unsubscribe();
    });

    it('26. Section grouping orders categories correctly', () => {
      const items: NormalizedJobHealthItem[] = EXPECTED_JOBS_CATALOG.map((job) => ({
        jobCode: job.jobCode,
        category: job.category,
        categoryKey: job.categoryKey,
        categoryTitle: job.categoryTitle,
        displayName: job.displayName,
        sortOrder: job.sortOrder,
        executionStatus: 'success',
        healthStatus: 'healthy',
        lastStartedAt: null,
        lastFinishedAt: null,
        lastSuccessAt: null,
        durationSeconds: null,
        isOverdue: false,
        messageCode: 'JOB_OK',
        checkedAt: null,
      }));

      const sections = groupJobsIntoSections(items);
      assert.strictEqual(sections.length, 3);
      assert.strictEqual(sections[0].key, 'prices');
      assert.strictEqual(sections[1].key, 'calendar');
      assert.strictEqual(sections[2].key, 'portfolio');
    });

    it('27. Duration and date formatters handle edge cases gracefully', () => {
      assert.strictEqual(formatDurationSeconds(null), '—');
      assert.strictEqual(formatDurationSeconds(undefined), '—');
      assert.strictEqual(formatDurationSeconds(-10), '—');
      assert.strictEqual(formatDurationSeconds(0), '0 sn');
      assert.strictEqual(formatDurationSeconds(42), '42 sn');
      assert.strictEqual(formatDurationSeconds(60), '1 dk');
      assert.strictEqual(formatDurationSeconds(75), '1 dk 15 sn');

      assert.strictEqual(formatSystemHealthDateTime(null), '—');
      assert.strictEqual(formatSystemHealthDateTime(undefined), '—');
      assert.strictEqual(formatSystemHealthDateTime('invalid'), '—');
    });
  });
});
