/**
 * Lucrari Authentication Context & Provider
 * 
 * Manages the client-side lifecycle of the Supabase Anonymous Authentication:
 * - Bootstraps anonymous session invisibly on app startup.
 * - Exposes session, user, isAuthReady, retryAuth, and resetAccount functionality.
 * - Subscribes to auth state changes to synchronize state reactively.
 * - Listens to AppState changes to handle token auto-refresh cleanly.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import type { Session, User } from '@supabase/supabase-js';
import {
  ensureAnonymousSession,
  onAuthStateChange,
  sanitizeAuthError,
} from '@/services/auth/auth-service';
import { resetMyInvestments } from '@/services/portfolio/portfolio-service';
import { getSupabaseClient } from '@/services/supabase/client';
import { createScopedLogger } from '@/utils/logger';

const log = createScopedLogger('AuthContext');

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  userId: string | null;
  isAuthenticated: boolean;
  isAuthReady: boolean;
  isLoading: boolean;
  error: string | null;
  retryAuth: () => Promise<void>;
  resetAccount: (clientRequestId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  // Bootstrap function to ensure anonymous session
  const bootstrapAuth = useCallback(async (forceNew = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await ensureAnonymousSession({ forceNew });

      if (!isMountedRef.current) return;

      if (result.error) {
        setError(result.error);
        log.warn('Auth bootstrap tamamlanamadı', { error: result.error });
      } else {
        setSession(result.session);
        setUser(result.user);
        setError(null);

      }
    } catch (err) {
      if (!isMountedRef.current) return;
      const sanitized = sanitizeAuthError(err);
      setError(sanitized);
      log.error('Beklenmeyen auth bootstrap hatası', { error: sanitized });
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setIsAuthReady(true);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    // 1. Initial anonymous session bootstrap
    bootstrapAuth();

    // 2. Auth State Change Listener (token refresh, sign-in, etc.)
    const { unsubscribe } = onAuthStateChange((event, newSession) => {
      if (!isMountedRef.current) return;

      log.debug('Auth state güncellendi', { event, hasSession: Boolean(newSession) });
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession) {
        setError(null);
      }
    });

    // 3. React Native AppState Listener for Token Auto-Refresh
    const appStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      try {
        const client = getSupabaseClient();
        if (nextAppState === 'active') {
          client.auth.startAutoRefresh();
        } else if (nextAppState === 'background') {
          client.auth.stopAutoRefresh();
        }
      } catch {
        // Safe fallback in test/Node environments where startAutoRefresh might be noop
      }
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe();
      appStateSubscription.remove();
    };
  }, [bootstrapAuth]);

  const retryAuth = useCallback(async () => {
    log.info('Kullanıcı / sistem tarafından auth retry tetiklendi');
    await bootstrapAuth(false);
  }, [bootstrapAuth]);

  // Atomically clears investment ledgers using reset_my_investments RPC while preserving user session
  const resetAccount = useCallback(async (clientRequestId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      log.info('Yatırımları sıfırlama işlemi başlatıldı (reset_my_investments)...', { clientRequestId });
      await resetMyInvestments({ clientRequestId });
      log.info('Yatırımlar başarıyla sıfırlandı.');
    } catch (err) {
      if (!isMountedRef.current) return;
      const sanitized = sanitizeAuthError(err);
      setError(sanitized);
      log.error('Hesap sıfırlama sırasında hata', { error: sanitized });
      throw err;
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const contextValue: AuthContextValue = {
    user,
    session,
    userId: user?.id ?? null,
    isAuthenticated: Boolean(session && user),
    isAuthReady,
    isLoading,
    error,
    retryAuth,
    resetAccount,
  };

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth() must be used within an <AuthProvider>');
  }
  return context;
}
