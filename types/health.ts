/**
 * Health Check Type Definitions
 * 
 * Defines typed diagnostics models for Supabase and external backend checks.
 */

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unconfigured';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export interface ServiceCheckItem {
  id: string;
  name: string;
  category: 'config' | 'rest' | 'auth' | 'gateway';
  status: CheckStatus;
  latencyMs: number | null;
  message: string;
  details?: Record<string, unknown>;
}

export interface SupabaseHealthReport {
  overallStatus: HealthStatus;
  supabaseUrl: string | null;
  isConfigured: boolean;
  checks: ServiceCheckItem[];
  averageLatencyMs: number | null;
  timestamp: string;
  errorMessage: string | null;
}

export interface HealthCheckState {
  isLoading: boolean;
  report: SupabaseHealthReport | null;
  error: Error | null;
  lastChecked: Date | null;
}
