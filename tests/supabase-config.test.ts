import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';
import {
  validateSupabaseConfig,
  validateClientKey,
  maskKey,
} from '../services/supabase/config';

// Helper to create simple mock JWT with specified role
function createMockJwt(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role, exp: 1999999999 })).toString('base64url');
  const signature = 'fake_signature_xyz';
  return `${header}.${payload}.${signature}`;
}

describe('Supabase Configuration & Security Validation', () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalPublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  describe('validateClientKey', () => {
    it('should accept valid sb_publishable key', () => {
      const validKey = 'sb_publishable_9Z95XW8Qo-tufYtmLuuPeA_Nm7YMwaM';
      const result = validateClientKey(validKey);
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.keyType, 'publishable');
    });

    it('should reject short sb_publishable key', () => {
      const shortKey = 'sb_publishable_123';
      const result = validateClientKey(shortKey);
      assert.strictEqual(result.isValid, false);
      assert.match(result.error || '', /uzunluğu beklenenden kısa/);
    });

    it('should reject sb_secret key with security error', () => {
      const secretKey = 'sb_secret_9Z95XW8Qo-tufYtmLuuPeA_Nm7YMwaM_admin';
      const result = validateClientKey(secretKey);
      assert.strictEqual(result.isValid, false);
      assert.match(result.error || '', /GÜVENLİK İHLALİ/);
    });

    it('should accept safe anon JWT', () => {
      const anonJwt = createMockJwt('anon');
      const result = validateClientKey(anonJwt);
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.keyType, 'anon_jwt');
    });

    it('should reject service_role JWT with security error', () => {
      const serviceRoleJwt = createMockJwt('service_role');
      const result = validateClientKey(serviceRoleJwt);
      assert.strictEqual(result.isValid, false);
      assert.match(result.error || '', /service_role/);
    });

    it('should reject JWT with non-anon role', () => {
      const adminJwt = createMockJwt('admin_role');
      const result = validateClientKey(adminJwt);
      assert.strictEqual(result.isValid, false);
      assert.match(result.error || '', /Geçersiz JWT rolü/);
    });

    it('should reject malformed or broken JWT', () => {
      const brokenJwt = 'header.not_valid_json_payload.signature';
      const result = validateClientKey(brokenJwt);
      assert.strictEqual(result.isValid, false);
      assert.match(result.error || '', /Bozuk veya çözümlenemeyen JWT/);
    });

    it('should reject placeholder and template keys', () => {
      const placeholder = 'your-anon-key-here';
      const result = validateClientKey(placeholder);
      assert.strictEqual(result.isValid, false);
      assert.match(result.error || '', /Placeholder/);
    });
  });

  describe('validateSupabaseConfig', () => {
    it('should report invalid when env vars are missing', () => {
      delete process.env.EXPO_PUBLIC_SUPABASE_URL;
      delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

      const result = validateSupabaseConfig();
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.errors.length >= 2, true);
    });

    it('should report invalid when URL is malformed', () => {
      process.env.EXPO_PUBLIC_SUPABASE_URL = 'invalid-url-without-protocol';
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_9Z95XW8Qo-tufYtmLuuPeA_Nm7YMwaM';

      const result = validateSupabaseConfig();
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some((e) => e.includes('URL')));
    });

    it('should support modern EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', () => {
      process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://myproject.supabase.co';
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_9Z95XW8Qo-tufYtmLuuPeA_Nm7YMwaM';
      delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

      const result = validateSupabaseConfig();
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.keyType, 'publishable');
      assert.strictEqual(result.errors.length, 0);
    });

    it('should fallback to EXPO_PUBLIC_SUPABASE_ANON_KEY when publishable key is not set', () => {
      process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://myproject.supabase.co';
      delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = createMockJwt('anon');

      const result = validateSupabaseConfig();
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.keyType, 'anon_jwt');
      assert.strictEqual(result.errors.length, 0);
    });
  });

  describe('maskKey', () => {
    it('should mask sensitive keys correctly', () => {
      assert.strictEqual(maskKey(null), '—');
      assert.strictEqual(maskKey(''), '—');
      assert.strictEqual(maskKey('12345'), '***');
      assert.strictEqual(maskKey('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'eyJhbG...VCJ9');
      assert.strictEqual(maskKey('sb_publishable_9Z95XW8Qo-tufYtmLuuPeA_Nm7YMwaM'), 'sb_pub...MwaM');
    });
  });

  // Restore environment variables after all tests
  process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalPublishableKey;
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
});
