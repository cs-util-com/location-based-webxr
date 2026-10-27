/**
 * Waits until the film's shaders are compiled, and stops waiting the
 * moment the scene is freed. three.js's own `compileAsync` keeps polling
 * its programs from a timer after the renderer is disposed, throws from
 * there and never settles; this wait asks `stopped()` before every check
 * and settles in every case (ready, stopped, a failing check, or out of
 * tries), so the film never waits on it forever.
 *
 * @see film-compile.ts.md
 */

export interface WhenReadyOptions {
  /** True once everything is compiled; may throw (it is then treated as done). */
  ready(): boolean;
  /** True once the scene is freed: no further check is made. */
  stopped(): boolean;
  /** The timer (default `setTimeout`). */
  later?: (cb: () => void, ms: number) => void;
  /** Between checks, ms (default 10, as three.js polls). */
  stepMs?: number;
  /** Checks before it gives up and lets the first draw finish (default 500, about 5 s). */
  maxTries?: number;
}

/** Settles once ready, stopped, failed or out of tries; never rejects. */
export function whenReady(o: WhenReadyOptions): Promise<void> {
  const later =
    o.later ??
    ((cb: () => void, ms: number) => {
      setTimeout(cb, ms);
    });
  const stepMs = o.stepMs ?? 10;
  const maxTries = o.maxTries ?? 500;
  return new Promise<void>((resolve) => {
    let tries = 0;
    const check = (): void => {
      if (o.stopped()) {
        resolve();
        return;
      }
      tries += 1;
      let done: boolean;
      try {
        done = o.ready();
      } catch {
        done = true;
      }
      if (done || tries >= maxTries) {
        resolve();
        return;
      }
      later(check, stepMs);
    };
    check();
  });
}
