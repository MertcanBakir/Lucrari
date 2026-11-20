export const hostHealthPayload = {
  status: 'ok',
  checks: { api: 'ok' },
  resources: {
    scope: 'host', sampled_at: '2026-11-19T12:00:00+00:00', status: 'ok',
    cpu: { status: 'ok', used_percent: 32.5, logical_cores: 2, sample_window_seconds: 10 },
    memory: { status: 'ok', used_percent: 50, total_bytes: 4294967296, available_bytes: 2147483648, used_bytes: 2147483648 },
    uptime_seconds: 86400,
  },
};
