import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './config';
import type { Database } from '@/types/database';
import { createScopedLogger } from '@/utils/logger';

const log = createScopedLogger('SupabaseClient');

try {
  // Polyfill WHATWG URL in React Native runtime
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-url-polyfill/auto');
} catch {
  // Not needed in Node.js environment
}

let clientInstance: SupabaseClient<Database> | null = null;

function getAuthStorage() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SecureStore = require('expo-secure-store');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native');

    return {
      getItem: async (key: string): Promise<string | null> => {
        try {
          if (Platform.OS === 'web') {
            if (typeof localStorage !== 'undefined') {
              return localStorage.getItem(key);
            }
            return null;
          }
          return await SecureStore.getItemAsync(key);
        } catch {
          return null;
        }
      },
      setItem: async (key: string, value: string): Promise<void> => {
        try {
          if (Platform.OS === 'web') {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem(key, value);
            }
            return;
          }
          await SecureStore.setItemAsync(key, value);
        } catch {
          // Fallback if secure store write fails
        }
      },
      removeItem: async (key: string): Promise<void> => {
        try {
          if (Platform.OS === 'web') {
            if (typeof localStorage !== 'undefined') {
              localStorage.removeItem(key);
            }
            return;
          }
          await SecureStore.deleteItemAsync(key);
        } catch {
          // Fallback
        }
      },
    };
  } catch {
    // Fallback for Node.js / CLI environment
    return undefined;
  }
}

/**
 * Returns the singleton Supabase client instance.
 * Lazily initialized to avoid startup crashes if environment is not yet set.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (clientInstance) {
    return clientInstance;
  }

  const { url, anonKey, isConfigured } = getSupabaseConfig();

  // If not configured, initialize with safe fallback credentials to prevent hard crashes
  const targetUrl = isConfigured ? url : 'https://placeholder.supabase.co';
  const targetKey = isConfigured ? anonKey : 'placeholder-anon-key';
  const storage = getAuthStorage();

  log.info('İstemci başlatıldı', { yapılandırıldı: isConfigured });

  clientInstance = createClient<Database>(targetUrl, targetKey, {
    auth: {
      ...(storage ? { storage } : {}),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });

  return clientInstance;
}

/**
 * Resets the client instance (useful after updating environment variables or during testing).
 */
export function resetSupabaseClient(): void {
  log.debug('İstemci sıfırlandı');
  clientInstance = null;
}

/**
 * Sets a mock Supabase client instance specifically for unit testing.
 */
export function setSupabaseClientForTesting(client: SupabaseClient<Database> | any): void {
  clientInstance = client;
}

/**
 * Resets the mock client instance after unit testing.
 */
export function resetSupabaseClientForTesting(): void {
  clientInstance = null;
}

/**
 * Shorthand export for singleton client instance.
 */
export const supabase = {
  get client(): SupabaseClient<Database> {
    return getSupabaseClient();
  },
};
