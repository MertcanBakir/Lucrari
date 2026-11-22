import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, Text } from 'react-native';
import { FeedbackToast } from '@/components/feedback/feedback-toast';
import { LoadingSkeleton } from '@/components/feedback/loading-skeleton';
import { MotionView, LayoutMotionView } from '@/components/feedback/motion-view';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { showSuccess, dismissFeedback, getFeedbackSnapshot } from '@/services/feedback/feedback-service';
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: jest.fn(() => true) }));
beforeEach(() => { jest.clearAllMocks(); dismissFeedback(); jest.mocked(useReducedMotion).mockReturnValue(true); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
it('shows a non-blocking success message and removes it after four seconds', () => {
  jest.useFakeTimers(); render(<FeedbackToast />);
  act(() => showSuccess('Nakit güncellendi.'));
  expect(screen.getByText('Nakit güncellendi.')).toBeOnTheScreen();
  act(() => jest.advanceTimersByTime(4000));
  expect(screen.queryByText('Nakit güncellendi.')).toBeNull();
  expect(getFeedbackSnapshot()).toBeNull();
});
it('restarts the timer for a newer message and supports explicit dismissal', () => {
  jest.useFakeTimers(); render(<FeedbackToast />);
  act(() => showSuccess('İlk kayıt.')); act(() => jest.advanceTimersByTime(3000));
  act(() => showSuccess('Son kayıt.')); act(() => jest.advanceTimersByTime(1000));
  expect(screen.getByText('Son kayıt.')).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText('Mesajı kapat'));
  expect(screen.queryByText('Son kayıt.')).toBeNull();
});
it('cleans up its timer without dismissing a new message after unmount', () => {
  jest.useFakeTimers(); const view = render(<FeedbackToast />);
  act(() => showSuccess('Kaydedildi.')); view.unmount();
  act(() => jest.advanceTimersByTime(4000)); expect(getFeedbackSnapshot()?.message).toBe('Kaydedildi.');
});
it.each(['portfolio', 'list'] as const)('announces %s loading without fake prices', variant => {
  render(<LoadingSkeleton variant={variant} label="Veriler yükleniyor" />);
  expect(screen.getByRole('progressbar', { name: 'Veriler yükleniyor' })).toBeOnTheScreen();
  expect(screen.queryByText('0')).toBeNull();
});
it('animates short transitions and cancels them when reduced motion is enabled', () => {
  jest.mocked(useReducedMotion).mockReturnValue(false);
  const stop = jest.fn(); const start = jest.fn();
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({ stop, start, reset: jest.fn() });
  const view = render(<MotionView motionKey="first" rise><Text>İçerik</Text></MotionView>);
  expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 180, useNativeDriver: true }));
  view.rerender(<MotionView motionKey="second" rise><Text>İçerik</Text></MotionView>);
  expect(stop).toHaveBeenCalled(); expect(start).toHaveBeenCalledTimes(2);
  jest.mocked(useReducedMotion).mockReturnValue(true);
  view.rerender(<MotionView motionKey="third"><Text>İçerik</Text></MotionView>);
  expect(start).toHaveBeenCalledTimes(2); expect(screen.getByText('İçerik')).toBeOnTheScreen();
});
it('does not animate an inactive view', () => {
  jest.mocked(useReducedMotion).mockReturnValue(false);
  const timing = jest.spyOn(Animated, 'timing');
  render(<MotionView active={false}><Text>Kapalı</Text></MotionView>);
  expect(timing).not.toHaveBeenCalled();
});

it('keeps expandable content mounted when layout motion is toggled', () => {
  jest.mocked(useReducedMotion).mockReturnValue(false);
  const view = render(<LayoutMotionView><Text>Liste içeriği</Text></LayoutMotionView>);
  expect(screen.getByText('Liste içeriği')).toBeOnTheScreen();
  jest.mocked(useReducedMotion).mockReturnValue(true);
  view.rerender(<LayoutMotionView><Text>Liste içeriği</Text></LayoutMotionView>);
  expect(screen.getByText('Liste içeriği')).toBeOnTheScreen();
});
