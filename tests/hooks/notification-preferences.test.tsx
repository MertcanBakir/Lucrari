import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAuth } from '@/context/auth-context';
import { useNotificationPreferences } from '@/hooks/use-notification-preferences';
import { getNotificationPreferences, setNotificationPreferences } from '@/services/notifications/preferences-service';
import { deferred } from '../helpers/deferred';
import type { NotificationPreferences } from '@/types/notifications';
jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/services/notifications/preferences-service', () => ({
  ...jest.requireActual('@/services/notifications/preferences-service'), getNotificationPreferences: jest.fn(), setNotificationPreferences: jest.fn(),
}));
const p: NotificationPreferences = { timezone: 'Europe/Istanbul', earnings_morning: true, watchlist_earnings: true, economic_reminders: true, earnings_today: true, earnings_tomorrow: true, earnings_midday: true, daily_portfolio: true, countries: ['TR', 'US'], min_importance: 1 };
const auth = (userId: string | null, ready = true) => jest.mocked(useAuth).mockReturnValue({ userId, isAuthReady: ready } as ReturnType<typeof useAuth>);
beforeEach(() => {
  jest.clearAllMocks(); auth('a');
  jest.mocked(getNotificationPreferences).mockReset().mockResolvedValue(p);
  jest.mocked(setNotificationPreferences).mockReset().mockResolvedValue(undefined);
});
it('waits for auth, edits preferences and deduplicates saves', async () => {
  auth(null, false); const hook = renderHook(() => useNotificationPreferences());
  expect(getNotificationPreferences).not.toHaveBeenCalled();
  await act(async () => hook.result.current.save());
  auth('a'); hook.rerender({});
  await waitFor(() => expect(hook.result.current.preferences).toEqual(p));
  act(() => hook.result.current.update({ ...p, daily_portfolio: false }));
  const pending = deferred<void>(); jest.mocked(setNotificationPreferences).mockReturnValueOnce(pending.promise);
  let save: Promise<void>;
  act(() => { save = hook.result.current.save(); void hook.result.current.save(); });
  expect(setNotificationPreferences).toHaveBeenCalledTimes(1);
  expect(hook.result.current.saving).toBe(true);
  await act(async () => { pending.resolve(); await save; });
  expect(hook.result.current.saved).toBe(true);
  act(() => hook.result.current.update(p)); expect(hook.result.current.saved).toBe(false);
});
it('reports load and save failures and retries without claiming success', async () => {
  jest.mocked(getNotificationPreferences).mockRejectedValueOnce(Error('offline'));
  const hook = renderHook(() => useNotificationPreferences());
  await waitFor(() => expect(hook.result.current.error).toBeTruthy());
  await act(async () => hook.result.current.reload());
  jest.mocked(setNotificationPreferences).mockRejectedValueOnce(Error('offline'));
  await act(async () => hook.result.current.save());
  expect(hook.result.current.saved).toBe(false); expect(hook.result.current.error).toBeTruthy();
  await act(async () => hook.result.current.save()); expect(hook.result.current.error).toBeNull();
});
it('discards late loads across users and unmounts', async () => {
  const pending = deferred<NotificationPreferences>();
  jest.mocked(getNotificationPreferences).mockReturnValueOnce(pending.promise);
  const hook = renderHook(() => useNotificationPreferences());
  auth('b'); hook.rerender({});
  expect(hook.result.current.preferences).toBeNull();
  await waitFor(() => expect(hook.result.current.preferences).toEqual(p));
  await act(async () => pending.resolve({ ...p, timezone: 'UTC' }));
  expect(hook.result.current.preferences?.timezone).toBe('Europe/Istanbul');
  jest.mocked(getNotificationPreferences).mockRejectedValueOnce(Error('late'));
  act(() => { void hook.result.current.reload(); }); hook.unmount();
  await act(async () => {});
});
it('does not publish a late save into another account', async () => {
  const hook = renderHook(() => useNotificationPreferences());
  await waitFor(() => expect(hook.result.current.preferences).toEqual(p));
  const pending = deferred<void>(); jest.mocked(setNotificationPreferences).mockReturnValueOnce(pending.promise);
  act(() => { void hook.result.current.save(); });
  auth('b'); hook.rerender({});
  await act(async () => pending.resolve());
  expect(hook.result.current.saved).toBe(false);
});

it('does not fetch notification preferences for ordinary calendar visits', () => {
  renderHook(() => useNotificationPreferences(false));
  expect(getNotificationPreferences).not.toHaveBeenCalled();
});

it('saves the complete v2 state while changing one independent preference', async () => {
  const hook = renderHook(() => useNotificationPreferences());
  await waitFor(() => expect(hook.result.current.preferences).toEqual(p));
  act(() => hook.result.current.update({ ...p, economic_reminders: false, earnings_tomorrow: false }));
  await act(async () => hook.result.current.save());
  expect(setNotificationPreferences).toHaveBeenCalledWith({ ...p, economic_reminders: false, earnings_tomorrow: false });
  expect(hook.result.current.saved).toBe(true);
});
