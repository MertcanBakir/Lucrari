import { ensureAnonymousSession } from '@/services/auth/auth-service';
import { clearOwnershipCache, fetchOwnedPositions, getOwnershipCacheSnapshot, subscribeOwnershipChanges } from '@/services/portfolio/portfolio-ownership-service';
import { ensureDefaultPortfolio, fetchPortfolioPositions, subscribePortfolioChanges } from '@/services/portfolio/portfolio-service';
import { deferred } from './helpers/deferred';

jest.mock('@/services/auth/auth-service', () => ({ ensureAnonymousSession: jest.fn() }));
jest.mock('@/services/portfolio/portfolio-service', () => ({
  ensureDefaultPortfolio: jest.fn(),
  fetchPortfolioPositions: jest.fn(),
  subscribePortfolioChanges: jest.fn(),
}));

const notifyMutation = jest.mocked(subscribePortfolioChanges).mock.calls[0][0];
const auth = jest.mocked(ensureAnonymousSession);
const requests = jest.mocked(fetchPortfolioPositions);
type Positions = Awaited<ReturnType<typeof fetchPortfolioPositions>>;

function signIn(userId: string | null) {
  auth.mockResolvedValue({ user: userId ? { id: userId } : null } as Awaited<ReturnType<typeof ensureAnonymousSession>>);
}

function position(instrumentId: string, quantity: number): Positions[number] {
  return { instrument_id: instrumentId, symbol: 'SAME', quantity } as Positions[number];
}

beforeEach(() => {
  auth.mockReset();
  requests.mockReset();
  signIn('user-a');
  jest.mocked(ensureDefaultPortfolio).mockImplementation(async (userId) => (
    { id: `portfolio-${userId}` } as Awaited<ReturnType<typeof ensureDefaultPortfolio>>
  ));
  clearOwnershipCache({ clearSubscribers: true });
});

it('indexes open positions by instrument, reuses fresh cache, and isolates users', async () => {
  requests.mockResolvedValueOnce([
    position('instrument-a', 1), position('instrument-b', 3),
    position('empty', 0), position('invalid', NaN), position('', 2),
  ]).mockResolvedValueOnce([]);
  expect(getOwnershipCacheSnapshot('')).toBeNull();
  expect(getOwnershipCacheSnapshot('user-a')).toBeNull();
  const first = await fetchOwnedPositions();
  expect([...first.ownedPositions.keys()]).toEqual(['instrument-a', 'instrument-b']);
  expect(await fetchOwnedPositions()).toBe(first);
  signIn('user-b');
  expect(await fetchOwnedPositions()).toMatchObject({ userId: 'user-b', portfolioId: 'portfolio-user-b' });
  expect(getOwnershipCacheSnapshot('user-a')).toBe(first);
  expect(requests.mock.calls).toEqual([['portfolio-user-a'], ['portfolio-user-b']]);
});

it('deduplicates concurrent requests and follows a mutation before caching positions', async () => {
  const result = deferred<Positions>();
  const started = deferred<void>();
  requests.mockImplementationOnce(() => {
    started.resolve();
    return result.promise;
  }).mockResolvedValueOnce([position('new', 2)]);
  const first = fetchOwnedPositions();
  const second = fetchOwnedPositions();
  await started.promise;
  notifyMutation();
  result.resolve([position('outdated', 1)]);
  const owned = await first;
  expect(await second).toBe(owned);
  expect([...owned.ownedPositions.keys()]).toEqual(['new']);
  expect(requests).toHaveBeenCalledTimes(2);
});

it('refreshes subscribers after mutations and retains only same-user data on errors', async () => {
  requests.mockResolvedValueOnce([position('cached', 1)]).mockRejectedValue(new Error('offline'));
  await fetchOwnedPositions();
  const updated = deferred<Awaited<ReturnType<typeof fetchOwnedPositions>>>();
  const unsubscribe = subscribeOwnershipChanges(updated.resolve);
  const stopBrokenListener = subscribeOwnershipChanges(() => { throw new Error('listener'); });
  notifyMutation();
  expect(getOwnershipCacheSnapshot('user-a')).toMatchObject({ isStale: true, timestamp: 0 });
  expect(await updated.promise).toMatchObject({ isStale: true, userId: 'user-a' });
  unsubscribe();
  stopBrokenListener();

  signIn('user-b');
  await expect(fetchOwnedPositions()).rejects.toThrow(/Açık pozisyonları alınamadı/i);
  expect(getOwnershipCacheSnapshot('user-b')).toBeNull();
  signIn(null);
  await expect(fetchOwnedPositions()).rejects.toThrow('Kullanıcı oturumu doğrulanamadı.');
});

it('fails closed after three conflicting revisions with and without earlier cache', async () => {
  requests.mockImplementation(async () => {
    notifyMutation();
    return [position('unverified', 1)];
  });
  await expect(fetchOwnedPositions()).rejects.toThrow(/mutasyon çakışması/);
  expect(requests).toHaveBeenCalledTimes(3);
  expect(getOwnershipCacheSnapshot('user-a')).toBeNull();
  requests.mockResolvedValueOnce([position('verified', 1)]);
  await fetchOwnedPositions();
  const stale = await fetchOwnedPositions({ forceRefresh: true });
  expect(stale.isStale).toBe(true);
  expect([...stale.ownedPositions.keys()]).toEqual(['verified']);
});
