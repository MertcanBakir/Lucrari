import { useAppTheme } from '@/context/theme-context';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { CashBalanceModal } from '@/components/portfolio/cash-balance-modal';
import { PortfolioActivityEntryCard } from '@/components/portfolio/portfolio-activity-entry-card';
import { PortfolioAllocationCard } from '@/components/portfolio/portfolio-allocation-card';
import { PortfolioErrorView } from '@/components/portfolio/portfolio-error-view';
import { PortfolioSummaryCard } from '@/components/portfolio/portfolio-summary-card';
import { PositionCard } from '@/components/portfolio/position-card';
import { PositionDetailModal } from '@/components/portfolio/position-detail-modal';
import { PositionTradeModal } from '@/components/portfolio/position-trade-modal';
import { TransactionModal } from '@/components/portfolio/transaction-modal';
import { searchInstrumentsDetailed } from '@/services/portfolio/instrument-service';
import { calculateAllocationItems, calculatePortfolioStats } from '@/utils/financial-math';
import { assetId, date, position } from './fixtures';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/services/portfolio/instrument-service', () => ({ searchInstrumentsDetailed: jest.fn() }));

const cash = { tryBalance: 1500, usdBalance: 0 };
const positions = [position];
const instrument = {
  id: assetId, symbol: 'THYAO', companyName: 'Türk Hava Yolları', market: 'BIST100' as const,
  assetType: 'stock' as const, currency: 'TRY' as const, price: 100, hasPrice: true, isStale: false,
  staleReason: null, changePercent: 5.26, changeAmount: 5, priceAt: date,
};
const lookup = jest.mocked(searchInstrumentsDetailed);

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockPush.mockClear();
  lookup.mockReset().mockResolvedValue({ items: [instrument], error: null, isStale: false, hasMore: false });
});

afterEach(() => jest.restoreAllMocks());

it('offers portfolio retry and opens the activity route only when enabled', async () => {
  const retry = jest.fn();
  const view = render(<><PortfolioErrorView error={null} onRetry={retry} /><PortfolioActivityEntryCard disabled /></>);
  fireEvent.press(screen.getByText('Tekrar Dene'));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: /Portföy Hareketleri/ })).toBeDisabled();
  view.rerender(<><PortfolioErrorView error="Bağlantı hatası" onRetry={retry} isLoading /><PortfolioActivityEntryCard /></>);
  expect(screen.getByText('Bağlantı hatası')).toBeOnTheScreen();
  expect(screen.queryByText('Tekrar Dene')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: /Portföy Hareketleri/ }));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/portfolio-activity'));
});

it('lets the user expand and clear a portfolio allocation breakdown', async () => {
  const stats = calculatePortfolioStats(positions, cash, null);
  render(<PortfolioAllocationCard allocationItems={calculateAllocationItems(stats)} currencyMode="TRY" usdTryRate={null} />);
  fireEvent.press(screen.getByText('BIST'));
  expect(await screen.findByText('BIST Hisseleri')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('BIST'));
  await waitFor(() => expect(screen.queryByText('BIST Hisseleri')).toBeNull());
});

it('opens positions and keeps missing market prices distinct from zero', async () => {
  const open = jest.fn();
  const close = jest.fn();
  const trade = jest.fn();
  render(<PositionCard position={position} pnlMode="DAILY" currencyMode="TRY" usdTryRate={null} onPress={open} />);
  fireEvent.press(screen.getByText('THYAO'));
  await waitFor(() => expect(open).toHaveBeenCalledWith(position));
  render(<PositionDetailModal visible position={{ ...position, latest_price: null, price_is_stale: true }}
    currencyMode="TRY" usdTryRate={null} onClose={close} onTrade={trade} />);
  expect(screen.getByText('— (Alınamadı)')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('- Satış Yap'));
  expect(trade).toHaveBeenCalledWith('SELL');
  screen.unmount();
  render(<PositionDetailModal visible position={position} currencyMode="USD" usdTryRate={32}
    onClose={close} onTrade={trade} />);
  expect(screen.getByText('Satışlardan Kâr / Zarar')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('+ Alış Yap'));
  expect(trade).toHaveBeenLastCalledWith('BUY');
});

it('displays losses and converts a dollar position only with an available exchange rate', () => {
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'dark' } as ReturnType<typeof useAppTheme>);
  const modal = { visible: true, onClose: jest.fn(), onTrade: jest.fn() };
  const losing = { ...position, currency: 'USD' as const, market: 'NASDAQ100' as const, latest_price: 75,
    unrealized_pnl: null, realized_pnl: -5, change_amount: null, change_percent: -5,
    remaining_cost_basis: 0, price_is_stale: true };
  const view = render(<PositionDetailModal {...modal} position={null} currencyMode="TRY" usdTryRate={null} />);
  expect(screen.queryByText('Piyasa Değeri')).toBeNull();
  view.rerender(<PositionDetailModal {...modal} position={losing} currencyMode="USD" usdTryRate={32} />);
  expect(screen.getByText('Eski Fiyat')).toBeOnTheScreen();
  expect(screen.getByText(/-%5[,.]00/)).toBeOnTheScreen();
  view.rerender(<PositionDetailModal {...modal} position={losing} currencyMode="TRY" usdTryRate={null} />);
  expect(screen.getByText('—')).toBeOnTheScreen();
  view.rerender(<PositionDetailModal {...modal} position={{ ...losing, average_cost: 0, realized_pnl: 0, change_percent: null }}
    currencyMode="TRY" usdTryRate={32} />);
  expect(screen.queryByText('Satışlardan Kâr / Zarar')).toBeNull();
  view.rerender(<PositionDetailModal {...modal} position={position} currencyMode="USD" usdTryRate={null} />);
  expect(screen.getByText('—')).toBeOnTheScreen();
});

it('separates missing returns from a known loss on the portfolio summary', () => {
  const props = {
    currencyMode: 'USD' as const, pnlMode: 'DAILY' as const, usdTryRate: 32,
    onTogglePnlMode: jest.fn(), onToggleCurrency: jest.fn(), onOpenChart: jest.fn(),
  };
  const stats = calculatePortfolioStats(positions, cash, {
    rate: 32, rateAt: date, isStale: false, staleReason: null, isAvailable: true, source: 'database',
  });
  const view = render(<PortfolioSummaryCard {...props} stats={{
    ...stats, totalPortfolioValueTry: null, positionsMarketValueTry: null, dailyPnlTry: null,
    dailyPnlPct: null, cashValueTry: null,
  }} />);
  expect(screen.queryByText('Kurulum Gerekli')).toBeNull();
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  view.rerender(<PortfolioSummaryCard {...props} stats={{ ...stats, dailyPnlTry: -160, dailyPnlPct: -5 }} />);
  expect(screen.getByText(/-\$5[,.]00/)).toBeOnTheScreen();
  expect(screen.getByText(/-%5[,.]00/)).toBeOnTheScreen();
});

it('records a buy without cash setup, and retries the exact same intent', async () => {
  const submit = jest.fn().mockRejectedValueOnce(new Error('Network failed')).mockResolvedValueOnce(undefined);
  const close = jest.fn();
  render(<TransactionModal visible positions={positions} onClose={close} onSubmitTransaction={submit} />);
  await screen.findAllByText('THYAO');
  fireEvent.changeText(screen.getByLabelText('Adet'), '2');
  expect(screen.queryByText(/Yetersiz nakit|Kurulum Gerekli/)).toBeNull();
  fireEvent.press(screen.getByText(/Alış İşlemini Kaydet/));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
  fireEvent.press(screen.getByText(/Alış İşlemini Kaydet/));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(submit.mock.calls[0][0]).toEqual(submit.mock.calls[1][0]);
  expect(submit.mock.calls[1][0]).toMatchObject({ instrumentId: assetId, quantity: 2, unitPrice: 100, transactionType: 'BUY' });
  expect(close).toHaveBeenCalledTimes(1);
});

it('rejects excess sales and accepts a fractional sale with a manual price', async () => {
  const submit = jest.fn().mockResolvedValue(undefined);
  render(<PositionTradeModal visible position={{ ...position, latest_price: null }} initialAction="SELL" onClose={jest.fn()} onSubmit={submit} />);
  fireEvent.changeText(screen.getByLabelText('Adet'), String(Number(position.quantity) + 1));
  fireEvent.changeText(screen.getByLabelText('Birim fiyat'), '120');
  expect(screen.getByText('Satış İşlemini Kaydet')).toBeDisabled();
  fireEvent.press(screen.getByText(/Satış İşlemini Kaydet/));
  expect(submit).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Adet'), '0,5');
  fireEvent.press(screen.getByText(/Satış İşlemini Kaydet/));
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ transactionType: 'SELL', quantity: 0.5, unitPrice: 120 })));
});

it('edits optional cash from its existing values and rejects negative amounts', async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  render(<CashBalanceModal visible tryBalance={120} usdBalance={5} onClose={jest.fn()} onSave={save} />);
  const [tryInput, usdInput] = screen.getAllByPlaceholderText('0');
  expect(tryInput.props.value).toBe('120');
  expect(usdInput.props.value).toBe('5');
  fireEvent.changeText(tryInput, '-1');
  fireEvent.press(screen.getByText('Bakiyeleri Kaydet'));
  expect(save).not.toHaveBeenCalled();
  fireEvent.changeText(tryInput, '1.234,56');
  fireEvent.changeText(usdInput, '0');
  fireEvent.press(screen.getByText('Bakiyeleri Kaydet'));
  await waitFor(() => expect(save).toHaveBeenCalledWith(1234.56, 0));
});

it('shows a complete portfolio without cash and separates realized sale profit', () => {
  const edit = jest.fn();
  const stats = calculatePortfolioStats(positions, null, null, { tryPnl: 900, usdPnl: 0 });
  render(<PortfolioSummaryCard stats={stats} currencyMode="TRY" pnlMode="TOTAL" usdTryRate={null}
    onTogglePnlMode={jest.fn()} onToggleCurrency={jest.fn()} onOpenChart={jest.fn()} onEditCash={edit} />);
  expect(screen.queryByText('Kısmi')).toBeNull();
  expect(screen.getByText('Açık Pozisyon Kâr / Zarar')).toBeOnTheScreen();
  expect(screen.getByText('Satışlardan Kâr / Zarar:')).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Nakit tutarını düzenle'));
  expect(edit).toHaveBeenCalledTimes(1);
});

it('retries a catalog failure without changing the search text', async () => {
  lookup.mockResolvedValueOnce({ items: [], error: 'Bağlantı yok', isStale: false, hasMore: false });
  render(<TransactionModal visible positions={positions} onClose={jest.fn()} onSubmitTransaction={jest.fn()} />);
  fireEvent.press(await screen.findByText('Tekrar Dene'));
  expect((await screen.findAllByText('THYAO')).length).toBeGreaterThan(0);
});

it('restores the position sale percentage shortcuts and context values', async () => {
  const submit = jest.fn().mockResolvedValue(undefined);
  render(<PositionTradeModal visible position={position} initialAction="SELL" onClose={jest.fn()} onSubmit={submit} />);
  expect(screen.getByText('Piyasa Fiyatı')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('%50'));
  await waitFor(() => expect(screen.getByLabelText('Adet').props.value).toBe('4'));
  fireEvent.press(screen.getByText('Satış İşlemini Kaydet'));
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 4, unitPrice: 100 })));
});

it('restores market tabs, owned-asset search and the full-sale shortcut', async () => {
  const submit = jest.fn().mockResolvedValue(undefined);
  const crypto = { ...position, instrument_id: '6ba7b812-9dad-11d1-80b4-00c04fd430c8', symbol: 'BTC', market: 'CRYPTO' as const,
    currency: 'USD' as const, latest_price: null };
  render(<TransactionModal visible initialType="SELL" positions={[position, crypto]} onClose={jest.fn()} onSubmitTransaction={submit} />);
  fireEvent.changeText(screen.getByPlaceholderText(/varlıklarda ara/), 'Türk Hava');
  expect(screen.getAllByText('THYAO').length).toBeGreaterThan(0);
  fireEvent.changeText(screen.getByPlaceholderText(/varlıklarda ara/), '');
  fireEvent.press(screen.getByText('Kripto'));
  fireEvent.press(screen.getAllByText('BTC')[0]);
  fireEvent.press(screen.getByText('Tümü (%100)'));
  fireEvent.changeText(screen.getByLabelText('Birim fiyat'), '25');
  fireEvent.press(screen.getByText(/Satış İşlemini Kaydet/));
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ currency: 'USD', quantity: 8, unitPrice: 25 })));
});
