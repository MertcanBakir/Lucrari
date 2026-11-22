// Installed by the native notification lifecycle. Web and CLI clients need no push cleanup.
let beforeChange: (() => Promise<void>) | undefined;
let afterChange: (() => void) | undefined;
export function setAccountTransitionHandlers(before?: () => Promise<void>, after?: () => void) {
  beforeChange = before;
  afterChange = after;
}
export async function withAccountTransition<T>(action: () => Promise<T>): Promise<T> {
  try {
    await beforeChange?.();
    return await action();
  } finally {
    afterChange?.();
  }
}
