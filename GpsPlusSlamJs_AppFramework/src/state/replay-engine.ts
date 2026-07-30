/**
 * Replay Engine
 *
 * Controls timed playback of recorded sessions by dispatching actions
 * to a RecorderStore with delays derived from action timestamps.
 *
 * Key design decisions (from 2026-02-19-replay-mode.md):
 * - Cancellable async loop with AbortController for pause/resume
 * - Speed factor as a mutable variable, changeable mid-playback
 * - extractActionTimestamp explicitly returns null for depthSample
 *   (uses performance.now, not epoch ms — Risk R4)
 * - Max delay clamp prevents hanging on stale recordings
 *
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-02-19-replay-mode.md Issue 2 (Option D), Issue 3
 */

import type { ReducersMapObject } from '@reduxjs/toolkit';
import type { SlamAppStore } from './create-slam-app-store';

/** Minimal store contract used by the replay engine: dispatches plain actions. */
type RecorderStore = SlamAppStore<ReducersMapObject>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum delay between actions in ms (30 seconds real-time) */
export const DEFAULT_MAX_DELAY_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReplayState = 'idle' | 'playing' | 'paused' | 'completed';

export type ProgressCallback = (current: number, total: number) => void;
export type CompleteCallback = () => void;
export type ErrorCallback = (actionIndex: number, error: Error) => void;

/** Max consecutive dispatch errors before auto-pause (Risk R7) */
const MAX_CONSECUTIVE_ERRORS = 10;

/** Minimal action shape for replay — just needs type and optional payload */
export interface ReplayAction {
  type: string;
  payload?: unknown;
}

// ---------------------------------------------------------------------------
// extractActionTimestamp
// ---------------------------------------------------------------------------

/**
 * Extract an absolute epoch-ms timestamp from a Redux action, or null
 * if the action type doesn't carry one.
 *
 * IMPORTANT: the high-frequency sensor streams (depthSample, qrDetected) return
 * null here ON PURPOSE — they are NOT used to pace replay delays (they anchor to
 * the GPS/image/session timeline by recorded ORDER instead). Their payload
 * `timestamp` IS epoch ms (`performance.timeOrigin + frameTs`, see
 * `ar/depth-sampler.ts`); the QR size as-of join reads those payload timestamps
 * directly, independently of this pacing function. (Risk R4)
 *
 * @param action - A Redux action with type and optional payload
 * @returns Epoch milliseconds, or null if unavailable/unreliable
 */
export function extractActionTimestamp(action: ReplayAction): number | null {
  if (!action.payload || typeof action.payload !== 'object') {
    return null;
  }

  const payload = action.payload as Record<string, unknown>;

  switch (action.type) {
    case 'gpsData/recordGpsEvent': {
      // payload.rawGpsPoint.timestamp (new format) or payload.gpsPoint.timestamp (old recordings)
      const rawGpsPoint = payload.rawGpsPoint as
        | Record<string, unknown>
        | undefined;
      if (rawGpsPoint && typeof rawGpsPoint.timestamp === 'number') {
        return rawGpsPoint.timestamp;
      }
      const gpsPoint = payload.gpsPoint as Record<string, unknown> | undefined;
      if (gpsPoint && typeof gpsPoint.timestamp === 'number') {
        return gpsPoint.timestamp;
      }
      return null;
    }

    case 'recording/startSession': {
      // payload.startTime — epoch ms
      if (typeof payload.startTime === 'number') {
        return payload.startTime;
      }
      return null;
    }

    case 'gpsData/markReferencePoint': {
      // payload.timestamp — epoch ms (optional field, may fall back to rawGpsPoint/gpsPoint)
      if (typeof payload.timestamp === 'number') {
        return payload.timestamp;
      }
      // Fallback: try rawGpsPoint.timestamp (new format) then gpsPoint.timestamp (old recordings)
      const rawGpsPoint = payload.rawGpsPoint as
        | Record<string, unknown>
        | undefined;
      if (rawGpsPoint && typeof rawGpsPoint.timestamp === 'number') {
        return rawGpsPoint.timestamp;
      }
      const gpsPoint = payload.gpsPoint as Record<string, unknown> | undefined;
      if (gpsPoint && typeof gpsPoint.timestamp === 'number') {
        return gpsPoint.timestamp;
      }
      return null;
    }

    case 'recording/recordDepthSample':
      // EXPLICITLY null — a high-frequency stream replayed in recorded ORDER, not
      // paced by delay. Its payload `timestamp` is epoch ms but is not consumed
      // here (Risk R4).
      return null;

    case 'qrDetected/recordQrDetection':
      // EXPLICITLY null — like depthSample, replayed in recorded order, not paced.
      // The QR `timestamp` is EPOCH ms (`Date.now()`, the SAME domain as the depth
      // stream) so the derive-on-read size as-of join aligns on the payload
      // timestamps; this pacing function deliberately ignores it.
      return null;

    case 'recording/endSession':
      // No timestamp in payload
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// computeInterActionDelay
// ---------------------------------------------------------------------------

/**
 * Compute the delay in ms between two consecutive actions for replay.
 *
 * @param currentTs - Epoch ms of the current (just-dispatched) action, or null
 * @param nextTs - Epoch ms of the next action, or null
 * @param speedFactor - Playback speed multiplier (1 = real-time)
 * @param maxDelay - Maximum delay in ms (default: DEFAULT_MAX_DELAY_MS)
 * @returns Delay in ms, clamped to [0, maxDelay]
 */
export function computeInterActionDelay(
  currentTs: number | null,
  nextTs: number | null,
  speedFactor: number,
  maxDelay: number = DEFAULT_MAX_DELAY_MS
): number {
  if (currentTs === null || nextTs === null) {
    return 0;
  }

  const rawDelay = (nextTs - currentTs) / speedFactor;

  // Clamp to [0, maxDelay]
  return Math.min(Math.max(0, rawDelay), maxDelay);
}

// ---------------------------------------------------------------------------
// ReplayEngine
// ---------------------------------------------------------------------------

/**
 * Async controller that dispatches recorded actions with timed delays.
 *
 * Uses AbortController for pause/cancel:
 * - play() starts the async loop
 * - pause() aborts the current controller → loop exits
 * - resume() creates a new controller and restarts from current index
 * - setSpeed() updates a closure variable, picked up on next delay calc
 * - dispose() stops everything and resets state
 */
export class ReplayEngine {
  private state: ReplayState = 'idle';
  private currentIndex = 0;
  private actions: ReplayAction[] = [];
  private store: RecorderStore | null = null;
  private speedFactor = 1;
  private abortController: AbortController | null = null;
  private progressCallbacks: ProgressCallback[] = [];
  private completeCallbacks: CompleteCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];
  private currentPlayPromise: Promise<void> | null = null;

  /** Get the current engine state */
  getState(): ReplayState {
    return this.state;
  }

  /** Get the current action index (1-based after dispatch, 0 before play) */
  getCurrentActionIndex(): number {
    return this.currentIndex;
  }

  /** Register a progress callback: (currentIndex, totalCount) */
  onProgress(callback: ProgressCallback): void {
    this.progressCallbacks.push(callback);
  }

  /** Register a completion callback */
  onComplete(callback: CompleteCallback): void {
    this.completeCallbacks.push(callback);
  }

  /**
   * Register an error callback: (actionIndex, error).
   * Called when a dispatch throws. Replay continues past the error.
   * After MAX_CONSECUTIVE_ERRORS consecutive failures, engine auto-pauses (R7).
   */
  onError(callback: ErrorCallback): void {
    this.errorCallbacks.push(callback);
  }

  /** Update playback speed (takes effect on next delay calculation) */
  setSpeed(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new RangeError(
        `Speed factor must be a positive finite number, got ${factor}`
      );
    }
    this.speedFactor = factor;
  }

  /**
   * Start replaying actions with timed delays.
   *
   * @param actions - Array of Redux actions to dispatch
   * @param store - RecorderStore to dispatch into
   * @param speedFactor - Initial playback speed (1 = real-time)
   * @returns Promise that resolves when replay completes or is paused
   */
  play(
    actions: ReplayAction[],
    store: RecorderStore,
    speedFactor: number
  ): Promise<void> {
    // Cancel any existing playback before starting a new one (Issue 2)
    this.abortController?.abort();

    this.actions = actions;
    this.store = store;
    this.speedFactor = speedFactor;
    this.currentIndex = 0;
    this.state = 'playing';

    this.abortController = new AbortController();
    this.currentPlayPromise = this.runLoop(this.abortController.signal);
    return this.currentPlayPromise;
  }

  /** Pause the replay. Can be resumed later with resume(). */
  pause(): void {
    if (this.state !== 'playing') {
      return;
    }
    this.state = 'paused';
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Resume from the current action index after a pause.
   * @returns Promise that resolves when replay completes or is paused again
   */
  resume(): Promise<void> {
    if (this.state !== 'paused' || !this.store) {
      return Promise.resolve();
    }
    this.state = 'playing';
    this.abortController = new AbortController();
    this.currentPlayPromise = this.runLoop(this.abortController.signal);
    return this.currentPlayPromise;
  }

  /** Stop playback and reset to idle. */
  dispose(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.state = 'idle';
    this.currentIndex = 0;
    this.actions = [];
    this.store = null;
    this.currentPlayPromise = null;
    this.progressCallbacks = [];
    this.completeCallbacks = [];
    this.errorCallbacks = [];
  }

  // -------------------------------------------------------------------------
  // Internal async loop
  // -------------------------------------------------------------------------

  private async runLoop(signal: AbortSignal): Promise<void> {
    const { actions, store } = this;
    if (!store) {
      return;
    }

    const total = actions.length;

    // Handle empty action list
    if (total === 0) {
      this.state = 'completed';
      this.notifyComplete();
      return;
    }

    let consecutiveErrors = 0;

    while (this.currentIndex < total) {
      // Check abort before dispatching
      if (signal.aborted) {
        return;
      }

      const action = actions[this.currentIndex]!;

      // Dispatch the action with error handling (Risk R7).
      // A malformed action must not crash the replay loop.
      try {
        // Cast needed: RecorderStore.dispatch has narrow overload types,
        // but the runtime implementation accepts any { type: string } action.
        (store.dispatch as (action: { type: string }) => void)(action);
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        const error = err instanceof Error ? err : new Error(String(err));
        this.notifyError(this.currentIndex + 1, error);

        // Auto-pause after too many consecutive errors (R7)
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          this.state = 'paused';
          this.abortController?.abort();
          this.abortController = null;
          return;
        }
      }
      this.currentIndex++;
      this.notifyProgress(this.currentIndex, total);

      // If this was the last action, we're done
      if (this.currentIndex >= total) {
        this.state = 'completed';
        this.notifyComplete();
        return;
      }

      // Compute delay to next action
      const currentTs = extractActionTimestamp(action);
      const nextTs = extractActionTimestamp(actions[this.currentIndex]!);
      const delay = computeInterActionDelay(
        currentTs,
        nextTs,
        this.speedFactor
      );

      if (delay > 0) {
        // Wait with abort support
        const aborted = await this.abortableDelay(delay, signal);
        if (aborted) {
          return;
        }
      }
    }
  }

  /**
   * Promise-based delay that resolves on timeout or rejects on abort.
   * Returns true if aborted, false if delay completed normally.
   */
  private abortableDelay(ms: number, signal: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (signal.aborted) {
        resolve(true);
        return;
      }

      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve(false);
      }, ms);

      // If signal is aborted while waiting, clear timer and resolve
      const onAbort = () => {
        clearTimeout(timer);
        resolve(true);
      };

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private notifyProgress(current: number, total: number): void {
    for (const cb of this.progressCallbacks) {
      cb(current, total);
    }
  }

  private notifyComplete(): void {
    for (const cb of this.completeCallbacks) {
      cb();
    }
  }

  private notifyError(actionIndex: number, error: Error): void {
    for (const cb of this.errorCallbacks) {
      cb(actionIndex, error);
    }
  }
}
