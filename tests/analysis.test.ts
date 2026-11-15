import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  checkAnalysisHealth,
  changeAnalysisConnection,
  clearAnalysisProvidersCacheForTesting,
  createAnalysisConnection,
  fetchAnalysisConnections,
  fetchAnalysisHistory,
  fetchAnalysisProviders,
  fetchAnalysisReport,
  fetchAnalysisStatus,
  getAnalysisApiBaseUrl,
  getAnalysisFailureMessage,
  isAnalysisApiError,
  isModelNotAllowedError,
  startAnalysis,
} from '../services/analysis/analysis-service';
import { authenticateRegisteredAccount, resetAuthLock } from '../services/auth/auth-service';
import {
  resetSupabaseClientForTesting,
  setSupabaseClientForTesting,
} from '../services/supabase/client';
import {
  canUseAnalysisModelCatalog,
  isAnalysisSuccessful,
  isFutureAnalysisDate,
  findActiveAnalysisToTrack,
  formatAnalysisPartTitle,
  formatAnalysisStage,
  formatAnalysisStatus,
  formatAnalysisDate,
  isAnalysisTerminal,
  normalizeAnalysisHistory,
  normalizeAnalysisRecord,
  normalizeAnalysisReport,
  normalizeProviders,
  getAnalysisModelCatalogError,
  reconcileSelectedModelId,
  resolveDefaultModels,
} from '../utils/analysis';
import { isSafeMarkdownUrl, sanitizeMarkdownSource, tokenizeMarkdown } from '../utils/safe-markdown';
import { logger } from '../utils/logger';

const ANALYSIS_ID = '45834309-dbef-4d43-a7ed-7619118a2af9';
const ACCESS_TOKEN = 'test-access-token-that-must-not-be-logged';
const ORIGINAL_API_URL = process.env.EXPO_PUBLIC_ANALYSIS_API_URL;
const ORIGINAL_FETCH = globalThis.fetch;

function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: ANALYSIS_ID,
    status: 'running',
    stage: 'analysis',
    created_at: '2026-10-22T17:12:49.533851+00:00',
    started_at: '2026-10-22T17:12:52.326064+00:00',
    finished_at: null,
    error_code: null,
    ticker: 'AAPL',
    analysis_date: '2026-10-22',
    replayed: false,
    ...overrides,
  };
}

function mockSupabaseSession(userId = 'user-1') {
  let refreshCount = 0;
  setSupabaseClientForTesting({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: ACCESS_TOKEN, user: { id: userId } } },
        error: null,
      }),
      refreshSession: async () => {
        refreshCount += 1;
        return {
          data: { session: { access_token: `${ACCESS_TOKEN}-refreshed`, user: { id: userId } } },
          error: null,
        };
      },
    },
  } as never);
  return () => refreshCount;
}

describe('FinBot Analysis frontend contract', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_ANALYSIS_API_URL = 'https://192.0.2.10';
    resetAuthLock();
    resetSupabaseClientForTesting();
    clearAnalysisProvidersCacheForTesting();
    logger.clearLogs();
    logger.setSilent(true);
    logger.setMinLevel('debug');
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    resetAuthLock();
    resetSupabaseClientForTesting();
    if (ORIGINAL_API_URL === undefined) delete process.env.EXPO_PUBLIC_ANALYSIS_API_URL;
    else process.env.EXPO_PUBLIC_ANALYSIS_API_URL = ORIGINAL_API_URL;
  });

  it('rejects malformed job fields before tracking a job', () => {
    const invalidFields = {
      status: [3, 'unknown'],
      stage: [3, 'unknown'],
      created_at: ['2026-10-22'],
      started_at: [5],
      finished_at: ['invalid'],
      error_code: [{ code: 'failed' }],
      ticker: [null, '$$'],
      analysis_date: ['2026-02-29'],
    };
    for (const [field, values] of Object.entries(invalidFields)) {
      for (const value of values) {
        assert.equal(normalizeAnalysisRecord(validRecord({ [field]: value })), null, field);
      }
    }
  });

  it('rejects ambiguous history pages and supports the older analyses array', () => {
    const item = validRecord();
    assert.equal(normalizeAnalysisHistory(false, 2, 0), null);
    assert.equal(normalizeAnalysisHistory({ items: 'invalid' }, 2, 0), null);
    assert.equal(normalizeAnalysisHistory([item, item], 1, 0), null);
    assert.equal(normalizeAnalysisHistory([item, item], 2, 0), null);
    assert.equal(normalizeAnalysisHistory([null], 2, 0), null);
    assert.equal(normalizeAnalysisHistory({ analyses: [item], total: 1 }, 2, 1), null);
    assert.equal(normalizeAnalysisHistory({ analyses: [item], total: 3 }, 2, 1)?.hasMore, true);
    assert.equal(normalizeAnalysisHistory({ items: [item], total: -1 }, 1, 0)?.totalCount, null);
    assert.equal(normalizeAnalysisHistory({ items: [item], total: 1.5 }, 2, 0)?.hasMore, false);
  });

  it('fails closed on ambiguous or unusable model catalog entries', () => {
    const provider = {
      provider: 'openai',
      models: ['model-a'],
      auth_type: 'api_key',
      model_options: [{ id: 'model-a', name: 'Model A' }],
    };
    const invalid = [
      null,
      { ...provider, provider: 1 },
      { ...provider, provider: ' ' },
      { ...provider, models: null },
      { ...provider, models: [1] },
      { ...provider, models: [' '] },
      { ...provider, models: ['a', ' a '] },
      { ...provider, model_options: null },
      { ...provider, model_options: [false] },
      { ...provider, model_options: [{ id: 1, name: 'A' }] },
      { ...provider, model_options: [{ id: ' ', name: 'A' }] },
      { ...provider, model_options: [{ id: 'a', name: 1 }] },
      { ...provider, model_options: [{ id: 'a', name: ' ' }] },
      { ...provider, model_options: [{ id: 'a', name: 'A' }, { id: ' a ', name: 'B' }] },
      { ...provider, models: [], model_options: [] },
      { ...provider, auth_type: 'unknown' },
    ];
    for (const entry of invalid) {
      assert.equal(normalizeProviders({ providers: [entry], unavailable: {} }), null, JSON.stringify(entry));
    }
    assert.equal(normalizeProviders({ providers: [], unavailable: [] }), null);
    assert.equal(normalizeProviders({ providers: [], unavailable: { openai: false } }), null);
  });

  it('shows localized labels and preserves the calendar date of an analysis', () => {
    const record = normalizeAnalysisRecord(validRecord());
    assert.ok(record);
    assert.equal(isAnalysisTerminal(record), false);
    assert.equal(isAnalysisTerminal({ ...record, status: 'timed_out' }), true);
    assert.equal(formatAnalysisStatus('partial'), 'Kısmi');
    assert.equal(formatAnalysisStage('persisting'), 'Rapor hazırlanıyor');
    assert.equal(formatAnalysisDate('2026-02-30'), '—');
    assert.equal(formatAnalysisDate('2026-10-22', 'en-US'), 'October 22, 2026');
    assert.equal(getAnalysisFailureMessage(null), null);
    assert.equal(getAnalysisFailureMessage('UNKNOWN_FAILURE'), null);
    assert.match(getAnalysisFailureMessage('REPORT_NOT_READY') ?? '', /henüz hazır değil/);
  });

  it('classifies rejected status requests without surfacing raw response bodies', async () => {
    mockSupabaseSession();
    for (const [status, code, retryable] of [
      [403, 'ANALYSIS_ACCESS_DENIED', false],
      [404, 'ANALYSIS_NOT_FOUND', false],
      [409, 'ANALYSIS_CONFLICT', true],
      [422, 'ANALYSIS_VALIDATION_FAILED', false],
      [500, 'ANALYSIS_SERVER_ERROR', true],
      [400, 'ANALYSIS_SERVER_ERROR', false],
      [401, 'ANALYSIS_AUTH_REQUIRED', true],
    ] as const) {
      globalThis.fetch = async () => new Response('private upstream details', { status });
      await assert.rejects(fetchAnalysisStatus(ANALYSIS_ID), (error: unknown) =>
        isAnalysisApiError(error) && error.code === code && error.status === status &&
        error.isRetryable === retryable && !error.message.includes('private upstream details')
      );
    }
  });

  it('requires an HTTPS API URL without credentials, query parameters, or fragments', () => {
    delete process.env.EXPO_PUBLIC_ANALYSIS_API_URL;
    assert.throws(getAnalysisApiBaseUrl, { code: 'ANALYSIS_API_NOT_CONFIGURED' });
    for (const url of [
      'not a URL', 'http://analysis.example.com', 'https://user@analysis.example.com',
      'https://:password@analysis.example.com', 'https://analysis.example.com?token=example',
      'https://analysis.example.com#internal',
    ]) {
      process.env.EXPO_PUBLIC_ANALYSIS_API_URL = url;
      assert.throws(getAnalysisApiBaseUrl, { code: 'ANALYSIS_API_INVALID_URL' });
    }
    process.env.EXPO_PUBLIC_ANALYSIS_API_URL = ' https://analysis.example.com/api/ ';
    assert.equal(getAnalysisApiBaseUrl(), 'https://analysis.example.com/api');
  });

  it('retries a throttled status read once and caps the reported follow-up delay', async () => {
    mockSupabaseSession();
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      const retryAfter = requests === 1 ? 'Wed, 21 Oct 2015 07:28:00 GMT' : '3600';
      return new Response('{}', { status: 429, headers: { 'Retry-After': retryAfter } });
    };
    await assert.rejects(fetchAnalysisStatus(ANALYSIS_ID), (error: unknown) =>
      isAnalysisApiError(error) && error.code === 'ANALYSIS_RATE_LIMITED' &&
      error.isRetryable && error.retryAfterMs === 10_000
    );
    assert.equal(requests, 2);
  });

  it('distinguishes malformed payloads, aborts, and network failures', async () => {
    mockSupabaseSession();
    for (const [fetchReply, code] of [
      [async () => new Response('not JSON'), 'ANALYSIS_INVALID_JSON'],
      [async () => new Response('{}'), 'ANALYSIS_CONTRACT_ERROR'],
      [async () => { throw new DOMException('disconnected', 'AbortError'); }, 'ANALYSIS_TIMEOUT'],
      [async () => { throw new TypeError('socket failed'); }, 'ANALYSIS_NETWORK_ERROR'],
    ] as const) {
      globalThis.fetch = fetchReply;
      await assert.rejects(fetchAnalysisStatus(ANALYSIS_ID), (error: unknown) =>
        isAnalysisApiError(error) && error.code === code
      );
    }
  });

  it('normalizes active and successful records while rejecting contradictory terminal state', () => {
    const running = normalizeAnalysisRecord(validRecord());
    assert.ok(running);
    assert.equal(running.status, 'running');

    const success = normalizeAnalysisRecord(
      validRecord({
        status: 'success',
        stage: 'finished',
        finished_at: '2026-10-22T17:20:00.626389+00:00',
      })
    );
    assert.ok(success);
    assert.equal(isAnalysisSuccessful(success), true);

    assert.equal(
      normalizeAnalysisRecord(validRecord({ status: 'success', stage: 'analysis' })),
      null
    );
  });

  it('tracks active analyses independently from report detail selection', () => {
    const running = normalizeAnalysisRecord(validRecord());
    const reserved = normalizeAnalysisRecord(
      validRecord({
        id: '6a6da143-995d-4414-a25f-7b086bb779c8',
        status: 'reserved',
        stage: 'accepted',
        started_at: null,
      })
    );
    const completed = normalizeAnalysisRecord(
      validRecord({
        id: 'e047fa60-a74f-4b52-823d-f98dbfa518ae',
        status: 'success',
        stage: 'finished',
        finished_at: '2026-10-22T17:20:00.626389+00:00',
      })
    );
    assert.ok(running);
    assert.ok(reserved);
    assert.ok(completed);

    assert.equal(
      findActiveAnalysisToTrack([running, reserved, completed], reserved.id)?.id,
      reserved.id
    );
    assert.equal(findActiveAnalysisToTrack([running, completed])?.id, running.id);
    assert.equal(findActiveAnalysisToTrack([completed]), null);
  });

  it('rejects invalid UUID, timestamps, ticker and future date helpers', () => {
    assert.equal(normalizeAnalysisRecord(validRecord({ id: 'not-a-uuid' })), null);
    assert.equal(normalizeAnalysisRecord(validRecord({ created_at: '2026-10-22' })), null);
    assert.equal(normalizeAnalysisRecord(validRecord({ ticker: 'BAD SYMBOL' })), null);
    assert.equal(isFutureAnalysisDate('2026-10-24', new Date('2026-10-23T12:00:00Z')), true);
    assert.equal(isFutureAnalysisDate('2026-10-23', new Date('2026-10-23T12:00:00Z')), false);
  });

  it('normalizes history array and wrapped response without inventing missing records', () => {
    const first = validRecord();
    const page = normalizeAnalysisHistory({ items: [first], total_count: 3, has_more: true }, 20, 0);
    assert.ok(page);
    assert.equal(page.items.length, 1);
    assert.equal(page.totalCount, 3);
    assert.equal(page.hasMore, true);

    assert.equal(normalizeAnalysisHistory({ items: [first, first] }, 20, 0), null);
    assert.equal(normalizeAnalysisHistory({ unexpected: [] }, 20, 0), null);
  });

  it('prefers dynamic model_options, preserves backend order, and defaults both selectors to the first model', () => {
    const result = normalizeProviders({
      providers: [{
        provider: 'chatgpt',
        models: ['gpt-6.1-sol', 'gpt-6-astra'],
        model_options: [
          { id: 'gpt-6-astra', name: 'GPT-6-Astra' },
          { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' },
        ],
        auth_type: 'personal_chatgpt',
      }],
      unavailable: { ollama: 'HOSTED_ENDPOINT_NOT_CONFIGURED' },
    });
    assert.ok(result);
    assert.deepEqual(resolveDefaultModels(result), {
      authType: 'personal_chatgpt',
      quickModel: 'gpt-6-astra',
      deepModel: 'gpt-6-astra',
      availableModels: [
        { id: 'gpt-6-astra', name: 'GPT-6-Astra' },
        { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' },
      ],
    });
  });

  it('falls back to legacy models and disables the catalog when personal ChatGPT is unavailable', () => {
    const legacy = normalizeProviders({
      providers: [{
        provider: 'chatgpt',
        models: ['future-model-a', 'future-model-b'],
        auth_type: 'personal_chatgpt',
      }],
      unavailable: {},
    });
    assert.ok(legacy);
    assert.deepEqual(resolveDefaultModels(legacy)?.availableModels, [
      { id: 'future-model-a', name: 'future-model-a' },
      { id: 'future-model-b', name: 'future-model-b' },
    ]);

    const unavailable = normalizeProviders({
      providers: [],
      unavailable: { chatgpt: 'MODEL_CATALOG_UNAVAILABLE' },
    });
    assert.ok(unavailable);
    assert.equal(resolveDefaultModels(unavailable), null);
    assert.equal(
      getAnalysisModelCatalogError(unavailable),
      'AI model listesi şu anda alınamıyor. Lütfen kısa bir süre sonra tekrar deneyin.'
    );
  });

  it('reconciles removed model selections and keeps analysis disabled while catalog is loading', () => {
    const models = [
      { id: 'model-new', name: 'Yeni Model' },
      { id: 'model-deep', name: 'Derin Model' },
    ];
    assert.equal(reconcileSelectedModelId('model-old', models), 'model-new');
    assert.equal(reconcileSelectedModelId('model-deep', models), 'model-deep');

    const selection = {
      authType: 'personal_chatgpt' as const,
      quickModel: 'model-new',
      deepModel: 'model-new',
      availableModels: models,
    };
    assert.equal(canUseAnalysisModelCatalog(selection, true, null), false);
    assert.equal(canUseAnalysisModelCatalog(selection, false, 'Katalog alınamadı.'), false);
    assert.equal(canUseAnalysisModelCatalog(selection, false, null), true);
  });

  it('requires disclaimer and validates effective report configuration', () => {
    const raw = {
      analysis_horizon: 'long_12m',
      sections: [
        { code: 'final_trade_decision', title: 'Nihai karar', content_markdown: '**Bekle**', parts: {} },
        { code: 'disclaimer', title: 'Yasal uyarı', content_markdown: 'Yatırım tavsiyesi değildir.', parts: {} },
      ],
      effective_config: {
        quick: { provider: 'chatgpt', model: 'gpt-6.1-sol' },
        deep: { provider: 'chatgpt', model: 'gpt-6-astra' },
        research_rounds: 1,
        risk_rounds: 1,
        analysts: ['market'],
        language: 'tr',
      },
      upstream_version: '0.7.0',
    };
    const section = raw.sections[1];
    for (const invalidSection of [
      null, { ...section, code: 2 }, { ...section, code: ' ' }, { ...section, title: 2 },
      { ...section, title: ' ' }, { ...section, content_markdown: false }, { ...section, parts: [] },
      { ...section, content_markdown: ' ' },
    ]) {
      assert.equal(normalizeAnalysisReport({ ...raw, sections: [invalidSection] }), null);
    }
    const config = raw.effective_config;
    for (const invalidConfig of [
      null, { ...config, quick: { provider: ' ', model: 'model' } },
      { ...config, deep: { provider: 'openai', model: ' ' } },
      { ...config, research_rounds: -1 }, { ...config, research_rounds: 1.5 },
      { ...config, risk_rounds: -1 }, { ...config, risk_rounds: '1' },
      { ...config, analysts: null }, { ...config, analysts: ['unknown'] },
      { ...config, language: 'unknown' },
    ]) {
      assert.equal(normalizeAnalysisReport({ ...raw, effective_config: invalidConfig }), null);
    }
    for (const version of [null, ' ']) {
      assert.equal(normalizeAnalysisReport({ ...raw, upstream_version: version }), null);
    }
    const withInvalidParts = normalizeAnalysisReport({
      ...raw, sections: [{ ...section, parts: { ' ': 'ignored', unknown: false, empty: ' ', ' summary ': 'Text' } }],
    });
    assert.deepEqual(withInvalidParts?.sections[0].parts, { summary: 'Text' });
    const report = normalizeAnalysisReport(raw);
    assert.ok(report);
    assert.equal(report.analysisHorizon, 'long_12m');
    assert.equal(report.sections[1].code, 'disclaimer');
    assert.equal(normalizeAnalysisReport({ ...raw, sections: raw.sections.slice(0, 1) }), null);
  });

  it('accepts real report sections with null main content and preserves Markdown parts', () => {
    const raw = {
      sections: [
        { code: 'executive_summary', title: 'Yönetici özeti', content_markdown: 'Özet', parts: {} },
        { code: 'fundamentals', title: 'Temel analiz', content_markdown: null, parts: {} },
        {
          code: 'trade_plan',
          title: 'İşlem planı',
          content_markdown: 'Ana işlem planı',
          parts: { research_manager: 'Araştırma yöneticisi değerlendirmesi' },
        },
        {
          code: 'risk',
          title: 'Risk değerlendirmesi',
          content_markdown: null,
          parts: {
            aggressive: 'Agresif risk değerlendirmesi',
            conservative: 'Muhafazakâr risk değerlendirmesi',
            neutral: 'Nötr risk değerlendirmesi',
          },
        },
        { code: 'disclaimer', title: 'Yasal uyarı', content_markdown: 'Yatırım tavsiyesi değildir.', parts: {} },
      ],
      effective_config: {
        quick: { provider: 'chatgpt', model: 'gpt-6.1-sol' },
        deep: { provider: 'chatgpt', model: 'gpt-6-astra' },
        research_rounds: 1,
        risk_rounds: 1,
        analysts: ['market'],
        language: 'tr',
      },
      upstream_version: '0.7.0',
    };

    const report = normalizeAnalysisReport(raw);
    assert.ok(report);
    assert.equal(report.sections.length, 5);
    assert.equal(report.sections[1].contentMarkdown, null);
    assert.deepEqual(report.sections[1].parts, {});
    assert.equal(report.sections[3].contentMarkdown, null);
    assert.equal(report.sections[3].parts.aggressive, 'Agresif risk değerlendirmesi');
    assert.equal(report.sections[2].parts.research_manager, 'Araştırma yöneticisi değerlendirmesi');
    assert.equal(formatAnalysisPartTitle('aggressive'), 'Agresif yaklaşım');
    assert.equal(formatAnalysisPartTitle('research_manager'), 'Araştırma yöneticisi');
    assert.equal(formatAnalysisPartTitle('custom_signal'), 'Custom signal');
  });

  it('reads the analysis horizon from job metadata and keeps older history records readable', () => {
    assert.equal(normalizeAnalysisRecord(validRecord({ analysis_horizon: 'short_1m' }))?.analysisHorizon, 'short_1m');
    assert.equal(normalizeAnalysisRecord(validRecord({ request: { analysis_horizon: 'medium_3m' } }))?.analysisHorizon, 'medium_3m');
    const legacyRecord = normalizeAnalysisRecord(validRecord({ analysis_horizon: null }));
    assert.ok(legacyRecord);
    assert.equal(legacyRecord.analysisHorizon, undefined);
  });

  it('logs report lifecycle metadata without exposing report text or access token', async () => {
    mockSupabaseSession();
    const privateReportText = 'BU-RAPOR-METNI-LOGA-YAZILMAMALI';
    globalThis.fetch = (async () => new Response(JSON.stringify({
      sections: [
        {
          code: 'risk',
          title: 'Risk değerlendirmesi',
          content_markdown: null,
          parts: { aggressive: privateReportText },
        },
        {
          code: 'disclaimer',
          title: 'Yasal uyarı',
          content_markdown: 'Yatırım tavsiyesi değildir.',
          parts: {},
        },
      ],
      effective_config: {
        quick: { provider: 'chatgpt', model: 'gpt-6.1-sol' },
        deep: { provider: 'chatgpt', model: 'gpt-6-astra' },
        research_rounds: 1,
        risk_rounds: 1,
        analysts: ['market'],
        language: 'tr',
      },
      upstream_version: '0.7.0',
    }), { status: 200 })) as typeof fetch;

    const report = await fetchAnalysisReport(ANALYSIS_ID);
    assert.equal(report.sections.length, 2);

    const serviceLogs = logger
      .getRecentLogs()
      .filter((entry) => entry.scope === 'AnalysisService');
    assert.deepEqual(
      serviceLogs.map((entry) => entry.message),
      ['Analiz raporu yükleniyor', 'Analiz raporu başarıyla yüklendi']
    );
    assert.equal(serviceLogs[1].metadata?.sectionCount, 2);
    assert.equal(serviceLogs[1].metadata?.partCount, 1);
    assert.equal(serviceLogs[1].metadata?.emptySectionCount, 0);

    const serializedLogs = JSON.stringify(serviceLogs);
    assert.equal(serializedLogs.includes(privateReportText), false);
    assert.equal(serializedLogs.includes(ACCESS_TOKEN), false);
  });

  it('sanitizes raw HTML/script while preserving supported Markdown blocks', () => {
    const source = '<script>alert(1)</script><b>Başlık</b>\n\n## Görüş\n- Madde\n[Kaynak](https://example.com)';
    const sanitized = sanitizeMarkdownSource(source);
    assert.equal(sanitized.includes('script'), false);
    assert.equal(sanitized.includes('<b>'), false);
    const blocks = tokenizeMarkdown(source);
    assert.deepEqual(blocks.map((block) => block.type), ['paragraph', 'heading', 'bullet', 'paragraph']);
    assert.equal(isSafeMarkdownUrl('https://example.com/report'), true);
    assert.equal(isSafeMarkdownUrl('https://user:pass@example.com'), false);
    assert.equal(isSafeMarkdownUrl('https://localhost/report'), false);
    assert.equal(isSafeMarkdownUrl('javascript:alert(1)'), false);
  });

  it('calls health without Authorization and protected providers with current Supabase token', async () => {
    mockSupabaseSession();
    const calls: { url: string; authorization: string | null }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, authorization: headers.get('authorization') });
      if (url.endsWith('/healthz')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      return new Response(JSON.stringify({
        providers: [{ provider: 'chatgpt', models: ['gpt-6.1-sol', 'gpt-6-astra'], auth_type: 'personal_chatgpt' }],
        unavailable: {},
      }), { status: 200 });
    }) as typeof fetch;

    assert.equal(await checkAnalysisHealth(), true);
    await fetchAnalysisProviders({ userId: 'user-1' });
    assert.equal(calls[0].authorization, null);
    assert.equal(calls[1].authorization, `Bearer ${ACCESS_TOKEN}`);
  });

  it('deduplicates concurrent provider requests and serves the same user from the five-minute cache', async () => {
    mockSupabaseSession();
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(JSON.stringify({
        providers: [{
          provider: 'chatgpt',
          models: ['dynamic-model'],
          model_options: [{ id: 'dynamic-model', name: 'Dynamic Model' }],
          auth_type: 'personal_chatgpt',
        }],
        unavailable: {},
      }), { status: 200 });
    }) as typeof fetch;

    const [first, second] = await Promise.all([
      fetchAnalysisProviders({ userId: 'user-1' }),
      fetchAnalysisProviders({ userId: 'user-1' }),
    ]);
    const cached = await fetchAnalysisProviders({ userId: 'user-1' });

    assert.equal(requestCount, 1);
    assert.equal(first.providers[0].modelOptions[0].name, 'Dynamic Model');
    assert.deepEqual(first, second);
    assert.deepEqual(first, cached);
  });

  it('scopes provider cache by user and force refreshes after the backend catalog changes', async () => {
    mockSupabaseSession('user-a');
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      const id = `model-${requestCount}`;
      return new Response(JSON.stringify({
        providers: [{
          provider: 'chatgpt',
          models: [id],
          auth_type: 'personal_chatgpt',
        }],
        unavailable: {},
      }), { status: 200 });
    }) as typeof fetch;

    const userA = await fetchAnalysisProviders({ userId: 'user-a' });
    mockSupabaseSession('user-b');
    const userB = await fetchAnalysisProviders({ userId: 'user-b' });
    mockSupabaseSession('user-a');
    const refreshedA = await fetchAnalysisProviders({ userId: 'user-a', forceRefresh: true });

    assert.equal(requestCount, 3);
    assert.equal(userA.providers[0].modelOptions[0].id, 'model-1');
    assert.equal(userB.providers[0].modelOptions[0].id, 'model-2');
    assert.equal(refreshedA.providers[0].modelOptions[0].id, 'model-3');
  });

  it('maps MODEL_NOT_ALLOWED safely without logging tokens or backend response details', async () => {
    mockSupabaseSession();
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: {
        code: 'MODEL_NOT_ALLOWED',
        retryable: false,
        details: `secret-${ACCESS_TOKEN}`,
      },
    }), { status: 422 })) as typeof fetch;

    await assert.rejects(
      () => startAnalysis({
        ticker: 'AAPL',
        analysisDate: '2026-10-22',
        analysisHorizon: 'medium_3m',
        language: 'tr',
        analysts: ['market'],
        authType: 'personal_chatgpt',
        quickModel: 'removed-model',
        deepModel: 'removed-model',
      }, 'fd1d6d68-3775-4a20-a1c9-1b9f3fe4e5d6'),
      (error: unknown) => {
        assert.equal(isModelNotAllowedError(error), true);
        assert.equal(
          error instanceof Error ? error.message : '',
          'Seçtiğiniz modele erişim artık kullanılamıyor. Model listesini yenileyip tekrar seçin.'
        );
        return true;
      }
    );

    const serializedLogs = JSON.stringify(logger.getRecentLogs());
    assert.equal(serializedLogs.includes(ACCESS_TOKEN), false);
    assert.equal(serializedLogs.includes('details'), false);
  });

  it('refreshes the catalog after MODEL_NOT_ALLOWED without replaying the rejected analysis', async () => {
    mockSupabaseSession();
    let providerCalls = 0;
    let analysisCalls = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/v1/providers')) {
        providerCalls += 1;
        const id = providerCalls === 1 ? 'retired-model' : 'replacement-model';
        return new Response(JSON.stringify({
          providers: [{
            provider: 'chatgpt',
            models: [id],
            model_options: [{ id, name: providerCalls === 1 ? 'Eski Model' : 'Yeni Model' }],
            auth_type: 'personal_chatgpt',
          }],
          unavailable: {},
        }), { status: 200 });
      }

      analysisCalls += 1;
      return new Response(JSON.stringify({
        error: { code: 'MODEL_NOT_ALLOWED', retryable: false },
      }), { status: 422 });
    }) as typeof fetch;

    const initial = await fetchAnalysisProviders({ userId: 'user-1' });
    assert.equal(initial.providers[0].modelOptions[0].id, 'retired-model');

    await assert.rejects(
      () => startAnalysis({
        ticker: 'AAPL',
        analysisDate: '2026-10-22',
        analysisHorizon: 'medium_3m',
        language: 'tr',
        analysts: ['market'],
        authType: 'personal_chatgpt',
        quickModel: 'retired-model',
        deepModel: 'retired-model',
      }, 'fd1d6d68-3775-4a20-a1c9-1b9f3fe4e5d6'),
      isModelNotAllowedError
    );

    const refreshed = await fetchAnalysisProviders({ userId: 'user-1', forceRefresh: true });
    assert.equal(refreshed.providers[0].modelOptions[0].id, 'replacement-model');
    assert.equal(providerCalls, 2);
    assert.equal(analysisCalls, 1);
  });

  it('refreshes Supabase session exactly once after 401 and retries the same request', async () => {
    const refreshCount = mockSupabaseSession();
    let rpcCount = 0;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      rpcCount += 1;
      const auth = new Headers(init?.headers).get('authorization');
      if (rpcCount === 1) {
        assert.equal(auth, `Bearer ${ACCESS_TOKEN}`);
        return new Response('', { status: 401 });
      }
      assert.equal(auth, `Bearer ${ACCESS_TOKEN}-refreshed`);
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    const page = await fetchAnalysisHistory(20, 0);
    assert.equal(page.items.length, 0);
    assert.equal(rpcCount, 2);
    assert.equal(refreshCount(), 1);
  });

  it('sends model IDs and exact idempotency key without bindings for personal ChatGPT', async () => {
    mockSupabaseSession();
    const idempotencyKey = 'fd1d6d68-3775-4a20-a1c9-1b9f3fe4e5d6';
    let capturedBody: unknown = null;
    let capturedKey: string | null = null;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      capturedKey = headers.get('idempotency-key');
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify(validRecord({ status: 'reserved', stage: 'accepted', started_at: null })), { status: 202 });
    }) as typeof fetch;

    const result = await startAnalysis({
      ticker: 'AAPL',
      analysisDate: '2026-10-22',
      analysisHorizon: 'short_1m',
      language: 'tr',
      analysts: ['market', 'news'],
      authType: 'personal_chatgpt',
      quickModel: 'gpt-6.1-sol',
      deepModel: 'gpt-6-astra',
    }, idempotencyKey);

    assert.equal(result.status, 'reserved');
    assert.equal(capturedKey, idempotencyKey);
    assert.ok(typeof capturedBody === 'object' && capturedBody !== null);
    const body = capturedBody as {
      auth_type: string;
      request: { analysis_horizon: string };
      connection_id: unknown;
      quick_model: string;
      deep_model: string;
    };
    assert.equal(Object.hasOwn(body, 'connection_id'), false);
    assert.equal(Object.hasOwn(body, 'models'), false);
    assert.equal(body.auth_type, 'personal_chatgpt');
    assert.equal(body.request.analysis_horizon, 'short_1m');
    assert.equal(body.quick_model, 'gpt-6.1-sol');
    assert.equal(body.deep_model, 'gpt-6-astra');
    assert.notEqual(body.quick_model, 'GPT-6.1-Sol');
  });

  it('allows a server-enabled API catalog when personal access is owner-only', () => {
    const result = normalizeProviders({
      providers: [{ provider: 'openai', auth_type: 'api_key', models: ['enabled-model'] }],
      unavailable: { chatgpt: 'PERSONAL_OWNER_ONLY' },
    });
    assert.ok(result);
    assert.equal(resolveDefaultModels(result), null);
    assert.equal(getAnalysisModelCatalogError(result), null);
  });

  it('uses Supabase registration and handles email confirmation before sign-in', async () => {
    const calls: string[] = [];
    const password = 'fixture-password';
    const user = { id: 'registered-user', is_anonymous: false };
    setSupabaseClientForTesting({
      auth: {
        signUp: async (credentials: unknown) => {
          calls.push('signup');
          assert.deepEqual(credentials, { email: 'user@example.com', password });
          return { data: { user, session: null }, error: null };
        },
        signInWithPassword: async (credentials: unknown) => {
          calls.push('signin');
          assert.deepEqual(credentials, { email: 'user@example.com', password });
          return { data: { user, session: { user } }, error: null };
        },
      },
    } as never);
    assert.equal(await authenticateRegisteredAccount('sign-up', ' user@example.com ', password), 'confirm-email');
    assert.equal(await authenticateRegisteredAccount('sign-in', 'user@example.com', password), 'signed-in');
    assert.deepEqual(calls, ['signup', 'signin']);
  });

  it('keeps Supabase sign-in failure details out of user errors and logs', async () => {
    const secret = 'fixture-auth-secret';
    setSupabaseClientForTesting({
      auth: {
        signInWithPassword: async () => ({
          data: { user: null, session: null },
          error: { code: 'invalid_credentials', message: secret },
        }),
      },
    } as never);
    await assert.rejects(
      () => authenticateRegisteredAccount('sign-in', 'user@example.com', secret),
      { message: 'Oturum açılamadı. E-posta adresini ve parolanı kontrol edip tekrar deneyin.' }
    );
    assert.doesNotMatch(JSON.stringify(logger.getRecentLogs()), /fixture-auth-secret/);
  });

  it('posts only tier bindings and preserves the exact payload and key during session refresh', async () => {
    const refreshCount = mockSupabaseSession();
    const calls: { key: string | null; body: unknown }[] = [];
    globalThis.fetch = async (_url, init) => {
      calls.push({
        key: new Headers(init?.headers).get('Idempotency-Key'),
        body: JSON.parse(String(init?.body)),
      });
      if (calls.length === 1) return new Response(null, { status: 401 });
      return Response.json(validRecord({
        auth_type: 'api_key',
        models: {
          quick: { provider: 'openai', model: 'enabled-a' },
          deep: { provider: 'anthropic', model: 'enabled-b' },
        },
      }), { status: 202 });
    };
    const idempotencyKey = 'fd1d6d68-3775-4a20-a1c9-1b9f3fe4e5d6';
    const result = await startAnalysis({
      authType: 'api_key', ticker: 'NVDA', analysisDate: '2026-11-02',
      analysisHorizon: 'long_12m',
      analysts: ['market'], language: 'tr',
      quick: { connectionId: ANALYSIS_ID, model: 'enabled-a' },
      deep: { connectionId: idempotencyKey, model: 'enabled-b' },
    }, idempotencyKey);
    assert.deepEqual(calls, Array(2).fill({
      key: idempotencyKey,
      body: {
        auth_type: 'api_key',
        request: {
          ticker: 'NVDA', analysis_date: '2026-11-02', analysis_horizon: 'long_12m',
          profile: 'standard', language: 'tr', analysts: ['market'],
        },
        models: {
          quick: { connection_id: ANALYSIS_ID, model: 'enabled-a' },
          deep: { connection_id: idempotencyKey, model: 'enabled-b' },
        },
      },
    }));
    assert.equal(refreshCount(), 1);
    assert.equal(result.models?.deep.provider, 'anthropic');
  });

  it('adds, lists, verifies and revokes connections with scoped authorization', async () => {
    mockSupabaseSession();
    const calls: string[] = [];
    const key = 'test-private-provider-key';
    globalThis.fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      calls.push(`${init?.method} ${path}`);
      assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${ACCESS_TOKEN}`);
      if (path === '/v1/connections' && init?.method === 'POST') {
        assert.deepEqual(JSON.parse(String(init.body)), { provider: 'openai', name: 'Kişisel', api_key: key });
        return Response.json({ id: ANALYSIS_ID, status: 'active' }, { status: 201 });
      }
      if (init?.method === 'GET') {
        return Response.json({ items: [{
          id: ANALYSIS_ID, provider: 'openai', name: 'Kişisel', status: 'active',
          created_at: '2026-11-02T12:00:00Z', verified_at: null, unexpected_secret: key,
        }] });
      }
      assert.equal(init?.body, undefined);
      return Response.json({ ok: true });
    };
    await createAnalysisConnection('user-1', 'openai', 'Kişisel', key);
    const items = await fetchAnalysisConnections('user-1');
    await changeAnalysisConnection('user-1', ANALYSIS_ID, 'verify');
    await changeAnalysisConnection('user-1', ANALYSIS_ID, 'remove');
    await assert.rejects(() => fetchAnalysisConnections('other-user'), { code: 'ANALYSIS_AUTH_REQUIRED' });
    assert.deepEqual(calls, [
      'POST /v1/connections', 'GET /v1/connections',
      `POST /v1/connections/${ANALYSIS_ID}/verify`, `DELETE /v1/connections/${ANALYSIS_ID}`,
    ]);
    assert.equal(items[0].provider, 'openai');
    assert.doesNotMatch(JSON.stringify({ items, logs: logger.getRecentLogs() }), /test-private-provider-key/);
  });

  it('surfaces CAPACITY_FULL once and preserves the key for explicit replay', async () => {
    mockSupabaseSession();
    const keys: (string | null)[] = [];
    globalThis.fetch = async (_url, init) => {
      keys.push(new Headers(init?.headers).get('Idempotency-Key'));
      return Response.json({ error: { code: 'CAPACITY_FULL', retryable: true } }, { status: 429 });
    };
    const submit = () => startAnalysis({
      authType: 'personal_chatgpt', ticker: 'NVDA', analysisDate: '2026-11-02',
      analysisHorizon: 'medium_3m',
      analysts: ['market'], language: 'tr', quickModel: 'model', deepModel: 'model',
    }, ANALYSIS_ID);
    await assert.rejects(submit, { code: 'CAPACITY_FULL', isRetryable: true });
    assert.deepEqual(keys, [ANALYSIS_ID]);
    await assert.rejects(submit, { code: 'CAPACITY_FULL' });
    assert.deepEqual(keys, [ANALYSIS_ID, ANALYSIS_ID]);
  });
});
