import { useAppTheme } from '@/context/theme-context';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import { CashAccountSetupModal } from '@/components/portfolio/cash-account-setup-modal';
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

const cash = {
  portfolioId: 'portfolio', isInitialized: true, balances: [
    { currency: 'TRY' as const, openingBalance: 1500, currentBalance: 1500, initializedAt: date },
    { currency: 'USD' as const, openingBalance: 0, currentBalance: 0, initializedAt: date },
  ],
};
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

it('shows portfolio cash setup and available valuation information', () => {
  const setup = jest.fn();
  const toggle = jest.fn();
  const props = { currencyMode: 'TRY' as const, usdTryRate: null, onToggleCurrency: jest.fn(),
    onTogglePnlMode: toggle, onOpenChart: jest.fn(), onOpenCashSetup: setup };
  const view = render(<PortfolioSummaryCard {...props} stats={calculatePortfolioStats(positions, null, null)} pnlMode="DAILY" />);
  expect(screen.getByText('Kısmi')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Nakit Bakiyenizi Kurun'));
  expect(setup).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText('Günlük Değişim'));
  expect(toggle).toHaveBeenCalledTimes(1);
  const stats = calculatePortfolioStats(positions, cash, null);
  view.rerender(<PortfolioSummaryCard {...props} stats={stats} pnlMode="TOTAL" />);
  expect(screen.getByText('Toplam Kâr / Zarar')).toBeOnTheScreen();
  expect(screen.queryByText('Kurulum Gerekli')).toBeNull();
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
  expect(screen.getByText('FIFO Gerçekleşmiş K/Z')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('+ Alış Yap'));
  expect(trade).toHaveBeenLastCalledWith('BUY');
});

it('validates opening cash amounts and submits exact TRY and USD balances', async () => {
  const initialize = jest.fn().mockResolvedValue(undefined);
  const close = jest.fn();
  render(<CashAccountSetupModal visible onClose={close} onInitialize={initialize} />);
  const [tryInput, usdInput] = screen.getAllByPlaceholderText('0');
  fireEvent.changeText(tryInput, '-2');
  fireEvent.press(screen.getByText('Bakiyeleri Kaydet'));
  expect(screen.getByText(/TRY Nakit:/)).toBeOnTheScreen();
  expect(initialize).not.toHaveBeenCalled();
  fireEvent.changeText(tryInput, '125,50');
  fireEvent.changeText(usdInput, '10');
  fireEvent.press(screen.getByText('Bakiyeleri Kaydet'));
  await waitFor(() => expect(initialize).toHaveBeenCalledWith(125.5, 10, expect.any(String)));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});

it('shows a cash setup error, lets the user correct USD, and allows dismissal', async () => {
  const close = jest.fn();
  const initialize = jest.fn().mockRejectedValue(new Error('Sunucu hatası'));
  render(<CashAccountSetupModal visible onClose={close} onInitialize={initialize} />);
  fireEvent.changeText(screen.getAllByPlaceholderText('0')[1], '-5');
  fireEvent.press(screen.getByText('Bakiyeleri Kaydet'));
  expect(screen.getByText(/USD Nakit:/)).toBeOnTheScreen();
  fireEvent.changeText(screen.getAllByPlaceholderText('0')[1], '5');
  fireEvent.press(screen.getByText('Bakiyeleri Kaydet'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Hata', expect.stringMatching(/Sunucu hatası/)));
  fireEvent.press(screen.getByText('İptal'));
  expect(close).toHaveBeenCalledTimes(1);
});

it('uses part of an owned position for a sale and displays a submission error', async () => {
  const submit = jest.fn().mockRejectedValue(new Error('Satış reddedildi'));
  render(<PositionTradeModal visible position={position} initialAction="SELL"
    availableCash={500} isCashInitialized onClose={jest.fn()} onSubmit={submit} />);
  fireEvent.press(screen.getByText('%50'));
  expect(await screen.findByDisplayValue('4')).toBeOnTheScreen();
  fireEvent.press(await screen.findByText(/Satış İşlemini Kaydet/));
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
    instrumentId: assetId, transactionType: 'SELL', quantity: 4, unitPrice: 100,
  })));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('İşlem Başarısız', 'Satış reddedildi'));
});

it('submits a cash deposit once while its request is pending', async () => {
  let resolve: () => void = () => {};
  const pending = new Promise<void>((done) => { resolve = done; });
  const submit = jest.fn(() => pending);
  const close = jest.fn();
  render(<TransactionModal visible initialType="DEPOSIT" positions={positions} isCashInitialized
    availableCashTry={1500} availableCashUsd={10} onClose={close} onSubmitTransaction={jest.fn()} onSubmitCashFlow={submit} />);
  fireEvent.press(screen.getByText(/Amerikan Doları/));
  fireEvent.changeText(screen.getByPlaceholderText('0'), '12,50');
  fireEvent.press(await screen.findByText(/USD Yatırma İşlemini Kaydet/));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ flowType: 'DEPOSIT', currency: 'USD', amount: 12.5 }));
  expect(screen.queryByText('USD Yatırma İşlemini Kaydet')).toBeNull();
  await act(async () => resolve());
  expect(close).toHaveBeenCalledTimes(1);
});

it('moves between buying and selling and submits the selected holding', async () => {
  const submit = jest.fn().mockResolvedValue(undefined);
  render(<TransactionModal visible positions={positions} isCashInitialized availableCashTry={5000}
    onClose={jest.fn()} onSubmitTransaction={submit} onSubmitCashFlow={jest.fn()} />);
  await screen.findByText('THYAO');
  fireEvent.changeText(screen.getByPlaceholderText('0'), '2');
  fireEvent.press(await screen.findByText(/Alış İşlemini Kaydet/));
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
    instrumentId: assetId, transactionType: 'BUY', quantity: 2, unitPrice: 100,
  })));
  fireEvent.press(screen.getByText('Satış'));
  fireEvent.press(screen.getByText('%50'));
  fireEvent.press(await screen.findByText(/Satış İşlemini Kaydet/));
  await waitFor(() => expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ transactionType: 'SELL', quantity: 4 })));
});

it('blocks a withdrawal until cash is configured and offers the setup action', () => {
  const setup = jest.fn();
  const submit = jest.fn();
  const base = { visible: true, initialType: 'WITHDRAWAL' as const, positions,
    onOpenCashSetup: setup, onClose: jest.fn(), onSubmitTransaction: jest.fn(), onSubmitCashFlow: submit };
  const view = render(<TransactionModal {...base} isCashInitialized={false} />);
  expect(screen.getByText(/Nakit bakiyesi kurulmamış/)).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Kurulum Yap'));
  expect(setup).toHaveBeenCalledTimes(1);
  view.rerender(<TransactionModal {...base} isCashInitialized />);
  expect(screen.getByText(/Nakit bakiyesi doğrulanamadı/)).toBeOnTheScreen();
  view.rerender(<TransactionModal {...base} isCashInitialized availableCashTry={10} />);
  expect(screen.getByText(/Yetersiz nakit/)).toBeOnTheScreen();
  expect(submit).not.toHaveBeenCalled();
});

it('offers a catalog retry and promotes valid results after a failed lookup', async () => {
  lookup.mockResolvedValueOnce({ items: [], error: 'Piyasa verisi yok', isStale: false, hasMore: false });
  render(<TransactionModal visible positions={positions} isCashInitialized availableCashTry={5000}
    onClose={jest.fn()} onSubmitTransaction={jest.fn()} onSubmitCashFlow={jest.fn()} />);
  expect(await screen.findByText('Piyasa verisi yok')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Tekrar Dene'));
  expect(await screen.findByText('THYAO')).toBeOnTheScreen();
  fireEvent.changeText(screen.getByPlaceholderText('Sembol veya şirket adı ara...'), 'THY');
  await waitFor(() => expect(lookup).toHaveBeenCalledWith('THY', 'BIST100', expect.any(Number), 0));
});

it('rejects excess sales and only offers a trade when holdings are available', () => {
  const submit = jest.fn();
  const view = render(<TransactionModal visible initialType="SELL" isCashInitialized
    onClose={jest.fn()} onSubmitTransaction={submit} onSubmitCashFlow={jest.fn()} />);
  expect(screen.getByText('Portföyünüzde Satılabilir Varlık Yok')).toBeOnTheScreen();
  view.rerender(<TransactionModal visible initialType="SELL" isCashInitialized positions={positions}
    onClose={jest.fn()} onSubmitTransaction={submit} onSubmitCashFlow={jest.fn()} />);
  fireEvent.changeText(screen.getByPlaceholderText('Portföyünüzdeki varlıklarda ara...'), 'AAPL');
  expect(screen.queryByText('THYAO')).toBeNull();
  fireEvent.changeText(screen.getByPlaceholderText('Portföyünüzdeki varlıklarda ara...'), '');
  fireEvent.changeText(screen.getByPlaceholderText('0'), '100');
  expect(screen.getByText(/Yetersiz pozisyon/i)).toBeOnTheScreen();
  expect(submit).not.toHaveBeenCalled();
});

it('shows why a position buy is blocked and can switch to a successful sale', async () => {
  const setup = jest.fn();
  const close = jest.fn();
  const submit = jest.fn().mockResolvedValue(undefined);
  const props = { visible: true, position, onOpenCashSetup: setup, onClose: close, onSubmit: submit };
  const view = render(<PositionTradeModal {...props} availableCash={null} isCashInitialized={false} />);
  fireEvent.press(screen.getByText('Kurulum Yap'));
  expect(setup).toHaveBeenCalledTimes(1);
  view.rerender(<PositionTradeModal {...props} availableCash={null} isCashInitialized />);
  expect(screen.getByText(/nakit bakiyesi doğrulanamadı/i)).toBeOnTheScreen();
  view.rerender(<PositionTradeModal {...props} availableCash={5} isCashInitialized />);
  expect(screen.getByText(/yetersiz nakit/i)).toBeOnTheScreen();
  fireEvent.press(screen.getByText('- Satış Yap'));
  fireEvent.changeText(screen.getByPlaceholderText('0'), '2');
  fireEvent.press(await screen.findByText(/Satış İşlemini Kaydet/));
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ transactionType: 'SELL', quantity: 2 })));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
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
  expect(screen.queryByText('FIFO Gerçekleşmiş K/Z')).toBeNull();
  view.rerender(<PositionDetailModal {...modal} position={position} currencyMode="USD" usdTryRate={null} />);
  expect(screen.getByText('—')).toBeOnTheScreen();
});

it('retries a failed buy with the same request ID, then accepts the corrected trade', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const close = jest.fn();
  const submit = jest.fn().mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce(undefined);
  const props = { visible: true, position, availableCash: 500, isCashInitialized: true, onClose: close, onSubmit: submit };
  const view = render(<PositionTradeModal {...props} />);
  fireEvent.changeText(screen.getByPlaceholderText('0'), '1');
  fireEvent.press(await screen.findByText(/Alış İşlemini Kaydet/));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
  fireEvent.press(await screen.findByText(/Alış İşlemini Kaydet/));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(submit.mock.calls[0][0].clientRequestId).toBe(submit.mock.calls[1][0].clientRequestId);
  view.rerender(<PositionTradeModal {...props} visible={false} />);
  expect(screen.queryByText(/Alış İşlemini Kaydet/)).toBeNull();
});

it('filters holdings across markets and permits a sale with a manually supplied price', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'dark' } as ReturnType<typeof useAppTheme>);
  const submit = jest.fn().mockRejectedValueOnce(new Error('invalid trade')).mockResolvedValueOnce(undefined);
  const other = [
    { ...position, instrument_id: '6ba7b812-9dad-11d1-80b4-00c04fd430c8', symbol: 'BTC', market: 'CRYPTO' as const,
      currency: 'USD' as const, latest_price: null, change_percent: null, change_amount: null, company_name: '' },
    { ...position, symbol: 'FUND', market: 'TEFAS' as const, quantity: 1 },
    { ...position, symbol: 'USD', market: 'FX' as const, price_is_stale: true },
  ];
  render(<TransactionModal visible initialType="SELL" positions={[position, ...other]} isCashInitialized
    onClose={jest.fn()} onSubmitTransaction={submit} onSubmitCashFlow={jest.fn()} />);
  fireEvent.changeText(screen.getByPlaceholderText(/varlıklarda ara/), 'Türk Hava');
  expect(screen.getAllByText('THYAO').length).toBeGreaterThan(0);
  fireEvent.changeText(screen.getByPlaceholderText(/varlıklarda ara/), '');
  fireEvent.press(screen.getByText('Kripto'));
  fireEvent.press(screen.getAllByText('BTC')[0]);
  fireEvent.press(screen.getByText('Tümü (%100)'));
  fireEvent.changeText(screen.getByPlaceholderText('0.00'), '25');
  fireEvent.press(await screen.findByText(/Satış İşlemini Kaydet/));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('İşlem Başarısız', 'invalid trade'));
  fireEvent.press(await screen.findByText(/Satış İşlemini Kaydet/));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(submit.mock.calls[1][0]).toMatchObject({ currency: 'USD', quantity: 8, unitPrice: 25 });
});

it('shows empty and rejected catalog searches and allows selection with missing market price', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const submit = jest.fn();
  lookup.mockResolvedValueOnce({ items: [], error: null, isStale: false, hasMore: false })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({
      items: [{ ...instrument, price: null, hasPrice: false, isStale: true }], error: null, isStale: true, hasMore: false,
    });
  render(<TransactionModal visible isCashInitialized availableCashTry={1000} onClose={jest.fn()}
    onSubmitTransaction={submit} onSubmitCashFlow={jest.fn()} />);
  await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/Bu kategoride listelenecek/)).toBeOnTheScreen();
  fireEvent.changeText(screen.getByPlaceholderText('Sembol veya şirket adı ara...'), 'THY');
  expect(await screen.findByText(/Piyasa verileri yüklenirken bir sorun/)).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Tekrar Dene'));
  fireEvent.press(await screen.findByText('THYAO'));
  expect(screen.getAllByText('Eski Fiyat').length).toBeGreaterThan(0);
  expect(submit).not.toHaveBeenCalled();
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
    dailyPnlPct: null, isCashInitialized: false,
  }} />);
  expect(screen.getByText('Kurulum Gerekli')).toBeOnTheScreen();
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  view.rerender(<PortfolioSummaryCard {...props} stats={{ ...stats, dailyPnlTry: -160, dailyPnlPct: -5 }} />);
  expect(screen.getByText(/-\$5[,.]00/)).toBeOnTheScreen();
  expect(screen.getByText(/-%5[,.]00/)).toBeOnTheScreen();
});

it('requires a manual price for a missing market quote and supports fractional sales', async () => {
  jest.mocked(useAppTheme).mockReturnValue({ colorScheme: 'dark' } as ReturnType<typeof useAppTheme>);
  jest.replaceProperty(Platform, 'OS', 'web');
  const submit = jest.fn().mockResolvedValue(undefined);
  const close = jest.fn();
  const props = { initialAction: 'SELL' as const, availableCash: 0, isCashInitialized: true, onClose: close, onSubmit: submit };
  const view = render(<PositionTradeModal {...props} visible position={null} />);
  expect(screen.queryByText('Piyasa Fiyatı')).toBeNull();
  view.rerender(<PositionTradeModal {...props} visible position={{ ...position, quantity: 1.5, latest_price: null, price_is_stale: true }} />);
  expect(screen.getByText('Eski Fiyat')).toBeOnTheScreen();
  const price = screen.getByPlaceholderText('0.00');
  expect(price).toHaveDisplayValue('');
  fireEvent.press(screen.getByText('%50'));
  expect(await screen.findByDisplayValue('0.75')).toBeOnTheScreen();
  fireEvent.changeText(price, '20');
  fireEvent.press(await screen.findByText(/Satış İşlemini Kaydet/));
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 0.75, unitPrice: 20 })));
});
