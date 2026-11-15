/**
 * Lucrari — Watchlist Swipe Gesture Pure Helpers & Decoupled State Reducers
 * 
 * Provides pure functions for swipe gesture detection, threshold evaluation,
 * mutual exclusion coordination, and overscroll resistance.
 */

export interface SwipeGestureDelta {
  dx: number;
  dy: number;
}

export interface SwipeReleaseResult {
  targetOffset: number;
  shouldOpen: boolean;
}

export type SwipeRowEvent =
  | { type: 'open'; instrumentId: string }
  | { type: 'close'; instrumentId: string }
  | { type: 'dismiss' };

export const DEFAULT_ACTION_WIDTH = 76;
export const DEFAULT_OPEN_THRESHOLD = 30;
export const DEFAULT_CLOSE_THRESHOLD = 25;

/**
 * Determines whether a gesture should be captured by the horizontal swipe responder.
 * Rejects predominantly vertical scrolling (so page scroll is never blocked).
 * Requires minimum 8px horizontal travel and dx to be at least 1.5x greater than dy.
 */
export function shouldCaptureSwipeGesture(gesture: SwipeGestureDelta): boolean {
  const absDx = Math.abs(gesture.dx);
  const absDy = Math.abs(gesture.dy);
  return absDx > 8 && absDx > absDy * 1.5;
}

/**
 * Resolves whether the row should snap open to -actionWidth or snap closed to 0.
 */
export function resolveSwipeReleaseAction(
  gesture: SwipeGestureDelta,
  currentlyOpen: boolean,
  actionWidth = DEFAULT_ACTION_WIDTH,
  openThreshold = DEFAULT_OPEN_THRESHOLD,
  closeThreshold = DEFAULT_CLOSE_THRESHOLD
): SwipeReleaseResult {
  if (currentlyOpen) {
    // When currently open, a rightward swipe > closeThreshold closes the action
    if (gesture.dx > closeThreshold) {
      return { targetOffset: 0, shouldOpen: false };
    }
    return { targetOffset: -actionWidth, shouldOpen: true };
  } else {
    // When currently closed, a leftward swipe < -openThreshold opens the action
    if (gesture.dx < -openThreshold) {
      return { targetOffset: -actionWidth, shouldOpen: true };
    }
    return { targetOffset: 0, shouldOpen: false };
  }
}

/**
 * Computes bounded translateX offset with rubber-band resistance beyond limits.
 */
export function computeSwipeOffset(
  baseOffset: number,
  dx: number,
  actionWidth = DEFAULT_ACTION_WIDTH,
  maxOverscroll = 15
): number {
  const newOffset = baseOffset + dx;
  const minLimit = -actionWidth - maxOverscroll;

  if (newOffset <= 0 && newOffset >= minLimit) {
    return newOffset;
  }
  if (newOffset > 0) {
    return newOffset * 0.2; // Rubber band resistance on right pull
  }
  // Rubber band resistance on extreme left pull beyond maxOverscroll
  return minLimit + (newOffset - minLimit) * 0.2;
}

/**
 * Pure state reducer for coordinating single active open row across the watchlist.
 * 
 * Rules:
 * - 'open': unconditionally sets the specified instrumentId as active.
 * - 'close': clears active state ONLY if the closing row is the current active row.
 * - 'dismiss': unconditionally clears active state (e.g. tapping another row, scrolling, opening modal).
 */
export function swipeRowReducer(
  currentActiveId: string | null,
  event: SwipeRowEvent
): string | null {
  switch (event.type) {
    case 'open':
      return event.instrumentId;
    case 'close':
      return currentActiveId === event.instrumentId ? null : currentActiveId;
    case 'dismiss':
      return null;
  }
}
