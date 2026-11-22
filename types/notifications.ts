export interface NotificationPreferences {
  timezone: string;
  earnings_morning: boolean;
  watchlist_earnings: boolean;
  economic_reminders: boolean;
  earnings_today: boolean;
  earnings_tomorrow: boolean;
  earnings_midday: boolean;
  daily_portfolio: boolean;
  countries: ('TR' | 'US')[];
  min_importance: number;
}

export type NotificationDeviceStatus = 'loading' | 'registered' | 'denied' | 'unsupported' | 'error';

export interface DailyPortfolioTarget {
  portfolio_id: string;
  snapshot_id: string;
  currency: 'TRY' | 'USD';
  valuation_date: string;
}
