/**
 * Supabase Client Configuration
 * 
 * Safely loads and validates public Supabase environment variables.
 * Enforces security constraints: never allow service-role / secret keys in client app.
 */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  isConfigured: boolean;
}

export interface ConfigValidationResult {
  isValid: boolean;
  url: string | null;
  anonKey: string | null;
  keyType: 'publishable' | 'anon_jwt' | null;
  errors: string[];
  warnings: string[];
}

/**
 * Validates whether a given key is a legitimate, safe client-side key (publishable or anon JWT).
 * Strictly rejects service-role keys, secret keys, malformed JWTs, and placeholders.
 * 
 * Note: Decoding the JWT payload is a client-side defensive check to prevent accidental usage
 * of privileged service-role credentials; it is not a cryptographic signature verification.
 */
export function validateClientKey(rawKey: string): {
  isValid: boolean;
  keyType: 'publishable' | 'anon_jwt' | null;
  error?: string;
  warning?: string;
} {
  const key = rawKey.trim();

  if (!key) {
    return { isValid: false, keyType: null, error: 'Anahtar boş bırakılamaz.' };
  }

  // 1. Check for explicit placeholder strings
  if (
    key.includes('your-') ||
    key.includes('your_') ||
    key.endsWith('...') ||
    key === 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  ) {
    return {
      isValid: false,
      keyType: null,
      error: 'Placeholder/şablon anahtar tespit edildi. Lütfen gerçek bir istemci anahtarı giriniz.',
    };
  }

  // 2. Reject secret / service-role prefixes
  if (
    key.startsWith('sb_secret_') ||
    key.toLowerCase().startsWith('sbp_') ||
    key.includes('service_role')
  ) {
    return {
      isValid: false,
      keyType: null,
      error: 'GÜVENLİK İHLALİ: Mobil uygulamada asla secret veya service-role anahtarı kullanılmamalıdır!',
    };
  }

  // 3. Modern Publishable Key format: sb_publishable_...
  if (key.startsWith('sb_publishable_')) {
    if (key.length < 25) {
      return {
        isValid: false,
        keyType: null,
        error: 'sb_publishable anahtarının karakter uzunluğu beklenenden kısa.',
      };
    }
    return { isValid: true, keyType: 'publishable' };
  }

  // 4. Legacy JWT format (Header.Payload.Signature)
  const jwtParts = key.split('.');
  if (jwtParts.length === 3) {
    try {
      // Decode JWT payload (part 1)
      let payloadBase64 = jwtParts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (payloadBase64.length % 4) {
        payloadBase64 += '=';
      }

      let jsonStr = '';
      if (typeof atob === 'function') {
        jsonStr = atob(payloadBase64);
      } else if (typeof Buffer !== 'undefined') {
        jsonStr = Buffer.from(payloadBase64, 'base64').toString('utf-8');
      } else {
        // Fallback
        return { isValid: true, keyType: 'anon_jwt', warning: 'Base64 ortamı bulunamadı, JWT formatı kabul edildi.' };
      }

      const payload = JSON.parse(jsonStr);

      if (payload.role === 'service_role') {
        return {
          isValid: false,
          keyType: null,
          error: 'GÜVENLİK İHLALİ: JWT payload içinde service_role rolü tespit edildi! Mobil istemcide kullanılamaz.',
        };
      }

      if (payload.role !== 'anon') {
        return {
          isValid: false,
          keyType: null,
          error: `Geçersiz JWT rolü: '${payload.role}'. İstemcide yalnızca 'anon' rolü geçerlidir.`,
        };
      }

      return { isValid: true, keyType: 'anon_jwt' };
    } catch {
      return {
        isValid: false,
        keyType: null,
        error: 'Bozuk veya çözümlenemeyen JWT anahtar biçimi.',
      };
    }
  }

  return {
    isValid: false,
    keyType: null,
    error: 'Tanınmayan Supabase anahtar biçimi. Geçerli bir sb_publishable veya anon JWT anahtarı gereklidir.',
  };
}

/**
 * Validates Supabase environment variables according to security and architecture rules.
 */
export function validateSupabaseConfig(): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '';
  // Support modern EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY with fallback to EXPO_PUBLIC_SUPABASE_ANON_KEY
  const rawKey = (
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  if (!url) {
    errors.push('EXPO_PUBLIC_SUPABASE_URL ortam değişkeni tanımlanmamış.');
  } else {
    try {
      const parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        errors.push('EXPO_PUBLIC_SUPABASE_URL geçerli bir http/https protokolü içermelidir.');
      }
    } catch {
      errors.push('EXPO_PUBLIC_SUPABASE_URL geçerli bir URL formatında değil.');
    }
  }

  let keyType: 'publishable' | 'anon_jwt' | null = null;

  if (!rawKey) {
    errors.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY / EXPO_PUBLIC_SUPABASE_ANON_KEY ortam değişkeni tanımlanmamış.');
  } else {
    const keyValidation = validateClientKey(rawKey);
    if (!keyValidation.isValid) {
      errors.push(keyValidation.error || 'Geçersiz Supabase anahtarı.');
    } else {
      keyType = keyValidation.keyType;
      if (keyValidation.warning) {
        warnings.push(keyValidation.warning);
      }
    }
  }

  return {
    isValid: errors.length === 0 && Boolean(url) && Boolean(rawKey),
    url: url || null,
    anonKey: rawKey || null,
    keyType,
    errors,
    warnings,
  };
}

/**
 * Returns the active Supabase configuration or placeholder if not configured.
 */
export function getSupabaseConfig(): SupabaseConfig {
  const validation = validateSupabaseConfig();
  return {
    url: validation.url || '',
    anonKey: validation.anonKey || '',
    isConfigured: validation.isValid,
  };
}

/**
 * Safely masks a sensitive key for diagnostic reporting.
 * Example: eyJhbGciOi...1234
 */
export function maskKey(key: string | null | undefined): string {
  if (!key) return '—';
  if (key.length <= 10) return '***';
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}
