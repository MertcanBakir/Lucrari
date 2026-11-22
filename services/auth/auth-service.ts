/**
 * Supabase Anonymous Authentication Service
 * 
 * Provides an invisible, robust Anonymous Auth lifecycle for Lucrari:
 * - Automatically initializes unique anonymous user on first app launch.
 * - Preserves existing session across app restarts (zero duplicate user generation).
 * - Concurrency Lock / Deduplication: Guarantees only 1 in-flight signInAnonymously() call.
 * - Safe error handling with retry support (no infinite loops or credential leaks).
 * - Sanitizes all diagnostic logs: Never outputs access tokens, refresh tokens, or API keys.
 */

import type { Session, User, AuthChangeEvent } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/services/supabase/client';
import { withAccountTransition } from './account-transition';
import { createScopedLogger } from '@/utils/logger';

const log = createScopedLogger('AuthService');

export interface AuthBootstrapResult {
  session: Session | null;
  user: User | null;
  isNewUser: boolean;
  error: string | null;
}

// In-flight promise lock to deduplicate concurrent bootstrap requests
let inFlightAuthPromise: Promise<AuthBootstrapResult> | null = null;

export async function authenticateRegisteredAccount(
  mode: 'sign-in' | 'sign-up',
  email: string,
  password: string
): Promise<'signed-in' | 'confirm-email'> {
  const credentials = { email: email.trim(), password };
  try {
    const { auth } = getSupabaseClient();
    const { data, error } = await withAccountTransition(() => mode === 'sign-up'
      ? auth.signUp(credentials)
      : auth.signInWithPassword(credentials));

    if (!error && data.session?.user && data.session.user.is_anonymous !== true) {
      return 'signed-in';
    }
    if (!error && mode === 'sign-up' && data.user && !data.session) return 'confirm-email';
    if (mode === 'sign-in' && error?.code === 'email_not_confirmed') return 'confirm-email';
  } catch {
    // Authentication credentials and raw errors must stay out of logs and UI.
  }
  throw new Error(mode === 'sign-up'
    ? 'Kayıt tamamlanamadı. E-posta adresini ve parola gereksinimlerini kontrol edip tekrar deneyin.'
    : 'Oturum açılamadı. E-posta adresini ve parolanı kontrol edip tekrar deneyin.');
}

/**
 * Sanitizes an error message to ensure no JWTs, refresh tokens, or sensitive keys leak into logs.
 */
export function sanitizeAuthError(err: unknown): string {
  if (!err) return 'Bilinmeyen kimlik doğrulama hatası';
  
  let raw = '';
  if (typeof err === 'string') {
    raw = err;
  } else if (err instanceof Error) {
    raw = err.message;
  } else if (typeof err === 'object' && err !== null) {
    if ('message' in err && typeof (err as { message: unknown }).message === 'string') {
      raw = (err as { message: string }).message;
    } else if ('error_description' in err && typeof (err as { error_description: unknown }).error_description === 'string') {
      raw = (err as { error_description: string }).error_description;
    } else {
      try {
        raw = JSON.stringify(err);
      } catch {
        raw = String(err);
      }
    }
  } else {
    raw = String(err);
  }

  // Remove potential JWT / token strings (long base64 chunks)
  const sanitized = raw
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, '[FILTERED_TOKEN]')
    .replace(/sbp_[a-zA-Z0-9_-]+/g, '[FILTERED_KEY]')
    .replace(/apikey=[^&\s]+/gi, 'apikey=[FILTERED]')
    .replace(/secret=[^&\s]+/gi, 'secret=[FILTERED]');

  return sanitized || 'Kimlik doğrulama hatası oluştu.';
}

/**
 * Ensures an active Supabase session exists.
 * If a stored session is found, reuses it immediately.
 * If no session is found, executes signInAnonymously() exactly once.
 */
export async function ensureAnonymousSession(options?: { forceNew?: boolean }): Promise<AuthBootstrapResult> {
  // If an auth bootstrap operation is already running, return the existing in-flight promise
  if (inFlightAuthPromise && !options?.forceNew) {
    log.debug('auth.bootstrap.deduplicated', {
      message: 'Auth bootstrap deduplicated.'
    });
    return inFlightAuthPromise;
  }

  inFlightAuthPromise = (async (): Promise<AuthBootstrapResult> => {
    try {
      const client = getSupabaseClient();

      // 1. Check if a valid session already exists in storage
      if (!options?.forceNew) {
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        
        if (sessionError) {
          log.warn('auth.session.lookup.failed', {
            message: 'Auth session lookup failed.',
            error: sanitizeAuthError(sessionError)
          });
        }

        if (sessionData?.session?.user) {
          log.debug('auth.session.reused', {
            message: 'Auth session reused.',
            context: { userId: sessionData.session.user.id, isAnonymous: sessionData.session.user.is_anonymous ?? true }
          });

          return {
            session: sessionData.session,
            user: sessionData.session.user,
            isNewUser: false,
            error: null,
          };
        }
      }

      // 2. No active session found — perform anonymous sign-in
      log.info('auth.anonymous.started', {
        message: 'Auth anonymous started.'
      });

      const { data, error } = await client.auth.signInAnonymously();

      if (error) {
        const sanitizedMsg = sanitizeAuthError(error);
        log.error('auth.anonymous.failed', {
          message: 'Auth anonymous failed.',
          error
        });

        return {
          session: null,
          user: null,
          isNewUser: false,
          error: sanitizedMsg,
        };
      }

      if (!data?.session || !data?.user) {
        const errMsg = 'Anonim oturum yanıtında kullanıcı bilgisi eksik.';
        log.error('auth.anonymous.invalid', {
          message: 'Auth anonymous invalid.'
        });
        return {
          session: null,
          user: null,
          isNewUser: false,
          error: errMsg,
        };
      }

      log.info('auth.anonymous.created', {
        message: 'Auth anonymous created.',
        context: { userId: data.user.id }
      });

      return {
        session: data.session,
        user: data.user,
        isNewUser: true,
        error: null,
      };
    } catch (unexpectedError) {
      const sanitizedMsg = sanitizeAuthError(unexpectedError);
      log.error('auth.bootstrap.exception', {
        message: 'Auth bootstrap exception.',
        error: unexpectedError
      });

      return {
        session: null,
        user: null,
        isNewUser: false,
        error: sanitizedMsg,
      };
    } finally {
      // Release lock so subsequent calls (e.g. manual retries) can proceed
      inFlightAuthPromise = null;
    }
  })();

  return inFlightAuthPromise;
}

/**
 * Returns the currently active session from Supabase client.
 */
export async function getCurrentSession(): Promise<Session | null> {
  try {
    const client = getSupabaseClient();
    const { data } = await client.auth.getSession();
    return data.session;
  } catch (error) {
    log.warn('auth.session.read.failed', {
      message: 'Auth session read failed.',
      error: sanitizeAuthError(error)
    });
    return null;
  }
}

/**
 * Returns the currently authenticated user from Supabase client.
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const client = getSupabaseClient();
    const { data } = await client.auth.getUser();
    return data.user;
  } catch (error) {
    log.warn('auth.user.read.failed', {
      message: 'Auth user read failed.',
      error: sanitizeAuthError(error)
    });
    return null;
  }
}

/**
 * Subscribes to Supabase auth state change events.
 */
export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
): { unsubscribe: () => void } {
  try {
    const client = getSupabaseClient();
    const { data } = client.auth.onAuthStateChange((event, session) => {
      log.debug('auth.state.changed', {
        message: 'Auth state changed.',
        context: { event, hasSession: Boolean(session) }
      });
      callback(event, session);
    });

    return {
      unsubscribe: () => {
        data.subscription.unsubscribe();
      },
    };
  } catch (error) {
    log.warn('auth.subscription.failed', {
      message: 'Auth subscription failed.',
      error: sanitizeAuthError(error)
    });
    return {
      unsubscribe: () => {},
    };
  }
}

/**
 * Completely resets the user session and local credentials.
 * Signs out the current session and creates a fresh anonymous session.
 */
export async function resetAccountSession(): Promise<AuthBootstrapResult> {
  const client = getSupabaseClient();
  try {
    log.info('auth.reset.started', {
      message: 'Auth reset started.'
    });
    await withAccountTransition(async () => {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    });
  } catch (err) {
    log.warn('auth.signout.failed', {
      message: 'Auth signout failed.',
      error: sanitizeAuthError(err)
    });
    throw err;
  }

  return await ensureAnonymousSession({ forceNew: true });
}

/**
 * Resets the in-flight lock (used primarily for test isolation).
 */
export function resetAuthLock(): void {
  inFlightAuthPromise = null;
}
