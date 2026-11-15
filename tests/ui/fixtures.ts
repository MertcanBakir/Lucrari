import type { AnalysisRecord, AnalysisReport } from '@/types/analysis';
import type { PortfolioPosition } from '@/types/database';
import type { PortfolioActivityItem } from '@/types/portfolio-activity';
import type { WatchlistItem } from '@/types/watchlist';
import type { CalendarEventViewModel } from '@/utils/calendar-event-filter';

export const date = '2026-08-31T10:00:00Z';
export const assetId = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

export const position: PortfolioPosition = {
  instrument_id: assetId, market: 'BIST100', symbol: 'THYAO', company_name: 'Türk Hava Yolları',
  currency: 'TRY', is_visible: true, quantity: 8, remaining_cost_basis: 720, average_cost: 90,
  realized_pnl: 15, latest_price: 100, change_percent: 5.26, change_amount: 5,
  price_at: date, provider_code: 'test', price_is_stale: false, price_stale_reason: null,
  market_value: 800, unrealized_pnl: 80,
};

export const activity: PortfolioActivityItem = {
  activityId: 'one-trade', sourceKind: 'TRANSACTION', activityType: 'BUY', portfolioId: 'one-portfolio',
  instrumentId: assetId, symbol: position.symbol, companyName: position.company_name,
  market: 'BIST100', quantity: 8, unitPrice: 100, grossAmount: 800, currency: 'TRY',
  occurredAt: date, createdAt: date, notes: 'İlk alım', isReversed: false,
  reversedAt: null, reversalReason: null, compositeKey: 'TRANSACTION:one-trade',
};

export const watched: WatchlistItem = {
  watchlistId: 'watched-one', instrumentId: assetId, symbol: position.symbol, companyName: position.company_name,
  market: 'BIST100', assetType: 'stock', currency: 'TRY', isActive: true, hasPrice: true, price: 100,
  changeAmount: 5, changePercent: 5.26, priceAt: date, priceIsStale: false, staleReason: null, addedAt: date,
};

export const earnings: CalendarEventViewModel = {
  id: 'one-earnings', type: 'earnings', dateKey: '2026-08-31', timeLabel: 'Seans Öncesi',
  title: position.symbol, subtitle: position.company_name, marketOrCountry: 'BIST 100',
  period: '2026/Q2', session: 'pre_market', sourceUrl: 'https://example.com/filing',
  instrumentId: assetId, market: 'BIST100', isInPortfolio: true, portfolioQuantity: 8, isInWatchlist: true,
};

export const economic: CalendarEventViewModel = {
  id: 'one-economic', type: 'economic', dateKey: '2026-08-31', timeLabel: '14:00',
  title: 'TÜFE', subtitle: 'Temmuz', marketOrCountry: 'Türkiye', period: 'Temmuz', country: 'TR',
  sourceUrl: null, instrumentId: null, market: null, isInPortfolio: false, portfolioQuantity: null,
  isInWatchlist: false,
};

export const analysis: AnalysisRecord = {
  id: '45834309-dbef-4d43-a7ed-7619118a2af9', status: 'success', stage: 'finished',
  ticker: 'AAPL', createdAt: date, startedAt: date, finishedAt: date, errorCode: null,
  analysisDate: '2026-08-31', analysisHorizon: 'long_12m', replayed: false,
  authType: 'personal_chatgpt',
};

export const report: AnalysisReport = {
  sections: [
    { code: 'summary', title: 'Analiz özeti', contentMarkdown: '**Rapor hazır**', parts: { neutral: 'Nötr görüş' } },
    { code: 'disclaimer', title: 'Yasal uyarı', contentMarkdown: 'Yatırım tavsiyesi değildir.', parts: {} },
  ],
  effectiveConfig: {
    quick: { provider: 'chatgpt', model: 'quick-model' }, deep: { provider: 'chatgpt', model: 'deep-model' },
    researchRounds: 1, riskRounds: 1, analysts: ['market'], language: 'tr',
  },
  upstreamVersion: '0.7.0',
};
