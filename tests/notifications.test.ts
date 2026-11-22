import { notificationDestination, isNotificationDate, parseDailyPortfolioTarget } from '@/utils/notification-routing';
import { getNotificationPreferences, setNotificationPreferences, parseNotificationPreferences, notificationError } from '@/services/notifications/preferences-service';
import { getSupabaseClient } from '@/services/supabase/client';
import { setAccountTransitionHandlers, withAccountTransition } from '@/services/auth/account-transition';

jest.mock('@/services/supabase/client', () => ({ getSupabaseClient: jest.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
const preferences = { timezone: 'Europe/Istanbul', earnings_morning: true, watchlist_earnings: true, economic_reminders: true, earnings_today: true, earnings_tomorrow: true, earnings_midday: true, daily_portfolio: true, countries: ['TR', 'US'], min_importance: 1 };
const payload = { schema_version: 1, notification_id: id, event_date: '2026-11-19' };
const rpc = jest.fn();
beforeEach(() => {
  jest.clearAllMocks(); setAccountTransitionHandlers();
  jest.mocked(getSupabaseClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getSupabaseClient>);
  rpc.mockResolvedValue({ data: preferences, error: null });
});
it.each(['earnings_morning', 'macro_morning'])('routes %s to a full date query, ignoring truncated ID hints', type => {
  const route = notificationDestination({ ...payload, type, instrument_ids: [id], count: 100 });
  expect(route).toEqual({ pathname: '/(tabs)', params: { date: payload.event_date, notification: id, filter: type === 'macro_morning' ? 'economic' : 'portfolio' } });
});
it('routes a specific earnings event and exact portfolio snapshot', () => {
  expect(notificationDestination({ ...payload, type: 'earnings_midday', instrument_id: id, event_id: id })).toMatchObject({ params: { event: id, instrument: id } });
  const target = { portfolio_id: id, snapshot_id: id, currency: 'USD', valuation_date: '2026-11-19' };
  expect(notificationDestination({ ...payload, ...target, type: 'daily_portfolio' })).toEqual({ pathname: '/notification-portfolio', params: target });
});
it.each([null, 'url', [], {}, { ...payload, schema_version: 2 }, { ...payload, notification_id: 'bad' },
  { ...payload, event_date: '2026-02-30' }, { ...payload, type: 'analysis_ready' }, { ...payload, type: 'earnings_midday' },
  { ...payload, type: 'daily_portfolio' }, { ...payload, type: 'arbitrary', url: 'https://example.test' }])('fails closed for unsupported payload %j', data => {
  expect(notificationDestination(data)).toEqual({ pathname: '/(tabs)' });
});
it.each(['2026-02-29', 'bad', null, '2026-1-01', '2026-13-01', '2026-01-00'])('rejects invalid date %j', date => expect(isNotificationDate(date)).toBe(false));
it('accepts leap days and validates every portfolio target field', () => {
  expect(isNotificationDate('2028-02-29')).toBe(true);
  const target = { portfolio_id: id, snapshot_id: id, currency: 'TRY', valuation_date: '2026-11-19' };
  expect(parseDailyPortfolioTarget(target)).toEqual(target);
  for (const field of Object.keys(target)) expect(parseDailyPortfolioTarget({ ...target, [field]: 'invalid' })).toBeNull();
});
it('reads preferences through RPC and writes every v2 preference argument', async () => {
  const p = await getNotificationPreferences();
  expect(p).toEqual(preferences);
  expect(rpc).toHaveBeenCalledWith('get_notification_preferences_v2');
  await setNotificationPreferences(p);
  expect(rpc).toHaveBeenLastCalledWith('set_notification_preferences_v2', {
    p_timezone: p.timezone, p_earnings_morning: true, p_watchlist_earnings: true, p_economic_reminders: true, p_earnings_today: true, p_earnings_tomorrow: true, p_earnings_midday: true,
    p_daily_portfolio: true, p_countries: ['TR', 'US'], p_min_importance: 1,
  });
});
it.each([null, {}, { ...preferences, timezone: '' }, { ...preferences, timezone: 'invalid/zone' },
  { ...preferences, earnings_morning: null }, { ...preferences, countries: ['GB'] }, { ...preferences, countries: null },
  { ...preferences, min_importance: 0 }, { ...preferences, min_importance: 4 }, { ...preferences, min_importance: 1.5 }])('rejects malformed preferences %j', raw => {
  expect(() => parseNotificationPreferences(raw)).toThrow();
});
it('supports no countries, all flags disabled, inclusive importance and deduplicated countries', () => {
  expect(parseNotificationPreferences({ ...preferences, countries: [], min_importance: 3, daily_portfolio: false })).toMatchObject({ countries: [], min_importance: 3, daily_portfolio: false });
  expect(parseNotificationPreferences({ ...preferences, countries: ['TR', 'TR'] }).countries).toEqual(['TR']);
});
it.each(['notification_auth_required', 'notification_invalid_device', 'notification_device_conflict', 'notification_invalid_preferences', 'unknown ExpoPushToken[secret]'])('sanitizes RPC failures %s', async message => {
  rpc.mockResolvedValue({ error: { message } });
  await expect(getNotificationPreferences()).rejects.toThrow();
  await expect(setNotificationPreferences(parseNotificationPreferences(preferences))).rejects.toThrow();
  expect(notificationError({ message }).message).not.toContain('ExpoPushToken');
});
it('sanitizes thrown transport errors and invalid preference responses', async () => {
  rpc.mockRejectedValue(new Error('secret token'));
  await expect(getNotificationPreferences()).rejects.not.toThrow('secret');
  await expect(setNotificationPreferences(parseNotificationPreferences(preferences))).rejects.not.toThrow('secret');
  rpc.mockResolvedValue({ data: null });
  await expect(getNotificationPreferences()).rejects.toThrow();
});
it('unregisters before changing an account and always resumes after failure', async () => {
  const calls: string[] = [];
  setAccountTransitionHandlers(async () => { calls.push('release'); }, () => { calls.push('resume'); });
  expect(await withAccountTransition(async () => { calls.push('account'); return 1; })).toBe(1);
  expect(calls).toEqual(['release', 'account', 'resume']);
  const action = jest.fn();
  setAccountTransitionHandlers(async () => { throw Error('offline'); }, () => calls.push('resume'));
  await expect(withAccountTransition(action)).rejects.toThrow('offline');
  expect(action).not.toHaveBeenCalled();
  setAccountTransitionHandlers();
  await expect(withAccountTransition(async () => 2)).resolves.toBe(2);
});

it.each(['watchlist_earnings', 'economic_reminders', 'earnings_today', 'earnings_tomorrow'])('requires the independent v2 field %s', field => {
  expect(() => parseNotificationPreferences({ ...preferences, [field]: undefined })).toThrow();
});
it('preserves every disabled switch and the backend timezone when saving a country change', async () => {
  const p = parseNotificationPreferences({ ...preferences, timezone: 'UTC', countries: ['US'], earnings_morning: false,
    earnings_midday: false, daily_portfolio: false, watchlist_earnings: false, economic_reminders: false,
    earnings_today: false, earnings_tomorrow: false });
  await setNotificationPreferences(p);
  expect(rpc).toHaveBeenCalledWith('set_notification_preferences_v2', {
    p_timezone: 'UTC', p_countries: ['US'], p_min_importance: 1,
    p_earnings_morning: false, p_earnings_midday: false, p_daily_portfolio: false, p_watchlist_earnings: false,
    p_economic_reminders: false, p_earnings_today: false, p_earnings_tomorrow: false,
  });
});
it.each([['earnings_today', 'earnings'], ['earnings_tomorrow', 'earnings'], ['watchlist_earnings', 'watchlist']])('opens %s on the payload event date with its full authorized list', (type, filter) => {
  expect(notificationDestination({ ...payload, event_date: '2026-12-01', type, count: 57, instrument_ids: [id], content_hash: 'opaque' })).toEqual({
    pathname: '/(tabs)', params: { date: '2026-12-01', notification: id, filter },
  });
});
it('opens an economic reminder by event, including a cross-midnight event date', () => {
  expect(notificationDestination({ ...payload, event_date: '2026-12-01', type: 'economic_reminder', event_id: id,
    scheduled_at: '2026-11-30T22:00:00+00:00', minutes_before: 180 })).toEqual({
    pathname: '/(tabs)', params: { date: '2026-12-01', notification: id, filter: 'economic', economicEvent: id },
  });
});
it.each([{}, { event_id: 'bad' }, { event_id: id, scheduled_at: 'bad', minutes_before: 60 },
  { event_id: id, scheduled_at: '2026-11-19T12:00:00Z', minutes_before: 30 }])('safely defaults malformed economic reminders %j', fields => {
  expect(notificationDestination({ ...payload, type: 'economic_reminder', ...fields })).toEqual({ pathname: '/(tabs)' });
});
