/**
 * Detection scheduler — a generic throttle + coalesce + N-consecutive-lock
 * state machine over ANY async detector. Phase 2 / §9 + research2 runtime
 * stability of the
 * [QR-code detection & tracking plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-0806-qr-code-detection-tracking-plan.md);
 * generalized per Note 1 of the
 * [follow-up plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-1219-qr-tracking-generalization-overlay-and-north-followup.md)
 * so a future detector (object detection / YOLO) reuses it unchanged.
 *
 * It turns the per-render-frame `offerFrame` firehose into a THROTTLED,
 * COALESCED cadence and applies the N-consecutive-lock gate:
 *
 * - **Throttle:** start a detection at most once per `minIntervalMs`
 *   (target 5–10 Hz for QR), never per frame.
 * - **Coalesce:** never start a second detection while one is in flight (the
 *   heavy work runs off the render thread; skipping is cheaper than queueing
 *   stale frames).
 * - **N-consecutive-lock:** only report a "lock" after `requiredLockCount`
 *   consecutive successful detections; a single miss resets the counter. This
 *   hides the lower cadence and rejects one-off bad detections.
 *
 * Generic over the detection RESULT (`TResult`) and the input frame (`TImage`,
 * default {@link RgbaImage}). The detect→solve work is injected as one async
 * `detect`, so this is a pure, device-free, clock-injectable unit, transport-
 * agnostic (worker-hosted or main-thread). The QR path uses
 * `TResult = QrPoseSolution` (`qr-detection-controller.ts` and
 * `qr-tracking-controller.ts` instantiate the generic directly).
 */

import type { RgbaImage } from './qr-frontend.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('DetectionScheduler');

export interface DetectionSchedulerConfig<TResult, TImage = RgbaImage> {
  /** The full detect→solve step; resolves to a result or `null` (no hit / rejected). */
  detect: (image: TImage) => Promise<TResult | null>;
  /** Minimum ms between detection STARTS (throttle). 100 ms ≈ 10 Hz. */
  minIntervalMs: number;
  /** Consecutive successes required before a lock is reported. Default 3. */
  requiredLockCount?: number;
  /** Injectable clock (ms). Defaults to `performance.now()`/`Date.now()`. */
  now?: () => number;
  /** Called on each success once locked (consecutiveLocks ≥ requiredLockCount). */
  onLocked?: (result: TResult) => void;
  /** Called when a detection completes with no usable result. */
  onMiss?: () => void;
  /** Called when `detect` rejects (the counter is reset). */
  onError?: (err: unknown) => void;
}

export interface DetectionScheduler<TImage = RgbaImage> {
  /** Offer the latest camera frame; may or may not start a detection. */
  offerFrame(image: TImage): void;
  /** True while a detection is awaiting `detect`. */
  readonly inFlight: boolean;
  /** Current consecutive-success count (capped at requiredLockCount). */
  readonly consecutiveLocks: number;
  /** True once `consecutiveLocks` has reached `requiredLockCount`. */
  readonly locked: boolean;
}

const defaultNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export function createDetectionScheduler<TResult, TImage = RgbaImage>(
  config: DetectionSchedulerConfig<TResult, TImage>
): DetectionScheduler<TImage> {
  const {
    detect,
    minIntervalMs,
    requiredLockCount = 3,
    now = defaultNow,
    onLocked,
    onMiss,
    onError,
  } = config;

  let inFlight = false;
  let consecutiveLocks = 0;
  // -Infinity so the first offered frame always passes the throttle.
  let lastStart = -Infinity;

  const scheduler: DetectionScheduler<TImage> = {
    get inFlight() {
      return inFlight;
    },
    get consecutiveLocks() {
      return consecutiveLocks;
    },
    get locked() {
      return consecutiveLocks >= requiredLockCount;
    },
    offerFrame(image: TImage): void {
      if (inFlight) return; // coalesce
      const t = now();
      if (t - lastStart < minIntervalMs) return; // throttle
      lastStart = t;
      inFlight = true;

      // Invoke `detect` synchronously (callers/tests rely on the start firing in
      // this tick) but convert a SYNCHRONOUS throw — one that escapes before the
      // promise is returned, e.g. a dead-worker transport or a sync precondition
      // check — into a rejection. Otherwise inFlight (set true above) would never
      // be cleared and all future detections would silently stall forever.
      // The async wrapper runs `detect(image)` synchronously (no await before
      // it) yet turns any synchronous throw into a rejection that flows through
      // the .catch below — preserving the original thrown value.
      const started: Promise<TResult | null> = (async () => detect(image))();

      // Isolate each user callback in its own try/catch. They are application
      // code that can throw; an unguarded throw in onLocked/onMiss would
      // propagate to the .catch below — resetting consecutiveLocks AND calling
      // onError — corrupting the lock state machine (the lock would flap) and
      // misreporting a callback bug as a detection failure. A throwing onError
      // would likewise surface as an unhandled rejection. We log and move on so
      // the scheduler's own state stays correct regardless of callback behavior.
      started
        .then((result) => {
          if (result) {
            consecutiveLocks = Math.min(
              consecutiveLocks + 1,
              requiredLockCount
            );
            if (consecutiveLocks >= requiredLockCount) {
              try {
                onLocked?.(result);
              } catch (err) {
                log.error('onLocked callback threw:', err);
              }
            }
          } else {
            consecutiveLocks = 0;
            try {
              onMiss?.();
            } catch (err) {
              log.error('onMiss callback threw:', err);
            }
          }
        })
        .catch((err: unknown) => {
          consecutiveLocks = 0;
          try {
            onError?.(err);
          } catch (callbackErr) {
            log.error('onError callback threw:', callbackErr);
          }
        })
        .finally(() => {
          inFlight = false;
        });
    },
  };

  return scheduler;
}
