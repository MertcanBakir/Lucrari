import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '@/services/supabase/client';
import { registerNotificationDevice, pauseAndUnregisterDevice, resumeNotificationRegistration, supportsPush } from '@/services/notifications/device-service';
import { deferred } from './helpers/deferred';

jest.mock('expo-device', () => ({ __esModule: true, isDevice: true }));
jest.mock('expo-constants', () => ({ executionEnvironment: 'standalone' }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
jest.mock('expo-notifications', () => ({
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined), AndroidImportance: { DEFAULT: 3 }, IosAuthorizationStatus: { PROVISIONAL: 3 },
  getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(), getExpoPushTokenAsync: jest.fn(),
  dismissAllNotificationsAsync: jest.fn().mockResolvedValue(undefined), clearLastNotificationResponseAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/services/supabase/client', () => ({ getSupabaseClient: jest.fn() }));
const id = '22222222-2222-4222-8222-222222222222';
const rpc = jest.fn();
const getSession = jest.fn();
beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear(); resumeNotificationRegistration();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  Object.assign(Device, { isDevice: true }); Constants.executionEnvironment = 'standalone' as typeof Constants.executionEnvironment;
  jest.mocked(getSupabaseClient).mockReturnValue({ rpc, auth: { getSession } } as unknown as ReturnType<typeof getSupabaseClient>);
  rpc.mockResolvedValue({ data: id, error: null });
  getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'a' } } } });
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true } as Notifications.NotificationPermissionsStatus);
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({ granted: true } as Notifications.NotificationPermissionsStatus);
  jest.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({ data: 'ExpoPushToken[testing-token-valid]' } as Notifications.ExpoPushToken);
});
it('persists installation and registration, refreshes tokens idempotently, and unregisters before deleting storage', async () => {
  expect(await registerNotificationDevice('a', true)).toBe('registered');
  expect(rpc).toHaveBeenCalledWith('register_push_device', {
    p_installation_id: '11111111-1111-4111-8111-111111111111', p_project_id: 'b44b6f90-e455-41e3-964b-1c3e7f9f4323',
    p_environment: 'production', p_token: 'ExpoPushToken[testing-token-valid]',
  });
  await registerNotificationDevice('a', false);
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  await pauseAndUnregisterDevice('a');
  expect(rpc).toHaveBeenLastCalledWith('unregister_push_device', { p_device_id: id });
  expect(await AsyncStorage.getItem('lucrari.push.device')).toBeNull();
  expect(await AsyncStorage.getItem('lucrari.push.installation')).toBeTruthy();
  expect(await registerNotificationDevice('a', false)).toBe('loading');
});
it('creates Android channel before requesting permissions', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'android' });
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: true } as Notifications.NotificationPermissionsStatus);
  await registerNotificationDevice('a', true);
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('default', expect.objectContaining({ importance: 3 }));
  expect(jest.mocked(Notifications.setNotificationChannelAsync).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(Notifications.requestPermissionsAsync).mock.invocationCallOrder[0]);
});
it.each(['web', 'simulator', 'expo-go'])('does not register on %s', async kind => {
  if (kind === 'web') Object.defineProperty(Platform, 'OS', { value: 'web' });
  if (kind === 'simulator') Object.assign(Device, { isDevice: false });
  if (kind === 'expo-go') Constants.executionEnvironment = 'storeClient' as typeof Constants.executionEnvironment;
  expect(supportsPush()).toBe(false);
  expect(await registerNotificationDevice('a', true)).toBe('unsupported');
  expect(rpc).not.toHaveBeenCalled();
});
it('respects rejection without repeating the system prompt and removes a revoked registration', async () => {
  await registerNotificationDevice('a', true);
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: false } as Notifications.NotificationPermissionsStatus);
  expect(await registerNotificationDevice('a', true)).toBe('denied');
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenLastCalledWith('unregister_push_device', { p_device_id: id });
  expect(await registerNotificationDevice('a', false)).toBe('denied');
});
it('allows provisional iOS permission and rejects invalid stored installations', async () => {
  await AsyncStorage.setItem('lucrari.push.installation', 'bad');
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, ios: { status: 3 } } as Notifications.NotificationPermissionsStatus);
  expect(await registerNotificationDevice('a', false)).toBe('registered');
});
it('does not request permission during a non-interactive refresh', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: true } as Notifications.NotificationPermissionsStatus);
  expect(await registerNotificationDevice('a', false)).toBe('denied');
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});
it('preserves the device record when unregister fails and rejects another owner', async () => {
  await registerNotificationDevice('a', true);
  rpc.mockResolvedValueOnce({ error: { message: 'notification_auth_required' } });
  await expect(pauseAndUnregisterDevice('a')).rejects.toThrow();
  expect(await AsyncStorage.getItem('lucrari.push.device')).toBeTruthy();
  await expect(pauseAndUnregisterDevice('b')).rejects.toThrow(/başka/);
});
it('rejects registration errors and malformed device IDs without logging tokens', async () => {
  rpc.mockResolvedValueOnce({ error: { message: 'notification_device_conflict ExpoPushToken[secret]' } });
  await expect(registerNotificationDevice('a', true)).rejects.not.toThrow('secret');
  rpc.mockResolvedValueOnce({ data: 'bad' });
  await expect(registerNotificationDevice('a', true)).rejects.toThrow();
});
it('waits for an in-flight RPC then releases its device before account change', async () => {
  const pending = deferred<{ data: string }>();
  rpc.mockReturnValueOnce(pending.promise);
  const registering = registerNotificationDevice('a', true);
  for (let i = 0; i < 40 && rpc.mock.calls.length === 0; i++) await Promise.resolve();
  expect(rpc).toHaveBeenCalledTimes(1);
  const releasing = pauseAndUnregisterDevice('a');
  pending.resolve({ data: id });
  await registering; await releasing;
  expect(rpc).toHaveBeenLastCalledWith('unregister_push_device', { p_device_id: id });
  expect(await AsyncStorage.getItem('lucrari.push.device')).toBeNull();
});
it('cancels queued work when cleanup begins while permission or token is pending', async () => {
  const pending = deferred<Notifications.NotificationPermissionsStatus>();
  jest.mocked(Notifications.getPermissionsAsync).mockReturnValueOnce(pending.promise);
  const first = registerNotificationDevice('a', true);
  const queued = registerNotificationDevice('a', true);
  await Promise.resolve(); await Promise.resolve();
  const cleanup = pauseAndUnregisterDevice('a');
  pending.resolve({ granted: true } as Notifications.NotificationPermissionsStatus);
  expect(await first).toBe('loading'); expect(await queued).toBe('loading'); await cleanup;
  expect(rpc).not.toHaveBeenCalled();
  resumeNotificationRegistration();
  const token = deferred<Notifications.ExpoPushToken>();
  jest.mocked(Notifications.getExpoPushTokenAsync).mockReturnValueOnce(token.promise);
  const second = registerNotificationDevice('a', true);
  for (let i = 0; i < 40 && jest.mocked(Notifications.getExpoPushTokenAsync).mock.calls.length === 0; i++) await Promise.resolve();
  const release = pauseAndUnregisterDevice('a');
  token.resolve({ data: 'ExpoPushToken[secret]' } as Notifications.ExpoPushToken);
  expect(await second).toBe('loading'); await release;
  expect(rpc).not.toHaveBeenCalled();
});

it('does not repeat an automatic permission prompt but supports an explicit retry', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: true } as Notifications.NotificationPermissionsStatus);
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce({ granted: false } as Notifications.NotificationPermissionsStatus);
  expect(await registerNotificationDevice('a', true)).toBe('denied');
  expect(await registerNotificationDevice('a', true)).toBe('denied');
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(await registerNotificationDevice('a', true, true)).toBe('registered');
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(2);
});
it('releases an active remote registration if local persistence fails', async () => {
  await AsyncStorage.setItem('lucrari.push.installation', id);
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(registerNotificationDevice('a', true)).rejects.toThrow();
  expect(rpc).toHaveBeenLastCalledWith('unregister_push_device', { p_device_id: id });
  expect(await AsyncStorage.getItem('lucrari.push.device')).toBeNull();
});
it('retains the unsaved device in memory when compensation fails so account cleanup can retry', async () => {
  await AsyncStorage.setItem('lucrari.push.installation', id);
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage unavailable'));
  rpc.mockResolvedValueOnce({ data: id }).mockResolvedValueOnce({ error: { message: 'offline' } });
  await expect(registerNotificationDevice('a', true)).rejects.toThrow();
  await pauseAndUnregisterDevice('a');
  expect(rpc).toHaveBeenLastCalledWith('unregister_push_device', { p_device_id: id });
});

it('rejects stale or expired account sessions before device writes', async () => {
  getSession.mockResolvedValueOnce({ data: { session: null } });
  await expect(registerNotificationDevice('a', true)).rejects.toThrow(/oturumun/);
  expect(rpc).not.toHaveBeenCalled();
  await registerNotificationDevice('a', true);
  getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'other' } } }, error: null });
  await expect(pauseAndUnregisterDevice('a')).rejects.toThrow(/oturumun/);
  expect(await AsyncStorage.getItem('lucrari.push.device')).not.toBeNull();
  await pauseAndUnregisterDevice('a');
});

it('reuses the native token supplied by the listener instead of requesting it recursively', async () => {
  const nativeToken: Notifications.DevicePushToken = { type: 'ios', data: 'private-native-token' };
  expect(await registerNotificationDevice('a', true, false, nativeToken)).toBe('registered');
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
    projectId: 'b44b6f90-e455-41e3-964b-1c3e7f9f4323', devicePushToken: nativeToken,
  });
  expect(await AsyncStorage.getItem('lucrari.push.device')).not.toContain(nativeToken.data);
});
