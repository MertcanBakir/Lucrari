/**
 * Lucrari — Watchlist Mutation Intent Queue
 * 
 * Guarantees deterministic "Last Intent Wins" execution per (userId, instrumentId):
 * - Sequences opposite mutations (e.g. Add -> Remove -> Add) so the final user intent strictly prevails.
 * - Merges identical concurrent in-flight requests to prevent duplicate RPC dispatches.
 * - Stores the latest queued executor for deterministic resolution.
 * - Fully isolates User A from User B.
 * - Guarantees 100% queue cleanup once active and queued operations settle.
 */

import type { SetWatchlistItemResult } from '@/types/watchlist';

interface DeferredResolver {
  resolve: (res: SetWatchlistItemResult) => void;
  reject: (err: unknown) => void;
}

interface InstrumentQueueState {
  activePromise: Promise<SetWatchlistItemResult> | null;
  activeIntent: boolean | null;
  queuedIntent: boolean | null;
  queuedExecutor: ((isWatched: boolean) => Promise<SetWatchlistItemResult>) | null;
  queuedResolvers: DeferredResolver[];
}

const queueMap = new Map<string, InstrumentQueueState>();

function getQueueKey(userId: string, instrumentId: string): string {
  return `${userId}:${instrumentId}`;
}

export function isMutationPendingForInstrument(userId: string, instrumentId: string): boolean {
  if (!userId || !instrumentId) return false;
  const state = queueMap.get(getQueueKey(userId, instrumentId));
  if (!state) return false;
  return state.activePromise !== null || state.queuedIntent !== null || state.queuedResolvers.length > 0;
}

export function getActiveMutationCount(userId: string, instrumentId: string): number {
  if (!userId || !instrumentId) return 0;
  const state = queueMap.get(getQueueKey(userId, instrumentId));
  if (!state) return 0;
  let count = 0;
  if (state.activePromise !== null) count += 1;
  count += state.queuedResolvers.length;
  return count;
}

export function clearMutationQueue(): void {
  queueMap.clear();
}

/**
 * Test Helper: Retrieves snapshot of an instrument's queue state for test assertions.
 */
export function getMutationQueueSnapshotForTesting(userId: string, instrumentId: string): {
  isPending: boolean;
  hasActivePromise: boolean;
  activeIntent: boolean | null;
  queuedIntent: boolean | null;
  queuedResolversCount: number;
} | null {
  const state = queueMap.get(getQueueKey(userId, instrumentId));
  if (!state) return null;
  return {
    isPending: isMutationPendingForInstrument(userId, instrumentId),
    hasActivePromise: state.activePromise !== null,
    activeIntent: state.activeIntent,
    queuedIntent: state.queuedIntent,
    queuedResolversCount: state.queuedResolvers.length,
  };
}

/**
 * Test Helper: Returns total number of active queue entries in memory.
 */
export function getMutationQueueSizeForTesting(): number {
  return queueMap.size;
}

/**
 * Enqueues a mutation request for (userId, instrumentId) with strict "Last Intent Wins" guarantees.
 */
export function enqueueWatchlistMutation(
  userId: string,
  instrumentId: string,
  desiredState: boolean,
  executor: (isWatched: boolean) => Promise<SetWatchlistItemResult>
): Promise<SetWatchlistItemResult> {
  const key = getQueueKey(userId, instrumentId);
  let state = queueMap.get(key);

  if (!state) {
    state = {
      activePromise: null,
      activeIntent: null,
      queuedIntent: null,
      queuedExecutor: null,
      queuedResolvers: [],
    };
    queueMap.set(key, state);
  }

  // Case 1: No mutation currently running -> Start execution immediately
  if (!state.activePromise) {
    return runActiveMutation(userId, instrumentId, desiredState, executor);
  }

  // Case 2: Mutation currently running, but no queued intent yet
  if (state.queuedIntent === null) {
    // Sub-case 2A: Same intent as active -> Share the active running promise
    if (desiredState === state.activeIntent) {
      return state.activePromise;
    }

    // Sub-case 2B: Opposite intent -> Enqueue as the next intent to run
    state.queuedIntent = desiredState;
    state.queuedExecutor = executor;
    return new Promise<SetWatchlistItemResult>((resolve, reject) => {
      state!.queuedResolvers.push({ resolve, reject });
    });
  }

  // Case 3: There is already an active mutation AND a queued intent
  // Sub-case 3A: New request matches the already-queued intent -> Join the queued resolvers
  if (desiredState === state.queuedIntent) {
    return new Promise<SetWatchlistItemResult>((resolve, reject) => {
      state!.queuedResolvers.push({ resolve, reject });
    });
  }

  // Sub-case 3B: New request flips the queued intent (e.g. Active=True, Queued=False, New=True)
  // Last Intent Wins: update queuedIntent and queuedExecutor to the latest desiredState
  state.queuedIntent = desiredState;
  state.queuedExecutor = executor;
  return new Promise<SetWatchlistItemResult>((resolve, reject) => {
    state!.queuedResolvers.push({ resolve, reject });
  });
}

function runActiveMutation(
  userId: string,
  instrumentId: string,
  intentToRun: boolean,
  executor: (isWatched: boolean) => Promise<SetWatchlistItemResult>
): Promise<SetWatchlistItemResult> {
  const key = getQueueKey(userId, instrumentId);
  const state = queueMap.get(key);
  if (!state) {
    return executor(intentToRun);
  }

  state.activeIntent = intentToRun;

  const promise = (async (): Promise<SetWatchlistItemResult> => {
    let result: SetWatchlistItemResult | undefined;
    let executionError: unknown = null;

    try {
      result = await executor(intentToRun);
    } catch (err) {
      executionError = err;
    } finally {
      const currentState = queueMap.get(key);
      if (currentState) {
        currentState.activePromise = null;
        currentState.activeIntent = null;

        // Check if there is a queued intent waiting to run next
        if (currentState.queuedIntent !== null && currentState.queuedExecutor !== null) {
          const nextIntent = currentState.queuedIntent;
          const nextExecutor = currentState.queuedExecutor;
          const resolvers = currentState.queuedResolvers;

          currentState.queuedIntent = null;
          currentState.queuedExecutor = null;
          currentState.queuedResolvers = [];

          // Start executing the queued intent with its proper executor
          runActiveMutation(userId, instrumentId, nextIntent, nextExecutor)
            .then((nextResult) => {
              for (const r of resolvers) {
                r.resolve(nextResult);
              }
            })
            .catch((nextErr) => {
              for (const r of resolvers) {
                r.reject(nextErr);
              }
            });
        } else {
          // No more queued intent -> If there are any stray resolvers waiting on this execution, notify them
          if (currentState.queuedResolvers.length > 0) {
            const resolvers = currentState.queuedResolvers;
            currentState.queuedResolvers = [];
            for (const r of resolvers) {
              if (executionError) {
                r.reject(executionError);
              } else if (result) {
                r.resolve(result);
              }
            }
          }

          // Clean up entry completely from Map
          queueMap.delete(key);
        }
      }
    }

    if (executionError) {
      throw executionError;
    }

    return result!;
  })();

  state.activePromise = promise;
  return promise;
}
