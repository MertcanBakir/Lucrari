import { useServerManagement } from '@/hooks/use-server-management';
import type { ApiHealthState } from '@/hooks/use-server-management';

export type AgentHealthState = ApiHealthState | 'stopped' | 'pending' | 'stopping';

// Menu, resources and power controls share one orchestrator per focused screen.
export function useAgentHealth(monitor = false) {
  const server = useServerManagement(monitor);
  const status: AgentHealthState = !server.hasSession || server.managementErrorStatus === 401 ? 'unauthorized'
    : server.denied ? 'forbidden'
    : server.error ? 'error'
    : server.state === null ? 'checking'
    : server.state !== 'running' ? server.state
    : server.healthStatus;
  return {
    status, report: status === 'online' ? server.report : null,
    checkedAt: server.checkedAt, message: server.error ?? server.apiMessage,
    isRefreshing: server.busy, refresh: server.refresh, server,
  };
}
