import { fireEvent, render, screen } from '@testing-library/react-native';
import AgentHealthScreen from '@/app/agent-health';
import { useAgentHealth } from '@/hooks/use-agent-health';
import { useAppTheme } from '@/context/theme-context';
import { normalizeAgentHealth } from '@/utils/agent-health';
import { hostHealthPayload } from '../ui/agent-health-fixtures';

jest.mock('@/components/health/server-management-card', () => ({ ServerManagementCard: () => null }));
const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock('@/hooks/use-agent-health', () => ({ useAgentHealth: jest.fn() }));
const refresh = jest.fn().mockResolvedValue(undefined);
const online = {
  status: 'online' as const, report: normalizeAgentHealth(hostHealthPayload), checkedAt: new Date(),
  server: {} as ReturnType<typeof useAgentHealth>['server'], message: null, isRefreshing: false, refresh,
};

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'light' } as ReturnType<typeof useAppTheme>));

it('enables monitoring and provides manual refresh and back navigation', () => {
  jest.mocked(useAgentHealth).mockReturnValue(online);
  render(<AgentHealthScreen />);
  expect(useAgentHealth).toHaveBeenCalledWith(true);
  expect(screen.getByText('Sunucu kaynakları')).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Agent durumunu yenile'));
  expect(refresh).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('Geri Dön'));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it.each(['checking', 'unreachable', 'forbidden', 'unauthorized', 'error'] as const)('removes metrics in %s state', (status) => {
  jest.mocked(useAgentHealth).mockReturnValue({ ...online, status });
  render(<AgentHealthScreen />);
  expect(screen.queryByText('Sunucu kaynakları')).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
});

it('shows a refreshing indicator and handles the public response in dark mode', () => {
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'dark' } as ReturnType<typeof useAppTheme>);
  jest.mocked(useAgentHealth).mockReturnValue({ ...online, isRefreshing: true, report: null, checkedAt: null });
  render(<AgentHealthScreen />);
  expect(screen.getByLabelText('Agent durumunu yenile')).toBeDisabled();
  expect(screen.getByText(/Kaynak ölçümleri bu yanıtta bulunmuyor/)).toBeOnTheScreen();
});
