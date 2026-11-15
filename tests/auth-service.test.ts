import {
  authenticateRegisteredAccount,
  ensureAnonymousSession,
  getCurrentSession,
  getCurrentUser,
  onAuthStateChange,
  resetAccountSession,
  resetAuthLock,
  sanitizeAuthError,
} from '@/services/auth/auth-service';
import { getSupabaseClient } from '@/services/supabase/client';
import { deferred } from './helpers/deferred';

jest.mock('@/services/supabase/client', () => ({ getSupabaseClient: jest.fn() }));

const user = { id: 'user-a', is_anonymous: true };
const session = { user };
const registeredUser = { id: 'user-b', is_anonymous: false };
const auth = {
  getSession: jest.fn(), getUser: jest.fn(), signInAnonymously: jest.fn(),
  signInWithPassword: jest.fn(), signUp: jest.fn(), signOut: jest.fn(), onAuthStateChange: jest.fn(),
};

beforeEach(() => {
  jest.resetAllMocks();
  resetAuthLock();
  jest.mocked(getSupabaseClient).mockReturnValue({ auth } as unknown as ReturnType<typeof getSupabaseClient>);
  auth.getSession.mockResolvedValue({ data: { session }, error: null });
  auth.getUser.mockResolvedValue({ data: { user }, error: null });
  auth.signInAnonymously.mockResolvedValue({ data: { user, session }, error: null });
});

it('deduplicates session bootstrap calls and reuses the stored identity', async () => {
  const pending = deferred<{ data: { session: typeof session }; error: null }>();
  auth.getSession.mockReturnValueOnce(pending.promise);
  const requests = [ensureAnonymousSession(), ensureAnonymousSession()];
  expect(auth.getSession).toHaveBeenCalledTimes(1);
  pending.resolve({ data: { session }, error: null });
  const results = await Promise.all(requests);
  expect(results[0]).toMatchObject({ user, session, isNewUser: false, error: null });
  expect(results[1]).toBe(results[0]);
  expect(auth.signInAnonymously).not.toHaveBeenCalled();
  await ensureAnonymousSession();
  expect(auth.getSession).toHaveBeenCalledTimes(2);
});

it('creates an anonymous session when the stored session is unavailable', async () => {
  auth.getSession.mockResolvedValue({ data: { session: null }, error: { message: 'expired' } });
  await expect(ensureAnonymousSession()).resolves.toMatchObject({ user, session, isNewUser: true, error: null });
  expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
});

it('returns safe errors for malformed, rejected and throwing anonymous sign-ins', async () => {
  auth.getSession.mockResolvedValue({ data: null, error: null });
  auth.signInAnonymously
    .mockResolvedValueOnce({ data: { session: null, user: null }, error: null })
    .mockResolvedValueOnce({ data: { session, user: null }, error: null })
    .mockResolvedValueOnce({ data: null, error: { error_description: 'apikey=abc' } })
    .mockRejectedValueOnce(new Error('offline'));
  await expect(ensureAnonymousSession()).resolves.toMatchObject({ isNewUser: false, user: null, error: expect.stringContaining('bilgisi eksik') });
  await expect(ensureAnonymousSession()).resolves.toMatchObject({ session: null, user: null });
  await expect(ensureAnonymousSession()).resolves.toMatchObject({ error: 'apikey=[FILTERED]' });
  await expect(ensureAnonymousSession()).resolves.toMatchObject({ error: 'offline' });
});

it('signs in registered accounts, trims the email and handles email confirmation', async () => {
  auth.signInWithPassword.mockResolvedValueOnce({ data: { session: { user: registeredUser } }, error: null });
  await expect(authenticateRegisteredAccount('sign-in', ' a@example.test ', 'pw')).resolves.toBe('signed-in');
  expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@example.test', password: 'pw' });
  auth.signUp.mockResolvedValueOnce({ data: { user: registeredUser, session: null }, error: null });
  await expect(authenticateRegisteredAccount('sign-up', 'a@example.test', 'pw')).resolves.toBe('confirm-email');
  auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { code: 'email_not_confirmed' } });
  await expect(authenticateRegisteredAccount('sign-in', 'a@example.test', 'pw')).resolves.toBe('confirm-email');
});

it('rejects anonymous sign-ins and hides upstream details on failure', async () => {
  auth.signInWithPassword.mockResolvedValueOnce({ data: { session }, error: null });
  await expect(authenticateRegisteredAccount('sign-in', 'a@example.test', 'pw')).rejects.toThrow('Oturum açılamadı');
  auth.signUp.mockRejectedValueOnce(new Error('private credential details'));
  await expect(authenticateRegisteredAccount('sign-up', 'a@example.test', 'pw')).rejects.toThrow('Kayıt tamamlanamadı');
});

it('reads the active session and user and returns null when either lookup fails', async () => {
  await expect(getCurrentSession()).resolves.toBe(session);
  await expect(getCurrentUser()).resolves.toBe(user);
  auth.getSession.mockRejectedValueOnce(new Error('unavailable'));
  auth.getUser.mockRejectedValueOnce(new Error('unavailable'));
  await expect(getCurrentSession()).resolves.toBeNull();
  await expect(getCurrentUser()).resolves.toBeNull();
});

it('forwards auth transitions and unsubscribes even when registration fails', () => {
  const listener = jest.fn();
  const unsubscribe = jest.fn();
  auth.onAuthStateChange.mockReturnValueOnce({ data: { subscription: { unsubscribe } } });
  const subscription = onAuthStateChange(listener);
  auth.onAuthStateChange.mock.calls[0][0]('SIGNED_IN', session);
  auth.onAuthStateChange.mock.calls[0][0]('SIGNED_OUT', null);
  expect(listener.mock.calls).toEqual([['SIGNED_IN', session], ['SIGNED_OUT', null]]);
  subscription.unsubscribe();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  auth.onAuthStateChange.mockImplementationOnce(() => { throw new Error('offline'); });
  expect(() => onAuthStateChange(listener).unsubscribe()).not.toThrow();
});

it('asks for a fresh session even if sign-out throws during reset', async () => {
  auth.signOut.mockRejectedValueOnce(new Error('offline'));
  await expect(resetAccountSession()).resolves.toMatchObject({ isNewUser: true, user });
  expect(auth.signOut).toHaveBeenCalledTimes(1);
  expect(auth.getSession).not.toHaveBeenCalled();
  expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
});

it('redacts tokens and credentials from strings and structured errors', () => {
  const raw = 'eyJheaderlongenough.payloadlongenough.signaturelongenough apikey=sbp_123&secret=value';
  expect(sanitizeAuthError(raw)).toBe('[FILTERED_TOKEN] apikey=[FILTERED]&secret=[FILTERED]');
  expect(sanitizeAuthError(new Error('offline'))).toBe('offline');
  expect(sanitizeAuthError({ message: 'expired' })).toBe('expired');
  expect(sanitizeAuthError({ error_description: 'denied' })).toBe('denied');
  expect(sanitizeAuthError({ fallback: true })).toBe('{"fallback":true}');
  const circular: { self?: unknown } = {};
  circular.self = circular;
  expect(sanitizeAuthError(circular)).toBe('[object Object]');
  expect(sanitizeAuthError(23)).toBe('23');
  expect(sanitizeAuthError(new Error())).toBe('Kimlik doğrulama hatası oluştu.');
  expect(sanitizeAuthError(null)).toBe('Bilinmeyen kimlik doğrulama hatası');
});
