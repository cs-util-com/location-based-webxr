/**
 * The look presets' glide (round-3 plan 2026-09-27-0532, feedback 1): the
 * sun and the look move to a preset's values over GLIDE_MS instead of
 * jumping, so the owner can step through the modes.
 *
 * Pure (no three, no DOM, no clock of its own): the page passes the time in,
 * which is what lets a test pin it, and passes the easing in, so the page's
 * curve is OsmDemo's one `smoothstep` rather than a copy. See
 * preset-glide.js.md.
 */

/** The glide's length (the owner's "about 5 s", round-3 plan §2). */
export const GLIDE_MS = 5000;

/** The page's state keys a preset sets, in the order the page lists them. */
const LOOK_KEYS = [
  "elevation",
  "azimuth",
  "visibility",
  "exposureEv",
  "clouds",
];

/** A framework `LookPreset` as the page's state keys. */
export function presetLook(preset) {
  return {
    elevation: preset.sunElevationDeg,
    azimuth: preset.sunAzimuthDeg,
    visibility: preset.visibilityKm,
    exposureEv: preset.exposureEv,
    clouds: preset.cloudCover,
  };
}

/**
 * The signed turn from `fromDeg` to `toDeg` the short way round, in
 * (-180, 180]; exactly opposite directions turn +180.
 */
export function shortestArcDeg(fromDeg, toDeg) {
  const turn = (((toDeg - fromDeg) % 360) + 360) % 360;
  return turn > 180 ? turn - 360 : turn;
}

function checkLook(look, name) {
  for (const key of LOOK_KEYS) {
    if (!Number.isFinite(look?.[key])) {
      throw new RangeError(`${name}.${key} must be finite, got ${look?.[key]}`);
    }
  }
  if (!(look.visibility > 0)) {
    throw new RangeError(`${name}.visibility must be positive`);
  }
}

/**
 * The look a fraction `s` (0..1, already eased) of the way from `from` to
 * `to`. The azimuth turns the short way and stays in [0, 360); the
 * visibility moves evenly on the slider's log scale (a geometric mean at
 * half-way); the other values move linearly.
 *
 * @throws RangeError for a non-finite value, a visibility <= 0, or a
 *   non-finite `s`.
 */
export function lerpLook(from, to, s) {
  checkLook(from, "from");
  checkLook(to, "to");
  if (!Number.isFinite(s)) throw new RangeError(`s must be finite, got ${s}`);
  const mix = (a, b) => a + (b - a) * s;
  const azimuth = from.azimuth + shortestArcDeg(from.azimuth, to.azimuth) * s;
  return {
    elevation: mix(from.elevation, to.elevation),
    azimuth: ((azimuth % 360) + 360) % 360,
    // A power, not exp(log): s = 0 gives the start exactly (x * 1).
    visibility: from.visibility * (to.visibility / from.visibility) ** s,
    exposureEv: mix(from.exposureEv, to.exposureEv),
    clouds: mix(from.clouds, to.clouds),
  };
}

/**
 * A glide controller. `start` begins (or retargets) a glide; the page calls
 * `tick(nowMs)` once per animation frame and applies what it returns.
 *
 * - `ease(t)`: the easing curve on [0, 1] (required).
 * - `durationMs`: default GLIDE_MS.
 * - `rebuildEvery`: the sky is rebuilt on every k-th frame of a glide (the
 *   first frame of a glide, and its last, always rebuild).
 *
 * @throws TypeError without an easing; RangeError for a duration <= 0 or a
 *   `rebuildEvery` that is not a positive integer.
 */
export function createPresetGlide({
  ease,
  durationMs = GLIDE_MS,
  rebuildEvery = 1,
} = {}) {
  if (typeof ease !== "function") {
    throw new TypeError("the glide needs an easing function");
  }
  if (!(Number.isFinite(durationMs) && durationMs > 0)) {
    throw new RangeError(`durationMs must be positive, got ${durationMs}`);
  }
  if (!(Number.isInteger(rebuildEvery) && rebuildEvery >= 1)) {
    throw new RangeError(
      `rebuildEvery must be a positive integer, got ${rebuildEvery}`,
    );
  }
  /** { from, to, id, startMs, frames } while gliding, else null. */
  let run = null;

  return {
    /**
     * Glide from `from` (the look the scene shows NOW: a retarget starts
     * here, not at the old start) to `to`, named `id`, starting at `nowMs`.
     * Validates before any change: a refused start leaves the old state.
     */
    start({ from, to, id, nowMs }) {
      checkLook(from, "from");
      checkLook(to, "to");
      if (!Number.isFinite(nowMs)) {
        throw new RangeError(`nowMs must be finite, got ${nowMs}`);
      }
      run = { from: { ...from }, to: { ...to }, id, startMs: nowMs, frames: 0 };
    },
    /**
     * One frame: null while idle, else `{ look, done, rebuild, id, t }`.
     * `rebuild` says whether the page should apply `look` on this frame;
     * the frame that reaches the end returns the target itself (a copy, not
     * an interpolation) with `done` and `rebuild` set, and the glide stops.
     */
    tick(nowMs) {
      if (!Number.isFinite(nowMs)) {
        throw new RangeError(`nowMs must be finite, got ${nowMs}`);
      }
      if (!run) return null;
      const t = Math.min(1, Math.max(0, (nowMs - run.startMs) / durationMs));
      const { id } = run;
      if (t >= 1) {
        const look = { ...run.to };
        run = null;
        return { look, done: true, rebuild: true, id, t };
      }
      const rebuild = run.frames % rebuildEvery === 0;
      run.frames += 1;
      const look = lerpLook(run.from, run.to, ease(t));
      return { look, done: false, rebuild, id, t };
    },
    /** Stop without applying anything (a manual change or a link won). */
    cancel() {
      run = null;
    },
    get active() {
      return run !== null;
    },
    /** The target's id while gliding, else null. */
    get id() {
      return run ? run.id : null;
    },
    /** The rebuild interval it was built with, frames. */
    get rebuildEvery() {
      return rebuildEvery;
    },
  };
}
