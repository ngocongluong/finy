// Some flows legitimately send the app to the background for a moment
// (Google's sign-in screen). While one is running, auto-lock is paused.
let suspended = 0;

export const autoLockSuspended = () => suspended > 0;

export async function withoutAutoLock<T>(fn: () => Promise<T>): Promise<T> {
  suspended++;
  try {
    return await fn();
  } finally {
    // Give the app a moment to return to the foreground before re-arming.
    setTimeout(() => {
      suspended = Math.max(0, suspended - 1);
    }, 1500);
  }
}
