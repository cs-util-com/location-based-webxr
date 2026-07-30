/**
 * The main-thread half of the worker boundary: correlated, abortable calls.
 *
 * WHY THIS IS NOT JUST `postMessage`. A worker is a message bus, not a function
 * call, and every property a caller expects from `await` has to be built:
 *
 * - **Correlation.** Replies arrive on one channel in whatever order the worker
 *   finishes, so each call carries an id and resolves its own promise.
 * - **Failure.** An exception inside a worker rejects nothing here. If the worker
 *   does not turn it into a reply, the promise never settles — a hung demo,
 *   which is worse than a reported error. The worker always replies; this side
 *   always rejects on `ok: false`.
 * - **Abort that actually stops work.** This is the part that matters for this
 *   app. `latest-only.ts` coalesces the *waiting* input but lets the in-flight
 *   run finish, because on the main thread there was nothing to cancel. Across a
 *   worker there is: a superseded position's 28–68 MB fetch is exactly the waste
 *   the prefetch discipline (DEC-R2-6) exists to avoid. So a cancelled call posts
 *   an `abort` naming the id it is dropping, and the worker honours it.
 * - **No leaks.** A pending entry is deleted on every settle path, including
 *   abort and disposal, so a long session does not accumulate dead resolvers.
 *
 * WHY IT TAKES A `Transport` RATHER THAN A `Worker`. All of the above is
 * ordinary bookkeeping that can be wrong in ordinary ways, and none of it needs
 * a real worker to test. `rpc-client.test.ts` drives it through an in-process
 * fake, so the only thing left needing a browser is that a worker is constructed
 * at all — which one e2e covers.
 *
 * @see rpc-client.ts.md
 */

import {
  isWorkerReply,
  type WorkerCallKind,
  type WorkerCalls,
  type WorkerEnvelope,
} from "./protocol.js";

/** The minimum a message channel has to offer. `Worker` satisfies it. */
export interface Transport {
  post(message: WorkerEnvelope): void;
  listen(handler: (data: unknown) => void): void;
  terminate(): void;
}

interface RpcCallOptions {
  readonly signal?: AbortSignal;
}

export interface RpcClient {
  call<K extends WorkerCallKind>(
    kind: K,
    payload: WorkerCalls[K]["request"],
    options?: RpcCallOptions,
  ): Promise<WorkerCalls[K]["result"]>;
  /**
   * Rejects every pending call WITHOUT terminating the transport.
   *
   * For a worker that has already died: it will never reply, so leaving calls
   * pending costs more than silence. `latestOnly`'s active promise never settles,
   * so its `busy` stays true and the cycles that chain off it never run again —
   * the demo wedges
   * in a state whose loading phase says error while its cycles think work is in
   * flight. Rejecting loses nothing a dead worker could still have told them.
   */
  fail(message: string): void;
  /** Rejects every pending call and terminates the transport. */
  dispose(): void;
}

/** Rejection used for a cancelled call, so callers can tell it from a failure. */
export class RpcAbortError extends Error {
  constructor() {
    super("The request was superseded");
    this.name = "RpcAbortError";
  }
}

/** Wraps a transport so calls look like ordinary async functions. */
export function createRpcClient(transport: Transport): RpcClient {
  interface Pending {
    resolve(value: unknown): void;
    reject(error: Error): void;
    /** Removes the abort listener; held so it cannot outlive the call. */
    cleanup(): void;
  }

  const pending = new Map<number, Pending>();
  let nextId = 1;
  let disposed = false;

  transport.listen((data) => {
    // GUARDED rather than cast. A worker's message channel is shared with
    // anything else that posts to it (bundler HMR pings, for one), and a reply
    // handler that assumes its own shape crashes on the first foreign message.
    if (!isWorkerReply(data)) return;
    const entry = pending.get(data.id);
    if (entry === undefined) return;
    pending.delete(data.id);
    entry.cleanup();
    if (data.ok) {
      entry.resolve(data.value);
    } else {
      entry.reject(new Error(data.message));
    }
  });

  function call<K extends WorkerCallKind>(
    kind: K,
    payload: WorkerCalls[K]["request"],
    options?: RpcCallOptions,
  ): Promise<WorkerCalls[K]["result"]> {
    if (disposed) {
      return Promise.reject(new Error("The worker client has been disposed"));
    }
    const id = nextId++;
    const signal = options?.signal;

    // CHECKED BEFORE POSTING. An already-aborted signal should cost no work at
    // all — posting first and cancelling immediately still hands the worker a
    // job to start and then stop, which for a fetch means a request that may
    // already be on the wire.
    if (signal?.aborted === true) {
      return Promise.reject(new RpcAbortError());
    }

    return new Promise<WorkerCalls[K]["result"]>((resolve, reject) => {
      const onAbort = (): void => {
        const entry = pending.get(id);
        if (entry === undefined) return;
        pending.delete(id);
        entry.cleanup();
        // Tell the worker, THEN reject. The order does not matter to the
        // caller, but posting first means a slow rejection handler cannot delay
        // the cancellation reaching the work being cancelled.
        transport.post({ id: nextId++, kind: "abort", target: id });
        reject(new RpcAbortError());
      };

      pending.set(id, {
        resolve,
        reject,
        cleanup: () => {
          signal?.removeEventListener("abort", onAbort);
        },
      });

      signal?.addEventListener("abort", onAbort, { once: true });
      transport.post({ id, kind, payload });
    });
  }

  /** Rejects and forgets every pending call. Shared by {@link fail} and {@link dispose}. */
  function rejectAllPending(message: string): void {
    for (const [, entry] of pending) {
      entry.cleanup();
      entry.reject(new Error(message));
    }
    pending.clear();
  }

  return {
    call,
    fail(message: string): void {
      // NOT disposed: a dead worker is not a page tearing down, and the client
      // stays usable so a later call fails fast rather than hanging too.
      rejectAllPending(message);
    },
    dispose(): void {
      disposed = true;
      // Reject rather than leave hanging: a disposed client with pending calls
      // is a page that is tearing down, and a promise that never settles there
      // keeps whatever awaited it alive with it.
      rejectAllPending("The worker client has been disposed");
      transport.terminate();
    },
  };
}

/**
 * Wraps a real `Worker` as a {@link Transport}.
 *
 * `onFatal` receives a worker-level failure — a syntax error in its module graph,
 * an OOM, a `self.close()`. These fire `error` and then the worker never replies
 * to anything, so **every pending call hangs**. There is no id to correlate it to,
 * so it cannot reject one call; the caller has to surface it some other way. It is
 * a required parameter rather than an optional one precisely because the default
 * anybody would reach for is silence, and silence here is a demo that stops with
 * no explanation — indistinguishable from a slow fetch, which is the hardest thing
 * to diagnose in this app.
 */
export function workerTransport(
  worker: Worker,
  onFatal: (message: string) => void,
): Transport {
  return {
    post: (message) => {
      worker.postMessage(message);
    },
    listen: (handler) => {
      worker.addEventListener("message", (event: MessageEvent) => {
        handler(event.data);
      });
      worker.addEventListener("error", (event: ErrorEvent) => {
        onFatal(event.message);
      });
    },
    terminate: () => {
      worker.terminate();
    },
  };
}
