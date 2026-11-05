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
 * two windows in a row leave the fingerprint unchanged; a fingerprint
 * that keeps changing past `timeoutMs` of wall clock throws, so a test
 * never reads a state that is still moving.
 *
 * The fingerprint must change on every step the test waits for (an
 * operation counter, the store's state object, the rendered markup): a
 * step it cannot see is not waited for.
 */
export async function settle(
  fingerprint: () => readonly unknown[],
  options: { readonly turns?: number; readonly timeoutMs?: number } = {},
): Promise<void> {
  const turns = options.turns ?? 10;
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  let previous = fingerprint();
  let quiet = 0;
  while (quiet < 2) {
    await oneWindow(turns);
    const now = fingerprint();
    quiet = same(previous, now) ? quiet + 1 : 0;
    previous = now;
    if (quiet < 2 && Date.now() > deadline) {
      throw new Error(
        `settle: the state was still changing after ${String(options.timeoutMs ?? 10_000)} ms`,
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
