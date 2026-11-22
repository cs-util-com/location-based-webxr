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
 * 6 and remains deferred. The `'mature-alignment'` start-up (owner decision
 * D33) fixes the point through the first mature alignment instead of a
 * median of samples.
 */
import * as THREE from 'three';
import {
  calcRelativeCoordsInMeters,
  type LatLong,
  type LatLongAlt,
} from '../core/index.js';
import {
  DEFERRED_ANCHOR_EPSILON_M,
  joinAnchorSet,
  type AnchorSetMembership,
} from '../ar/deferred-anchors.js';
import type { ArParentTarget } from '../ar/ar-parent-target.js';
import { nueToArLocal, worldNueToGps } from './frame-conversions.js';
import { interpolatingMedian } from '../utils/median.js';
import {
  advanceMatureAlignmentPick,
  checkMatureGpsExtentM,
  isUsableAlignment,
  openMatureAlignmentPick,
  type AlignmentMoment,
  type MatureAlignmentPick,
} from '../state/alignment-maturity.js';

export type GpsAnchorMode = 'snap-when-offscreen' | 'snap-every-tick';
export type GpsAnchorPhase = 'bootstrap' | 'anchored';
/**
 * How the anchor's GPS point is first fixed (the `'bootstrap'` phase):
 * - `'median'` (the default): the per-coordinate median of
 *   `secondsToAccumulateGpsPose` 1 Hz samples (`getCurrentGpsPoint`, or the
 *   object through the CURRENT alignment);
 * - `'mature-alignment'` (owner decision D33): the object through the FIRST
 *   MATURE alignment at or after its placement - the first whose session GPS
 *   extent (`getGpsExtentM`) reaches `matureGpsExtentM`
 *   (`state/alignment-maturity.ts`) - so SLAM drift walked after that never
 *   reaches it; `settleNow()` fixes it through the latest usable alignment
 *   when the session ends first.
 */
export type GpsAnchorStartup = 'median' | 'mature-alignment';

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
  /** See {@link GpsAnchorStartup}. Default `'median'`. */
  readonly startup?: GpsAnchorStartup;
  /**
   * The session's GPS extent (m) now (`state/gps-extent-tracker.ts`), or
   * null when unknown (never mature). Required by the `'mature-alignment'`
   * start-up, ignored otherwise.
   */
  readonly getGpsExtentM?: () => number | null;
  /** The maturity floor (m) of the `'mature-alignment'` start-up; default
   *  `MATURE_GPS_EXTENT_M` (40). Positive and finite. */
  readonly matureGpsExtentM?: number;
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
  /**
   * `'mature-alignment'` start-up only: fix the GPS point NOW, through the
   * latest usable alignment the anchor has followed since the placement -
   * the fallback when the session ends before the alignment matured. Fires
   * `onBootstrapComplete` like a mature fix.
   *
   * @returns the committed point, or null when nothing was committed (the
   *   point is already fixed, the start-up is `'median'`, or no usable
   *   alignment was ever seen).
   */
  settleNow(): LatLong | LatLongAlt | null;
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

/** The other direction: `object` holds an anchored descendant. */
function holdsAnchoredObject(object: THREE.Object3D): boolean {
  let found = false;
  object.traverse((o) => {
    if (o !== object && anchoredObjects.has(o)) found = true;
  });
  return found;
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

/** The start-up and, for `'mature-alignment'`, its floor (0 otherwise).
 *  Checked before the object is registered, so a refusal leaves nothing
 *  behind. */
function startupOf(options: GpsAnchorOptions): {
  startup: GpsAnchorStartup;
  matureFloorM: number;
} {
  const startup = options.startup ?? 'median';
  if (startup === 'median') return { startup, matureFloorM: 0 };
  return { startup, matureFloorM: checkMatureStartup(options) };
}

/** The `'mature-alignment'` start-up's own requirements; its floor. */
function checkMatureStartup(options: GpsAnchorOptions): number {
  if (options.getGpsExtentM === undefined) {
    throw new Error(
      "createGpsAnchor: the 'mature-alignment' start-up needs getGpsExtentM " +
        '(the session GPS extent decides when the alignment is mature).'
    );
  }
  if (options.skipBootstrap === true) {
    throw new Error(
      "createGpsAnchor: skipBootstrap skips the start-up, so it cannot be combined with the 'mature-alignment' start-up."
    );
  }
  return checkMatureGpsExtentM(options.matureGpsExtentM);
}

/** What an alignment moment is read from: the alignment matrix, the zero
 *  and the session GPS extent, as the anchor's getters return them. */
type MomentInputs = readonly [
  readonly number[] | null,
  LatLong | null,
  number | null,
];

function readMomentInputs(options: GpsAnchorOptions): MomentInputs {
  return [
    options.getAlignmentMatrix() ?? null,
    options.getGpsZeroRef() ?? null,
    options.getGpsExtentM?.() ?? null,
  ];
}

function sameMomentInputs(a: MomentInputs | null, b: MomentInputs): boolean {
  return a !== null && a[0] === b[0] && a[1] === b[1] && Object.is(a[2], b[2]);
}

/** The moment, with a COPY of the matrix: a pick must keep this alignment
 *  even if the caller's array is reused. */
function momentOf([matrix, zero, extent]: MomentInputs): AlignmentMoment {
  return {
    alignmentMatrix: matrix === null ? null : Array.from(matrix),
    zero,
    ...(extent === null ? {} : { gpsExtentM: extent }),
  };
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

/** Throws for an object inside, or holding, an anchored object. */
function assertNotNested(object: THREE.Object3D): void {
  if (isObjectInAnchoredChain(object)) {
    throw new Error(
      'createGpsAnchor: nested GpsAnchors are not supported — ' +
        'the supplied object3D is already inside an anchored parent chain.'
    );
  }
  if (holdsAnchoredObject(object)) {
    throw new Error(
      'createGpsAnchor: nested GpsAnchors are not supported: ' +
        'the supplied object3D holds an anchored descendant.'
    );
  }
}

export function createGpsAnchor(options: GpsAnchorOptions): GpsAnchor {
  assertNotNested(options.object3D);
  if (!isDescendantOf(options.object3D, options.arWorldGroup)) {
    throw new Error(
      'createGpsAnchor: object3D must be a descendant of arWorldGroup ' +
        '(the alignment-bearing node the camera lives under); parenting an ' +
        'anchor to the scene root defeats AR stability.'
    );
  }
  const { startup, matureFloorM } = startupOf(options);
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

  // The `'mature-alignment'` start-up: the alignment as it stands now, and
  // the pick that follows it from the placement until it matures
  // (`state/alignment-maturity.ts`). Re-read only when one of its three
  // inputs changed, so a waiting anchor allocates nothing per frame.
  let lastMomentInputs: MomentInputs | null = null;
  /** The alignment moment now, or null when nothing changed since the last
   *  read. */
  const alignmentNow = (): AlignmentMoment | null => {
    const inputs = readMomentInputs(options);
    if (sameMomentInputs(lastMomentInputs, inputs)) return null;
    lastMomentInputs = inputs;
    return momentOf(inputs);
  };
  const openPick = (): MatureAlignmentPick<AlignmentMoment> | null => {
    if (startup !== 'mature-alignment') return null;
    lastMomentInputs = null;
    const now = alignmentNow();
    return now === null ? null : openMatureAlignmentPick(now, matureFloorM);
  };
  let maturePick = openPick();
  const scratchFix = new THREE.Vector3();
  const scratchAlignment = new THREE.Matrix4();

  const enterBootstrap = (): void => {
    phase = 'bootstrap';
    isFullyAnchored = false;
    phaseEnteredAtElapsed = null;
    lastSampleAtElapsed = null;
    samples.length = 0;
  };

  /** Fix the point: the object's position in `arWorldGroup`'s frame (raw
   *  odometry NUE, whatever the group's matrix is now) through the
   *  picked alignment, as GPS. */
  const commitThrough = (moment: AlignmentMoment): void => {
    const { alignmentMatrix, zero } = moment;
    if (alignmentMatrix === null || zero === null) return;
    options.arWorldGroup.updateWorldMatrix(true, false);
    options.object3D.getWorldPosition(scratchFix);
    options.arWorldGroup.worldToLocal(scratchFix);
    scratchFix.applyMatrix4(scratchAlignment.fromArray(alignmentMatrix));
    gpsPoint = worldNueToGps(scratchFix, zero);
    phase = 'anchored';
    isFullyAnchored = true;
    options.onBootstrapComplete?.(gpsPoint);
  };

  /** One frame of the `'mature-alignment'` start-up; true when it fixed
   *  the point. */
  const followMaturity = (): boolean => {
    const now = alignmentNow();
    if (now !== null) {
      maturePick =
        maturePick === null
          ? openMatureAlignmentPick(now, matureFloorM)
          : advanceMatureAlignmentPick(maturePick, now, matureFloorM);
    }
    if (maturePick?.mature !== true) return false;
    commitThrough(maturePick.alignment);
    return true;
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
   * AR-local frame via the inverse of the group's alignment target, write
   * it into `into` and return the distance-scaled threshold. The anchor set
   * (`ar/deferred-anchors.ts`) commits it to `object3D.position` once the
   * delta reaches the threshold AND its gate allows it.
   *
   * Gate (`'snap-when-offscreen'`): the set holds a correction while any
   * part of the object is in view, at its current pose (this and the
   * previous frame) or at the target pose, and lands it once none is,
   * confirmed by a fresh traversal. A code-lock release lands it at once,
   * and a frame switch (an odometry epoch change) lets it land in view while
   * the set's window is open. The whole AR frame rides one
   * `arWorldGroup.matrix` (`enableArWorldGroupAlignment`), so an alignment
   * change moves the whole view together in one frame and needs no
   * per-anchor on-screen snap. The one view-gate exception besides those
   * events is the first placement of a `skipBootstrap` anchor (see
   * `firstCommitPending`), which must escape the origin even while
   * on-screen. `'snap-every-tick'` is never gated by the view. See
   * `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-06-1210-anchor-starter-cachehit-jump-investigation.md`.
   *
   * Frame note: `arWorldGroup.matrix` carries the alignment target T, which
   * maps **AR-odometry NUE → GPS-world NUE**. `object3D.position` is a
   * *local* transform in that AR-odometry frame. To make the object's
   * *world* position equal the GPS-world `nue`, the local target must be
   * `T⁻¹ · nue`; writing raw `nue` would double-apply the alignment (world
   * = `T · nue`). Under a binding (`enableArWorldGroupAlignment`) T is read
   * from the binding, so a T that differs from the caller's alignment (the
   * dev world jump) is solved with the same value the group carries;
   * without one, the caller's `getAlignmentMatrix` is T. See
   * `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-gps-anchor-alignment-frame-bug.md`.
   *
   * Returns null on missing inputs (no `zeroRef`, or no alignment matrix
   * yet from the caller: an AR-local object cannot be placed without
   * knowing the AR↔NUE transform).
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

  /** The local target of `gpsPoint` under `alignment`, into `scratchTarget`. */
  const refreshTarget = (zero: LatLong, alignment: readonly number[]): void => {
    const targetAlt =
      'altitude' in gpsPoint && typeof gpsPoint.altitude === 'number'
        ? gpsPoint.altitude
        : 0;
    const nue = calcRelativeCoordsInMeters(zero, gpsPoint, targetAlt, 0);
    // GPS-world NUE → AR-local: `alignment⁻¹ · nue`. Centralised in
    // `nueToArLocal` so the frame conversion has one tested home (see its
    // sidecar). Writes into the reused `scratchTarget` to avoid per-tick
    // allocation.
    nueToArLocal(alignment, [nue[0], nue[1], nue[2]], scratchTarget);
  };

  const steadyTarget = (
    source: ArParentTarget | null,
    into: THREE.Vector3
  ): number | null => {
    const zero = options.getGpsZeroRef();
    if (zero === null || zero === undefined) return null;
    const currentAlignment = options.getAlignmentMatrix();

    // Without an alignment matrix we cannot map the GPS-world NUE target
    // into `arWorldGroup`'s AR-local frame. Skip the commit and leave the
    // object at its last local pose until an alignment exists. (Previously
    // this path committed raw NUE, which placed the object in the wrong
    // frame — see the alignment-frame bug doc referenced above.)
    if (currentAlignment === null || currentAlignment === undefined) {
      return null;
    }
    // The binding's T changes exactly when its version does.
    const alignmentRef = source === null ? currentAlignment : source.version();

    if (
      zero !== lastTargetZeroRef ||
      alignmentRef !== lastTargetAlignmentRef ||
      gpsPoint !== lastTargetGpsPointRef
    ) {
      refreshTarget(
        zero,
        source === null ? currentAlignment : source.target().elements
      );
      lastTargetZeroRef = zero;
      lastTargetAlignmentRef = alignmentRef;
      lastTargetGpsPointRef = gpsPoint;
    }
    into.copy(scratchTarget);

    // Distance-scaled threshold: `scale = 1 + 10 × distanceFromCamera/100`.
    // Each accepted commit snaps the object instantly to the target; the
    // alignment itself is applied once, at `arWorldGroup`, so a commit here
    // is only the residual of this anchor's own GPS point.
    options.camera.getWorldPosition(scratchCamWorld);
    options.object3D.getWorldPosition(scratchObjWorld);
    const distFromCamera = scratchCamWorld.distanceTo(scratchObjWorld);
    const threshold = distanceThreshold * (1 + (10 * distFromCamera) / 100);
    // An object that starts within its threshold of the target (a cached
    // pose) is placed already: the first-placement exemption ends here, so
    // its first real correction is gated like any other. The same rule as
    // the set's "not pending".
    const delta = options.object3D.position.distanceTo(into);
    if (delta < threshold || delta <= DEFERRED_ANCHOR_EPSILON_M) {
      firstCommitPending = false;
    }
    return threshold;
  };

  /** One frame: the bootstrap, or the steady-state target and threshold.
   *  A bootstrap frame has no target, so it never also commits. */
  const step = (
    elapsed: number,
    source: ArParentTarget | null,
    into: THREE.Vector3
  ): number | null => {
    if (phase === 'anchored') return steadyTarget(source, into);
    if (startup === 'mature-alignment') {
      followMaturity();
      return null;
    }
    if (phaseEnteredAtElapsed === null) {
      phaseEnteredAtElapsed = elapsed;
      lastSampleAtElapsed = elapsed - 1; // allow a sample on the next tick if no settling
    }
    // Settling window: ignore samples until it elapses.
    if (elapsed - phaseEnteredAtElapsed < settlingSeconds) return null;
    // Sample at most once per second.
    if (lastSampleAtElapsed !== null && elapsed - lastSampleAtElapsed < 1)
      return null;
    const sample = getCurrentGpsPoint();
    if (sample === null || sample === undefined) return null;
    samples.push(sample);
    lastSampleAtElapsed = elapsed;
    if (samples.length >= sampleCount) {
      commitMedian();
    }
    return null;
  };

  // The anchor set of `arWorldGroup` runs `step` once per frame and lands
  // the target: `'snap-every-tick'` and the first placement are not gated
  // by the view; every other commit is the set's.
  let membership: AnchorSetMembership;
  try {
    membership = joinAnchorSet(options.arWorldGroup, {
      object: options.object3D,
      camera: options.camera,
      step: (_dt, elapsed, source, into) => step(elapsed, source, into),
      ungated: () => {
        if (mode === 'snap-every-tick') return 'every-tick';
        return firstCommitPending ? 'first' : null;
      },
      placed: () => {
        firstCommitPending = false;
      },
    });
  } catch (error) {
    anchoredObjects.delete(options.object3D);
    throw error;
  }

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
      // A move is a new placement: the pick starts again from now.
      maturePick = openPick();
    },
    setGpsPoint(point: LatLong | LatLongAlt): void {
      gpsPoint = point;
    },
    settleNow(): LatLong | LatLongAlt | null {
      if (startup !== 'mature-alignment' || phase !== 'bootstrap') return null;
      if (followMaturity()) return gpsPoint;
      if (maturePick === null || !isUsableAlignment(maturePick.alignment)) {
        return null;
      }
      commitThrough(maturePick.alignment);
      return gpsPoint;
    },
    dispose(): void {
      membership.leave();
      anchoredObjects.delete(options.object3D);
    },
    __tickForTests(dt: number, elapsed: number): void {
      membership.runPassForTests(options.camera, dt, elapsed);
    },
  };
}
