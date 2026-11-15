/**
 * Lucrari Supabase Health Check CLI Script
 * 
 * Run with: npx ts-node scripts/check-supabase-health.ts
 * or via: npm run test:health
 */

import * as fs from 'fs';
import * as path from 'path';

// Load .env file if present in project root
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...values] = trimmed.split('=');
      const val = values.join('=').trim().replace(/^['"](.*)['"]$/, '$1');
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = val;
      }
    }
  }
}

async function runCliHealthCheck() {
  console.log('\n======================================================');
  console.log('🚀 LUCRARI — SUPABASE HEALTH CHECK & DIAGNOSTICS');
  console.log('======================================================\n');

  const { validateSupabaseConfig, maskKey } = await import('../services/supabase/config');
  const validation = validateSupabaseConfig();

  console.log(`📡 EXPO_PUBLIC_SUPABASE_URL     : ${validation.url || '[NOT SET]'}`);
  console.log(`🔑 EXPO_PUBLIC_SUPABASE_ANON_KEY : ${maskKey(validation.anonKey)}`);
  console.log(`⚙️  Config Valid                 : ${validation.isValid ? '✅ YES' : '❌ NO'}`);

  if (validation.warnings.length > 0) {
    console.log(`⚠️  Warnings: ${validation.warnings.join(', ')}`);
  }

  if (!validation.isValid) {
    console.log('\n❌ HATA: Supabase ortam değişkenleri eksik veya hatalı:');
    validation.errors.forEach((err) => console.log(`   - ${err}`));
    console.log('\n💡 İpucu: .env.example dosyasını .env olarak kopyalayıp Supabase bilgilerinizi girin.\n');
    return;
  }

  console.log('\n⏳ Backend ve Veritabanı servis kontrolleri başlatılıyor...\n');

  const { checkSupabaseHealth } = await import('../services/supabase/health');
  const startTime = Date.now();
  const report = await checkSupabaseHealth();
  const totalElapsed = Date.now() - startTime;

  console.log('------------------------------------------------------');
  console.log(`Durum: ${report.overallStatus.toUpperCase()} | Ort. Gecikme: ${report.averageLatencyMs ? report.averageLatencyMs + ' ms' : '—'}`);
  console.log('------------------------------------------------------');

  report.checks.forEach((c) => {
    const icon = c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌';
    const latency = c.latencyMs !== null ? `(${c.latencyMs} ms)` : '';
    console.log(`${icon} [${c.category.toUpperCase()}] ${c.name} ${latency}`);
    console.log(`   └─ ${c.message}`);
  });

  console.log('\n======================================================');
  console.log(`✨ Tamamlandı (${totalElapsed} ms)`);
  console.log('======================================================\n');
}

runCliHealthCheck().catch((err) => {
  console.error('Beklenmeyen CLI hatası:', err);
});
