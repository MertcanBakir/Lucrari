import { haptics } from './haptics';

export interface FeedbackMessage { id: number; message: string }
let current: FeedbackMessage | null = null;
let sequence = 0;
const listeners = new Set<() => void>();
export function getFeedbackSnapshot() { return current; }
export function subscribeFeedback(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function showSuccess(message: string) {
  current = { id: ++sequence, message };
  void haptics.notificationAsync(haptics.NotificationFeedbackType.Success);
  listeners.forEach(listener => listener());
}
export function dismissFeedback(id?: number) {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  listeners.forEach(listener => listener());
}
