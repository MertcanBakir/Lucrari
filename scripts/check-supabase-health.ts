/** Run with npm run check:health. */
import * as fs from 'fs';
import * as path from 'path';
import { createScopedLogger } from '../utils/logger';

const log = createScopedLogger('HealthCheckCli');
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...values] = trimmed.split('=');
    const value = values.join('=').trim().replace(/^['"](.*)['"]$/, '');
    if (!process.env[key.trim()]) process.env[key.trim()] = value;
  }
}

async function runCliHealthCheck() {
  const { validateSupabaseConfig } = await import('../services/supabase/config');
  const validation = validateSupabaseConfig();
  if (!validation.isValid) {
    log.error('supabase.health.config.invalid', {
      message: 'Supabase configuration is invalid. Check the environment variables in .env.example.',
      context: { errorCount: validation.errors.length, warningCount: validation.warnings.length },
    });
    return;
  }

  const { checkSupabaseHealth } = await import('../services/supabase/health');
  const startedAt = Date.now();
  const report = await checkSupabaseHealth();
  for (const check of report.checks) {
    log.info('supabase.health.check.completed', {
      message: 'Supabase diagnostic check completed.',
      context: { checkId: check.id, category: check.category, status: check.status, latencyMs: check.latencyMs },
    });
  }
  log.info('supabase.health.completed', {
    message: 'Supabase health check completed.',
    context: { status: report.overallStatus, durationMs: Date.now() - startedAt, latencyMs: report.averageLatencyMs },
  });
}

runCliHealthCheck().catch((error: unknown) => {
  log.error('supabase.health.failed', { message: 'Supabase health check failed.', error });
});
