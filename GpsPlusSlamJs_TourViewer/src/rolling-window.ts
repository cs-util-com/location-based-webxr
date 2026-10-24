/**
 * The mean and the worst of the samples of the last few seconds: the `?debug=1` readout's ms per
 * radar draw and frame time, which the field check reads against the
 * 50 ms frame budget.
 *
 * A time window, unlike the framework's `utils/frame-times` (the last N
 * frames, as percentiles): "the last 2 s" means the same at 30 and at
 * 60 frames a second, and the readout's worst must forget a slow frame
 * once it is 2 s old, so the phone's present is what the reader sees.
 *
 * @see rolling-window.ts.md
 */

/** The window the readout reports (plan M3: the last 2 s). */
export const ROLLING_WINDOW_MS = 2000;

export interface RollingSummary {
  readonly mean: number;
  readonly worst: number;
  readonly count: number;
}

export interface RollingWindow {
  /** One sample taken at `atMs`; a non-finite time, or a value that is no
   *  finite number at least 0, is ignored. Times are expected in order. */
  push(atMs: number, value: number): void;
  /** The samples no older than the window at `nowMs`; null when none. */
  summary(nowMs: number): RollingSummary | null;
  reset(): void;
}

/**
 * @param windowMs how far back a summary reads, ms.
 * @param capacity the most samples held (the oldest go first), so a
 *   source faster than expected cannot grow it without bound.
 * @throws RangeError for a window that is no positive finite number, or a
 *   capacity that is no positive integer.
 */
export function createRollingWindow(
  windowMs = ROLLING_WINDOW_MS,
  capacity = 1024,
): RollingWindow {
  if (!(Number.isFinite(windowMs) && windowMs > 0)) {
    throw new RangeError(
      `rolling-window: the window must be a positive number of ms, got ${String(windowMs)}`,
    );
  }
  if (!(Number.isInteger(capacity) && capacity > 0)) {
    throw new RangeError(
      `rolling-window: the capacity must be a positive integer, got ${String(capacity)}`,
    );
  }
  const times = new Float64Array(capacity);
  const values = new Float64Array(capacity);
  /** The oldest sample's slot, and how many are held. */
  let head = 0;
  let count = 0;

  function evict(nowMs: number): void {
    while (count > 0 && nowMs - times[head]! > windowMs) {
      head = (head + 1) % capacity;
      count -= 1;
    }
  }

  return {
    push(atMs, value) {
      if (!Number.isFinite(atMs) || !(Number.isFinite(value) && value >= 0)) {
        return;
      }
      if (count === capacity) {
        head = (head + 1) % capacity;
        count -= 1;
      }
      const slot = (head + count) % capacity;
      times[slot] = atMs;
      values[slot] = value;
      count += 1;
    },
    summary(nowMs) {
      evict(nowMs);
      if (count === 0) return null;
      let sum = 0;
      let worst = 0;
      for (let i = 0; i < count; i += 1) {
        const v = values[(head + i) % capacity]!;
        sum += v;
        if (v > worst) worst = v;
      }
      return { mean: sum / count, worst, count };
    },
    reset() {
      head = 0;
      count = 0;
    },
  };
}
