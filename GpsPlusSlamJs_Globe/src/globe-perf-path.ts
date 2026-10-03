/**
 * The frame-hitch recorder's flight paths (globe zoom frame-hitch plan
 * 2026-10-03-2017 §4.2): the places, the time-driven zoom for a real GPU
 * (the owner's phone) and the frame-stepped zoom for SwiftShader. Pure: a
 * run's altitudes are a function of its time or its frame index alone, so
 * runs compare.
 *
 * @see globe-perf-path.ts.md
 */

/** The plan's places (§4.2): open ocean, the Alps, near the pole, a city. */
export const PERF_PLACES = Object.freeze([
  Object.freeze({ id: "ocean", lat: 0, lng: -160 }),
  Object.freeze({ id: "alps", lat: 46.5, lng: 9.0 }),
  Object.freeze({ id: "pole", lat: 82, lng: -40 }),
  Object.freeze({ id: "city", lat: 40.7, lng: -74.0 }),
]);

export const PERF_PATH = Object.freeze({
  /** The top of the zoom (m). */
  fromM: 20_000_000,
  /** The bottom of the zoom (m). */
  toM: 30_000,
  /** The hold at each end of the time-driven zoom (ms). */
  settleMs: 2_000,
});

/** The frame-stepped path's settle checkpoints, km (§4.2). */
export const PERF_CHECKPOINTS_KM: readonly number[] = Object.freeze([
  5_000, 2_000, 1_600, 1_200, 300, 30,
]);

/** The held altitude for the frame-stepped path's one E change, km (§4.2). */
export const PERF_E_CHECK_KM = 1_000;

const legMs = (decadesPerS: number): number =>
  (Math.log10(PERF_PATH.fromM / PERF_PATH.toM) / decadesPerS) * 1000;

function checkSpeed(decadesPerS: number): void {
  if (!(decadesPerS > 0 && Number.isFinite(decadesPerS))) {
    throw new RangeError(
      `the zoom speed must be finite and > 0 decades a second, got ${decadesPerS}`,
    );
  }
}

/** The time-driven zoom's length (ms) at a speed (decades of altitude a second). */
export function perfZoomDurationMs(options: { decadesPerS: number }): number {
  checkSpeed(options.decadesPerS);
  return 2 * legMs(options.decadesPerS) + 2 * PERF_PATH.settleMs;
}

/**
 * The time-driven zoom (§4.2) at `tMs` since its start: a hold at the top
 * (`settleMs`), down at `decadesPerS` in the logarithm of the altitude to
 * the bottom, a hold there, and back up at the same speed. `done` once the
 * climb is over. RangeError for a non-finite time or a speed not > 0.
 */
export function perfZoomAltitudeM(
  tMs: number,
  options: { decadesPerS: number },
): {
  altitudeM: number;
  phase: "top" | "down" | "bottom" | "up";
  done: boolean;
} {
  if (!Number.isFinite(tMs)) {
    throw new RangeError(`the time must be finite, got ${tMs}`);
  }
  checkSpeed(options.decadesPerS);
  const { fromM, toM, settleMs } = PERF_PATH;
  const leg = legMs(options.decadesPerS);
  const decades = Math.log10(fromM / toM);
  const t = Math.max(0, tMs);
  if (t <= settleMs) return { altitudeM: fromM, phase: "top", done: false };
  if (t <= settleMs + leg) {
    const share = (t - settleMs) / leg;
    return {
      altitudeM: fromM * 10 ** (-decades * share),
      phase: "down",
      done: false,
    };
  }
  if (t < 2 * settleMs + leg) {
    return { altitudeM: toM, phase: "bottom", done: false };
  }
  const share = Math.min(1, (t - 2 * settleMs - leg) / leg);
  return {
    altitudeM: toM * 10 ** (decades * share),
    phase: "up",
    done: share >= 1,
  };
}

/** One frame of the frame-stepped path. */
export interface PerfStep {
  readonly altitudeM: number;
  readonly leg: "down" | "up";
  /** A settle checkpoint: the lab holds here until the tiles settle. */
  readonly checkpoint: boolean;
}

/**
 * The frame-stepped zoom (§4.2): one fixed step of `1 / stepsPerDecade`
 * in the logarithm of the altitude per frame, from the top to the bottom
 * and back. On the way down each settle checkpoint is visited exactly
 * (the step is cut short to land on it), so the counts are taken at the
 * same altitudes in every run. RangeError for a step count that is not a
 * positive integer.
 */
export function perfStepPath(options: { stepsPerDecade: number }): PerfStep[] {
  const { stepsPerDecade } = options;
  if (!(Number.isInteger(stepsPerDecade) && stepsPerDecade > 0)) {
    throw new RangeError(
      `steps per decade must be a positive integer, got ${stepsPerDecade}`,
    );
  }
  const step = 1 / stepsPerDecade;
  const { fromM, toM } = PERF_PATH;
  const checkpoints = PERF_CHECKPOINTS_KM.map((km) => km * 1000);
  const path: PerfStep[] = [
    { altitudeM: fromM, leg: "down", checkpoint: false },
  ];
  let log = Math.log10(fromM);
  const bottom = Math.log10(toM);
  while (log > bottom + 1e-12) {
    let next = log - step;
    const crossed = checkpoints.find(
      (m) => Math.log10(m) < log - 1e-12 && Math.log10(m) >= next - 1e-12,
    );
    if (crossed !== undefined) next = Math.log10(crossed);
    if (next < bottom) next = bottom;
    log = next;
    const altitudeM = 10 ** log;
    const isCheckpoint = checkpoints.some(
      (m) => Math.abs(Math.log10(m) - log) < 1e-9,
    );
    path.push({
      altitudeM: isCheckpoint
        ? checkpoints.find((m) => Math.abs(Math.log10(m) - log) < 1e-9)!
        : altitudeM,
      leg: "down",
      checkpoint: isCheckpoint,
    });
  }
  const top = Math.log10(fromM);
  while (log < top - 1e-12) {
    log = Math.min(top, log + step);
    path.push({ altitudeM: 10 ** log, leg: "up", checkpoint: false });
  }
  return path;
}

/**
 * The controls' wheel step per unit of `deltaY` at `zoomSpeed` 1
 * (3d-tiles-renderer 0.5.3: the wheel adds -0.25 x deltaY to the zoom
 * delta, and the globe's far zoom moves the camera by 0.0025 of its
 * distance per unit of it, `ZOOM_DELTA_SCALAR`).
 */
const WHEEL_SHARE_PER_DELTA_Y = 0.25 * 0.0025;

/**
 * The controls-driven mode (§4.2, H5): the wheel `deltaY` (pixels) that
 * takes the camera from `altitudeM` to `targetM` in one frame under the
 * controls' zoom law; negative zooms in. A step is capped at half the
 * distance in and double it out, so one frame never jumps past the
 * target. Close to the ground the controls zoom toward the point under the
 * pointer instead, by the same share of that distance, so the step is
 * approximate there and the next frame corrects it. RangeError for an
 * altitude or a target that is not finite and > 0.
 */
export function perfWheelDeltaY(altitudeM: number, targetM: number): number {
  for (const [name, v] of [
    ["altitude", altitudeM],
    ["target", targetM],
  ] as const) {
    if (!(v > 0 && Number.isFinite(v))) {
      throw new RangeError(`the ${name} must be finite and > 0, got ${v}`);
    }
  }
  const share = Math.min(0.5, Math.max(-1, 1 - targetM / altitudeM));
  return share === 0 ? 0 : -share / WHEEL_SHARE_PER_DELTA_Y;
}
