import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ServerManagementCard as Card } from '@/components/health/server-management-card';
import { useServerManagement } from '@/hooks/use-server-management';
jest.mock('@/hooks/use-server-management', () => ({ useServerManagement: jest.fn() }));
const ServerManagementCard = () => <Card server={useServerManagement()} />;
const changeState = jest.fn(); const refresh = jest.fn();
const base = { managementErrorStatus: null, report: null, healthStatus: 'checking' as const, apiMessage: null, checkedAt: null, state: 'stopped' as const, apiReady: false, error: null, denied: false, hasSession: true, busy: false, refresh, changeState };
beforeEach(() => { jest.clearAllMocks(); jest.mocked(useServerManagement).mockReturnValue(base); });
it('starts a stopped host and refreshes independently', () => {
  render(<ServerManagementCard />);
  fireEvent.press(screen.getByText('Sunucuyu başlat')); expect(changeState).toHaveBeenCalledWith('start');
  fireEvent.press(screen.getByText('Sunucu durumunu yenile')); expect(refresh).toHaveBeenCalledTimes(1);
});
it('requires explicit stop confirmation, supports cancellation', () => {
  jest.mocked(useServerManagement).mockReturnValue({ ...base, state: 'running', apiReady: true });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<ServerManagementCard />); expect(screen.getByText('API çevrimiçi')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Sunucuyu durdur')); expect(changeState).not.toHaveBeenCalled();
  expect(alert.mock.calls[0][2]?.[0].style).toBe('cancel');
  alert.mock.calls[0][2]?.[1].onPress?.(); expect(changeState).toHaveBeenCalledWith('stop');
  alert.mockRestore();
});
it.each(['pending', 'stopping'] as const)('disables controls during %s', state => {
  jest.mocked(useServerManagement).mockReturnValue({ ...base, state }); render(<ServerManagementCard />);
  expect(screen.getByText('İşlem sürüyor')).toBeDisabled();
});
it('hides management actions on forbidden but shows error and retry', () => {
  jest.mocked(useServerManagement).mockReturnValue({ ...base, denied: true, error: 'Yetkiniz yok' });
  render(<ServerManagementCard />); expect(screen.queryByText('Sunucuyu başlat')).toBeNull();
  fireEvent.press(screen.getByText('Yeniden dene')); expect(refresh).toHaveBeenCalled();
});
it('shows startup until health passes, disables actions on error', () => {
  jest.mocked(useServerManagement).mockReturnValue({ ...base, state: 'running', error: 'Son durum doğrulanamadı.' });
  render(<ServerManagementCard />); expect(screen.getByText('Son doğrulanan: Sunucu çalışıyor')).toBeOnTheScreen();
  expect(screen.getByText('Sunucuyu durdur')).toBeDisabled();
});
it('waits without a session and displays ongoing request', () => {
  jest.mocked(useServerManagement).mockReturnValue({ ...base, state: null, hasSession: false, busy: true });
  render(<ServerManagementCard />); expect(screen.getByText('Sunucu yönetimi için oturum gerekli.')).toBeOnTheScreen();
  expect(screen.queryByText('Sunucu durumunu yenile')).toBeNull();
  expect(screen.getByLabelText('Sunucu kontrol ediliyor')).toBeOnTheScreen();
});
it('shows initial status while waiting', () => {
  jest.mocked(useServerManagement).mockReturnValue({ ...base, state: null }); render(<ServerManagementCard />);
  expect(screen.getByText('Sunucu durumu kontrol ediliyor…')).toBeOnTheScreen();
});

it('distinguishes running EC2 from API readiness', () => {
  jest.mocked(useServerManagement).mockReturnValue({ ...base, state: 'running' });
  render(<ServerManagementCard />); expect(screen.getByText('Sunucu açılıyor')).toBeOnTheScreen();
});
