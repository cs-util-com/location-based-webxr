/**
 * The splat trainer's tuning values, in one place. The window length and
 * the steps per frame are measured (a sweep over the ranges named); every
 * other value is PROVISIONAL, picked before the sweep that is to settle it
 * has run. Each names its range and what would move it.
 *
 * @see trainer-defaults.ts.md
 */

/** The tuning a frame selection, window plan and budget read. */
export interface TrainerSettings {
  /** Speed above which two consecutive captures are a tracking jump, not
   *  a walk (m/s). Swept 2 / 3 / 5. A walk is about 1.4 m/s; lower
   *  would split brisk walks, higher would let a relocalisation through. */
  readonly jumpSpeedMPerS: number;
  /** Every n-th capture is held out for evaluation, never trained on.
   *  Swept 4 / 8 / 16: fewer hold-outs starve the score, more starve the
   *  training. */
  readonly holdoutEvery: number;
  /** Below this many hold-outs a window borrows its neighbours'.
   *  Swept 3 / 5 / 8. */
  readonly minHoldouts: number;
  /** A window's length along the walk (m). Measured over 15 / 30 / 60:
   *  held-out quality moved by about a decibel either way with no
   *  consistent direction, while the time per window grew with length.
   *  Windows are a time and memory measure, not a quality gain. */
  readonly windowM: number;
  /** Fewest training captures a window keeps (a shorter one is merged
   *  into its neighbour). Must be at most half of `maxFrames`. */
  readonly minFrames: number;
  /** Most training captures a window keeps (a longer one is split). */
  readonly maxFrames: number;
  /** How far, as a fraction of `windowM`, a window also trains on its
   *  neighbours' captures. Swept 0 / 0.15 / 0.25 / 0.4. */
  readonly overlapFraction: number;
  /** Range within which a capture claims the splats it sees (m). Swept
   *  20 / 40 / 80. */
  readonly ownRangeM: number;
  /** A window keeps splats within this fraction of the background shell's
   *  distance from one of its cameras. Swept 0.5 / 0.8 / 1.0. */
  readonly keepFraction: number;
  /** Training steps per training capture. Measured against 300: double
   *  the steps improved only the training views, held-out quality stayed
   *  flat. */
  readonly itersPerFrame: number;
  /** Fewest training steps for a window. */
  readonly minIterations: number;
  /** Most training steps for a window. */
  readonly maxIterations: number;
  /** The trainer's photo memory target (bytes), before the adapter's own
   *  limits cap it further. */
  readonly targetMemoryBytes: number;
  /** Bytes the trainer holds per photo pixel (colour plus its working
   *  copies). */
  readonly bytesPerPixel: number;
  /** Shortest photo side the trainer may scale down to (px); below it a
   *  window is refused as too large instead. Swept 64 / 128 / 256. */
  readonly minShortSidePx: number;
  /** Steps measured before a time estimate is shown: earlier ones carry
   *  shader compilation and warm-up. */
  readonly etaMinIterations: number;
}

/** The provisional defaults (see the module comment). */
export const TRAINER_DEFAULTS: TrainerSettings = Object.freeze({
  jumpSpeedMPerS: 3,
  holdoutEvery: 8,
  minHoldouts: 5,
  windowM: 30,
  minFrames: 20,
  maxFrames: 100,
  overlapFraction: 0.25,
  ownRangeM: 40,
  keepFraction: 0.8,
  itersPerFrame: 150,
  minIterations: 4000,
  maxIterations: 30000,
  targetMemoryBytes: 700 * 1024 * 1024,
  bytesPerPixel: 12,
  minShortSidePx: 128,
  etaMinIterations: 200,
});
