/**
 * Waits until the state a test reads stops changing, in place of a fixed
 * count of `setTimeout(0)` turns.
 *
 * Why: on Windows every `setTimeout(0)` waits for the 15.6 ms timer tick
 * (about 1 ms on Linux), so a flush of 40 such turns costs about 0.6 s
 * locally whatever the code under test does. One window here is `turns`
 * `setImmediate` turns (promise callbacks and finished I/O run between
 * them), one `setTimeout(0)` (so a zero-delay timer the code scheduled
 * itself has fired), then `turns` more. The state counts as settled once
 * two windows in a row leave the fingerprint unchanged AND `quietMs` of
 * wall clock passed since it last changed; a fingerprint that keeps
 * changing past `timeoutMs` of wall clock throws, so a test never reads a
 * state that is still moving.
 *
 * The windows alone are no measure of time: two take about 25 ms on Windows
 * and about 2 ms on Linux. Work on the thread pool (a `crypto.subtle`
 * digest) turns no event-loop step the fingerprint can see, so the quiet
 * window is what gives it time to land, on every platform alike; it costs
 * nothing where two windows already take that long.
 *
 * The fingerprint must change on every step the test waits for (an
 * operation counter, the store's state object, the rendered markup): a
 * step it cannot see is covered by `quietMs` at most. A test that needs
 * such a step to have happened waits for its result, not for this.
 *
 * Real timers only: under `vi.useFakeTimers()` a window's `setImmediate`
 * and `setTimeout(0)` never fire, so the wait hangs past `timeoutMs`
 * without its message (the bound is only read between windows) until the
 * test times out. Faking `performance` alone is fine.
 */
const QUIET_MS = 25;
/** Under vitest's 5 s test timeout, so this file's message is the one read. */
const TIMEOUT_MS = 4_000;

export async function settle(
  fingerprint: () => readonly unknown[],
  options: {
    readonly turns?: number;
    readonly quietMs?: number;
    readonly timeoutMs?: number;
  } = {},
): Promise<void> {
  const turns = options.turns ?? 10;
  const quietMs = options.quietMs ?? QUIET_MS;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const deadline = performance.now() + timeoutMs;
  let previous = fingerprint();
  let quiet = 0;
  let changedAt = performance.now();
  while (quiet < 2 || performance.now() - changedAt < quietMs) {
    await oneWindow(turns);
    const now = fingerprint();
    if (same(previous, now)) {
      quiet += 1;
    } else {
      quiet = 0;
      changedAt = performance.now();
    }
    previous = now;
    if (quiet < 2 && performance.now() > deadline) {
      throw new Error(
        `settle: the state was still changing after ${String(timeoutMs)} ms`,
      );
    }
  }
}

async function oneWindow(turns: number): Promise<void> {
  for (let i = 0; i < turns; i += 1) await immediate();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < turns; i += 1) await immediate();
}

function immediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function same(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}
