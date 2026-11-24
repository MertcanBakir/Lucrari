import { useAgentHealth } from '@/hooks/use-agent-health';

export function useAnalysisHealth(): 'checking' | 'online' | 'unreachable' {
  const health = useAgentHealth();
  return health.status === 'online' ? 'online' : health.status === 'checking' ? 'checking' : 'unreachable';
}
