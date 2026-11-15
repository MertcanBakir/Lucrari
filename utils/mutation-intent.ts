/**
 * Lucrari — Client-Side Mutation Intent & Retry Idempotency Helper
 * 
 * Provides pure, deterministic intent resolution:
 * - If previous intent has the exact same payload key, preserves clientRequestId and timestamp across network retries.
 * - If payload key changes (quantity, price, instrument, action, currency, or amount), mints a fresh intent with a new ID and timestamp.
 */

export interface MutationIntent {
  clientRequestId: string;
  timestamp: string;
  payloadKey: string;
}

/**
 * Resolves or creates a mutation intent.
 * 
 * @param previousIntent The previously active intent (if any)
 * @param payloadKey Canonical string representation of mutation parameters
 * @param createUuid UUID generator factory
 * @param now Timestamp generator factory (defaults to ISO 8601 UTC)
 */
export function getOrCreateMutationIntent(
  previousIntent: MutationIntent | null | undefined,
  payloadKey: string,
  createUuid: () => string,
  now: () => string = () => new Date().toISOString()
): MutationIntent {
  if (previousIntent && previousIntent.payloadKey === payloadKey && previousIntent.clientRequestId) {
    return previousIntent;
  }

  return {
    clientRequestId: createUuid(),
    timestamp: now(),
    payloadKey,
  };
}

export interface ResetIntent {
  clientRequestId: string;
  createdAt: string;
}

/**
 * Creates a fresh user-confirmed reset intent.
 */
export function createResetIntent(
  createUuid: () => string,
  now: () => string = () => new Date().toISOString()
): ResetIntent {
  return {
    clientRequestId: createUuid(),
    createdAt: now(),
  };
}
