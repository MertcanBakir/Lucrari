import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AgentScreen from '@/app/(tabs)/agent';
import { useAuth } from '@/context/auth-context';
import { useAnalysis } from '@/hooks/use-analysis';
import { authenticateRegisteredAccount } from '@/services/auth/auth-service';
import { analysis } from '../ui/fixtures';

jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/hooks/use-analysis', () => ({ useAnalysis: jest.fn() }));
jest.mock('@/services/auth/auth-service', () => ({ authenticateRegisteredAccount: jest.fn() }));
jest.mock('@/utils/logger', () => ({
  createScopedLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

function makeAgent() {
  return {
    userId: 'user-a', isAuthReady: true, isAuthenticated: true, retryAuth: jest.fn(),
    connections: { items: [], isLoading: false, error: null, refresh: jest.fn(),
      create: jest.fn(), verify: jest.fn(), remove: jest.fn() },
    providers: { providers: [], unavailable: {} },
    modelSelection: { authType: 'personal_chatgpt', quickModel: 'm', deepModel: 'm',
      availableModels: [{ id: 'm', name: 'Test model' }] },
    isProvidersLoading: false, providersError: null, isAccessDenied: false,
    history: [], historyTotalCount: 0, isHistoryLoading: false, isHistoryRefreshing: false, historyError: null,
    hasMoreHistory: false, isLoadingMore: false, loadMoreError: null, selectedAnalysis: null, selectedReport: null,
    isSelectedLoading: false, selectedError: null, isStarting: false, startError: null, canRetryStart: false,
    refreshDashboard: jest.fn(), refreshProviders: jest.fn(), loadMoreHistory: jest.fn(),
    openAnalysis: jest.fn(), closeAnalysis: jest.fn(), refreshSelected: jest.fn(),
    startNewAnalysis: jest.fn(), retryStart: jest.fn(), clearStartError: jest.fn(),
  } satisfies ReturnType<typeof useAnalysis>;
}

const setUser = (id: string, isGuest = false) => jest.mocked(useAuth).mockReturnValue({
  user: { id, is_anonymous: isGuest },
} as ReturnType<typeof useAuth>);

beforeEach(() => setUser('user-a'));

it('exposes model catalogue and analysis creation, then closes session-owned forms on account switch', async () => {
  const state = makeAgent();
  const hook = jest.mocked(useAnalysis).mockReturnValue(state);
  const view = render(<AgentScreen />);
  fireEvent.press(screen.getByLabelText(/Kullanılabilir AI modelleri/));
  expect(screen.getByText('Test model')).toBeOnTheScreen();
  expect(screen.getByText('Henüz analiz yok')).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Yeni analiz oluştur'));
  expect(await screen.findByPlaceholderText('AAPL')).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Kapat'));
  expect(screen.queryByPlaceholderText('AAPL')).toBeNull();
  fireEvent.press(screen.getByText('API Bağlantıları'));
  await waitFor(() => expect(state.connections.refresh).toHaveBeenCalled());
  expect(screen.getByRole('header', { name: 'API Bağlantıları' })).toBeOnTheScreen();
  setUser('user-b');
  hook.mockReturnValue({ ...state, userId: 'user-b' });
  view.rerender(<AgentScreen />);
  expect(screen.queryByRole('header', { name: 'API Bağlantıları' })).toBeNull();
});

it('guides denied guest accounts to sign-in and offers auth retry', () => {
  const state = makeAgent();
  setUser('guest-a', true);
  const hook = jest.mocked(useAnalysis).mockReturnValue({ ...state, isAccessDenied: true, modelSelection: null, providers: null });
  const view = render(<AgentScreen />);
  expect(screen.getByText('Agent için hesabınla giriş yap')).toBeOnTheScreen();
  expect(screen.getByLabelText('Yeni analiz oluştur')).toBeDisabled();
  fireEvent.press(screen.getByText('Giriş Yap veya Hesap Oluştur'));
  expect(screen.getByLabelText('E-posta')).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Kapat' }));
  hook.mockReturnValue({ ...state, isAuthenticated: false });
  view.rerender(<AgentScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Tekrar Dene' }));
  expect(state.retryAuth).toHaveBeenCalledTimes(1);
  expect(authenticateRegisteredAccount).not.toHaveBeenCalled();
});

it('keeps data visible for background errors and retries history and model loading', async () => {
  const state = makeAgent();
  const hook = jest.mocked(useAnalysis).mockReturnValue({
    ...state, history: [analysis], historyTotalCount: 1, historyError: 'Dashboard unreachable',
    loadMoreError: 'Page unavailable', providersError: 'Catalog unavailable',
  });
  const view = render(<AgentScreen />);
  fireEvent.press(screen.getByLabelText('AAPL analizini aç'));
  expect(state.openAnalysis).toHaveBeenCalledWith(analysis);
  fireEvent.press(screen.getByText('Yenile'));
  expect(state.refreshProviders).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Dashboard unreachable')).toBeOnTheScreen();
  expect(screen.getByText('Page unavailable')).toBeOnTheScreen();
  const [dashboardRetry, footerRetry] = screen.getAllByRole('button', { name: 'Tekrar Dene' });
  fireEvent.press(dashboardRetry);
  expect(state.refreshDashboard).toHaveBeenCalledTimes(1);
  fireEvent.press(footerRetry);
  expect(state.loadMoreHistory).toHaveBeenCalledTimes(1);
  hook.mockReturnValue({ ...state, historyError: 'History unavailable' });
  view.rerender(<AgentScreen />);
  expect(screen.getByText('Geçmiş yüklenemedi')).toBeOnTheScreen();
  hook.mockReturnValue({ ...state, isAuthReady: false, isHistoryLoading: true });
  view.rerender(<AgentScreen />);
  expect(screen.getByText(/Oturum hazırlanıyor/)).toBeOnTheScreen();
  expect(screen.getByText(/Analiz geçmişi yükleniyor/)).toBeOnTheScreen();
});
