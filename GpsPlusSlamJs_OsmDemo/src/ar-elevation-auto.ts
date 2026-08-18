/**
 * The automatic elevation offset: AR-measured floor vs the DEM, composed
 * with the fused vertical baseline, published for the manual nudge's channel.
 *
 * **WHAT IT MEASURES.** The framework's floor estimator reads the occupancy
 * grid in the raw AR frame; each floor hit is paired with the DEM height at
 * the hit's OWN horizontal position (slope-correct sampling — on a hillside
 * "the floor height" is position-dependent), and the baseline-free delta
 * `hitYar − (DEM + N)` streams into the framework's elevation-offset
 * estimator. The published value re-adds the live baseline:
 *
 * ```
 * autoM = baselineY + robust(hitYar − terrain)   // baselineY = matrix[13]
 * ```
 *
 * **THE SIGN** is owned by the dedicated sign test in
 * `ar-elevation-auto.test.ts` (this feature's `fieldMatchesArDatum`): a
 * measured floor ABOVE the DEM surface yields a positive offset and the city
 * RISES to meet it.
 *
 * **THE BASELINE IS RE-ADDED AT READ TIME, NEVER SMOOTHED** (plan §2.3): a
 * baseline jump — one new GPS fix re-owning the vertical solve — moves the
 * camera instantly, and the content must move WITH it or the city visibly
 * teleports and then heals over half a window. Only the slow, physical
 * floor-vs-DEM disagreement goes through the estimator.
 *
 * **TWO SMOOTHING STAGES, WITH DISJOINT JOBS** (cold-review F4 revised the
 * earlier one-stage rule). The estimator's slew limiter (0.5 m/s on the
 * baseline-free component) shapes the SIGNAL between ticks — but it cannot
 * touch the cold-start FIRST value or the re-added baseline, both of which
 * reach this module's output as steps. `ar-mode.ts` therefore eases the
 * APPLIED value toward the composed target at a bounded rate
 * (`AUTO_APPLY_RATE_M_PER_S`), so no published step ever moves the content
 * in one frame; the manual trim stays instant (owner-driven, DEC-E1).
 *
 * **NO EXTRA GEOID TERM.** In AR the demo's terrain field is sampled with
 * `absoluteDatum = −N` (see `absoluteDatumFor`), so `heightAt` already
 * returns ELLIPSOIDAL DEM+N — the same datum the scene's y = 0 and the
 * baseline live in. The injected sampler is expected to be gated on exactly
 * that (`terrainReadout` / `fieldMatchesArDatum`) and to answer `undefined`
 * otherwise; an ungated relief-datum sample would be wrong by the whole
 * ellipsoidal height.
 *
 * **VERTICAL FRAME-INVARIANCE ASSUMPTION**: `hitYar` is used directly as the
 * baseline-free vertical, which holds iff the alignment rotation is yaw-only
 * and unscaled — true under `DefaultAlignmentConfig` and pinned by the
 * framework's own M1 tests (invariance property + config-default assertion).
 *
 * @see ar-elevation-auto.ts.md
 */

// DEEP SUBPATHS, NOT THE `/ar` BARREL — same two reasons as
// `ar-depth-pipeline.ts`: the barrel is mocked wholesale in `ar-mode.test.ts`
// and this module must keep the REAL estimators there.
import { estimateFloor } from "gps-plus-slam-app-framework/ar/floor-estimator";
import {
  createElevationOffsetEstimator,
  type ElevationOffsetSample,
} from "gps-plus-slam-app-framework/ar/elevation-offset-estimator";
import type { OccupancyGrid } from "gps-plus-slam-app-framework/ar/occupancy-grid";

/** The URL parameter of the kill switch (plan §2.6 — field A/B on the spot). */
const AUTO_ELEVATION_PARAM = "autoElevation";

/**
 * Whether the auto offset is enabled for this entry, from the URL.
 *
 * ON unless explicitly switched off (`?autoElevation=off|0|false`): the kill
 * switch exists so a misbehaving estimator can be silenced in the field, and
 * an unrecognised value must not silently disable the feature being tested.
 */
export function autoElevationEnabled(search: string): boolean {
  const value = new URLSearchParams(search).get(AUTO_ELEVATION_PARAM);
  if (value === null) return true;
  const v = value.trim().toLowerCase();
  return v !== "off" && v !== "0" && v !== "false";
}

/**
 * The estimator tick cadence, ms. ~1 Hz: the C#/Unity precedent ran its floor
 * raycasts at 2000 ms after abandoning plane detection for perf, and the
 * framework estimator's window arithmetic (45 s / 20 m) was corpus-tuned at
 * this cadence. The caller invokes {@link ArElevationAuto.sample} per frame;
 * the throttle lives HERE so the cadence has one owner and is testable.
 */
export const AUTO_TICK_INTERVAL_MS = 1000;

/** A point in the demo's anchor ENU — the shape `heightAt` takes. */
export interface AnchorEnuPoint {
  /** Metres east of the scene anchor. */
  readonly x: number;
  /** Metres north of the scene anchor. */
  readonly y: number;
}

/** A point in the scene's GPS-world NUE frame (about the framework's zero). */
export interface SceneNuePoint {
  readonly north: number;
  readonly up: number;
  readonly east: number;
}

/**
 * A raw-WebXR point through the alignment, into the scene's NUE frame.
 *
 * Two steps, both easy to get backwards and both stated: raw WebXR is
 * X=East, Y=Up, Z=South, so the odometry-NUE form is `(−z, y, x)`; the
 * alignment matrix (column-major, as `arWorldGroup.matrix.elements`) then
 * maps odometry NUE → GPS-world NUE — the same composition the framework
 * applies to the camera. Answers `undefined` for any non-finite input, so a
 * tracking glitch degrades to "no sample" rather than a NaN in the window.
 */
export function arPointToSceneNue(
  alignment: ArrayLike<number>,
  arPoint: readonly [number, number, number],
): SceneNuePoint | undefined {
  const el = (i: number): number => {
    const v = alignment[i];
    return typeof v === "number" ? v : Number.NaN;
  };
  const n = -arPoint[2];
  const u = arPoint[1];
  const e = arPoint[0];
  const north = el(0) * n + el(4) * u + el(8) * e + el(12);
  const up = el(1) * n + el(5) * u + el(9) * e + el(13);
  const east = el(2) * n + el(6) * u + el(10) * e + el(14);
  if (
    !Number.isFinite(north) ||
    !Number.isFinite(up) ||
    !Number.isFinite(east)
  ) {
    return undefined;
  }
  return { north, up, east };
}

/**
 * The one composition of the applied offset: `auto + manual trim`, with a
 * null auto contributing ZERO — the kill-switch/cold-start contract that the
 * manual nudge behaves exactly as it did before this feature existed.
 */
export function composeElevationM(
  autoM: number | null,
  manualTrimM: number,
): number {
  return (autoM ?? 0) + manualTrimM;
}

export interface ArElevationAutoState {
  /**
   * The full auto offset for the nudge channel (baseline re-added), or null
   * when nothing can honestly be published — cold estimator (never had a
   * value, or `reset()` after a tracking restart) or the kill switch.
   *
   * **A pose/alignment GAP is not one of those cases** (cold-review F3): a
   * tracking blip drops the pose for a frame or two, and flapping to null
   * there composes as 0 — the city jumps by the full offset and jumps back
   * when the pose returns. The physical floor-vs-DEM disagreement did not
   * change because ARCore blinked, so the last value is HELD across gaps
   * (with decaying confidence — see {@link POSE_GAP_CONFIDENCE_TAU_S});
   * only a state that never measured anything contributes 0.
   */
  readonly autoM: number | null;
  /** The estimator's confidence, [0, 1]. 0 whenever `autoM` is null. */
  readonly confidence: number;
  /** True while the freeze layer holds the offset (tower/stairs/bridge). */
  readonly frozen: boolean;
}

interface ArElevationAutoInput {
  /** Monotonic milliseconds (the frame loop's `elapsed * 1000`). */
  readonly nowMs: number;
  /** Camera position in the RAW WebXR frame, or undefined without a pose. */
  readonly cameraPosAr: readonly [number, number, number] | undefined;
  /**
   * `arWorldGroup.matrix.elements` while an alignment EXISTS, else undefined.
   * The caller owns the identity check (`ar-mode.ts` already compares against
   * the identity for `worldBaselineY`) — an identity matrix's element 13 is a
   * perfectly real 0, which is exactly the unmeasured-rendered-as-measured
   * trap this module must not fall into.
   */
  readonly alignment: ArrayLike<number> | undefined;
}

export interface ArElevationAutoOptions {
  /** The session's occupancy grid (raw-WebXR frame). */
  readonly grid: OccupancyGrid;
  /**
   * The AR-datum-gated DEM sampler: ellipsoidal DEM+N at an anchor-ENU
   * point, or undefined while no matching field is held. See the module
   * header for why the gate is the caller's (it owns the field and the
   * session undulation).
   */
  readonly terrainHeightM: (enu: AnchorEnuPoint) => number | undefined;
  /**
   * Where the scene anchor sits in the GPS-world NUE frame — the SAME
   * `sceneAnchorOffsetNue` result `ar-mode.ts` attaches the city with. The
   * DEM field is sampled about the anchor while the alignment is about
   * `zero`; subtracting this is what reconciles the two.
   */
  readonly anchorOffsetNue: { readonly north: number; readonly east: number };
}

export interface ArElevationAuto {
  /** Offer the current frame. Internally throttled to ~1 Hz; returns state. */
  sample(input: ArElevationAutoInput): ArElevationAutoState;
  /**
   * Back to a true cold start: fresh estimator, no held value, throttle
   * re-armed. For the `odometryTrackingRestarted` callback (cold-review F2):
   * the window's samples were measured in the odometry frame that just died,
   * and without this the estimator's hold branch would keep publishing a
   * dead-frame value for up to its 45 s window while the cleared grid
   * refills.
   */
  reset(): void;
}

/**
 * e-folding time of the published confidence while the pose/alignment is
 * missing (tracking blip), seconds. The VALUE is held — see the
 * `ArElevationAutoState.autoM` contract — but a held value must not keep
 * advertising its pre-gap confidence forever, so it decays at the same
 * "absence of evidence, not evidence of a problem" rate the framework
 * estimator uses for its own hold state.
 */
const POSE_GAP_CONFIDENCE_TAU_S = 10;

const AUTO_OFF: ArElevationAutoState = {
  autoM: null,
  confidence: 0,
  frozen: false,
};

/** Create the session's auto-elevation estimator. One per AR session. */
export function createArElevationAuto(
  options: ArElevationAutoOptions,
): ArElevationAuto {
  const { grid, terrainHeightM, anchorOffsetNue } = options;
  let estimator = createElevationOffsetEstimator();
  let lastTickMs = Number.NEGATIVE_INFINITY;
  let state: ArElevationAutoState = AUTO_OFF;

  /**
   * A tick with no usable pose/alignment: HOLD an established value with
   * decaying confidence (F3 — flapping to null composes as 0 and teleports
   * the city by the full offset, twice); a true cold start stays off. The
   * estimator deliberately receives no tick either way — its own window
   * keeps its hold/decay semantics for when data returns.
   */
  const holdThroughGap = (gapS: number): ArElevationAutoState => {
    if (state.autoM === null) return AUTO_OFF;
    state = {
      autoM: state.autoM,
      confidence:
        state.confidence * Math.exp(-gapS / POSE_GAP_CONFIDENCE_TAU_S),
      frozen: state.frozen,
    };
    return state;
  };

  return {
    reset(): void {
      estimator = createElevationOffsetEstimator();
      lastTickMs = Number.NEGATIVE_INFINITY;
      state = AUTO_OFF;
    },
    sample(input: ArElevationAutoInput): ArElevationAutoState {
      if (input.nowMs - lastTickMs < AUTO_TICK_INTERVAL_MS) return state;
      // Time since the last REAL tick, for the gap decay. Finite whenever a
      // value is held (holding implies a previous tick set `lastTickMs`).
      const gapS = (input.nowMs - lastTickMs) / 1000;
      lastTickMs = input.nowMs;

      const { cameraPosAr, alignment } = input;
      if (cameraPosAr === undefined || alignment === undefined) {
        return holdThroughGap(gapS);
      }
      const camNue = arPointToSceneNue(alignment, cameraPosAr);
      const baselineY = arPointToSceneNue(alignment, [0, 0, 0])?.up;
      if (camNue === undefined || baselineY === undefined) {
        return holdThroughGap(gapS);
      }

      const estimate = estimateFloor(grid, cameraPosAr);
      const samples: ElevationOffsetSample[] = [];
      if (estimate !== null) {
        for (const hit of estimate.hits) {
          const nue = arPointToSceneNue(alignment, [hit.x, hit.y, hit.z]);
          if (nue === undefined) continue;
          const enu: AnchorEnuPoint = {
            x: nue.east - anchorOffsetNue.east,
            y: nue.north - anchorOffsetNue.north,
          };
          const terrain = terrainHeightM(enu);
          if (terrain === undefined || !Number.isFinite(terrain)) continue;
          samples.push({
            // BASELINE-FREE by construction: the RAW AR height, not `nue.up`,
            // which would fold the baseline into the smoothed window — the
            // exact jump-then-slide failure §2.3 exists to cancel.
            sampleM: hit.y - terrain,
            // The estimate's own confidence, shared across its hits: the
            // per-hit population exists for slope-correct positions, not for
            // per-hit certainty the estimator cannot measure.
            confidence: estimate.confidence,
            posE: nue.east - anchorOffsetNue.east,
            posN: nue.north - anchorOffsetNue.north,
          });
        }
      }

      const est = estimator.update({
        tMs: input.nowMs,
        posE: camNue.east - anchorOffsetNue.east,
        posN: camNue.north - anchorOffsetNue.north,
        cameraYar: cameraPosAr[1],
        samples,
      });
      state =
        est.offsetM === null
          ? AUTO_OFF
          : {
              autoM: baselineY + est.offsetM,
              confidence: est.confidence,
              frozen: est.frozen,
            };
      return state;
    },
  };
}
