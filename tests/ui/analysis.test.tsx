import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { AnalysisAccountModal } from '@/components/analysis/analysis-account-modal';
import { AnalysisConnectionsModal } from '@/components/analysis/analysis-connections-modal';
import { AnalysisCreateModal } from '@/components/analysis/analysis-create-modal';
import { AnalysisDetailModal } from '@/components/analysis/analysis-detail-modal';
import { AnalysisHistoryCard } from '@/components/analysis/analysis-history-card';
import { SafeMarkdown } from '@/components/analysis/safe-markdown';
import { authenticateRegisteredAccount } from '@/services/auth/auth-service';
import type { AnalysisProvider } from '@/types/analysis';
import { analysis, date, report } from './fixtures';

jest.mock('@/services/auth/auth-service', () => ({ authenticateRegisteredAccount: jest.fn() }));
jest.mock('@/utils/logger', () => ({
  createScopedLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const provider: AnalysisProvider = {
  provider: 'openai', models: ['test-model'], modelOptions: [{ id: 'test-model', name: 'Test model' }], authType: 'api_key',
};
const connection = { id: 'connection-1', provider: 'openai', name: 'Kişisel bağlantı', createdAt: date, verifiedAt: null };

function createConnections(items = [connection]) {
  return {
    items, error: null, isLoading: false, refresh: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue(true), verify: jest.fn().mockResolvedValue(true),
    remove: jest.fn().mockResolvedValue(true),
  };
}

afterEach(() => jest.restoreAllMocks());

it('guides a new account through confirmation, then signs in', async () => {
  const authenticate = jest.mocked(authenticateRegisteredAccount);
  authenticate.mockReset().mockResolvedValueOnce('confirm-email').mockResolvedValueOnce('signed-in');
  const close = jest.fn();
  render(<AnalysisAccountModal onClose={close} />);
  expect(screen.getByRole('button', { name: 'Giriş Yap' })).toBeDisabled();
  fireEvent.press(screen.getByRole('button', { name: 'Yeni hesap oluştur' }));
  fireEvent.changeText(screen.getByLabelText('E-posta'), 'user@example.com');
  fireEvent.changeText(screen.getByLabelText('Parola'), 'test-password');
  fireEvent.press(screen.getByRole('button', { name: 'Hesap Oluştur' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/E-posta doğrulaması gerekiyor/);
  expect(authenticate).toHaveBeenCalledWith('sign-up', 'user@example.com', 'test-password');
  expect(screen.getByRole('button', { name: 'Giriş Yap' })).toBeDisabled();
  fireEvent.changeText(screen.getByLabelText('Parola'), 'test-password');
  fireEvent.press(screen.getByRole('button', { name: 'Giriş Yap' }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});

it('shows sign-in errors without closing the account form', async () => {
  jest.mocked(authenticateRegisteredAccount).mockReset().mockRejectedValue(new Error('Oturum açılamadı'));
  const close = jest.fn();
  render(<AnalysisAccountModal onClose={close} />);
  fireEvent.changeText(screen.getByLabelText('E-posta'), 'user@example.com');
  fireEvent.changeText(screen.getByLabelText('Parola'), 'wrong-password');
  fireEvent.press(screen.getByRole('button', { name: 'Giriş Yap' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Oturum açılamadı');
  expect(close).not.toHaveBeenCalled();
});

it('validates a connection form, clears the submitted key and confirms removal', async () => {
  const connections = createConnections();
  render(<AnalysisConnectionsModal providers={[provider]} isProvidersLoading={false}
    providersError={null} onRefreshProviders={jest.fn()} connections={connections} onClose={jest.fn()} />);
  fireEvent.press(screen.getByRole('button', { name: 'Bağlantıyı Kontrol Et' }));
  expect(connections.verify).toHaveBeenCalledWith(connection.id);
  fireEvent.press(screen.getByRole('button', { name: 'Kaldır' }));
  fireEvent.press(screen.getByRole('button', { name: 'Vazgeç' }));
  expect(connections.remove).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Kaldır' }));
  fireEvent.press(screen.getByRole('button', { name: 'Kaldırmayı Onayla' }));
  expect(connections.remove).toHaveBeenCalledWith(connection.id);
  fireEvent.changeText(screen.getByLabelText('Bağlantı adı'), 'a'.repeat(81));
  fireEvent.changeText(screen.getByLabelText('API anahtarı'), 'mock-key');
  fireEvent.press(screen.getByRole('button', { name: 'Kontrol Et ve Ekle' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/kontrol edin/);
  fireEvent.changeText(screen.getByLabelText('Bağlantı adı'), ' Ev ');
  fireEvent.press(screen.getByRole('button', { name: 'Kontrol Et ve Ekle' }));
  await waitFor(() => expect(connections.create).toHaveBeenCalledWith('openai', 'Ev', 'mock-key'));
  expect(screen.queryByDisplayValue('mock-key')).toBeNull();
});

it('validates the analysis inputs and submits the selected model and horizon', async () => {
  const start = jest.fn().mockResolvedValue(true);
  const close = jest.fn();
  const props = {
    visible: true, modelSelection: { authType: 'personal_chatgpt' as const,
      quickModel: 'test-model', deepModel: 'test-model', availableModels: provider.modelOptions },
    apiProviders: [provider], connections: createConnections(), isProvidersLoading: false,
    providersError: null, isStarting: false, startError: null, canRetryStart: false,
    onClose: close, onStart: start, onRetry: jest.fn(), onRefreshProviders: jest.fn(), onClearStartError: jest.fn(),
  };
  const view = render(<AnalysisCreateModal {...props} />);
  expect(screen.getByRole('button', { name: 'Analizi Başlat' })).toBeDisabled();
  fireEvent.press(screen.getByText('Kısa (1 ay)'));
  fireEvent.press(screen.getByRole('button', { name: 'Analizi Başlat' }));
  expect(screen.getByText(/Geçerli bir sembol/)).toBeOnTheScreen();
  fireEvent.changeText(screen.getByPlaceholderText('AAPL'), ' aapl ');
  fireEvent.changeText(screen.getByPlaceholderText('YYYY-AA-GG'), '2026-02-31');
  fireEvent.press(screen.getByRole('button', { name: 'Analizi Başlat' }));
  expect(screen.getByText(/YYYY-AA-GG biçiminde/)).toBeOnTheScreen();
  fireEvent.changeText(screen.getByPlaceholderText('YYYY-AA-GG'), '2099-01-01');
  fireEvent.press(screen.getByRole('button', { name: 'Analizi Başlat' }));
  expect(screen.getByText(/Gelecek bir tarih/)).toBeOnTheScreen();
  fireEvent.changeText(screen.getByPlaceholderText('YYYY-AA-GG'), '2020-01-01');
  fireEvent.press(screen.getByRole('button', { name: 'Analizi Başlat' }));
  await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({
    ticker: 'AAPL', authType: 'personal_chatgpt', analysisHorizon: 'short_1m',
  })));
  view.rerender(<AnalysisCreateModal {...props} startError="Sunucu meşgul" canRetryStart />);
  expect(screen.getByText('Sunucu meşgul')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Aynı İstekle Tekrar Dene'));
  expect(props.onRetry).toHaveBeenCalledTimes(1);
});

it('opens analysis history and expands a completed report section', () => {
  const open = jest.fn();
  render(<AnalysisHistoryCard item={analysis} onPress={open} />);
  fireEvent.press(screen.getByLabelText('AAPL analizini aç'));
  expect(open).toHaveBeenCalledTimes(1);
  screen.unmount();
  const close = jest.fn();
  render(<AnalysisDetailModal analysis={analysis} report={report} isLoading={false}
    error={null} onClose={close} onRefresh={jest.fn()} />);
  expect(screen.getByText('Yatırım tavsiyesi değildir.')).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Analiz özeti bölümünü genişlet'));
  expect(screen.getByText('Rapor hazır')).toBeOnTheScreen();
  expect(screen.getByText('Nötr görüş')).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Analiz özeti bölümünü daralt'));
  expect(screen.queryByText('Rapor hazır')).toBeNull();
  fireEvent.press(screen.getByLabelText('Raporu kapat'));
  expect(close).toHaveBeenCalledTimes(1);
});

it('retains warnings and retry controls for unavailable reports', () => {
  const refresh = jest.fn();
  const props = { report: null, onClose: jest.fn(), onRefresh: refresh };
  const view = render(<AnalysisDetailModal {...props} analysis={{ ...analysis, status: 'running', stage: 'analysis' }}
    isLoading error={null} />);
  expect(screen.getByText('Analiz devam ediyor')).toBeOnTheScreen();
  view.rerender(<AnalysisDetailModal {...props} analysis={{ ...analysis, status: 'failed' }}
    isLoading={false} error="Rapor alınamadı" />);
  expect(screen.getByText('Analiz tamamlanamadı')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Tekrar Dene'));
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('renders safe Markdown blocks and lets the user open an HTTPS source', () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  render(<SafeMarkdown source={'# Özet\n\n> Alıntı\n\n- Bir\n- İki\n\n1. Üç\n\n**Kalın** ve *vurgulu* ve `kod`\n\n[Kaynak](https://example.com)\n\n---\n\n```\nexample()\n```'} />);
  expect(screen.getByText('Özet')).toBeOnTheScreen();
  expect(screen.getByText('Alıntı')).toBeOnTheScreen();
  expect(screen.getByText('Bir')).toBeOnTheScreen();
  expect(screen.getByText('example()')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Kaynak'));
  expect(open).toHaveBeenCalledWith('https://example.com');
});

it('requires two API bindings and sends them with the selected model', async () => {
  const start = jest.fn().mockResolvedValue(false);
  const connections = createConnections();
  const props = {
    visible: true, modelSelection: null, apiProviders: [provider], connections,
    isProvidersLoading: false, providersError: null, isStarting: false, startError: null, canRetryStart: false,
    onClose: jest.fn(), onStart: start, onRetry: jest.fn(), onRefreshProviders: jest.fn(), onClearStartError: jest.fn(),
  };
  const view = render(<AnalysisCreateModal {...props} />);
  fireEvent.changeText(screen.getByPlaceholderText('AAPL'), 'AAPL');
  fireEvent.press(screen.getByText('Kısa (1 ay)'));
  fireEvent.press(screen.getByText('English'));
  expect(screen.getByRole('button', { name: 'Analizi Başlat' })).toBeDisabled();
  for (const choice of screen.getAllByRole('button', { name: /Kişisel bağlantı/ })) {
    fireEvent.press(choice);
  }
  fireEvent.press(screen.getByRole('button', { name: 'Analizi Başlat' }));
  await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({
    authType: 'api_key', language: 'en', quick: { connectionId: connection.id, model: 'test-model' },
    deep: { connectionId: connection.id, model: 'test-model' },
  })));
  view.rerender(<AnalysisCreateModal {...props} providersError="Katalog alınamadı" />);
  fireEvent.press(screen.getByText('Yeniden Dene'));
  expect(props.onRefreshProviders).toHaveBeenCalledTimes(1);
  view.rerender(<AnalysisCreateModal {...props} connections={{ ...connections, error: 'Bağlantılar alınamadı' }} />);
  fireEvent.press(screen.getByText('Yeniden Dene'));
  expect(connections.refresh).toHaveBeenCalledTimes(1);
});
