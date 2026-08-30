/**
 * The capture-time geo join (plan `2026-08-26-1130-capture-time-geo-join`,
 * Revision 2): turn a REPLAYED recording state into world poses for every
 * captured photo, so the AR view places each photo where it was taken
 * instead of ringing them around the QR code.
 *
 * Pure decision + transform layer — no DOM, no three scene, no fetching.
 * The caller replays the tour zip (`replayRecording` over the streaming
 * ByteSource) and hands this module the result plus the action-type list;
 * this module decides whether the join is TRUSTWORTHY (every decline
 * reason falls back to the existing ring) and computes the poses.
 *
 * FRAME CONTRACT: inputs are the REPLAYED STATE (NUE — the reducer
 * converted raw WebXR action payloads on dispatch); outputs are geo
 * (lat/lon/ABSOLUTE altitude, `fusedGpsFromOdom`'s contract) plus a
 * world-NUE rotation (`alignmentRotation ∘ captureRotation`). The images
 * form a rigid constellation in SLAM space: the whole set shares the
 * final alignment's error (owner-corrected accuracy model, plan Rev 2).
 *
 * @see capture-geo-join.ts.md
 */

import { Quaternion as ThreeQuaternion } from "three";
import { fusedGpsFromOdom } from "gps-plus-slam-app-framework/utils/fused-path";
import { isIdentityMatrix4 } from "gps-plus-slam-app-framework/core";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
// The framework already owns the unit-quaternion contract for this exact data
// class (it is what `parseQrLevel` and `mintQrGeoPose` validate with), so the
// replayed-state boundary uses it rather than growing a fourth, looser check.
import { renormalizeUnitQuaternion } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";

import { MIN_ALIGNMENT_SAMPLES } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
// The list is shared (framework `state/segmenting-actions`): this consumer
// DECLINES such a recording while the recorder's QR fold SEGMENTS it, and two
// copies that drifted would let one accept what the other refuses.
import { SEGMENTING_ACTION_TYPES } from "gps-plus-slam-app-framework/state/segmenting-actions";

type Vec3 = readonly [number, number, number];
type Quat = readonly [number, number, number, number];
type AlignmentMatrix = Parameters<typeof fusedGpsFromOdom>[0];

/** Boundary guard: the structural state carries `readonly number[]`; the
 *  library's `Matrix4` is a 16-tuple. Validate the length once, then the
 *  cast is honest. */
function toAlignmentMatrix(values: readonly number[]): AlignmentMatrix {
  if (values.length !== 16) {
    throw new Error(
      `capture-geo-join: alignmentMatrix must have 16 entries, got ${String(values.length)}`,
    );
  }
  return [...values] as unknown as AlignmentMatrix;
}

/** The slice of the replayed state the join reads — structural on purpose
 *  so tests and the caller need not build a full CombinedRootState. */
export interface ReplayedJoinState {
  gpsData: {
    zero: { lat: number; lon: number } | null;
    gpsEvents: {
      gpsPositions: readonly unknown[];
      alignmentMatrix: readonly number[];
      alignmentRotation: Quat;
      gpsAccuracyMedian: number | null;
    };
    odometryPath: {
      points: readonly {
        imageFile: string;
        position: Vec3;
        rotation: Quat;
        width?: number;
        height?: number;
      }[];
    };
  } | null;
}

export interface CaptureWorldPose {
  imageFile: string;
  geo: { lat: number; lon: number; altitude: number };
  /** World-NUE orientation the camera faced at capture (D3: as captured). */
  rotationNue: Quat;
  width?: number;
  height?: number;
}

export type JoinAssessment =
  | {
      ok: true;
      quality: { pairCount: number; gpsAccuracyMedianM: number | null };
    }
  | { ok: false; reason: string };

/**
 * The oldest recording era this viewer replays without migration. Eras 4
 * and 5 have IDENTICAL action formats (the RecorderApp's own migration
 * says so: era 5 was a state-side rotation-convention change only) — it
 * is eras 1–3 whose payloads are differently framed and would
 * double-convert if replayed raw. Their migration lives in the
 * RecorderApp; promoting it is the filed follow-up, declining is the
 * honest V1. (This milestone's cold review, finding 3: the first cut
 * required === 5 and declined era-4 zips for nothing.)
 */
const MIN_SUPPORTED_ODOM_COORD_VERSION = 4;

/**
 * The BEFORE-replay half of the decision: era and segment gates run on the
 * cheap inputs (meta + action types) so a declined zip never pays the
 * seconds-long replay. Every `ok: false` means: keep the ring.
 */
export function preflightCaptureJoin(
  meta: { odomCoordVersion?: unknown } | null,
  actionTypes: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  // TYPE-checked, not just compared (PR #367 review): session.json is
  // hand-editable, and `null < 4` is false — a null/string version would
  // otherwise slip PAST the gate into a raw replay of an unknown era.
  if (
    typeof meta?.odomCoordVersion !== "number" ||
    !Number.isInteger(meta.odomCoordVersion) ||
    meta.odomCoordVersion < MIN_SUPPORTED_ODOM_COORD_VERSION
  ) {
    return {
      ok: false,
      reason: "the recording predates the current format (no migration here)",
    };
  }
  for (const type of SEGMENTING_ACTION_TYPES) {
    if (actionTypes.includes(type)) {
      return {
        ok: false,
        reason:
          "the recording's coordinate frame changed mid-walk (tracking restart or loop closure)",
      };
    }
  }
  return { ok: true };
}

/**
 * The AFTER-replay half: quality gates on the replayed state. Every
 * `ok: false` carries a plain-words reason (surfaced in the AR status) and
 * means: keep the ring.
 */
export function assessReplayedJoin(state: ReplayedJoinState): JoinAssessment {
  const gpsData = state.gpsData;
  if (gpsData === null) return { ok: false, reason: "no GPS data recorded" };
  if (gpsData.zero === null)
    return { ok: false, reason: "the recording has no GPS origin" };
  const pairCount = gpsData.gpsEvents.gpsPositions.length;
  if (pairCount < MIN_ALIGNMENT_SAMPLES) {
    return {
      ok: false,
      reason: `only ${String(pairCount)} of ${String(MIN_ALIGNMENT_SAMPLES)} GPS fixes needed for a solve`,
    };
  }
  // The empty/degenerate solve ships an IDENTITY alignment — joining on it
  // would place photos at raw odometry metres from the zero, a
  // coherent-looking wrong cloud (cold review finding 8).
  if (gpsData.gpsEvents.alignmentMatrix.length !== 16) {
    return { ok: false, reason: "the recording's alignment data is malformed" };
  }
  if (isIdentityMatrix4(toAlignmentMatrix(gpsData.gpsEvents.alignmentMatrix))) {
    return { ok: false, reason: "the recording's GPS alignment never solved" };
  }
  // The ROTATION from that same solve was read unguarded while the matrix
  // beside it got two checks (PR #376 review). It is destructured straight
  // into a `ThreeQuaternion`, so a short array yields `undefined` components
  // and a non-finite one yields NaN — either way every capture gets a garbage
  // ORIENTATION while the status line still reports "N photos at capture
  // spots". That is the identical failure the position drop-guard below was
  // added to stop, one axis over. Replayed recordings are untrusted disk
  // data, so this is validated rather than assumed.
  //
  // UNIT NORM, not merely length + finiteness (PR #378 review). `[0,0,0,0]`
  // passes both of those, and `Matrix4.compose` turns it into the IDENTITY —
  // so every capture would be placed facing East instead of the direction it
  // was taken, with the status line still reporting success. A non-unit norm
  // shears the plane instead. `renormalizeUnitQuaternion` is the framework's
  // existing contract for exactly this data class, and since PR #383 it
  // enforces length and finiteness too — this file used to carry that
  // prelude at three separate sites, one per review round, which was the
  // signal the check belonged in the callee.
  const rotation = gpsData.gpsEvents.alignmentRotation;
  if (renormalizeUnitQuaternion(rotation) === undefined) {
    return { ok: false, reason: "the recording's alignment data is malformed" };
  }
  if (gpsData.odometryPath.points.length === 0) {
    return { ok: false, reason: "the recording contains no captured photos" };
  }
  return {
    ok: true,
    quality: {
      pairCount,
      gpsAccuracyMedianM: gpsData.gpsEvents.gpsAccuracyMedian,
    },
  };
}

/**
 * Compute every capture's world pose. Call only after
 * {@link assessReplayedJoin} returned `ok` — a null `gpsData`/zero here is
 * a programming error and throws.
 */
export function computeCaptureGeoJoin(
  state: ReplayedJoinState,
): CaptureWorldPose[] {
  const gpsData = state.gpsData;
  if (gpsData === null || gpsData.zero === null) {
    throw new Error("capture-geo-join: assess before computing");
  }
  const zero = gpsData.zero;
  const matrix = toAlignmentMatrix(gpsData.gpsEvents.alignmentMatrix);
  // The RENORMALIZED value, not the raw one (PR #380 review). The previous
  // round fixed this for the per-capture rotation and left it here, where it
  // matters MORE: `alignmentQuat` multiplies into every plane at once, and
  // `image-planes.ts` does `mesh.quaternion.copy(...)` with no normalise, so
  // Three composes the matrix as R*|q|^2 - an off-unit alignment scales the
  // whole photo constellation by up to ~0.2 % at the 1e-3 tolerance.
  //
  // This function is exported and re-derives `toAlignmentMatrix` itself, so
  // it already declines to fully trust its input; trusting the rotation while
  // checking the matrix beside it was the same asymmetry this file has now
  // been corrected for three times.
  // Length and finiteness FIRST, exactly as the per-capture path below does
  // and for the same documented reason: `renormalizeUnitQuaternion` does not
  // reject non-finite input, so `[NaN, 0, 0, 1]` comes back as itself and a
  // short array yields `[x, y, z, NaN]`. Checking only the norm here while
  // checking both there was the same asymmetry one more time (PR #381
  // review), and it made the sidecar's "fails loudly" claim untrue.
  const alignmentRotation = renormalizeUnitQuaternion(
    gpsData.gpsEvents.alignmentRotation,
  );
  if (alignmentRotation === undefined) {
    throw new Error("capture-geo-join: assess before computing");
  }
  const [ax, ay, az, aw] = alignmentRotation;
  const alignmentQuat = new ThreeQuaternion(ax, ay, az, aw);
  const basisQuat = new ThreeQuaternion().setFromRotationMatrix(WEBXR_TO_NUE);
  return gpsData.odometryPath.points.flatMap((point) => {
    const geo = fusedGpsFromOdom(matrix, [...point.position], zero);
    // A capture the solve cannot place is DROPPED, never defaulted (PR #370
    // review). `main.ts` converts these back with
    // `calcRelativeCoordsInMeters(zero, {lat, lon}, altitude, 0)`, so NUE y
    // IS absolute altitude - the old `altitude ?? 0` put every such photo at
    // sea level, hundreds of metres below the visitor at any inland site,
    // while the status line still reported "N photos at capture spots". The
    // caller falls back to the photo ring when nothing survives, which is the
    // honest answer. Note zero is a VALID altitude here (the fixture's own
    // zero sits at 0), so this keys on missing-or-non-finite, never on falsy.
    if (
      !Number.isFinite(geo.lat) ||
      !Number.isFinite(geo.lon) ||
      geo.altitude === undefined ||
      !Number.isFinite(geo.altitude)
    ) {
      return [];
    }
    // The PER-CAPTURE rotation gets the same treatment as the solve's
    // alignment rotation validated in `assessReplayedJoin` — it comes from
    // the same untrusted replayed state, and the guard added there did not
    // reach it (PR #377 review). A non-finite component survives the position
    // check above, reaches `mesh.quaternion.copy(...)` in `image-planes.ts`,
    // and the plane silently never renders — while `viewerPlanesInfo` still
    // reports "N photos at capture spots", because `count` is
    // `meshes.length`. That is the outcome the position drop-guard exists to
    // prevent, one axis over. Drop the capture rather than place it wrongly.
    // Unit norm too, for the same reason as the alignment rotation above:
    // `[0,0,0,0]` is finite and length-4 and composes to the IDENTITY, which
    // would place this capture facing East rather than dropping it.
    // Use the RETURNED value, not the call as a predicate: that is what
    // `parseQrLevel` and `mintQrGeoPose` do, and it is what makes the
    // writer/reader round-trip exact rather than merely within tolerance.
    // Length and finiteness are the callee's job since PR #383.
    const rotation = renormalizeUnitQuaternion(point.rotation);
    if (rotation === undefined) {
      return [];
    }
    const [cx, cy, cz, cw] = rotation;
    // World orientation. The scene-root convention for a mesh carrying a
    // camera pose is `alignment × WEBXR_TO_NUE × R_webxr` (the same chain
    // qr-author-mode's mint uses). But the replayed STATE stores the
    // CONJUGATED quaternion R_nue = B·R_webxr·B⁻¹ (the reducer relabels the
    // body axes too, serializableTypes' webxrQuaternionToNUE), so
    // A·B·R_webxr = A·(B·R_webxr·B⁻¹)·B = A·R_nue·B — the trailing basis
    // factor is LOAD-BEARING. Without it every plane is yawed 90° about Up
    // (this milestone's cold review, finding 1; the directional test below
    // pins South-facing for a North-looking capture).
    const world = alignmentQuat
      .clone()
      .multiply(new ThreeQuaternion(cx, cy, cz, cw))
      .multiply(basisQuat);
    // The guard above narrowed altitude to a finite number, so this is a
    // read rather than a default.
    return {
      imageFile: point.imageFile,
      geo: { lat: geo.lat, lon: geo.lon, altitude: geo.altitude },
      rotationNue: [world.x, world.y, world.z, world.w],
      ...(point.width !== undefined ? { width: point.width } : {}),
      ...(point.height !== undefined ? { height: point.height } : {}),
    };
  });
}
