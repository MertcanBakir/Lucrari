import { useAppTheme } from '@/context/theme-context';
import { useLocalSearchParams } from 'expo-router';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import PortfolioChartScreen from '@/app/portfolio-chart';
import { useAuth } from '@/context/auth-context';
import { usePortfolioChart } from '@/hooks/use-portfolio-chart';
import { PortfolioLineChart } from '@/components/portfolio-chart/portfolio-line-chart';
import type { PortfolioChartPoint } from '@/types/portfolio-chart';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }), useLocalSearchParams: jest.fn(() => ({ currency: 'USD' })) }));
jest.mock('@/context/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/hooks/use-portfolio-chart', () => ({ usePortfolioChart: jest.fn() }));
const points: PortfolioChartPoint[] = [{ date: '2026-11-01', value: 100, calculationVersion: 2, isPartial: false,
  missingFx: false, missingMarketPnl: false, capturedAt: null, sourceCount: 1 }];
const refresh = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useAuth).mockReturnValue({ userId: 'a', isAuthReady: true, retryAuth: jest.fn() } as unknown as ReturnType<typeof useAuth>);
  jest.mocked(usePortfolioChart).mockReturnValue({ points, name: 'Ana Portföy', isLoading: false, error: null, refresh, isStale: false });
});
it('opens in the selected currency and switches markets, metric and date range', async () => {
  render(<PortfolioChartScreen />);
  expect(screen.getByText('Portföy Grafiği')).toBeOnTheScreen();
  expect(usePortfolioChart).toHaveBeenLastCalledWith(expect.objectContaining({ currency: 'USD' }));
  fireEvent.press(screen.getByLabelText('Grafik para birimini değiştir'));
  expect(usePortfolioChart).toHaveBeenLastCalledWith(expect.objectContaining({ currency: 'TRY' }));
  await act(async () => fireEvent.press(screen.getByText('BIST')));
  expect(usePortfolioChart).toHaveBeenLastCalledWith(expect.objectContaining({ market: 'BIST100' }));
  fireEvent.press(screen.getByText('Kâr / Zarar'));
  fireEvent.press(screen.getByLabelText('Dönem: 1Y'));
  expect(usePortfolioChart).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'PNL', range: '1Y' }));
  fireEvent.press(screen.getByLabelText('Geri dön'));
  expect(mockBack).toHaveBeenCalled();
});
it('separates loading, failed and legitimately empty history', () => {
  const hook = jest.mocked(usePortfolioChart);
  hook.mockReturnValue({ points: [], name: '', isLoading: true, error: null, refresh, isStale: false });
  const view = render(<PortfolioChartScreen />);
  expect(screen.getByText('Grafik yükleniyor…')).toBeOnTheScreen();
  hook.mockReturnValue({ points: [], name: '', isLoading: false, error: 'Bağlantı yok', refresh, isStale: false });
  view.rerender(<PortfolioChartScreen />);
  expect(screen.getByText('Grafik yüklenemedi')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Tekrar Dene'));
  expect(refresh).toHaveBeenCalled();
  hook.mockReturnValue({ points: [], name: '', isLoading: false, error: null, refresh, isStale: false });
  view.rerender(<PortfolioChartScreen />);
  expect(screen.getByText('Bu seçim için grafik verisi yok')).toBeOnTheScreen();
});
it('provides exact values when the line is inspected with accessibility actions', () => {
  render(<PortfolioLineChart points={[points[0], { ...points[0], date: '2026-11-02', value: -20 }]} currency="TRY" metric="PNL" />);
  fireEvent(screen.getByTestId('portfolio-chart-plot'), 'layout', { nativeEvent: { layout: { width: 300, height: 240 } } });
  fireEvent(screen.getByTestId('portfolio-chart-plot'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
  expect(screen.getByTestId('chart-selected-value').props.children).toMatch(/100/);
});

it('scrubs with stable coordinates, keeps the date after release and limits haptic ticks', async () => {
  const { PanResponder } = jest.requireActual('react-native');
  const haptics = jest.requireMock('expo-haptics');
  const create = jest.spyOn(PanResponder, 'create');
  let now = 1000;
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    render(<PortfolioLineChart points={[points[0], { ...points[0], date: '2026-11-02', value: 200 },
      { ...points[0], date: '2026-11-03', value: 300 }]} currency="TRY" metric="VALUE" />);
    fireEvent(screen.getByTestId('portfolio-chart-plot'), 'layout', { nativeEvent: { layout: { width: 300, height: 240 } } });
    const config = create.mock.calls[create.mock.calls.length - 1][0] as any;
    await act(async () => config.onPanResponderGrant({ nativeEvent: { locationX: 12 } }));
    expect(haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(haptics.impactAsync).toHaveBeenCalledWith(haptics.ImpactFeedbackStyle.Light);
    now += 100;
    await act(async () => config.onPanResponderMove({ nativeEvent: { locationX: 0 } }, { x0: 1000, moveX: 1138 }));
    expect(screen.getByTestId('chart-selected-value').props.children).toMatch(/200/);
    expect(haptics.impactAsync).toHaveBeenCalledTimes(2);
    fireEvent(screen.getByTestId('portfolio-chart-plot'), 'responderRelease', { nativeEvent: { touches: [], changedTouches: [] } });
    expect(screen.getByTestId('chart-selected-value').props.children).toMatch(/200/);
    await act(async () => config.onPanResponderMove({}, { x0: 1000, moveX: 1139 }));
    expect(haptics.impactAsync).toHaveBeenCalledTimes(2);
    now += 10;
    await act(async () => config.onPanResponderMove({}, { x0: 1000, moveX: 1276 }));
    expect(haptics.impactAsync).toHaveBeenCalledTimes(2);
    expect(config.onPanResponderTerminationRequest()).toBe(false);
    fireEvent(screen.getByTestId('portfolio-chart-plot'), 'responderRelease', { nativeEvent: { touches: [], changedTouches: [] } });
    expect(screen.getByTestId('chart-selected-value').props.children).toMatch(/300/);
  } finally { create.mockRestore(); clock.mockRestore(); }
});

it('explains missing FX, missing market profit and historical valuation limitations', () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ currency: 'TRY', market: 'NASDAQ100' });
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'dark' } as ReturnType<typeof useAppTheme>);
  const hook = jest.mocked(usePortfolioChart);
  hook.mockReturnValue({ points: [{ ...points[0], value: null, missingFx: true }], name: '', isLoading: false,
    error: null, refresh, isStale: false });
  const view = render(<PortfolioChartScreen />);
  expect(usePortfolioChart).toHaveBeenLastCalledWith(expect.objectContaining({ currency: 'TRY', market: 'NASDAQ100' }));
  expect(screen.getByText(/geçmiş dolar kuru bulunamadı/)).toBeOnTheScreen();
  hook.mockReturnValue({ points: [{ ...points[0], value: null, missingMarketPnl: true }], name: '', isLoading: false,
    error: null, refresh, isStale: false });
  view.rerender(<PortfolioChartScreen />);
  expect(screen.getByText(/toplam kâr\/zarar geçmişi yeni günlük kayıtlarla/)).toBeOnTheScreen();
  hook.mockReturnValue({ points: [
    { ...points[0], sourceCount: 20, calculationVersion: 1 },
    { ...points[0], date: '2026-11-02', sourceCount: 20, isPartial: true, capturedAt: '2026-11-02T12:00:00Z' },
  ], name: 'Portföy', isLoading: false, error: 'Bağlantı yok', refresh, isStale: true });
  view.rerender(<PortfolioChartScreen />);
  expect(screen.getByText(/Son yüklenen grafik gösteriliyor/)).toBeOnTheScreen();
  expect(screen.getByText(/Son kayıt:/)).toBeOnTheScreen();
  expect(screen.getByText(/uç değerleri koruyan/)).toBeOnTheScreen();
  expect(screen.getByText(/önceki maliyet yöntemiyle/)).toBeOnTheScreen();
  expect(screen.getByText(/güncel olmayan fiyatlar/)).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Grafik para birimini değiştir'));
  expect(usePortfolioChart).toHaveBeenLastCalledWith(expect.objectContaining({ currency: 'USD' }));
});

it('retries authentication when chart history cannot load for a signed-out account', () => {
  const retryAuth = jest.fn();
  jest.mocked(useAuth).mockReturnValue({ userId: null, isAuthReady: true, retryAuth } as unknown as ReturnType<typeof useAuth>);
  jest.mocked(usePortfolioChart).mockReturnValue({ points: [], name: '', isLoading: false,
    error: 'Oturum gerekli', refresh, isStale: false });
  render(<PortfolioChartScreen />);
  fireEvent.press(screen.getByText('Tekrar Dene'));
  expect(retryAuth).toHaveBeenCalledTimes(1);
});

afterEach(() => {
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'light' } as ReturnType<typeof useAppTheme>);
  jest.restoreAllMocks();
});
