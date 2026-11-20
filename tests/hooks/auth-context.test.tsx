import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AuthProvider, useAuth } from '@/context/auth-context';
import { ensureAnonymousSession, onAuthStateChange } from '@/services/auth/auth-service';
import { getSupabaseClient } from '@/services/supabase/client';

jest.mock('@/services/auth/auth-service', () => ({ ensureAnonymousSession: jest.fn(), onAuthStateChange: jest.fn(), sanitizeAuthError: (error: Error) => error.message }));
jest.mock('@/services/portfolio/portfolio-service', () => ({ resetMyInvestments: jest.fn() }));
jest.mock('@/services/supabase/client', () => ({ getSupabaseClient: jest.fn() }));
const guest = { user: { id: 'guest-a', is_anonymous: true } } as Session;
const registered = { user: { id: 'registered-b', is_anonymous: false } } as Session;
const unsubscribe = jest.fn();
let listener: (event: AuthChangeEvent, session: Session | null) => void;
const wrapper = ({ children }: React.PropsWithChildren) => <AuthProvider>{children}</AuthProvider>;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getSupabaseClient).mockReturnValue({ auth: { startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() } } as unknown as ReturnType<typeof getSupabaseClient>);
  jest.mocked(ensureAnonymousSession).mockResolvedValue({ session: guest, user: guest.user, isNewUser: false, error: null });
  jest.mocked(onAuthStateChange).mockImplementation(callback => { listener = callback; return { unsubscribe }; });
});

it('replaces the guest identity on sign-in and clears it on sign-out', async () => {
  const hook = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(hook.result.current.userId).toBe('guest-a'));
  act(() => listener('SIGNED_IN', registered));
  expect(hook.result.current.userId).toBe('registered-b');
  expect(hook.result.current.session).toBe(registered);
  act(() => listener('TOKEN_REFRESHED', registered));
  expect(hook.result.current.userId).toBe('registered-b');
  act(() => listener('SIGNED_OUT', null));
  expect(hook.result.current.userId).toBeNull();
  expect(hook.result.current.session).toBeNull();
  expect(hook.result.current.isAuthenticated).toBe(false);
  hook.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('exposes a bootstrap failure and lets retry recover the original identity', async () => {
  jest.mocked(ensureAnonymousSession).mockResolvedValueOnce({ session: null, user: null, isNewUser: false, error: 'Oturum okunamadı' });
  const hook = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(hook.result.current.isAuthReady).toBe(true));
  expect(hook.result.current.error).toBe('Oturum okunamadı');
  expect(hook.result.current.isAuthenticated).toBe(false);
  await act(() => hook.result.current.retryAuth());
  expect(hook.result.current.userId).toBe('guest-a');
  expect(hook.result.current.error).toBeNull();
  expect(ensureAnonymousSession).toHaveBeenLastCalledWith({ forceNew: false });
});
