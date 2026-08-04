/**
 * A set of callbacks that is snapshotted before iteration and invokes each
 * entry in isolation.
 *
 * WHY THIS EXISTS. `frame-loop.ts`, `xr-frame-loop.ts` and
 * `session-disposers.ts` were three structurally identical modules — the same
 * `Set`, the same cached iteration snapshot, the same register-returns-
 * unregister, the same isolated invocation, the same clear — differing only in
 * what the callback is handed and, for disposers, whether the set is emptied
 * before running. Three copies of one idea.
 *
 * THE COST OF THE COPIES WAS NOT THE LINE COUNT, it was that each re-derived
 * the same two subtleties, and subtleties re-derived per site get re-derived
 * differently:
 *
 * 1. **Snapshot before iterating.** `frame-loop.ts`'s comment called iterating
 *    the live `Set` "a hard-to-debug source of non-determinism" — an unregister
 *    from inside a tick skips a not-yet-visited entry. Every registry needs
 *    this, and the hand-rolled observer lists elsewhere in the framework do not
 *    all have it.
 * 2. **Isolate every callback**, so one throwing handler cannot abort the rest
 *    nor propagate into the frame render or the teardown that invoked it.
 *
 * WHY A FACTORY AND NOT A SHARED MODULE-LEVEL REGISTRY. The three call sites
 * are genuinely separate registries with separate lifetimes; what they share is
 * the SHAPE. A factory also makes the shape available to per-instance observer
 * lists, which a module-level singleton never could — that is why those had to
 * hand-roll it in the first place.
 *
 * WHY THE ARGUMENTS ARE A TUPLE. `run(...args: A)` lets `frame-loop` keep its
 * `(dt, elapsed)` signature exactly, so adopting this primitive is not an API
 * break for any caller.
 *
 * @see isolated-registry.ts.md
 */

export interface IsolatedRegistryOptions {
  // NO `label` FIELD. An earlier revision carried one to name the registry in a
  // default failure message; once `onError` became required every caller writes
  // its own message, and a label the primitive never reads is a field that can
  // silently disagree with the text beside it.
  /**
   * Where a thrown callback goes. **Required, deliberately.**
   *
   * **THIS MODULE IMPORTS NOTHING.** Reaching for `createLogger` here would
   * make the framework's own logger unable to use this primitive: `logger.ts`
   * keeps a subscriber list of exactly this shape, and
   * `logger → isolated-registry → logger` is a cycle the `check:cycles` gate
   * rejects.
   *
   * Required rather than defaulted to `console.error` for two reasons. Each
   * registry keeps its OWN logger name ("FrameLoop", "XrFrameLoop", …) instead
   * of collapsing every failure under one shared name; and a default would let
   * a caller adopt this silently in a context where logging recurses — which is
   * exactly `logger.ts`'s situation, where reporting a throwing subscriber
   * through the logger would notify the subscribers and throw again.
   */
  readonly onError: (error: unknown) => void;
}

export interface IsolatedRegistry<A extends readonly unknown[]> {
  /**
   * Add a callback; returns its unregister function.
   *
   * Idempotent — registering the same function twice leaves one entry, because
   * the backing store is a `Set`. The returned unregister removes that entry
   * whichever registration produced it.
   */
  register(fn: (...args: A) => void): () => void;
  /** Invoke every callback, isolated. Registry membership is unchanged. */
  run(...args: A): void;
  /**
   * Empty the registry, THEN invoke everything it held, isolated.
   *
   * The teardown semantics: clearing first makes a second flush a no-op rather
   * than a double-release, and stops a callback that re-registers during
   * teardown from looping forever.
   */
  runOnce(...args: A): void;
  /** Drop every registration without invoking any. */
  clear(): void;
  /** Current registration count. */
  readonly size: number;
  /**
   * How many iteration snapshots have been taken.
   *
   * Test-facing: it makes "the snapshot is reused between registry changes"
   * assertable without timing, which at 60–90 Hz would be flaky.
   */
  readonly snapshotCount: number;
}

export function createIsolatedRegistry<A extends readonly unknown[]>(
  options: IsolatedRegistryOptions
): IsolatedRegistry<A> {
  const { onError } = options;
  const callbacks = new Set<(...args: A) => void>();

  /**
   * Cached iteration snapshot, invalidated on every mutation.
   *
   * Caching does not change the SEMANTICS — a register/unregister during a run
   * still defers to the next run — it only avoids re-allocating an identical
   * array at 60–90 Hz between registry changes, which are rare (PR #67 review).
   */
  let snapshot: readonly ((...args: A) => void)[] | null = null;
  let snapshotCount = 0;

  const takeSnapshot = (): readonly ((...args: A) => void)[] => {
    if (snapshot === null) {
      snapshot = Array.from(callbacks);
      snapshotCount++;
    }
    return snapshot;
  };

  const invoke = (fns: readonly ((...args: A) => void)[], args: A): void => {
    for (const fn of fns) {
      try {
        fn(...args);
      } catch (error) {
        // THE SINK IS ISOLATED TOO. It is caller-supplied — `logger.ts`'s
        // writes to `console.error`, which a test spy can make throw — and a
        // failing report must not become the thing that aborts the dispatch it
        // was reporting on. Swallowed rather than re-thrown because there is no
        // second channel to report it through: the sink IS the channel.
        try {
          onError(error);
        } catch {
          // Nothing further can be done, and trying would recurse.
        }
      }
    }
  };

  return {
    register(fn) {
      callbacks.add(fn);
      snapshot = null;
      return () => {
        callbacks.delete(fn);
        snapshot = null;
      };
    },
    run(...args) {
      invoke(takeSnapshot(), args);
    },
    runOnce(...args) {
      // Snapshot BEFORE clearing, then clear before invoking — so a disposer
      // that re-registers during teardown lands in a fresh, un-run set.
      const fns = takeSnapshot();
      callbacks.clear();
      snapshot = null;
      invoke(fns, args);
    },
    clear() {
      callbacks.clear();
      snapshot = null;
    },
    get size() {
      return callbacks.size;
    },
    get snapshotCount() {
      return snapshotCount;
    },
  };
}
