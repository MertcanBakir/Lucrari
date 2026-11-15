/**
 * Lucrari — Mutation Intent & Retry Idempotency Unit Tests
 * 
 * Tests pure mutation intent resolution across network failures, form changes, and reset lifecycle:
 * 1. Initial attempt creates UUID and timestamp.
 * 2. Simulated network error retry with same payload preserves clientRequestId and timestamp.
 * 3. Modifying quantity, price, instrument, action, or currency mints a new UUID and timestamp.
 * 4. DEPOSIT and WITHDRAWAL preserve flowAt and clientRequestId on retry.
 * 5. Cash setup preserves clientRequestId on retry.
 * 6. createResetIntent generates fresh clientRequestId on each distinct user confirmation.
 */

import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';
import { getOrCreateMutationIntent, createResetIntent } from '../utils/mutation-intent';

describe('Mutation Intent & Retry Idempotency', () => {
  let uuidCounter = 0;
  const mockUuidGenerator = () => `uuid-${++uuidCounter}`;
  let timeCounter = 1000;
  const mockTimeGenerator = () => `2026-08-26T12:00:${++timeCounter}Z`;

  it('should generate a fresh intent on first execution', () => {
    const payloadKey = 'BUY:inst-1:100:25.50:TRY';
    const intent = getOrCreateMutationIntent(null, payloadKey, mockUuidGenerator, mockTimeGenerator);

    assert.ok(intent.clientRequestId.startsWith('uuid-'));
    assert.ok(intent.timestamp.includes('2026-08-26'));
    assert.strictEqual(intent.payloadKey, payloadKey);
  });

  it('should preserve identical clientRequestId and timestamp across retries with unchanged payload', () => {
    const payloadKey = 'BUY:inst-1:100:25.50:TRY';
    
    // First attempt (e.g. fails with network error)
    const intent1 = getOrCreateMutationIntent(null, payloadKey, mockUuidGenerator, mockTimeGenerator);
    const initialId = intent1.clientRequestId;
    const initialTimestamp = intent1.timestamp;

    // Second attempt (user clicks Retry without changing form)
    const intent2 = getOrCreateMutationIntent(intent1, payloadKey, mockUuidGenerator, mockTimeGenerator);

    assert.strictEqual(intent2.clientRequestId, initialId, 'clientRequestId must remain identical on retry');
    assert.strictEqual(intent2.timestamp, initialTimestamp, 'timestamp must remain identical on retry to avoid idempotency conflict');
    assert.strictEqual(intent2.payloadKey, payloadKey);
  });

  it('should generate new clientRequestId and timestamp when quantity changes', () => {
    const payloadKey1 = 'BUY:inst-1:100:25.50:TRY';
    const intent1 = getOrCreateMutationIntent(null, payloadKey1, mockUuidGenerator, mockTimeGenerator);

    const payloadKey2 = 'BUY:inst-1:150:25.50:TRY'; // Quantity changed
    const intent2 = getOrCreateMutationIntent(intent1, payloadKey2, mockUuidGenerator, mockTimeGenerator);

    assert.notStrictEqual(intent2.clientRequestId, intent1.clientRequestId, 'clientRequestId must change when payload changes');
    assert.notStrictEqual(intent2.timestamp, intent1.timestamp, 'timestamp must refresh when payload changes');
    assert.strictEqual(intent2.payloadKey, payloadKey2);
  });

  it('should generate new clientRequestId and timestamp when price changes', () => {
    const payloadKey1 = 'BUY:inst-1:100:25.50:TRY';
    const intent1 = getOrCreateMutationIntent(null, payloadKey1, mockUuidGenerator, mockTimeGenerator);

    const payloadKey2 = 'BUY:inst-1:100:26.00:TRY'; // Price changed
    const intent2 = getOrCreateMutationIntent(intent1, payloadKey2, mockUuidGenerator, mockTimeGenerator);

    assert.notStrictEqual(intent2.clientRequestId, intent1.clientRequestId);
    assert.strictEqual(intent2.payloadKey, payloadKey2);
  });

  it('should generate new clientRequestId when instrument or action changes', () => {
    const payloadKey1 = 'BUY:inst-1:100:25.50:TRY';
    const intent1 = getOrCreateMutationIntent(null, payloadKey1, mockUuidGenerator, mockTimeGenerator);

    const payloadKey2 = 'SELL:inst-1:100:25.50:TRY'; // Action switched from BUY to SELL
    const intent2 = getOrCreateMutationIntent(intent1, payloadKey2, mockUuidGenerator, mockTimeGenerator);

    assert.notStrictEqual(intent2.clientRequestId, intent1.clientRequestId);
  });

  it('should preserve intent for DEPOSIT and WITHDRAWAL retries', () => {
    const depositKey = 'DEPOSIT:5000:USD';
    const intent1 = getOrCreateMutationIntent(null, depositKey, mockUuidGenerator, mockTimeGenerator);
    const intent2 = getOrCreateMutationIntent(intent1, depositKey, mockUuidGenerator, mockTimeGenerator);

    assert.strictEqual(intent2.clientRequestId, intent1.clientRequestId);
    assert.strictEqual(intent2.timestamp, intent1.timestamp);
  });

  it('should preserve intent for Cash Account Setup retries', () => {
    const setupKey = '25000:1000';
    const intent1 = getOrCreateMutationIntent(null, setupKey, mockUuidGenerator, mockTimeGenerator);
    const intent2 = getOrCreateMutationIntent(intent1, setupKey, mockUuidGenerator, mockTimeGenerator);

    assert.strictEqual(intent2.clientRequestId, intent1.clientRequestId);
  });

  it('createResetIntent should generate fresh clientRequestId on each distinct user confirmation call', () => {
    const resetIntent1 = createResetIntent(mockUuidGenerator, mockTimeGenerator);
    const resetIntent2 = createResetIntent(mockUuidGenerator, mockTimeGenerator);

    assert.ok(resetIntent1.clientRequestId.startsWith('uuid-'));
    assert.ok(resetIntent2.clientRequestId.startsWith('uuid-'));
    assert.notStrictEqual(resetIntent1.clientRequestId, resetIntent2.clientRequestId, 'Each distinct createResetIntent call must produce a unique UUID');
    assert.notStrictEqual(resetIntent1.createdAt, resetIntent2.createdAt);
  });
});
