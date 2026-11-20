/** Real Supabase Auth SDK and the app storage adapter, with only device storage and HTTP replaced. */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { getSupabaseClient, resetSupabaseClient } from '@/services/supabase/client';
import { ensureAnonymousSession, resetAuthLock } from '@/services/auth/auth-service';
import { getSupabaseConfig } from '@/services/supabase/config';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('@/services/supabase/config', () => ({ getSupabaseConfig: jest.fn() }));
const disk = new Map<string, string>();
let anonymousCount = 0;
let http: jest.SpyInstance;
const anonymousId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const registeredId = '00000000-0000-4000-8000-999999999999';
function authResponse(id: string, anonymous: boolean) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: id, aud: 'authenticated', exp: now + 3600, iat: now })).toString('base64url');
  return { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-signature`, refresh_token: `test-refresh-${id}`,
    expires_in: 3600, token_type: 'bearer', user: { id, aud: 'authenticated', role: 'authenticated',
      created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, is_anonymous: anonymous } };
}
function restart() {
  getSupabaseClient().auth.stopAutoRefresh();
  resetAuthLock();
  resetSupabaseClient();
}
beforeEach(() => {
  disk.clear(); anonymousCount = 0; resetAuthLock(); resetSupabaseClient();
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.mocked(getSupabaseConfig).mockReturnValue({ url: 'https://session-test.supabase.co', anonKey: 'sb_publishable_test_only', isConfigured: true });
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => disk.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { disk.set(key, value); });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key => { disk.delete(key); });
  http = jest.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input);
    let body: unknown;
    if (url.includes('/signup')) body = authResponse(anonymousId(++anonymousCount), true);
    else if (url.includes('/token?grant_type=password')) body = authResponse(registeredId, false);
    else if (url.includes('/logout')) body = {};
    else throw new Error('Unexpected auth request');
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
});
afterEach(() => { getSupabaseClient().auth.stopAutoRefresh(); resetSupabaseClient(); resetAuthLock(); jest.restoreAllMocks(); });

it('restores the same guest identity from storage after recreating the app client', async () => {
  const first = await ensureAnonymousSession();
  expect(first).toMatchObject({ isNewUser: true, user: { id: anonymousId(1) }, error: null });
  expect(disk.size).toBeGreaterThan(0);
  restart();
  const reopened = await ensureAnonymousSession();
  expect(reopened).toMatchObject({ isNewUser: false, user: { id: anonymousId(1) }, error: null });
  expect(reopened.session?.refresh_token).toBe(first.session?.refresh_token);
  expect(http).toHaveBeenCalledTimes(1);
});

it('persists the registered account after switching away from a guest', async () => {
  await ensureAnonymousSession();
  const { error } = await getSupabaseClient().auth.signInWithPassword({ email: 'test@example.test', password: 'test-password' });
  expect(error).toBeNull();
  restart();
  const reopened = await ensureAnonymousSession();
  expect(reopened).toMatchObject({ isNewUser: false, user: { id: registeredId, is_anonymous: false } });
  expect(anonymousCount).toBe(1);
  expect(http).toHaveBeenCalledTimes(2);
});

it('does not restore the previous identity after a successful sign-out and restart', async () => {
  await ensureAnonymousSession();
  const { error } = await getSupabaseClient().auth.signOut();
  expect(error).toBeNull();
  restart();
  const reopened = await ensureAnonymousSession();
  expect(reopened).toMatchObject({ isNewUser: true, user: { id: anonymousId(2) } });
});
