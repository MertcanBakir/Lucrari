import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { getSupabaseClient } from '@/services/supabase/client';
import { isValidUUID } from '@/utils/validation';
import { notificationError } from './preferences-service';
import type { NotificationDeviceStatus } from '@/types/notifications';

const INSTALLATION_KEY = 'lucrari.push.installation';
const DEVICE_KEY = 'lucrari.push.device';
const PERMISSION_KEY = 'lucrari.push.permissionRequested';
const PROJECT_ID = 'b44b6f90-e455-41e3-964b-1c3e7f9f4323';
let queue: Promise<unknown> = Promise.resolve();
let paused = false;
let generation = 0;
let unsavedDevice: { id: string; userId: string } | null = null;

export function supportsPush() {
  return Platform.OS !== 'web' && Device.isDevice && Constants.executionEnvironment !== 'storeClient';
}
async function assertSessionOwner(userId: string) {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error || data.session?.user.id !== userId) throw notificationError({ message: 'notification_auth_required' });
}
function serialized<T>(action: () => Promise<T>): Promise<T> {
  const result = queue.then(action);
  queue = result.catch(() => {});
  return result;
}

export function registerNotificationDevice(userId: string, requestPermission: boolean, manual = false, devicePushToken?: Notifications.DevicePushToken): Promise<NotificationDeviceStatus> {
  const revision = generation;
  return serialized(async () => {
    if (!supportsPush()) return 'unsupported';
    if (paused || revision !== generation) return 'loading';
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Portföy ve ekonomik takvim', importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain && requestPermission && (manual || !await AsyncStorage.getItem(PERMISSION_KEY))) {
      await AsyncStorage.setItem(PERMISSION_KEY, 'true');
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) {
      await removeStoredDevice(userId);
      return 'denied';
    }
    if (paused || revision !== generation) return 'loading';
    let installation = await AsyncStorage.getItem(INSTALLATION_KEY);
    if (!isValidUUID(installation)) {
      installation = Crypto.randomUUID();
      await AsyncStorage.setItem(INSTALLATION_KEY, installation);
    }
    // Reuse the token delivered by the native listener. Asking APNs/FCM for it
    // again emits that same listener and can recursively restart registration.
    const token = (await Notifications.getExpoPushTokenAsync({
      projectId: PROJECT_ID, ...(devicePushToken ? { devicePushToken } : {}),
    })).data;
    if (paused || revision !== generation) return 'loading';
    await assertSessionOwner(userId);
    if (paused || revision !== generation) return 'loading';
    const { data, error } = await getSupabaseClient().rpc('register_push_device', {
      p_installation_id: installation, p_project_id: PROJECT_ID, p_environment: 'production', p_token: token,
    });
    if (error) throw notificationError(error);
    if (!isValidUUID(data)) throw notificationError(null);
    // Persist even when cleanup started during the RPC, so queued cleanup can release it.
    unsavedDevice = { id: data, userId };
    try {
      await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify(unsavedDevice));
      unsavedDevice = null;
    } catch {
      // Do not leave an untracked active device if durable storage fails.
      await removeStoredDevice(userId);
      throw notificationError(null);
    }
    return 'registered';
  });
}

async function removeStoredDevice(userId: string): Promise<void> {
  const stored = unsavedDevice ? null : await AsyncStorage.getItem(DEVICE_KEY);
  if (!unsavedDevice && !stored) return;
  const record = unsavedDevice ?? JSON.parse(stored!) as { id: unknown; userId: unknown };
  if (!isValidUUID(record.id) || record.userId !== userId) throw notificationError({ message: 'notification_device_conflict' });
  await assertSessionOwner(userId);
  const { error } = await getSupabaseClient().rpc('unregister_push_device', { p_device_id: record.id });
  if (error) throw notificationError(error);
  await AsyncStorage.removeItem(DEVICE_KEY);
  unsavedDevice = null;
}

export async function pauseAndUnregisterDevice(userId: string): Promise<void> {
  paused = true;
  generation++;
  await serialized(() => removeStoredDevice(userId));
  await Notifications.dismissAllNotificationsAsync();
  await Notifications.clearLastNotificationResponseAsync();
}
export function resumeNotificationRegistration() { paused = false; }
