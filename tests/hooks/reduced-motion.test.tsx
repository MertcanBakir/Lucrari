import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { deferred } from '../helpers/deferred';
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
});
afterEach(() => jest.restoreAllMocks());
it('starts without motion, observes the system setting, and removes its listener', async () => {
  const remove = jest.fn(); jest.mocked(AccessibilityInfo.addEventListener).mockReturnValue({ remove } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
  const hook = renderHook(() => useReducedMotion());
  expect(hook.result.current).toBe(true);
  await waitFor(() => expect(hook.result.current).toBe(false));
  act(() => (jest.mocked(AccessibilityInfo.addEventListener).mock.lastCall![1] as unknown as (value: boolean) => void)(true));
  expect(hook.result.current).toBe(true);
  hook.unmount(); expect(remove).toHaveBeenCalledTimes(1);
});
it('does not overwrite a newer accessibility event with a late initial read', async () => {
  const pending = deferred<boolean>(); jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(pending.promise);
  const hook = renderHook(() => useReducedMotion());
  act(() => (jest.mocked(AccessibilityInfo.addEventListener).mock.lastCall![1] as unknown as (value: boolean) => void)(true));
  await act(async () => pending.resolve(false)); expect(hook.result.current).toBe(true);
});
it('keeps motion off on failure and ignores reads after unmount', async () => {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockRejectedValueOnce(Error('unavailable'));
  const hook = renderHook(() => useReducedMotion()); await act(async () => {}); expect(hook.result.current).toBe(true); hook.unmount();
  const pending = deferred<boolean>(); jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValueOnce(pending.promise);
  const second = renderHook(() => useReducedMotion()); second.unmount(); await act(async () => pending.resolve(false));
});
