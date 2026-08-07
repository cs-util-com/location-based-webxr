/**
 * De-duplicates concurrent requests for the same key — WITHOUT sharing signals.
 *
 * WHY THIS IS A MODULE RATHER THAN A `Map<string, Promise>`.
 *
 * The obvious de-dup is four lines: look the key up, return the existing
 * promise, otherwise start one and store it. Three call sites in this package
 * wrote exactly that, and all three inherited the same bug — the promise they
 * hand out belongs to whoever asked FIRST, and so does the `AbortSignal` that
 * governs it.
 *
 * Both directions of that are wrong, and each is worse than a duplicate fetch:
 *
 * - **A joiner's cancellation reaches everyone.** A prefetch and a movement
 *   trigger — named in `OverpassSource` as the two callers most likely to want
 *   the same tile at the same moment — have different lifetimes. The user
 *   cancels the download, the prefetch's controller aborts the shared request,
 *   and the movement trigger's whole working-set load rejects with an
 *   `AbortError` for a signal it never owned. Worse, `loadTiles` rethrows
 *   aborts, so there is no `deferred`/`failed` entry to say what happened.
 * - **A joiner's cancellation reaches no one.** The mirror case: a caller that
 *   aborts cannot actually stop anything, because the in-flight request belongs
 *   to the first caller. Passing a signal looks like it works and does not.
 *
 * So the request is dispatched on an internal controller and the waiters are
 * ref-counted: each caller's returned promise races its OWN signal, and the
 * internal controller is aborted only when every joined caller has gone. A
 * caller that passes no signal declares itself uncancellable and pins the
 * request for as long as it is waiting.
 *
 * It lives in `source/` because that is where all three call sites' concerns
 * originate (`OverpassSource`, `CachingSource`, and the DEM tile fetcher in
 * `elevation/terrarium.ts`, which is a network cache of the same shape).
 *
 * @see in-flight-requests.ts.md
 */

interface Entry<T> {
  readonly controller: AbortController;
  readonly promise: Promise<T>;
  /** Waiters that can still be cancelled, i.e. that supplied a signal. */
  cancellable: number;
  /** Waiters that supplied NO signal. One of these pins the request. */
  pinned: number;
}

export class InFlightRequests<T> {
  private readonly entries = new Map<string, Entry<T>>();

  /** Whether a request for `key` is already running — for dedup counters. */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Requests currently in flight. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Joins the in-flight request for `key`, or starts one with `dispatch`.
   *
   * `dispatch` receives an internal signal that is aborted only when every
   * caller has abandoned the request — never the caller's own signal.
   */
  join(
    key: string,
    dispatch: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    // Checked before the entry is touched: an already-dead caller must neither
    // start a request nor be counted as a waiter on someone else's.
    if (signal?.aborted === true) return Promise.reject(abortReason(signal));

    const entry = this.entries.get(key) ?? this.start(key, dispatch);
    if (signal === undefined) {
      entry.pinned++;
      return entry.promise;
    }
    return this.attach(entry, signal);
  }

  private start(
    key: string,
    dispatch: (signal: AbortSignal) => Promise<T>,
  ): Entry<T> {
    const controller = new AbortController();
    // The async wrapper is doing two jobs. `dispatch` is still called
    // SYNCHRONOUSLY — an async function body runs up to its return before
    // yielding — so a caller can observe the request it just started, which the
    // concurrency semaphore in `OverpassSource` depends on. But a `dispatch`
    // that throws instead of rejecting comes back as a rejected promise rather
    // than escaping `join` as a synchronous throw.
    const entry: Entry<T> = {
      controller,
      promise: (async () => dispatch(controller.signal))().finally(() => {
        this.entries.delete(key);
      }),
      cancellable: 0,
      pinned: 0,
    };
    // Every caller may detach before this settles (they all aborted), leaving
    // the rejection unobserved and Node printing an unhandled-rejection
    // warning for a cancellation we asked for. This handler is that observer;
    // the callers' own promises are separate and still reject normally.
    entry.promise.catch(() => undefined);
    this.entries.set(key, entry);
    return entry;
  }

  private attach(entry: Entry<T>, signal: AbortSignal): Promise<T> {
    entry.cancellable++;
    return new Promise<T>((resolve, reject) => {
      // Guards the two paths against each other: whichever of "the request
      // settled" and "this caller aborted" happens first, the waiter is
      // released exactly once.
      let released = false;
      const release = (): boolean => {
        if (released) return false;
        released = true;
        entry.cancellable--;
        return true;
      };

      const onAbort = (): void => {
        if (!release()) return;
        if (entry.cancellable === 0 && entry.pinned === 0) {
          entry.controller.abort(abortReason(signal));
        }
        reject(abortReason(signal));
      };
      signal.addEventListener("abort", onAbort, { once: true });

      entry.promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          release();
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          release();
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- passing the dispatch's own failure through verbatim. Wrapping it would hide the cause from callers that discriminate on it, which `CachingSource` does (`instanceof RateLimitedError`) and `area-loader` does (`isAbort`).
          reject(error);
        },
      );
    });
  }
}

/**
 * The rejection for an aborted caller, always an `Error` named `AbortError`.
 *
 * The default `signal.reason` already is one (a `DOMException`, which IS
 * `instanceof Error`), and it is passed through untouched. The normalisation
 * matters for the other cases: a caller may abort with an arbitrary reason, and
 * `area-loader`'s `isAbort()` recognises an abort by
 * `instanceof Error && name === "AbortError"`. A bare string reason would
 * otherwise stop looking like an abort by the time it reached `loadTiles`,
 * which would file a cancelled tile under `failed`.
 */
function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  const error = new Error(
    typeof reason === "string" ? reason : "The operation was aborted.",
  );
  error.name = "AbortError";
  return error;
}
