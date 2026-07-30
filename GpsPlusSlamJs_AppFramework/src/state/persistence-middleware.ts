/**
 * Redux middleware for action persistence during recording sessions.
 *
 * Replaces the inline persistence logic previously embedded in the manual
 * dispatch wrapper. Actions whose slice prefix is whitelisted via
 * `persistedPrefixes` (e.g. `gpsData/*`, `refPoints/*`, `recording/*`,
 * except `recording/recordWriteFailure`) are written to the StorageBackend
 * when the recording slice is in recording state. The whitelist is supplied
 * by the store factory and derived from the actual slices, never hand-typed
 * here.
 *
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-07-architecture-observations-consolidated.md §4
 */

import type { Middleware, UnknownAction } from '@reduxjs/toolkit';
import type { StorageBackend } from '../storage/storage-backend';
import {
  endSession,
  recordWriteFailure,
  startSession,
} from './recording-slice';
import { createLogger } from '../utils/logger';

const log = createLogger('PersistenceMiddleware');

// ---------------------------------------------------------------------------
// Write queue with concurrency limit
// ---------------------------------------------------------------------------

/** Maximum number of concurrent OPFS write operations. */
const MAX_CONCURRENT_WRITES = 3;

/**
 * Simple write queue that limits concurrent OPFS operations.
 * Prevents unbounded memory growth when storage is slow.
 */
class WriteQueue {
  private pendingCount = 0;
  private queue: Array<() => Promise<void>> = [];
  private flushWaiters: Array<() => void> = [];

  enqueue(writeFn: () => Promise<void>): void {
    this.queue.push(writeFn);
    this.drain();
  }

  /**
   * Resolves once the queue is fully idle — every enqueued write (including
   * ones still waiting behind the concurrency cap) has settled. Rejected
   * writes count as settled (the enqueue wrappers handle their errors), so
   * flush never hangs on a failing backend. Writes enqueued AFTER the queue
   * went idle again are not waited for.
   */
  flush(): Promise<void> {
    if (this.isIdle()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.flushWaiters.push(resolve);
    });
  }

  private isIdle(): boolean {
    return this.pendingCount === 0 && this.queue.length === 0;
  }

  private drain(): void {
    while (this.pendingCount < MAX_CONCURRENT_WRITES && this.queue.length > 0) {
      const fn = this.queue.shift()!;
      this.pendingCount++;
      void fn().finally(() => {
        this.pendingCount--;
        this.drain();
      });
    }
    if (this.isIdle() && this.flushWaiters.length > 0) {
      const waiters = this.flushWaiters;
      this.flushWaiters = [];
      for (const resolve of waiters) {
        resolve();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PersistenceMiddlewareOptions {
  /**
   * StorageBackend to use for action persistence.
   */
  storageBackend: StorageBackend;

  /**
   * Slice names whose actions are persisted to the recording stream
   * (e.g. `['gpsData', 'recording', 'refPoints']`).
   *
   * Callers MUST derive these from the actual slices — pass
   * `slicePrefixOf(someActionCreator.type)` or a `slice.name`, never a
   * hand-typed literal. A slice rename then propagates here automatically
   * instead of silently dropping the renamed slice's actions from every
   * recording (the 2026-05-28 `refPointsV2/` → `refPoints/` regression).
   *
   * `recording/recordWriteFailure` is always excluded regardless of this
   * list, to prevent recursive persistence.
   */
  persistedPrefixes: readonly string[];

  /**
   * Callback invoked when a write operation fails during persistence.
   * User Feedback Issue #1 Part B: Used to show toast notifications.
   */
  onWriteFailure?: (error: Error) => void;
}

/**
 * Extract the slice prefix from a namespaced Redux action type.
 *
 * `'gpsData/setZeroPos'` → `'gpsData'`. Returns the whole string when there
 * is no slash (e.g. `'@@INIT'`). This is the single point that turns a
 * slice-owned action type into the value the persistence whitelist matches
 * on, so call sites can derive prefixes from real action creators instead of
 * re-typing literals.
 */
export function slicePrefixOf(actionType: string): string {
  const slashIndex = actionType.indexOf('/');
  return slashIndex === -1 ? actionType : actionType.slice(0, slashIndex);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Read `state.recording.isRecording`, defaulting to false for any shape. */
function readIsRecording(state: unknown): boolean {
  return (
    (state as { recording?: { isRecording?: boolean } })?.recording
      ?.isRecording ?? false
  );
}

/**
 * Decide whether the just-reduced action belongs to a session whose actions
 * must be persisted. True while recording, and also for the `endSession`
 * action that just flipped `isRecording` to false (Issue 5) so the session's
 * final action is still captured.
 *
 * The endSession type is derived from the imported action creator
 * (`endSession.type`) rather than a hand-typed literal, so a rename of the
 * recording slice or its actions propagates here automatically instead of
 * silently breaking final-action persistence.
 */
function isInPersistableSession(
  wasRecording: boolean,
  isRecording: boolean,
  actionType: string
): boolean {
  const isEndSession = actionType === endSession.type;
  return isRecording || (wasRecording && isEndSession);
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create a Redux middleware that persists qualifying actions to storage
 * during active recording sessions.
 *
 * Persistence rules:
 * - Only persists when `state.recording.isRecording` is true (checked AFTER
 *   the action is reduced, so `startSession` itself is included).
 * - Persists actions whose slice prefix is listed in `persistedPrefixes`.
 * - Excludes `recording/recordWriteFailure` to prevent recursive persistence.
 * - Excludes `routing/*` and any other non-whitelisted actions.
 * - Uses 1-based indexing for action files (000001.json, 000002.json, …).
 * - Each middleware instance maintains its own action index (Bug 10 fix).
 */
/**
 * The persistence middleware plus its drain hook: `flushPendingWrites`
 * resolves once every queued action write has settled. The stop flow MUST
 * await it before anything reads the session's `actions/` (final sync, ZIP
 * export) — the queue is async, so a write enqueued moments before Stop
 * could otherwise land after the export enumerated the directory.
 */
export type PersistenceMiddleware = Middleware & {
  flushPendingWrites: () => Promise<void>;
};

export function createPersistenceMiddleware(
  options: PersistenceMiddlewareOptions
): PersistenceMiddleware {
  const { storageBackend, onWriteFailure, persistedPrefixes } = options;

  // Normalize each whitelisted slice name to its `name/` form once, so the
  // per-action check is a cheap `startsWith`. Deriving the excluded type from
  // the imported action creator keeps it in lock-step with the recording
  // slice (no second hand-typed literal to drift).
  const normalizedPrefixes = persistedPrefixes.map((prefix) =>
    prefix.endsWith('/') ? prefix : `${prefix}/`
  );
  const excludedActionType = recordWriteFailure.type;

  // Per-middleware-instance action index (Bug 10: was module-level)
  let actionIndex = 0;
  const writeQueue = new WriteQueue();

  // Re-entrancy tripwire (guardrail for the subscriber-dispatch ordering trap).
  // `dispatchDepth` counts how many of THIS middleware's invocations are
  // currently on the stack: a top-level dispatch runs at depth 1, while a
  // dispatch fired re-entrantly from inside another action's `next()` (e.g. a
  // synchronous `store.subscribe` listener) runs at depth > 1. A re-entrant
  // PERSISTED dispatch receives a LOWER replay index than its trigger (the index
  // is assigned after `next()`), so it is recorded BEFORE the action that
  // created the state it depends on and is dropped on replay — a silent,
  // replay-only failure. We warn ONCE (per instance) to turn that into a loud
  // dev-time signal even if the listener-middleware convention is bypassed.
  // See GpsPlusSlamJs_Docs/docs/2026-06-28-0751-subscriber-dispatch-persistence-ordering-review.md.
  let dispatchDepth = 0;
  let hasWarnedReentrant = false;

  const middleware: Middleware = (store) => (next) => (action: unknown) => {
    // Increment at entry; the `finally` wraps the WHOLE handler body (not just
    // `next`), because the depth check below runs after `next()` returns — a
    // decrement scoped to `next` alone would make the check always read depth 0.
    dispatchDepth += 1;
    try {
      const typedAction = action as UnknownAction;
      const actionType =
        typeof typedAction.type === 'string' ? typedAction.type : null;

      // Capture recording state BEFORE reducer runs so we can detect
      // endSession (which sets isRecording=false in the reducer).
      const wasRecording = readIsRecording(store.getState());

      // Let reducers handle the action first
      const result = next(action);

      if (!actionType) {
        return result;
      }

      // Reset action index when a new session starts (Issue 4). The type is
      // derived from the imported action creator (`startSession.type`) so a
      // slice/action rename can't silently disable the per-session reset.
      if (actionType === startSession.type) {
        actionIndex = 0;
      }

      // Check recording state AFTER reducers ran (so startSession is included).
      // Special-case endSession: wasRecording was true before the reducer,
      // but isRecording is now false — still needs to be persisted (Issue 5).
      const isRecording = readIsRecording(store.getState());

      // Persist if actively recording, or if this is the endSession action
      // that just flipped isRecording to false (Issue 5).
      if (!isInPersistableSession(wasRecording, isRecording, actionType)) {
        return result;
      }

      // Persist only actions whose slice prefix is whitelisted, always
      // excluding recordWriteFailure (would recurse via the error handler).
      const shouldPersistAction =
        actionType !== excludedActionType &&
        normalizedPrefixes.some((prefix) => actionType.startsWith(prefix));

      if (!shouldPersistAction) {
        return result;
      }

      // Use pre-increment for 1-based indexing (000001.json, 000002.json, etc.)
      const index = ++actionIndex;

      // Tripwire: a persisted action enqueued while nested inside another
      // dispatch's `next()` will replay out of order. Warn once (the failure is
      // otherwise silent and replay-only). Observational only — the recorded
      // actions/indices are unchanged; we never throw (that could destabilise a
      // live recording).
      if (dispatchDepth > 1 && !hasWarnedReentrant) {
        hasWarnedReentrant = true;
        log.warn(
          `Persisted action "${actionType}" was dispatched re-entrantly ` +
            `(inside another dispatch's next()). Its recorded order can invert ` +
            `on replay — react to actions via a prepended listener middleware, ` +
            `not a synchronous store.subscribe dispatch. See ` +
            `2026-06-28-0751-subscriber-dispatch-persistence-ordering-review.md.`
        );
      }

      writeQueue.enqueue(async () => {
        try {
          await storageBackend.writeAction(typedAction, index);
        } catch (err) {
          // Normalize rejection to Error (JS allows rejecting with any value)
          const normalized =
            err instanceof Error ? err : new Error(String(err));
          log.error('Failed to persist action:', normalized);

          // recordWriteFailure is excluded from persistence above,
          // so this dispatch won't cause recursion
          store.dispatch(recordWriteFailure(normalized.message));

          if (onWriteFailure) {
            onWriteFailure(normalized);
          }
        }
      });

      return result;
    } finally {
      dispatchDepth -= 1;
    }
  };

  return Object.assign(middleware, {
    flushPendingWrites: () => writeQueue.flush(),
  });
}
