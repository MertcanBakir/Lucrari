import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRootNavigationState, useRouter } from 'expo-router';
import { useAuth } from '@/context/auth-context';
import { useNotificationLifecycle, useNotificationDevice } from '@/hooks/use-notifications';
import { registerNotificationDevice, pauseAndUnregisterDevice, resumeNotificationRegistration, supportsPush } from '@/services/notifications/device-service';
import { withAccountTransition } from '@/services/auth/account-transition';
import { deferred } from '../helpers/deferred';

jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useRootNavigationState: jest.fn() }));
jest.mock('@/services/notifications/device-service', () => ({ registerNotificationDevice: jest.fn(), pauseAndUnregisterDevice: jest.fn(), resumeNotificationRegistration: jest.fn(), supportsPush: jest.fn() }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(), addNotificationResponseReceivedListener: jest.fn(), getLastNotificationResponseAsync: jest.fn(),
  addPushTokenListener: jest.fn(), clearLastNotificationResponseAsync: jest.fn(),
}));
const push = jest.fn();
const removeResponse = jest.fn(); const removeToken = jest.fn();
const id = '11111111-1111-4111-8111-111111111111';
const response = (identifier = 'push-a') => ({ actionIdentifier: 'default', notification: { request: { identifier, content: { data: {
  schema_version: 1, type: 'economic_reminder', notification_id: id, event_date: '2026-11-19',
  event_id: id, scheduled_at: '2026-11-19T12:00:00Z', minutes_before: 60,
} } } } } as unknown as Notifications.NotificationResponse);
const auth = (userId: string | null, ready = true) => jest.mocked(useAuth).mockReturnValue({ userId, isAuthReady: ready, session: null } as ReturnType<typeof useAuth>);
const receive = () => jest.mocked(Notifications.addNotificationResponseReceivedListener).mock.lastCall![0];
const mount = () => renderHook(() => { useNotificationLifecycle(); return useNotificationDevice(); });
beforeEach(() => {
  jest.clearAllMocks(); auth('a');
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  jest.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useRootNavigationState).mockReturnValue({ key: 'root' } as ReturnType<typeof useRootNavigationState>);
  jest.mocked(supportsPush).mockReturnValue(true);
  jest.mocked(registerNotificationDevice).mockReset().mockResolvedValue('registered');
  jest.mocked(pauseAndUnregisterDevice).mockResolvedValue(undefined);
  jest.mocked(Notifications.getLastNotificationResponseAsync).mockReset().mockResolvedValue(null);
  jest.mocked(Notifications.clearLastNotificationResponseAsync).mockResolvedValue(undefined);
  jest.mocked(Notifications.addNotificationResponseReceivedListener).mockReturnValue({ remove: removeResponse });
  jest.mocked(Notifications.addPushTokenListener).mockReturnValue({ remove: removeToken });
});
it('registers after auth, queues cold-start navigation until ready, and handles one tap once', async () => {
  auth(null, false);
  jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValue(response());
  const hook = mount();
  await act(async () => {});
  expect(push).not.toHaveBeenCalled(); expect(registerNotificationDevice).not.toHaveBeenCalled();
  auth('a'); jest.mocked(useRootNavigationState).mockReturnValue({ key: '' } as ReturnType<typeof useRootNavigationState>); hook.rerender({});
  expect(push).not.toHaveBeenCalled();
  jest.mocked(useRootNavigationState).mockReturnValue({ key: 'ready' } as ReturnType<typeof useRootNavigationState>); hook.rerender({});
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  expect(push).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ date: '2026-11-19', filter: 'economic' }) }));
  act(() => receive()(response())); expect(push).toHaveBeenCalledTimes(1);
  act(() => receive()(response('push-b'))); expect(push).toHaveBeenCalledTimes(1);
  const other = response('push-c'); other.notification.request.content.data.notification_id = '22222222-2222-4222-8222-222222222222';
  act(() => receive()(other)); expect(push).toHaveBeenCalledTimes(2);
  hook.unmount(); expect(removeResponse).toHaveBeenCalled(); expect(removeToken).toHaveBeenCalled();
});
it('retries registration after errors, token rotation and app foregrounding', async () => {
  const appSpy = jest.spyOn(AppState, 'addEventListener');
  jest.mocked(registerNotificationDevice).mockRejectedValueOnce(Error('ExpoPushToken[secret]'));
  const hook = mount();
  await waitFor(() => expect(hook.result.current.status).toBe('error'));
  await act(async () => hook.result.current.retry());
  expect(hook.result.current.status).toBe('registered');
  act(() => jest.mocked(Notifications.addPushTokenListener).mock.lastCall![0]({ type: 'ios', data: 'changed' }));
  await waitFor(() => expect(registerNotificationDevice).toHaveBeenCalledTimes(3));
  act(() => appSpy.mock.calls[0][1]('background'));
  expect(registerNotificationDevice).toHaveBeenCalledTimes(3);
  act(() => appSpy.mock.calls[0][1]('active'));
  await waitFor(() => expect(registerNotificationDevice).toHaveBeenCalledTimes(4));

});
it('releases registration before account mutation and suppresses notifications during transition', async () => {
  const hook = mount(); await waitFor(() => expect(hook.result.current.status).toBe('registered'));
  const pending = deferred<void>(); jest.mocked(pauseAndUnregisterDevice).mockReturnValueOnce(pending.promise);
  const change = jest.fn().mockResolvedValue(undefined);
  let transition: Promise<void>;
  act(() => { transition = withAccountTransition(change); });
  expect(change).not.toHaveBeenCalled();
  act(() => receive()(response())); expect(push).not.toHaveBeenCalled();
  const handler = jest.mocked(Notifications.setNotificationHandler).mock.calls[0][0]!;
  expect(await handler.handleNotification({} as Notifications.Notification)).toMatchObject({ shouldShowBanner: false });
  await act(async () => { pending.resolve(); await transition; });
  expect(change).toHaveBeenCalledTimes(1); expect(resumeNotificationRegistration).toHaveBeenCalled();
  expect(await handler.handleNotification({} as Notifications.Notification)).toMatchObject({ shouldShowBanner: true });
});
it('discards a delayed cold-start response after account transition and after unmount', async () => {
  const initial = deferred<Notifications.NotificationResponse | null>();
  jest.mocked(Notifications.getLastNotificationResponseAsync).mockReturnValueOnce(initial.promise);
  const hook = mount();
  await act(async () => withAccountTransition(async () => {}));
  await act(async () => initial.resolve(response()));
  expect(push).not.toHaveBeenCalled();
  hook.unmount(); act(() => receive()(response())); expect(push).not.toHaveBeenCalled();
});
it('does not open a queued response under a different user', async () => {
  jest.mocked(useRootNavigationState).mockReturnValue({ key: '' } as ReturnType<typeof useRootNavigationState>);
  const hook = mount(); await act(async () => {});
  act(() => receive()(response()));
  auth('b'); jest.mocked(useRootNavigationState).mockReturnValue({ key: 'ready' } as ReturnType<typeof useRootNavigationState>); hook.rerender({});
  expect(push).not.toHaveBeenCalled();
});
it('reports unsupported surfaces without native listeners', async () => {
  jest.mocked(supportsPush).mockReturnValue(false);
  const hook = mount();
  expect(hook.result.current.status).toBe('unsupported');
  expect(Notifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
});
it('safely handles initial response lookup failure and retry errors', async () => {
  jest.mocked(Notifications.getLastNotificationResponseAsync).mockRejectedValueOnce(Error('offline'));
  const hook = mount(); await act(async () => {});
  jest.mocked(registerNotificationDevice).mockRejectedValueOnce(Error('offline'));
  await act(async () => hook.result.current.retry()); expect(hook.result.current.status).toBe('error');
  auth(null); hook.rerender({});
  const count = jest.mocked(registerNotificationDevice).mock.calls.length;
  await act(async () => hook.result.current.retry()); expect(registerNotificationDevice).toHaveBeenCalledTimes(count);
});
it('ignores registration results and errors after unmount', async () => {
  const pending = deferred<'registered'>(); jest.mocked(registerNotificationDevice).mockReturnValueOnce(pending.promise);
  const hook = mount(); hook.unmount(); await act(async () => pending.resolve('registered'));
  const rejected = deferred<'registered'>(); jest.mocked(registerNotificationDevice).mockReturnValueOnce(rejected.promise);
  const second = mount(); second.unmount(); await act(async () => rejected.reject(Error('offline')));
});

it('settles registration when acquiring a token emits the native token listener, without a feedback loop', async () => {
  const nativeToken: Notifications.DevicePushToken = { type: 'ios', data: 'private-native-token' };
  let attempts = 0;
  jest.mocked(registerNotificationDevice).mockImplementation(async (_user, _permission, _manual, suppliedToken) => {
    attempts++;
    // The actual Expo SDK emits this callback during getDevicePushTokenAsync.
    // Bound the reproduction so the old implementation fails without hanging Jest.
    if (!suppliedToken && attempts < 4) jest.mocked(Notifications.addPushTokenListener).mock.lastCall![0](nativeToken);
    return 'registered';
  });
  const hook = mount();
  await waitFor(() => expect(hook.result.current.status).toBe('registered'));
  expect(registerNotificationDevice).toHaveBeenCalledTimes(2);
  expect(registerNotificationDevice).toHaveBeenLastCalledWith('a', true, false, nativeToken);
  act(() => jest.mocked(Notifications.addPushTokenListener).mock.lastCall![0]({ ...nativeToken }));
  await act(async () => {});
  expect(registerNotificationDevice).toHaveBeenCalledTimes(2);
  const rotated: Notifications.DevicePushToken = { type: 'ios', data: 'private-rotated-token' };
  act(() => jest.mocked(Notifications.addPushTokenListener).mock.lastCall![0](rotated));
  await waitFor(() => expect(registerNotificationDevice).toHaveBeenCalledTimes(3));
  expect(registerNotificationDevice).toHaveBeenLastCalledWith('a', true, false, rotated);
  await waitFor(() => expect(hook.result.current.status).toBe('registered'));
});

it('shows foreground notifications without automatic navigation and routes all seven v2 tap types', async () => {
  const hook = mount(); await act(async () => {});
  const handler = jest.mocked(Notifications.setNotificationHandler).mock.calls[0][0]!;
  expect(await handler.handleNotification({} as Notifications.Notification)).toMatchObject({ shouldShowBanner: true, shouldShowList: true });
  expect(push).not.toHaveBeenCalled();
  const types = ['earnings_morning', 'earnings_midday', 'daily_portfolio', 'watchlist_earnings', 'economic_reminder', 'earnings_today', 'earnings_tomorrow'];
  for (const [index, type] of types.entries()) {
    const tapped = response(`v2-${type}`);
    tapped.notification.request.content.data = {
      schema_version: 1, type, notification_id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      event_date: '2026-12-01', event_id: id, instrument_id: id, portfolio_id: id, snapshot_id: id,
      currency: 'TRY', valuation_date: '2026-12-01', scheduled_at: '2026-12-01T08:00:00Z', minutes_before: 15,
    };
    act(() => receive()(tapped));
  }
  expect(push).toHaveBeenCalledTimes(7);
  expect(push.mock.calls.map(([destination]) => [destination.pathname, destination.params?.filter])).toEqual([
    ['/(tabs)', 'portfolio'], ['/(tabs)', 'earnings'], ['/notification-portfolio', undefined],
    ['/(tabs)', 'watchlist'], ['/(tabs)', 'economic'], ['/(tabs)', 'earnings'], ['/(tabs)', 'earnings'],
  ]);
  expect(push.mock.calls[4][0].params.economicEvent).toBe(id);
  expect(push.mock.calls[6][0].params.date).toBe('2026-12-01');
  hook.unmount();
});
