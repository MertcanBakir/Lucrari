import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import AgentHealthScreen from '@/app/agent-health';
import { AnalysisHealthMenuItem } from '@/components/health/analysis-health-menu-item';
import { useAuth } from '@/context/auth-context';
import { requestServerManagement, ServerManagementError } from '@/services/analysis/server-management-service';
import { checkAnalysisHealth, fetchAgentHealth } from '@/services/analysis/analysis-service';
import { normalizeAgentHealth } from '@/utils/agent-health';
import { hostHealthPayload } from '../ui/agent-health-fixtures';

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('react-native/Libraries/AppState/AppState', () => ({ __esModule: true, default: { currentState: 'active', addEventListener: jest.fn() } }));
jest.mock('@/services/analysis/server-management-service', () => ({ ...jest.requireActual('@/services/analysis/server-management-service'), requestServerManagement: jest.fn() }));
jest.mock('@/services/analysis/analysis-service', () => ({ ...jest.requireActual('@/services/analysis/analysis-service'), checkAnalysisHealth: jest.fn(), fetchAgentHealth: jest.fn() }));
const management = jest.mocked(requestServerManagement);
const resources = jest.mocked(fetchAgentHealth);
const publicHealth = jest.mocked(checkAnalysisHealth);
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  jest.mocked(useAuth).mockReturnValue({ userId: 'owner', isAuthReady: true } as never);
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
  management.mockReset().mockResolvedValue('stopped');
  resources.mockReset().mockResolvedValue(normalizeAgentHealth(hostHealthPayload));
  publicHealth.mockReset().mockResolvedValue(true);
});
afterEach(() => jest.useRealTimers());

it('sends no health requests from the menu or detail while stopped, including manual refresh', async () => {
  const menu = render(<AnalysisHealthMenuItem />); await act(async () => {});
  expect(screen.getByText('Sunucu kapalı')).toBeOnTheScreen(); menu.unmount();
  render(<AgentHealthScreen />); await act(async () => {});
  expect(management).toHaveBeenCalledTimes(2);
  fireEvent.press(screen.getByLabelText('Agent durumunu yenile')); await act(async () => {});
  await act(async () => jest.advanceTimersByTime(60_000));
  expect(management).toHaveBeenCalledTimes(3);
  expect(resources).not.toHaveBeenCalled(); expect(publicHealth).not.toHaveBeenCalled();
});
it('shares one detail controller and polls resources only after verifying running', async () => {
  management.mockResolvedValue('running');
  render(<AgentHealthScreen />); await act(async () => {});
  expect(management).toHaveBeenCalledTimes(1); expect(resources).toHaveBeenCalledTimes(1);
  expect(publicHealth).not.toHaveBeenCalled(); expect(screen.getByText('Sunucu kaynakları')).toBeOnTheScreen();
  management.mockResolvedValue('stopped');
  await act(async () => jest.advanceTimersByTime(12_000));
  expect(management).toHaveBeenCalledTimes(2); expect(resources).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Sunucu kaynakları')).toBeNull();
});
it('keeps running EC2 separate from an unreachable API and provides retry', async () => {
  management.mockResolvedValue('running'); resources.mockRejectedValue(new Error('network'));
  render(<AgentHealthScreen />); await act(async () => {});
  expect(screen.getAllByText('API’ye henüz ulaşılamıyor').length).toBeGreaterThan(0);
  expect(screen.getByText('Çalışıyor')).toBeOnTheScreen(); expect(screen.getByText('Yeniden dene')).toBeOnTheScreen();
  expect(screen.queryByText('Sunucu kaynakları')).toBeNull();
});
it.each([401, 403, 503])('never guesses EC2 state or probes health after management %s', async status => {
  management.mockRejectedValue(new ServerManagementError('Durum doğrulanamadı', status));
  render(<AgentHealthScreen />); await act(async () => {});
  expect(resources).not.toHaveBeenCalled(); expect(publicHealth).not.toHaveBeenCalled();
  expect(screen.queryByText('Sunucuyu başlat')).toBeNull(); expect(screen.queryByText('Sunucuyu durdur')).toBeNull();
  expect(screen.getByLabelText('Geri Dön')).toBeOnTheScreen();
});
