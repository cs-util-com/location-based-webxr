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

import { MIN_ALIGNMENT_SAMPLES } from "./qr-author-mode.js";

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

/** Action types whose PRESENCE in the recording invalidates the final
 *  alignment for earlier captures (plan Rev 2): a restart wipes and a loop
 *  closure DEFORMS the alignment's odometry history while
 *  `odometryPath.points` keeps every capture unchanged. V1 declines;
 *  per-segment joins are the filed follow-up. */
const SEGMENTING_ACTION_TYPES = [
  "gpsData/odometryTrackingRestarted",
  "gpsData/arLoopClosureDetected",
] as const;

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
  meta: { odomCoordVersion?: number } | null,
  actionTypes: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  if (
    meta?.odomCoordVersion === undefined ||
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
  const [ax, ay, az, aw] = gpsData.gpsEvents.alignmentRotation;
  const alignmentQuat = new ThreeQuaternion(ax, ay, az, aw);
  const basisQuat = new ThreeQuaternion().setFromRotationMatrix(WEBXR_TO_NUE);
  return gpsData.odometryPath.points.map((point) => {
    const geo = fusedGpsFromOdom(matrix, [...point.position], zero);
    const [cx, cy, cz, cw] = point.rotation;
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
    return {
      imageFile: point.imageFile,
      geo: { lat: geo.lat, lon: geo.lon, altitude: geo.altitude ?? 0 },
      rotationNue: [world.x, world.y, world.z, world.w],
      ...(point.width !== undefined ? { width: point.width } : {}),
      ...(point.height !== undefined ? { height: point.height } : {}),
    };
  });
}
