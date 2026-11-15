import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { getSupabaseClient, resetSupabaseClient, supabase } from '@/services/supabase/client';
import { getSupabaseConfig } from '@/services/supabase/config';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));
jest.mock('@/services/supabase/config', () => ({ getSupabaseConfig: jest.fn() }));

const construct = jest.mocked(createClient);
const url = 'https://example.supabase.co';
const key = 'sb_publishable_test';

function getStorage() {
  getSupabaseClient();
  const storage = construct.mock.lastCall?.[2]?.auth?.storage;
  if (!storage) throw new Error('Expected Supabase auth storage');
  return storage;
}

beforeEach(() => {
  jest.resetAllMocks();
  resetSupabaseClient();
  construct.mockReturnValue({} as ReturnType<typeof createClient>);
  jest.mocked(getSupabaseConfig).mockReturnValue({ url, anonKey: key, isConfigured: true });
});

afterEach(() => jest.restoreAllMocks());

it('creates a single configured client and replaces it after reset', () => {
  expect(supabase.client).toBe(getSupabaseClient());
  expect(construct).toHaveBeenCalledTimes(1);
  expect(construct).toHaveBeenCalledWith(url, key, expect.objectContaining({
    auth: expect.objectContaining({ persistSession: true, detectSessionInUrl: false }),
  }));
  resetSupabaseClient();
  jest.mocked(getSupabaseConfig).mockReturnValue({ url: '', anonKey: '', isConfigured: false });
  getSupabaseClient();
  expect(construct).toHaveBeenCalledTimes(2);
  expect(construct).toHaveBeenLastCalledWith('https://placeholder.supabase.co', 'placeholder-anon-key', expect.any(Object));
});

it('persists native auth in secure storage and tolerates storage failures', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const storage = getStorage();
  jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('session').mockRejectedValueOnce(new Error('locked'));
  jest.mocked(SecureStore.setItemAsync).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('locked'));
  jest.mocked(SecureStore.deleteItemAsync).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('locked'));
  expect(await storage.getItem('auth')).toBe('session');
  await storage.setItem('auth', 'session');
  await storage.removeItem('auth');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('auth', 'session');
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('auth');
  expect(await storage.getItem('auth')).toBeNull();
  await expect(storage.setItem('auth', 'session')).resolves.toBeUndefined();
  await expect(storage.removeItem('auth')).resolves.toBeUndefined();
});

it('allows web sessions when local storage is absent', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
  try {
    const storage = getStorage();
    expect(await storage.getItem('auth')).toBeNull();
    await storage.setItem('auth', 'session');
    await storage.removeItem('auth');
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

it('uses web local storage when available', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const local = { getItem: jest.fn().mockReturnValue('session'), setItem: jest.fn(), removeItem: jest.fn() };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  try {
    const storage = getStorage();
    expect(await storage.getItem('auth')).toBe('session');
    await storage.setItem('auth', 'session');
    await storage.removeItem('auth');
    expect(local.setItem).toHaveBeenCalledWith('auth', 'session');
    expect(local.removeItem).toHaveBeenCalledWith('auth');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
