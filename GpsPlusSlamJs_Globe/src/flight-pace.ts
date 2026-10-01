/**
 * The fly-in's clock, paced by the OSM prefetch (round-5 plan
 * 2026-10-01-0945 §3.6, DEC-GL5-6). The owner: slow while the data loads,
 * quick when it is already stored, and never longer than the cap. Pure:
 * the previous state, the prefetch's progress and the elapsed time in; the
 * path fraction `s` (0 to 1) and its rate out. The flight's own pose
 * function maps `s` to the camera, eases its ends, and owns the path.
 *
 * WHY IT TAKES THE PREVIOUS STATE. The progress arrives in steps (a 21 MB
 * Overpass tile is one signal), and any pure function of (progress,
 * elapsed) alone jumps its speed with them, which is what the plan forbids.
 * So the rate approaches its target with a first-order lag of
 * `smoothingMs`, integrated exactly over each frame (frame-rate
 * independent), and that lag is state.
 *
 * THE CONTRACT, each part a property test:
 * - the target rate runs from the cold pace (the whole path over `capMs`)
 *   at progress 0 to the warm pace (over `minMs`) at progress 1, linear in
 *   the ratcheted progress;
 * - the rate starts at the cold pace (before the first signal) and never
 *   leaves [cold, warm], so the flight never ends before `minMs` and always
 *   ends by `capMs` (the cold pace alone gets there);
 * - one frame of `dt` moves the rate by at most
 *   (warm - cold) x (1 - e^(-dt / smoothingMs));
 * - a progress value acts from the frame AFTER the one that reports it
 *   (causal, and what makes two frame rates agree).
 *
 * @see flight-pace.ts.md
 */

export interface FlightPaceParams {
  /** The flight with the data already warm, ms: the shortest it can be. */
  readonly minMs: number;
  /** The cap (DEC-GL5-6): the flight ends by then whatever the data, ms. */
  readonly capMs: number;
  /** The rate's lag behind its target, ms (the time constant). */
  readonly smoothingMs: number;
}

/**
 * The defaults. `capMs` is DEC-GL5-6's 30 s. `minMs` 8 s is about half
 * today's fixed 15 s dive (`GLOBE_DIVE.durationMs`): a second visit reads
 * as quick without becoming a cut. `smoothingMs` 800 ms: a tile landing
 * reaches 63 % of its speed change in 0.8 s (about 2 % per 60 Hz frame),
 * and a warm flight costs 0.6 s over `minMs`. Any positive lag keeps the
 * contract; the value is a feel, swept 250-3,000 ms in the round-5 results
 * (2026-10-01 globe-arrival-prefetch results).
 */
export const FLIGHT_PACE_DEFAULTS: FlightPaceParams = {
  minMs: 8_000,
  capMs: 30_000,
  smoothingMs: 800,
};

/** One instant of the flight clock. */
export interface FlightPaceState {
  /** The path fraction, 0 to 1. */
  readonly s: number;
  /** ds/dt, per millisecond. */
  readonly rate: number;
  /** The elapsed time this state is at, ms. */
  readonly elapsedMs: number;
  /** The highest progress seen so far, clamped to [0, 1]. */
  readonly progress: number;
  /** Whether the path has been flown (s is 1). */
  readonly done: boolean;
}

function requireParams(params: FlightPaceParams): void {
  const { minMs, capMs, smoothingMs } = params;
  if (!(Number.isFinite(minMs) && minMs > 0)) {
    throw new RangeError(`minMs must be a positive number, got ${minMs}`);
  }
  if (!(Number.isFinite(capMs) && capMs > minMs)) {
    throw new RangeError(
      `capMs must be a finite number above minMs (${minMs}), got ${capMs}`,
    );
  }
  if (!(Number.isFinite(smoothingMs) && smoothingMs > 0)) {
    throw new RangeError(
      `smoothingMs must be a positive number, got ${smoothingMs}`,
    );
  }
}

/** Progress as the clock reads it: NaN and anything outside are clamped. */
function clampProgress(progress: number): number {
  if (!(progress > 0)) return 0;
  return progress >= 1 ? 1 : progress;
}

/**
 * The rate the clock steers towards at a given progress, per ms: linear
 * from the cold pace (1 / capMs) to the warm pace (1 / minMs).
 */
export function paceTargetRate(
  progress: number,
  params: FlightPaceParams,
): number {
  const cold = 1 / params.capMs;
  const warm = 1 / params.minMs;
  return cold + (warm - cold) * clampProgress(progress);
}

/** The clock at 0 ms: nothing flown, the cold pace, no signal yet. */
export function startPace(params: FlightPaceParams): FlightPaceState {
  requireParams(params);
  return {
    s: 0,
    rate: 1 / params.capMs,
    elapsedMs: 0,
    progress: 0,
    done: false,
  };
}

/**
 * The clock at `elapsedMs`, from the previous state. The frame since the
 * previous state is flown towards the target of the progress known THEN;
 * `progress` (this frame's reading) is ratcheted in for the next frame.
 * Time that does not advance (or runs back) moves nothing.
 */
export function stepPace(
  state: FlightPaceState,
  progress: number,
  elapsedMs: number,
  params: FlightPaceParams,
): FlightPaceState {
  requireParams(params);
  const seen = Math.max(state.progress, clampProgress(progress));
  if (state.done) return { ...state, progress: seen };
  const dt = elapsedMs - state.elapsedMs;
  if (!(dt > 0)) return { ...state, progress: seen };

  // Exact for a target held over the frame: the rate decays towards it,
  // and s gains the integral of that decay.
  const target = paceTargetRate(state.progress, params);
  const tau = params.smoothingMs;
  const decay = Math.exp(-dt / tau);
  const rate = target + (state.rate - target) * decay;
  const s = state.s + target * dt + (state.rate - target) * tau * (1 - decay);

  // The cap is a promise, not only a consequence of the arithmetic: the
  // cold pace alone reaches s = 1 at capMs, and rounding must not leave
  // the camera a hair short of the end.
  const done = s >= 1 || elapsedMs >= params.capMs;
  return {
    s: done ? 1 : s,
    rate,
    elapsedMs,
    progress: seen,
    done,
  };
}
