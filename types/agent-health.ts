export type ResourceStatus = 'ok' | 'warning' | 'critical' | 'unknown';

export interface AgentResources {
  scope: 'host' | 'system';
  sampledAt: string | null;
  status: ResourceStatus;
  cpu: {
    status: ResourceStatus;
    usedPercent: number | null;
    logicalCores: number | null;
    sampleWindowSeconds: number | null;
  };
  memory: {
    status: ResourceStatus;
    usedPercent: number | null;
    totalBytes: number | null;
    availableBytes: number | null;
    usedBytes: number | null;
  };
  uptimeSeconds: number | null;
}

export interface AgentHealthReport {
  resources: AgentResources | null;
}
