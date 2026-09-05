/**
 * `createGpsAnchor` — GPS-anchored placement of a single `THREE.Object3D`.
 *
 * See the colocated sidecar (`gps-anchor.ts.md`) and the port plan at
 * `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-13-gps-anchor-port-plan.md`
 * for the full design, state machine, and test matrix.
 *
 * This file implements sub-steps 2 (bootstrap phase), 3 (steady-state
 * `'snap-every-tick'` + distance-scaled threshold gate), and 4
 * (`'snap-when-offscreen'` mode gate, with a one-time initial-placement
 * exemption for `skipBootstrap` anchors). Floor-Y correction is sub-step
 * 6 and remains deferred.
 */
import * as THREE from 'three';
import {
  calcRelativeCoordsInMeters,
  type LatLong,
  type LatLongAlt,
} from '../core/index.js';
import { registerFrameUpdate } from '../ar/frame-loop.js';
import { isObjectInCameraFrustum } from './frustum-visibility.js';
import { nueToArLocal, worldNueToGps } from './frame-conversions.js';
import { interpolatingMedian } from '../utils/median.js';

export type GpsAnchorMode = 'snap-when-offscreen' | 'snap-every-tick';
export type GpsAnchorPhase = 'bootstrap' | 'anchored';

/**
 * The minimum shape needed for the bootstrap median — a `LatLong` with
 * optional altitude. Re-exported as a named alias so the sidecar and
 * tests can refer to "the kind of point the anchor samples" without
 * importing core types.
 */
export type GpsAnchorSamplePoint = LatLong | LatLongAlt;

export interface GpsAnchorOptions {
  readonly object3D: THREE.Object3D;
  readonly arWorldGroup: THREE.Object3D;
  readonly camera: THREE.Camera;
  readonly gpsPoint: LatLong | LatLongAlt;
  readonly skipBootstrap?: boolean;
  readonly getAlignmentMatrix: () => readonly number[] | null;
  readonly getGpsZeroRef: () => LatLong | null;
  /**
   * Returns the current bootstrap sample, or null to skip this tick.
   *
   * OPTIONAL since quality-review G-6: when omitted, the anchor samples the
   * OBJECT's own world pose converted to GPS via `worldNueToGps` (the
   * "object-pose" source) — pinning the anchor to the placed point, not the
   * device. This was previously hand-built (scratch vector + zero/alignment
   * guards) in every consumer and was the subtlest piece of anchor wiring:
   * re-deriving it incorrectly anchored silently wrong. Provide a custom
   * reader only when the samples should come from somewhere else (e.g. the
   * phone's GPS fix).
   */
  readonly getCurrentGpsPoint?: () => GpsAnchorSamplePoint | null;
  /**
   * Optional callback invoked whenever the bootstrap median is committed (the
   * anchor's GPS reference is (re)assigned). Receives the exact committed point
   * — the same value assigned to `gpsPoint`. Fires once after the initial
   * bootstrap and again after every re-bootstrap (`markMovedExternally` →
   * re-accumulate → commit). Never fires when `skipBootstrap` is true (there is
   * no bootstrap to complete). Lets a host persist the committed reference (e.g.
   * AnchorStarter writing `?show=`) so the persisted link equals the committed
   * reference by construction.
   */
  readonly onBootstrapComplete?: (gpsPoint: LatLong | LatLongAlt) => void;
  readonly mode?: GpsAnchorMode;
  readonly distanceThreshold?: number;
  /** Number of 1 Hz samples collected during bootstrap. Default 7. */
  readonly secondsToAccumulateGpsPose?: number;
  /** Wait window (seconds) at phase entry during which no samples are taken. Default 0. */
  readonly settlingSeconds?: number;
}

/**
 * Built-in "object-pose" bootstrap source (quality-review G-6): samples the
 * object's world pose converted to GPS. Requires a GPS-world frame — the
 * world position is GPS-world NUE only once an alignment exists (via
 * `enableArWorldGroupAlignment`), so ticks are skipped until zero AND
 * alignment are available (mirrors "no fix yet").
 */
function createObjectPoseSampler(
  options: Pick<
    GpsAnchorOptions,
    'object3D' | 'getGpsZeroRef' | 'getAlignmentMatrix'
  >
): () => GpsAnchorSamplePoint | null {
  const scratch = new THREE.Vector3();
  return () => {
    const zero = options.getGpsZeroRef();
    if (zero === null || zero === undefined) return null;
    const alignment = options.getAlignmentMatrix();
    if (alignment === null || alignment === undefined) return null;
    return worldNueToGps(options.object3D.getWorldPosition(scratch), zero);
  };
}

/** A caller-provided bootstrap reader wins; otherwise the built-in object-pose source. */
function resolveBootstrapSampler(
  options: GpsAnchorOptions
): () => GpsAnchorSamplePoint | null {
  return options.getCurrentGpsPoint ?? createObjectPoseSampler(options);
}

export interface GpsAnchor {
  readonly phase: GpsAnchorPhase;
  readonly isFullyAnchored: boolean;
  /** Current target GPS pose; during `bootstrap` this is the seed, post-bootstrap the median. */
  readonly gpsPoint: LatLong | LatLongAlt;
  markMovedExternally(): void;
  setGpsPoint(point: LatLong | LatLongAlt): void;
  dispose(): void;
  /** @internal — testing seam; exposed in lieu of pumping `runFrameUpdates`. */
  __tickForTests(dt: number, elapsed: number): void;
}

/**
 * Module-level registry of objects currently owned by a `GpsAnchor`.
 * Used to detect nested anchors (parent + child both anchored) which
 * we explicitly forbid; mirrors the C# invariant.
 */
const anchoredObjects = new WeakSet<THREE.Object3D>();

function isObjectInAnchoredChain(object: THREE.Object3D): boolean {
  let cursor: THREE.Object3D | null = object;
  while (cursor) {
    if (anchoredObjects.has(cursor)) return true;
    cursor = cursor.parent;
  }
  return false;
}

/**
 * Returns true iff `object` is `arWorldGroup` itself or a descendant of it.
 * The anchor's `object3D` MUST satisfy this: only then does it ride the
 * alignment applied to `arWorldGroup.matrix` (the node the camera also lives
 * under) via scene-graph propagation. An anchor parented to the scene root
 * instead never receives the alignment, so each steady-state re-registration
 * snaps the full alignment delta and the object visibly slides as the user
 * moves — the exact instability the anchor exists to prevent.
 *
 * **SCOPE: this is a rule about ANCHORS, not about the scene root.** The
 * failure above is caused by RE-REGISTRATION — an anchor re-solves its local
 * position from its GPS point repeatedly, and doing that outside the alignment
 * applies the whole delta each time. Content that is built ONCE in GPS-world
 * coordinates and never re-solved has no re-registration and therefore no
 * slide: it belongs on the scene root, which is the GPS-world frame. See the
 * "WHERE DO I ATTACH MY CONTENT?" block in `ar/ar-scene-hierarchy.ts`.
 *
 * Recorded because this comment has been read as "never parent GPS content to
 * the scene root", which is not what it says and would send a caller with a
 * pre-built city mesh down a much harder and wrong path.
 */
function isDescendantOf(
  object: THREE.Object3D,
  arWorldGroup: THREE.Object3D
): boolean {
  let cursor: THREE.Object3D | null = object;
  while (cursor) {
    if (cursor === arWorldGroup) return true;
    cursor = cursor.parent;
  }
  return false;
}

function medianPoint(
  samples: readonly GpsAnchorSamplePoint[]
): LatLong | LatLongAlt {
  const lat = interpolatingMedian(samples.map((s) => s.lat));
  const lon = interpolatingMedian(samples.map((s) => s.lon));
  const alts = samples
    .map((s) => ('altitude' in s ? s.altitude : undefined))
    .filter((a): a is number => typeof a === 'number');
  if (alts.length > 0) {
    return { lat, lon, altitude: interpolatingMedian(alts) };
  }
  return { lat, lon };
}

export function createGpsAnchor(options: GpsAnchorOptions): GpsAnchor {
  if (isObjectInAnchoredChain(options.object3D)) {
    throw new Error(
      'createGpsAnchor: nested GpsAnchors are not supported — ' +
        'the supplied object3D is already inside an anchored parent chain.'
    );
  }
  if (!isDescendantOf(options.object3D, options.arWorldGroup)) {
    throw new Error(
      'createGpsAnchor: object3D must be a descendant of arWorldGroup ' +
        '(the alignment-bearing node the camera lives under); parenting an ' +
        'anchor to the scene root defeats AR stability.'
    );
  }
  anchoredObjects.add(options.object3D);

  const sampleCount = options.secondsToAccumulateGpsPose ?? 7;
  if (sampleCount < 1) {
    // A sub-1 sample count would commit the bootstrap median after the
    // first received sample (best case) or never make sense at all;
    // `0` in particular implies "median of zero samples". Fail fast and
    // point the caller at the supported bypass instead of silently
    // degrading the accumulation phase.
    anchoredObjects.delete(options.object3D);
    throw new Error(
      'createGpsAnchor: secondsToAccumulateGpsPose must be >= 1 — ' +
        'use skipBootstrap:true to bypass the accumulation phase.'
    );
  }
  const settlingSeconds = options.settlingSeconds ?? 0;
  const distanceThreshold = options.distanceThreshold ?? 2;
  const mode: GpsAnchorMode = options.mode ?? 'snap-when-offscreen';

  // Scratch vectors — reused across ticks to avoid per-frame allocs.
  const scratchTarget = new THREE.Vector3();
  const getCurrentGpsPoint = resolveBootstrapSampler(options);
  const scratchCamWorld = new THREE.Vector3();
  const scratchObjWorld = new THREE.Vector3();

  let phase: GpsAnchorPhase =
    options.skipBootstrap === true ? 'anchored' : 'bootstrap';
  let isFullyAnchored = phase === 'anchored';
  let gpsPoint: LatLong | LatLongAlt = options.gpsPoint;
  let phaseEnteredAtElapsed: number | null = null;
  let lastSampleAtElapsed: number | null = null;
  const samples: GpsAnchorSamplePoint[] = [];
  /**
   * The one-time "initial placement" exemption from the `snap-when-offscreen`
   * frustum gate. A `skipBootstrap` anchor is `anchored` from frame one but its
   * `object3D` still sits at the AR origin (local 0,0,0 — "inside the user")
   * until its first steady-state commit. That first commit MUST land even while
   * the object is on-screen, otherwise the marker stays stuck at the origin
   * until the user happens to look away. A fresh appearance is not a "jump", so
   * it is exempt. Consumed (set false) by the first committed correction; never
   * re-armed (a re-bootstrap moves an already-placed object, so its later
   * corrections are normal gated snaps). Anchors that bootstrap are placed at
   * their seed pose by the host, so they never need this exemption — hence it is
   * armed only for `skipBootstrap`.
   */
  let firstCommitPending = options.skipBootstrap === true;

  const enterBootstrap = (): void => {
    phase = 'bootstrap';
    isFullyAnchored = false;
    phaseEnteredAtElapsed = null;
    lastSampleAtElapsed = null;
    samples.length = 0;
  };

  const commitMedian = (): void => {
    gpsPoint = medianPoint(samples);
    phase = 'anchored';
    isFullyAnchored = true;
    samples.length = 0;
    // Hand the host the exact committed reference so it can persist it (the
    // persisted value equals the committed `gpsPoint` by construction). Re-fires
    // after every re-bootstrap because this is the only place `gpsPoint` is
    // assigned from a median.
    options.onBootstrapComplete?.(gpsPoint);
  };

  /**
   * Steady-state: compute the GPS-world NUE target from the stored
   * `gpsPoint` and the current `zeroRef`, map it into `arWorldGroup`'s
   * AR-local frame via the inverse alignment matrix, and commit it to
   * `object3D.position` iff the (AR-local) position delta exceeds the
   * distance-scaled threshold AND the mode gate allows it.
   *
   * Mode gate: in `'snap-when-offscreen'` a correction is suppressed while the
   * object is inside the camera frustum — corrections only land when the user
   * is not looking, so the anchor never visibly jumps. The whole AR frame
   * (camera + every anchor) rides one lerped `arWorldGroup.matrix`
   * (`enableArWorldGroupAlignment`), so an on-screen alignment change is
   * absorbed smoothly for the entire view and never needs a per-anchor
   * on-screen snap. The one exception is the first placement of a `skipBootstrap`
   * anchor (see `firstCommitPending`), which must escape the origin even while
   * on-screen. See
   * `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-06-1210-anchor-starter-cachehit-jump-investigation.md`.
   *
   * Frame note: `arWorldGroup.matrix` IS the alignment matrix, which maps
   * **AR-odometry NUE → GPS-world NUE**. `object3D.position` is a *local*
   * transform in that AR-odometry frame. To make the object's *world*
   * position equal the GPS-world `nue`, the local target must be
   * `alignment⁻¹ · nue` — writing raw `nue` would double-apply the
   * alignment (world = `alignment · nue`). See
   * `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-gps-anchor-alignment-frame-bug.md`.
   *
   * Returns silently on missing inputs (no `zeroRef`, or no alignment
   * matrix yet — an AR-local object cannot be placed without knowing the
   * AR↔NUE transform).
   */
  // E-3 target cache (2026-07-10 quality review): the geo trig + 4×4
  // inversion below depend only on (zeroRef, alignmentMatrix, gpsPoint) —
  // all ~1 Hz reference identities — yet used to be recomputed every XR
  // frame per anchor. `scratchTarget` keeps the last computed AR-local
  // target while all three references are unchanged. (The declared-but-
  // never-wired `targetPosRefreshRateInSec` option was removed in favour of
  // this reference-keyed cache — no timer needed.)
  let lastTargetZeroRef: unknown = null;
  let lastTargetAlignmentRef: unknown = null;
  let lastTargetGpsPointRef: unknown = null;

  const maybeCommitSteadyState = (): void => {
    const zero = options.getGpsZeroRef();
    if (zero === null || zero === undefined) return;
    const currentAlignment = options.getAlignmentMatrix();

    // Without an alignment matrix we cannot map the GPS-world NUE target
    // into `arWorldGroup`'s AR-local frame. Skip the commit and leave the
    // object at its last local pose until an alignment exists. (Previously
    // this path committed raw NUE, which placed the object in the wrong
    // frame — see the alignment-frame bug doc referenced above.)
    if (currentAlignment === null || currentAlignment === undefined) return;

    if (
      zero !== lastTargetZeroRef ||
      currentAlignment !== lastTargetAlignmentRef ||
      gpsPoint !== lastTargetGpsPointRef
    ) {
      const targetAlt =
        'altitude' in gpsPoint && typeof gpsPoint.altitude === 'number'
          ? gpsPoint.altitude
          : 0;
      const nue = calcRelativeCoordsInMeters(zero, gpsPoint, targetAlt, 0);
      // GPS-world NUE → AR-local: `alignment⁻¹ · nue`. Centralised in
      // `nueToArLocal` so the frame conversion has one tested home (see its
      // sidecar). Writes into the reused `scratchTarget` to avoid per-tick
      // allocation.
      nueToArLocal(currentAlignment, [nue[0], nue[1], nue[2]], scratchTarget);
      lastTargetZeroRef = zero;
      lastTargetAlignmentRef = currentAlignment;
      lastTargetGpsPointRef = gpsPoint;
    }

    // Distance-scaled threshold: `scale = 1 + 10 × distanceFromCamera/100`.
    options.camera.getWorldPosition(scratchCamWorld);
    options.object3D.getWorldPosition(scratchObjWorld);
    const distFromCamera = scratchCamWorld.distanceTo(scratchObjWorld);
    const scale = 1 + (10 * distFromCamera) / 100;
    const posDelta = options.object3D.position.distanceTo(scratchTarget);

    // Commit gate: the distance-scaled threshold plus the `snap-when-offscreen`
    // frustum suppression. When the gate accepts a correction the object snaps
    // instantly to the target. Smoothing is NOT done per-anchor: alignment is
    // lerped once at `arWorldGroup` (`enableArWorldGroupAlignment`), so all
    // anchored content shifts together and each accepted commit here is only a
    // small off-screen residual. The sole on-screen exception is the one-time
    // initial placement of a `skipBootstrap` anchor (`firstCommitPending`),
    // which must escape the AR origin even while the user is looking.
    if (posDelta >= distanceThreshold * scale) {
      const blockedByMode =
        mode === 'snap-when-offscreen' &&
        !firstCommitPending &&
        isObjectInCameraFrustum(options.camera, options.object3D);
      if (!blockedByMode) {
        options.object3D.position.copy(scratchTarget);
        firstCommitPending = false;
      }
    }
  };

  const tick = (_dt: number, elapsed: number): void => {
    if (phase === 'anchored') {
      maybeCommitSteadyState();
      return;
    }
    if (phaseEnteredAtElapsed === null) {
      phaseEnteredAtElapsed = elapsed;
      lastSampleAtElapsed = elapsed - 1; // allow a sample on the next tick if no settling
    }
    // Settling window: ignore samples until it elapses.
    if (elapsed - phaseEnteredAtElapsed < settlingSeconds) return;
    // Sample at most once per second.
    if (lastSampleAtElapsed !== null && elapsed - lastSampleAtElapsed < 1)
      return;
    const sample = getCurrentGpsPoint();
    if (sample === null || sample === undefined) return;
    samples.push(sample);
    lastSampleAtElapsed = elapsed;
    if (samples.length >= sampleCount) {
      commitMedian();
    }
  };

  const unregister = registerFrameUpdate(tick);

  return {
    get phase() {
      return phase;
    },
    get isFullyAnchored() {
      return isFullyAnchored;
    },
    get gpsPoint() {
      return gpsPoint;
    },
    markMovedExternally(): void {
      enterBootstrap();
    },
    setGpsPoint(point: LatLong | LatLongAlt): void {
      gpsPoint = point;
    },
    dispose(): void {
      unregister();
      anchoredObjects.delete(options.object3D);
    },
    __tickForTests(dt: number, elapsed: number): void {
      tick(dt, elapsed);
    },
  };
}
