import { useIsFocused } from '@react-navigation/native';
import { useEffect, useState } from 'react';

import { checkAnalysisHealth } from '@/services/analysis/analysis-service';

export function useAnalysisHealth(): 'checking' | 'online' | 'unreachable' {
  const isFocused = useIsFocused();
  const [status, setStatus] = useState<'checking' | 'online' | 'unreachable'>('checking');

  useEffect(() => {
    if (!isFocused) return;
    const controller = new AbortController();
    const update = (healthy: boolean) => {
      if (!controller.signal.aborted) setStatus(healthy ? 'online' : 'unreachable');
    };

    setStatus('checking');
    void checkAnalysisHealth(controller.signal).then(update, () => update(false));
    return () => controller.abort();
  }, [isFocused]);

  return status;
}
