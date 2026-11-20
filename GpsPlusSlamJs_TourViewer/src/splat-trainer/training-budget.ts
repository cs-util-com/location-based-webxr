/**
 * How much a training window may hold and how long it trains: the photo
 * memory the adapter allows, the photo size that fits it, the number of
 * training steps, and the live time estimate while it runs. Pure: the
 * caller passes the adapter's limits in.
 *
 * @see training-budget.ts.md
 */

import { requirePositive } from "./splat-math.js";
import type { TrainerSettings } from "./trainer-defaults.js";

/** The two `GPUSupportedLimits` the photo memory depends on. */
export interface AdapterLimits {
  readonly maxStorageBufferBindingSize: number;
  readonly maxBufferSize: number;
}

export type PhotoScale =
  | {
      readonly kind: "fits";
      readonly width: number;
      readonly height: number;
      readonly bytes: number;
    }
  | {
      readonly kind: "too-large";
      /** Bytes needed at the shortest side allowed. */
      readonly neededBytes: number;
      readonly budgetBytes: number;
    };

/**
 * The photo memory budget (bytes): the target, at most half the storage
 * binding limit (the photos must share the device with the trainer's own
 * buffers) and at most the largest buffer. Throws a RangeError for limits
 * that are not positive numbers.
 */
export function memoryBudgetBytes(
  limits: AdapterLimits,
  settings: TrainerSettings,
): number {
  requirePositive(
    "maxStorageBufferBindingSize",
    limits.maxStorageBufferBindingSize,
  );
  requirePositive("maxBufferSize", limits.maxBufferSize);
  requirePositive("targetMemoryBytes", settings.targetMemoryBytes);
  return Math.floor(
    Math.min(
      settings.targetMemoryBytes,
      limits.maxStorageBufferBindingSize / 2,
      limits.maxBufferSize,
    ),
  );
}

/**
 * The photo size a window of `frames` photos of `width` x `height` trains
 * at within `budgetBytes`: its own size when it fits, else scaled down by
 * one factor on both sides (rounded down, so the result never exceeds the
 * budget), but never with a shorter side under `minShortSidePx`: then the
 * window is too large and must be cut smaller. Throws a RangeError for
 * sizes that are not positive integers.
 */
export function photoScale(
  frames: number,
  width: number,
  height: number,
  budgetBytes: number,
  settings: TrainerSettings,
): PhotoScale {
  for (const [name, v] of [
    ["frames", frames],
    ["width", width],
    ["height", height],
  ] as const) {
    if (!Number.isInteger(v) || v < 1) {
      throw new RangeError(
        `${name} must be a positive integer, got ${String(v)}`,
      );
    }
  }
  requirePositive("budgetBytes", budgetBytes);
  requirePositive("bytesPerPixel", settings.bytesPerPixel);
  const bytesAt = (w: number, h: number): number =>
    frames * w * h * settings.bytesPerPixel;
  if (bytesAt(width, height) <= budgetBytes) {
    return { kind: "fits", width, height, bytes: bytesAt(width, height) };
  }
  let factor = Math.sqrt(budgetBytes / bytesAt(width, height));
  let w = Math.floor(width * factor);
  let h = Math.floor(height * factor);
  // Float round-off can leave one pixel too many; step down until it fits.
  while (w > 0 && h > 0 && bytesAt(w, h) > budgetBytes) {
    factor *= 0.999;
    w = Math.floor(width * factor);
    h = Math.floor(height * factor);
  }
  const shortSide = Math.min(width, height);
  const minShort = Math.min(settings.minShortSidePx, shortSide);
  if (Math.min(w, h) < minShort) {
    // Rounding may undershoot the shortest side by a pixel when the
    // budget allows exactly that size; it is then the answer.
    const minW = Math.floor((width * minShort) / shortSide);
    const minH = Math.floor((height * minShort) / shortSide);
    const minBytes = bytesAt(minW, minH);
    return minBytes <= budgetBytes
      ? { kind: "fits", width: minW, height: minH, bytes: minBytes }
      : { kind: "too-large", neededBytes: minBytes, budgetBytes };
  }
  return { kind: "fits", width: w, height: h, bytes: bytesAt(w, h) };
}

/** Training steps for a window of `trainFrames` training photos:
 *  `itersPerFrame` each, within `[minIterations, maxIterations]`. */
export function iterationBudget(
  trainFrames: number,
  settings: TrainerSettings,
): number {
  if (!Number.isInteger(trainFrames) || trainFrames < 0) {
    throw new RangeError(
      `trainFrames must be a non-negative integer, got ${String(trainFrames)}`,
    );
  }
  if (!(settings.minIterations <= settings.maxIterations)) {
    throw new RangeError(
      `maxIterations (${String(settings.maxIterations)}) must be at least minIterations (${String(settings.minIterations)})`,
    );
  }
  return Math.min(
    settings.maxIterations,
    Math.max(settings.minIterations, settings.itersPerFrame * trainFrames),
  );
}

/**
 * The time left (ms) at the rate measured so far. `done` and `elapsedMs`
 * count from a mark the caller takes after warm-up (shader compilation
 * and the first upload), not from the start of training, or the rate
 * would carry that one-off cost; `total` counts from the same mark. Null
 * before `etaMinIterations` steps since the mark (too few for a steady
 * rate) or for a measurement that makes no sense (not finite, negative,
 * or more steps done than planned).
 */
export function liveEta(
  progress: {
    readonly done: number;
    readonly total: number;
    readonly elapsedMs: number;
  },
  settings: TrainerSettings,
): number | null {
  const { done, total, elapsedMs } = progress;
  if (![done, total, elapsedMs].every(Number.isFinite)) return null;
  if (
    elapsedMs < 0 ||
    done <= 0 ||
    done > total ||
    done < settings.etaMinIterations
  ) {
    return null;
  }
  return ((total - done) * elapsedMs) / done;
}
