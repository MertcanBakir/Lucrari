import { fetchNotificationPortfolioSummary } from '@/services/notifications/portfolio-summary-service';
import { getSupabaseClient } from '@/services/supabase/client';
jest.mock('@/services/supabase/client', () => ({ getSupabaseClient: jest.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
const target = { portfolio_id: id, snapshot_id: id, currency: 'TRY' as const, valuation_date: '2026-11-19' };
const snapshot = { snapshot_date: target.valuation_date, base_currency: 'TRY', total_value_base: '1000', absolute_pnl_base: '100', valuation_status: 'success', calculation_version: 2, captured_at: null };
const previous = { ...snapshot, absolute_pnl_base: '80' };
const maybeSingle = jest.fn();
const query = { select: jest.fn(), eq: jest.fn(), maybeSingle };
const from = jest.fn(() => query);
beforeEach(() => {
  jest.clearAllMocks(); maybeSingle.mockReset();
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  maybeSingle.mockResolvedValueOnce({ data: snapshot }).mockResolvedValueOnce({ data: previous });
  jest.mocked(getSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<typeof getSupabaseClient>);
});
it('loads the exact owned snapshot and calculates daily PNL from absolute PNL, not portfolio deposits', async () => {
  expect(await fetchNotificationPortfolioSummary(target)).toEqual({ date: target.valuation_date, currency: 'TRY', dailyPnl: 20, capturedAt: null });
  expect(from).toHaveBeenCalledWith('portfolio_snapshots');
  expect(query.select.mock.calls[0][0]).not.toContain('total_value_base');
  expect(query.eq.mock.calls).toEqual([['id', id], ['portfolio_id', id], ['snapshot_date', '2026-11-19'], ['portfolio_id', id], ['snapshot_date', '2026-11-18']]);
});
it.each([null, { ...snapshot, base_currency: 'USD' }, { ...snapshot, valuation_status: 'partial' }, { ...snapshot, calculation_version: 1 }])('rejects missing, inaccessible or incompatible snapshot %j', async data => {
  maybeSingle.mockReset().mockResolvedValueOnce({ data });
  await expect(fetchNotificationPortfolioSummary(target)).rejects.toThrow(/erişilemiyor/);
});
it.each([null, { ...previous, valuation_status: 'partial' }, { ...previous, calculation_version: 1 }, { ...previous, base_currency: 'USD' }])('keeps missing daily change distinct from zero %j', async data => {
  maybeSingle.mockReset().mockResolvedValueOnce({ data: snapshot }).mockResolvedValueOnce({ data });
  expect((await fetchNotificationPortfolioSummary(target)).dailyPnl).toBeNull();
});
it.each([null, '', false, {}, 'NaN', Infinity])('rejects invalid monetary values %j', async value => {
  maybeSingle.mockReset().mockResolvedValueOnce({ data: { ...snapshot, absolute_pnl_base: value } }).mockResolvedValueOnce({ data: previous });
  await expect(fetchNotificationPortfolioSummary(target)).rejects.toThrow();
});
it('handles negative changes, exact zero and month boundaries', async () => {
  maybeSingle.mockReset().mockResolvedValueOnce({ data: { ...snapshot, total_value_base: 0, absolute_pnl_base: -20 } }).mockResolvedValueOnce({ data: { ...previous, absolute_pnl_base: 10 } });
  expect(await fetchNotificationPortfolioSummary({ ...target, valuation_date: '2026-03-01' })).toMatchObject({ dailyPnl: -30 });
  expect(query.eq).toHaveBeenCalledWith('snapshot_date', '2026-02-28');
});
it('fails safely for invalid targets and both database failures', async () => {
  await expect(fetchNotificationPortfolioSummary({ ...target, portfolio_id: 'bad' })).rejects.toThrow();
  maybeSingle.mockReset().mockResolvedValueOnce({ error: { message: 'secret' } });
  await expect(fetchNotificationPortfolioSummary(target)).rejects.not.toThrow('secret');
  maybeSingle.mockResolvedValueOnce({ data: snapshot }).mockResolvedValueOnce({ error: { message: 'secret' } });
  await expect(fetchNotificationPortfolioSummary(target)).rejects.not.toThrow('secret');
});
