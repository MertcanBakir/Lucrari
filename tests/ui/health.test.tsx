import { Platform } from 'react-native';
import { useAppTheme } from '@/context/theme-context';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AnalysisHealthMenuItem } from '@/components/health/analysis-health-menu-item';
import { SupabaseHealthCard } from '@/components/health/supabase-health-card';
import { SupabaseHealthMenuItem } from '@/components/health/supabase-health-menu-item';
import { SystemHealthJobCard } from '@/components/system-health/system-health-job-card';
import { SystemHealthMenuItem } from '@/components/system-health/system-health-menu-item';
import { SystemHealthOverallCard } from '@/components/system-health/system-health-overall-card';
import { useAgentHealth } from '@/hooks/use-agent-health';
import { useSupabaseHealth } from '@/hooks/use-supabase-health';
import { useSystemHealth } from '@/hooks/use-system-health';
import type { SupabaseHealthReport } from '@/types/health';
import { evaluateOverallHealth, normalizeSystemHealthResponse } from '@/utils/system-health-formatters';
import { date } from './fixtures';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/use-agent-health', () => ({ useAgentHealth: jest.fn() }));
jest.mock('@/hooks/use-supabase-health', () => ({ useSupabaseHealth: jest.fn() }));
jest.mock('@/hooks/use-system-health', () => ({ useSystemHealth: jest.fn() }));

const report: SupabaseHealthReport = {
  overallStatus: 'healthy', supabaseUrl: 'https://example.com', isConfigured: true,
  timestamp: date, averageLatencyMs: 35, errorMessage: null,
  checks: [
    { id: 'rest', name: 'Veri erişimi', category: 'rest', status: 'pass', latencyMs: 35, message: 'Bağlı' },
    { id: 'auth', name: 'Oturum', category: 'auth', status: 'warn', latencyMs: null, message: 'Yavaş' },
    { id: 'gateway', name: 'Ağ geçidi', category: 'gateway', status: 'fail', latencyMs: null, message: 'Yanıt yok' },
    { id: 'config', name: 'Ayar', category: 'config', status: 'skipped', latencyMs: null, message: 'Atlandı' },
  ],
};
const [job] = normalizeSystemHealthResponse([{
  job_code: 'BIST_PRICES', execution_status: 'success', health_status: 'healthy',
  last_started_at: date, last_finished_at: date, last_success_at: date, checked_at: date,
  duration_seconds: 45, is_overdue: false, message_code: 'JOB_OK',
}]).items;
const refetch = jest.fn().mockResolvedValue(undefined);
const baseHealth = { report, isLoading: false, isRefetching: false, error: null, lastChecked: new Date(date), refetch };

it('renders Agent connectivity and changes status when a check finishes', () => {
  const status = jest.mocked(useAgentHealth);
  status.mockReturnValue({ status: 'checking', report: null } as ReturnType<typeof useAgentHealth>);
  const view = render(<AnalysisHealthMenuItem />);
  expect(screen.getByText('Kontrol ediliyor')).toBeOnTheScreen();
  status.mockReturnValue({ status: 'online', report: null } as ReturnType<typeof useAgentHealth>);
  view.rerender(<AnalysisHealthMenuItem />);
  expect(screen.getByText('Çevrimiçi')).toBeOnTheScreen();
  status.mockReturnValue({ status: 'unreachable', report: null } as ReturnType<typeof useAgentHealth>);
  view.rerender(<AnalysisHealthMenuItem />);
  expect(screen.getByText('Erişilemiyor')).toBeOnTheScreen();
});

it('renders Supabase diagnostics and refreshes the displayed report', async () => {
  const health = jest.mocked(useSupabaseHealth);
  const completed = jest.fn();
  health.mockReturnValue({ ...baseHealth, report: null, isLoading: true, lastChecked: null });
  const view = render(<SupabaseHealthCard onRefreshCompleted={completed} />);
  expect(screen.getByText(/Bağlantı kontrolleri yapılıyor/)).toBeOnTheScreen();
  health.mockReturnValue(baseHealth);
  view.rerender(<SupabaseHealthCard onRefreshCompleted={completed} />);
  expect(screen.getByText('Veri erişimi')).toBeOnTheScreen();
  expect(screen.getByText('Yanıt yok')).toBeOnTheScreen();
  expect(screen.getAllByText(/35\s*ms/).length).toBeGreaterThan(0);
  fireEvent.press(screen.getByText('Bağlantıyı Yeniden Kontrol Et'));
  await waitFor(() => expect(refetch).toHaveBeenCalled());
  await waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
  health.mockReturnValue({ ...baseHealth, report: { ...report, overallStatus: 'unconfigured', isConfigured: false } });
  view.rerender(<SupabaseHealthCard />);
  expect(screen.getByText(/Yapılandırma Gerekli/)).toBeOnTheScreen();
});

it.each([
  ['healthy', 'Sağlıklı'], ['degraded', 'Kısıtlı'], ['unhealthy', 'Hata'], ['unconfigured', 'Bekliyor'],
] as const)('shows the %s database menu badge and can open diagnostics', async (overallStatus, label) => {
  jest.mocked(useSupabaseHealth).mockReturnValue({ ...baseHealth, report: { ...report, overallStatus } });
  render(<SupabaseHealthMenuItem />);
  expect(screen.getByText(label)).toBeOnTheScreen();
  fireEvent.press(screen.getByText(label));
  await waitFor(() => expect(mockPush).toHaveBeenLastCalledWith('/supabase-health'));
});

it('renders job information and warns that a system status report is stale', () => {
  const overall = evaluateOverallHealth([job], date);
  render(<><SystemHealthJobCard item={job} /><SystemHealthOverallCard overall={overall} isStale isIncomplete /></>);
  expect(screen.getByText(job.displayName)).toBeOnTheScreen();
  expect(screen.getByText('45 sn')).toBeOnTheScreen();
  expect(screen.getByText(overall.title)).toBeOnTheScreen();
  expect(screen.getAllByText(/güncel|eksik/i).length).toBeGreaterThan(0);
});

it('reports a critical system job and opens the detailed status screen', async () => {
  const critical = { ...job, healthStatus: 'critical', executionStatus: 'failed', isOverdue: true } as const;
  const overall = evaluateOverallHealth([critical], date);
  jest.mocked(useSystemHealth).mockReturnValue({
    report: { items: [critical], sections: [], overall, checkedAt: date, isStale: false, isIncomplete: false },
    isLoading: false, isRefreshing: false, isStale: false, error: null, refetch, lastChecked: 1,
  });
  render(<><SystemHealthJobCard item={critical} /><SystemHealthMenuItem /></>);
  expect(screen.getByText('Başarısız')).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText(/Sistem ve Veri Durumu ekranını aç/));
  await waitFor(() => expect(mockPush).toHaveBeenLastCalledWith('/system-health'));
});

it.each([
  ['warning', 'DİKKAT / KISMİ DURUM', 'Dikkat'],
  ['critical', 'KRİTİK HATA / ÇALIŞMIYOR', 'Kritik'],
  ['running', 'GÜNCELLEME DEVAM EDİYOR', 'Çalışıyor'],
  ['unknown', 'DURUM BEKLENİYOR', 'Bekleniyor'],
] as const)('keeps the %s summary and menu badge consistent', (status, summaryLabel, menuLabel) => {
  const item = { ...job, healthStatus: status };
  const overall = evaluateOverallHealth([item], date);
  jest.mocked(useSystemHealth).mockReturnValue({
    report: { items: [item], sections: [], overall, checkedAt: date, isStale: false, isIncomplete: false },
    isLoading: false, isRefreshing: false, isStale: false, error: null, refetch, lastChecked: 1,
  });
  render(<><SystemHealthOverallCard overall={overall} /><SystemHealthJobCard item={item} /><SystemHealthMenuItem /></>);
  expect(screen.getByText(summaryLabel)).toBeOnTheScreen();
  expect(screen.getByLabelText(new RegExp('Durum: ' + menuLabel))).toBeOnTheScreen();
  expect(screen.getByLabelText(new RegExp('Sağlık Durumu: ' + menuLabel))).toBeOnTheScreen();
});

it('distinguishes an initial health check from a failed request', () => {
  const hook = jest.mocked(useSystemHealth);
  const state = {
    report: null, isLoading: true, isRefreshing: false, isStale: false, error: null, refetch, lastChecked: 0,
  };
  hook.mockReturnValue(state);
  const view = render(<SystemHealthMenuItem />);
  expect(screen.getByText(/Durum kontrol ediliyor/)).toBeOnTheScreen();
  hook.mockReturnValue({ ...state, isLoading: false, error: 'Sunucuya erişilemiyor' });
  view.rerender(<SystemHealthMenuItem />);
  expect(screen.getByText('Durum bilgisi alınamadı')).toBeOnTheScreen();
});

it('renders degraded and unavailable diagnostics, including manual refresh in dark mode on web', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'dark' } as ReturnType<typeof useAppTheme>);
  const health = jest.mocked(useSupabaseHealth);
  health.mockReturnValue({ ...baseHealth, report: null, error: new Error('Connection unavailable'), lastChecked: null });
  const view = render(<SupabaseHealthCard />);
  expect(screen.getByText('YAPILANDIRMA BEKLİYOR')).toBeOnTheScreen();
  health.mockReturnValue({ ...baseHealth, report: { ...report, overallStatus: 'degraded', averageLatencyMs: null } });
  view.rerender(<SupabaseHealthCard />);
  expect(screen.getByText('KISITLI ERİŞİM')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Bağlantıyı Yeniden Kontrol Et'));
  await waitFor(() => expect(refetch).toHaveBeenCalled());
  health.mockReturnValue({ ...baseHealth, isRefetching: true, report: { ...report, overallStatus: 'unhealthy', errorMessage: 'Unavailable' } });
  view.rerender(<SupabaseHealthCard />);
  expect(screen.queryByText('Bağlantıyı Yeniden Kontrol Et')).toBeNull();
});

afterEach(() => {
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'light' } as ReturnType<typeof useAppTheme>);
  jest.restoreAllMocks();
});
