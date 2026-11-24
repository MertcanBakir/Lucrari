import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRootNavigationState, useRouter } from 'expo-router';
import { useAuth } from '@/context/auth-context';
import { registerNotificationDevice, pauseAndUnregisterDevice, resumeNotificationRegistration, supportsPush } from '@/services/notifications/device-service';
import { setAccountTransitionHandlers } from '@/services/auth/account-transition';
import { isValidUUID } from '@/utils/validation';
import { notificationDestination } from '@/utils/notification-routing';
import { createScopedLogger } from '@/utils/logger';
import type { NotificationDeviceStatus } from '@/types/notifications';

const log = createScopedLogger('Notifications');
const listeners = new Set<() => void>();
let deviceStatus: NotificationDeviceStatus = 'loading';
function publish(status: NotificationDeviceStatus) { deviceStatus = status; listeners.forEach(listener => listener()); }
export function useNotificationDevice() {
  const { userId } = useAuth();
  const [status, setStatus] = useState(deviceStatus);
  useEffect(() => {
    const update = () => setStatus(deviceStatus);
    listeners.add(update);
    update();
    return () => { listeners.delete(update); };
  }, []);
  const retry = useCallback(async () => {
    if (!userId) return;
    publish('loading');
    try { publish(await registerNotificationDevice(userId, true, true)); }
    catch (error) { publish('error'); log.warn('notification.device.registration.failed', { message: 'Notification device registration failed.', error }); }
  }, [userId]);
  return { status, retry };
}

export function useNotificationLifecycle() {
  const { session, userId, isAuthReady } = useAuth();
  const router = useRouter();
  const navigation = useRootNavigationState();
  const [pending, setPending] = useState<{ response: Notifications.NotificationResponse; owner: string | null } | null>(null);
  const seen = useRef(new Set<string>());
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const transitioning = useRef(false);
  const responseGeneration = useRef(0);
  const nativePushToken = useRef<Notifications.DevicePushToken | undefined>(undefined);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!supportsPush()) { publish('unsupported'); return; }
    Notifications.setNotificationHandler({ handleNotification: async () => ({
      shouldPlaySound: !transitioning.current && Boolean(currentUser.current), shouldSetBadge: false,
      shouldShowBanner: !transitioning.current && Boolean(currentUser.current),
      shouldShowList: !transitioning.current && Boolean(currentUser.current),
    }) });
    let active = true;
    const receive = (response: Notifications.NotificationResponse | null) => { if (active && !transitioning.current) setPending(response ? { response, owner: currentUser.current } : null); };
    // Subscribe before reading the cold-start response; deduplication handles both paths.
    const response = Notifications.addNotificationResponseReceivedListener(receive);
    const initialGeneration = responseGeneration.current;
    Notifications.getLastNotificationResponseAsync().then(response => { if (initialGeneration === responseGeneration.current) receive(response); }).catch(() => {
      log.warn('notification.response.read.failed', { message: 'Notification response could not be read.' });
    });
    const token = Notifications.addPushTokenListener(nextToken => {
      const previous = nativePushToken.current;
      if (previous?.type === nextToken.type && previous.data === nextToken.data) return;
      nativePushToken.current = nextToken;
      setRevision(value => value + 1);
    });
    const app = AppState.addEventListener('change', state => { if (state === 'active') setRevision(value => value + 1); });
    setAccountTransitionHandlers(async () => {
      transitioning.current = true;
      responseGeneration.current++;
      setPending(null);
      if (currentUser.current) await pauseAndUnregisterDevice(currentUser.current);
    }, () => {
      transitioning.current = false;
      resumeNotificationRegistration();
      setRevision(value => value + 1);
    });
    return () => {
      active = false; response.remove(); token.remove(); app.remove();
      setAccountTransitionHandlers();
      Notifications.setNotificationHandler(null);
    };
  }, []);

  useEffect(() => {
    if (!isAuthReady || !userId || !supportsPush() || transitioning.current) return;
    let active = true;
    publish('loading');
    registerNotificationDevice(userId, true, false, nativePushToken.current).then(status => { if (active) publish(status); }).catch((error: unknown) => {
      if (active) publish('error');
      log.warn('notification.device.registration.failed', { message: 'Notification device registration failed.', error });
    });
    return () => { active = false; };
  }, [isAuthReady, userId, session, revision]);

  useEffect(() => {
    if (!pending || !isAuthReady || !userId || !navigation?.key || transitioning.current) return;
    if (pending.owner && pending.owner !== userId) { setPending(null); return; }
    const noticeId = pending.response.notification.request.content.data.notification_id;
    const key = `${isValidUUID(noticeId) ? noticeId : pending.response.notification.request.identifier}:${pending.response.actionIdentifier}`;
    if (!seen.current.has(key)) {
      seen.current.add(key);
      if (seen.current.size > 100) seen.current.delete(seen.current.values().next().value!);
      router.push(notificationDestination(pending.response.notification.request.content.data));
    }
    setPending(null);
    Notifications.clearLastNotificationResponseAsync().catch(() => {});
  }, [pending, isAuthReady, userId, navigation?.key, router]);
}
