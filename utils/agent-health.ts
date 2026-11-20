import type { AgentHealthReport, ResourceStatus } from '@/types/agent-health';
import { isValidIsoTimestampWithTimezone } from '@/utils/validation';

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function number(value: unknown, max = Infinity): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}

function status(value: number | null, warning: number, critical: number): ResourceStatus {
  if (value === null) return 'unknown';
  if (value >= critical) return 'critical';
  if (value >= warning) return 'warning';
  return 'ok';
}

export function normalizeAgentHealth(raw: unknown): AgentHealthReport {
  const payload = record(raw);
  if (payload.status !== 'ok') throw new Error('Agent servisi beklenen sağlık yanıtını döndürmedi.');
  const resources = record(payload.resources);
  if (resources.scope !== 'host' && resources.scope !== 'system') return { resources: null };
  const cpu = record(resources.cpu);
  const memory = record(resources.memory);
  const cpuPercent = number(cpu.used_percent, 100);
  const memoryPercent = number(memory.used_percent, 100);
  const cpuStatus = status(cpuPercent, 90, 98);
  const memoryStatus = status(memoryPercent, 85, 95);
  const states = [cpuStatus, memoryStatus];
  const overall = (['critical', 'warning', 'unknown', 'ok'] as const).find((item) => states.includes(item))!;
  return {
    resources: {
      scope: resources.scope,
      sampledAt: isValidIsoTimestampWithTimezone(resources.sampled_at) ? resources.sampled_at : null,
      status: overall,
      cpu: {
        status: cpuStatus, usedPercent: cpuPercent,
        logicalCores: number(cpu.logical_cores),
        sampleWindowSeconds: number(cpu.sample_window_seconds),
      },
      memory: {
        status: memoryStatus, usedPercent: memoryPercent,
        totalBytes: number(memory.total_bytes), availableBytes: number(memory.available_bytes),
        usedBytes: number(memory.used_bytes),
      },
      uptimeSeconds: number(resources.uptime_seconds),
    },
  };
}

export const RESOURCE_STATUS_LABELS: Record<ResourceStatus, string> = {
  ok: 'Normal', warning: 'Yüksek kullanım', critical: 'Kritik kullanım', unknown: 'Ölçüm bekleniyor',
};

export function formatResourceBytes(bytes: number | null): string {
  return bytes === null ? '—' : `${(bytes / 1024 ** 3).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} GiB`;
}

export function formatHostUptime(seconds: number | null): string {
  if (seconds === null) return '—';
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 1440)} gün ${Math.floor(minutes / 60) % 24} saat ${minutes % 60} dakika`;
}
