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

export interface CompileAheadOptions<M> {
  /** Compiles the scene's programs and returns what it compiled (three.js `compile`). */
  compile(): Iterable<M>;
  /** Whether one compiled item's program is ready; may throw (counted as done). */
  isReady(item: M): boolean;
  /** True once the scene is freed. */
  stopped(): boolean;
  /** As `whenReady`'s. */
  later?: (cb: () => void, ms: number) => void;
}

/**
 * Compiles ahead and waits until every compiled program is ready (by
 * `whenReady`). A compile that throws (a context already lost, where a
 * shader cannot even be created) settles at once: compiling ahead is only
 * a head start, and the first draw, or the loss path, takes over. Never
 * throws and never rejects.
 */
export function compileAhead<M>(o: CompileAheadOptions<M>): Promise<void> {
  let pending: Set<M>;
  try {
    pending = new Set(o.compile());
  } catch {
    return Promise.resolve();
  }
  return whenReady({
    stopped: () => o.stopped(),
    ready: () => {
      for (const m of pending) if (o.isReady(m)) pending.delete(m);
      return pending.size === 0;
    },
    ...(o.later ? { later: o.later } : {}),
  });
}
