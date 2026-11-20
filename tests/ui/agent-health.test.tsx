import { fireEvent, render, screen } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { AgentHealthCard } from '@/components/health/agent-health-card';
import { AnalysisHealthMenuItem } from '@/components/health/analysis-health-menu-item';
import { useAgentHealth } from '@/hooks/use-agent-health';
import { useAppTheme } from '@/context/theme-context';
import { normalizeAgentHealth } from '@/utils/agent-health';
import { hostHealthPayload } from './agent-health-fixtures';

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('@/hooks/use-agent-health', () => ({ useAgentHealth: jest.fn() }));
const push = jest.fn();
const resources = normalizeAgentHealth(hostHealthPayload).resources!;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
});
afterEach(() => {
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'light' } as ReturnType<typeof useAppTheme>);
});

it.each(['ok', 'warning', 'critical', 'unknown'] as const)('displays the %s resource state and opens the detailed route', (status) => {
  jest.mocked(useAgentHealth).mockReturnValue({
    status: 'online', report: { resources: { ...resources, status } },
  } as ReturnType<typeof useAgentHealth>);
  render(<AnalysisHealthMenuItem />);
  fireEvent.press(screen.getByRole('button'));
  expect(push).toHaveBeenCalledWith('/agent-health');
});

it.each(['checking', 'online', 'unreachable', 'forbidden', 'unauthorized', 'error'] as const)('keeps %s menu details accessible', (status) => {
  jest.mocked(useAgentHealth).mockReturnValue({ status, report: null } as ReturnType<typeof useAgentHealth>);
  render(<AnalysisHealthMenuItem />);
  expect(screen.getByRole('button')).toHaveProp('accessibilityLabel', expect.stringContaining('Agent servisi'));
});

it('shows host percentages, memory units, sample time and host uptime', () => {
  render(<AgentHealthCard resources={resources} />);
  expect(screen.getByText('Sunucu kaynakları')).toBeOnTheScreen();
  expect(screen.getByText('%32,5')).toBeOnTheScreen();
  expect(screen.getByText(/Kullanılan 2 GiB \/ Toplam 4 GiB/)).toBeOnTheScreen();
  expect(screen.getByText('1 gün 0 saat 0 dakika')).toBeOnTheScreen();
  expect(screen.getByRole('progressbar', { name: 'CPU kullanımı' })).toHaveProp('accessibilityValue', { min: 0, max: 100, now: 32.5 });
});

it('labels system scope and unknown CPU without displaying fabricated zeros', () => {
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'dark' } as ReturnType<typeof useAppTheme>);
  render(<AgentHealthCard resources={{
    ...resources, scope: 'system', sampledAt: null, uptimeSeconds: null,
    cpu: { status: 'unknown', usedPercent: null, logicalCores: null, sampleWindowSeconds: null },
    memory: { ...resources.memory, status: 'critical' },
  }} />);
  expect(screen.getByText('Sistem kaynakları')).toBeOnTheScreen();
  expect(screen.queryByText('Sunucu kaynakları')).toBeNull();
  expect(screen.getByText(/İlk CPU ölçümü hazırlanıyor/)).toBeOnTheScreen();
  expect(screen.getByRole('progressbar', { name: 'CPU kullanımı' })).toHaveProp('accessibilityValue', { text: 'Ölçüm mevcut değil' });
  expect(screen.getByText('Kritik kullanım')).toBeOnTheScreen();
});

it('supports public liveness responses without assuming resources are present', () => {
  render(<AgentHealthCard resources={null} />);
  expect(screen.getByText(/Kaynak ölçümleri bu yanıtta bulunmuyor/)).toBeOnTheScreen();
  expect(screen.queryByRole('progressbar')).toBeNull();
});
