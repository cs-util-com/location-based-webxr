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
   *  limits cap it further. Splat.js shrinks its photos at its own
   *  700e6-byte budget, so the default plans with the same number. */
  readonly targetMemoryBytes: number;
  /** Bytes per photo pixel the memory budget counts: Splat.js counts 12
   *  (three float32 channels) against its budget. */
  readonly bytesPerPixel: number;
  /** Bytes per photo pixel the graphics card holds: Splat.js packs its
   *  training photos as RGBA8, one 32-bit word a pixel, in one buffer the
   *  card's binding and buffer limits apply to. */
  readonly gpuBytesPerPixel: number;
  /** Shortest photo side the trainer may scale down to (px); below it a
   *  window is refused as too large instead. The GPU trainer counts the
   *  larger of this and Splat.js's own floor (320 px on the longer side:
   *  240 px short for 4:3 photos, 180 px for 16:9), so at 128 it binds
   *  only for photos wider than 2.5:1 and is inert for camera photos; of
   *  the range 64 / 128 / 256 only 256 changes which stretches are
   *  refused (4:3 and wider). Kept as the knob that raises the floor. */
  readonly minShortSidePx: number;
  /** Steps measured before a time estimate is shown: earlier ones carry
   *  shader compilation and warm-up. */
  readonly etaMinIterations: number;
  /** A depth sample seeds a training photo when it was taken within this
   *  many milliseconds of it. Picked, not swept: the recorder takes them
   *  in the same frame, so any value above a frame or two keeps them. */
  readonly depthMaxDtMs: number;
  /** Seeds from depth readings are merged per cube of this side (m).
   *  Picked, not swept: finer keeps more seeds than training needs. */
  readonly seedVoxelM: number;
  /** The background shell's distance from each camera along every pixel
   *  ray (m). Picked, not swept: beyond what the depth readings reach. */
  readonly shellDistanceM: number;
  /** One shell point per square of this side in pixels. */
  readonly shellGridPx: number;
  /** Every n-th training photo grows shell points. */
  readonly shellEveryPhoto: number;
  /** Shell points are merged per cube of this side (m). */
  readonly shellVoxelM: number;
  /** A first try trains for at most this long (s); "train again" scales
   *  it. Picked, not swept: a window of 100 photos took minutes on the
   *  graphics cards measured so far. */
  readonly deadlineS: number;
  /** Loading the trainer library and preparing the graphics card
   *  (uploading the photos, seeding) may take at most this long (s)
   *  together, one cap from the worker's start, before the stretch fails
   *  in words; "train again" scales it. Picked, not measured: 120 s would likely cut off a
   *  slow integrated card uploading 100 photos, 600 s leaves the creator
   *  watching a stuck print for ten minutes; 300 s sits between. A
   *  measured upload time on a slow card would replace it. */
  readonly prepareCapS: number;
  /** Held-out sharpness (dB) from which a stretch is good, and from which
   *  it is at least weak. Picked, not swept: they stand until the stretch
   *  judge is measured against people's ratings. Provisional and laxer
   *  than the stricter bars the trainer aims for (good at 21 dB held out and 27 dB at the
   *  camera with SSIM 0.70; not good under 19 dB held out or 25 dB at the
   *  camera): this judge reads held-out sharpness only, with no SSIM and
   *  no camera bar, until a measured judge replaces both. */
  readonly goodHeldOutDb: number;
  readonly weakHeldOutDb: number;
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
  targetMemoryBytes: 700e6,
  bytesPerPixel: 12,
  gpuBytesPerPixel: 4,
  minShortSidePx: 128,
  etaMinIterations: 200,
  depthMaxDtMs: 200,
  seedVoxelM: 0.05,
  shellDistanceM: 40,
  shellGridPx: 48,
  shellEveryPhoto: 4,
  shellVoxelM: 1,
  deadlineS: 1200,
  prepareCapS: 300,
  goodHeldOutDb: 20,
  weakHeldOutDb: 16,
});
