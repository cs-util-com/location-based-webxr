/**
 * Minting a QR level from a solved pose: the odometry → GPS-world
 * composition, and the level/quality assembly around `mintQrGeoPose`.
 *
 * WHY THIS IS FRAMEWORK-LEVEL. `mintQrGeoPose` was already shared, but the
 * two things wrapped around it — the frame composition and the level
 * assembly — lived in the tour viewer. A second authoring surface (the
 * recorder, minting from a whole recording) would otherwise copy both
 * verbatim, and the composition is the single easiest thing in this stack to
 * get wrong.
 *
 * FRAME CONTRACT — read this before touching {@link qrWorldPoseFromOdom}.
 * The input pose is RAW WebXR/odometry, which is what the tracking controller
 * composes with `getCameraPose`. The GPS-world NUE pose is therefore
 *
 *     alignment · WEBXR_TO_NUE · pose        (basis factor LEADING)
 *
 * A **trailing** basis factor is correct for a different input: replayed
 * STATE, whose quaternions are already basis-conjugated (`R_nue =
 * B·R_webxr·B⁻¹`, so `A·B·R_webxr = A·R_nue·B`). That is why the
 * capture-time geo join composes the other way round — and applying its form
 * here would yaw every anchor by 90°, which is precisely the bug that
 * milestone's review caught. The unit tests pin the direction by bearing, not
 * by matrix components, because component assertions on a near-identity
 * rotation are what let the original bug through.
 *
 * SEE `GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
 * §3 M-A / M-C (cold-review blocker 1).
 */

import { Matrix4, Quaternion as ThreeQuaternion, Vector3 } from 'three';
import { WEBXR_TO_NUE } from '../webxr-nue-basis.js';
import { mintQrGeoPose } from './qr-geo-pose-minting.js';
import {
  serializeQrLevel,
  type QrLevel,
  type QrMintQuality,
} from './qr-level.js';
import type { Pose } from './qr-pose.js';
import type { Quaternion } from 'gps-plus-slam-js';
import type { LatLong, Matrix4 as AlignmentMatrix } from '../../core/index.js';

/**
 * Default printed side length (m) to prefill in an authoring panel.
 *
 * 0.16, not 0.2: with the 8 % quiet zone on each side the printed content is
 * `sizeM × 1.16`, and 0.2 m → 23.2 cm exceeds the ~19 cm printable width of
 * A4/Letter — at the mandated 100 % scale the symbol's edge modules are
 * CLIPPED and the code does not decode. 0.16 m → 18.6 cm fits.
 */
export const AUTHOR_DEFAULT_SIZE_M = 0.16;

/**
 * The mint gate's alignment requirement: a non-null alignment matrix is
 * VACUOUS — the store ships an IDENTITY matrix from the very first GPS fix,
 * and an identity-composed mint stamps a heading that is wrong by the
 * session's arbitrary WebXR yaw. Requiring several solved-in GPS fixes is the
 * cheap honest floor; field numbers may raise it.
 */
export const MIN_ALIGNMENT_SAMPLES = 3;

/** What the mint gate knows about the session's GPS alignment. */
export interface MintAlignmentInfo {
  hasMatrix: boolean;
  /** GPS fixes actually solved into the alignment. */
  sampleCount: number;
  /** Median GPS accuracy (m) — recorded into `mintQuality` when sensible. */
  gpsAccuracyM?: number;
}

/** A pose in the GPS-world NUE frame. */
export interface WorldNuePose {
  position: { x: number; y: number; z: number };
  rotation: Quaternion;
}

/**
 * Compose a RAW WebXR/odometry pose into the GPS-world NUE frame.
 *
 * @param odomPose the solved QR pose in raw WebXR/odometry space
 * @param alignmentMatrix column-major odom-NUE → GPS-world NUE (the solved
 *   TARGET matrix, never a lerped visual transform — for minting, the
 *   converged solve is the honest frame)
 */
export function qrWorldPoseFromOdom(
  odomPose: Pose,
  alignmentMatrix: AlignmentMatrix
): WorldNuePose {
  const poseMatrix = new Matrix4().compose(
    new Vector3(...odomPose.position),
    new ThreeQuaternion(...odomPose.rotation),
    new Vector3(1, 1, 1)
  );
  const world = new Matrix4()
    .fromArray(alignmentMatrix)
    .multiply(WEBXR_TO_NUE)
    .multiply(poseMatrix);

  const position = new Vector3();
  const rotation = new ThreeQuaternion();
  world.decompose(position, rotation, new Vector3());
  rotation.normalize();
  return {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
  };
}

/** Everything the level assembly needs once a world pose already exists. */
export interface MintQrLevelFromWorldInput {
  /** The code's pose in the GPS-world NUE frame. */
  world: WorldNuePose;
  /** The session's GPS zero reference; `null` before the first fix. */
  zero: LatLong | null;
  /** Defence in depth: see {@link MIN_ALIGNMENT_SAMPLES}. */
  alignment: MintAlignmentInfo;
  /** Printed side length (m) written into the level. */
  sizeM: number;
  /** Injected timestamp (ISO) — becomes `mintQuality.mintedAtIso`. */
  nowIso: string;
  /** Extra quality fields (a session mint adds sighting counts and spreads). */
  quality?: Partial<QrMintQuality>;
}

export interface MintQrLevelInput {
  /** The solved (ideally stable/aggregated) pose, in RAW WebXR/odom space. */
  odomPose: Pose;
  /** The alignment TARGET matrix; `null` while the session has none. */
  alignmentMatrix: AlignmentMatrix | null;
  /** The session's GPS zero reference; `null` before the first fix. */
  zero: LatLong | null;
  /** Defence in depth: the matrix alone is vacuous, see
   *  {@link MIN_ALIGNMENT_SAMPLES}. */
  alignment: MintAlignmentInfo;
  /** Printed side length (m) written into the level. */
  sizeM: number;
  /** Injected timestamp (ISO) — becomes `mintQuality.mintedAtIso`. */
  nowIso: string;
  /** Extra quality fields (a session mint adds sighting counts and spreads). */
  quality?: Partial<QrMintQuality>;
}

export type MintQrLevelResult =
  | { ok: true; level: QrLevel; json: string }
  | { ok: false; error: string };

/**
 * Compose the GPS-world pose and assemble the exportable level.
 *
 * Refuses in plain words while the session has no usable GPS alignment —
 * minting earlier would stamp a garbage anchor behind a printed code. Never
 * throws: a caller is a UI panel or a zip contributor, and both want a
 * message rather than an exception.
 */
export function mintQrLevel(input: MintQrLevelInput): MintQrLevelResult {
  const { odomPose, alignmentMatrix, zero, alignment, sizeM, nowIso } = input;
  if (alignmentMatrix === null) return NO_ALIGNMENT_RESULT;
  return mintQrLevelFromWorld({
    world: qrWorldPoseFromOdom(odomPose, alignmentMatrix),
    zero,
    alignment,
    sizeM,
    nowIso,
    ...(input.quality !== undefined ? { quality: input.quality } : {}),
  });
}

/** The one refusal message both entry points share. */
const NO_ALIGNMENT_RESULT: MintQrLevelResult = {
  ok: false,
  error:
    'No usable GPS alignment yet — walk a few metres with GPS reception, then mint once the pose is stable.',
};

/**
 * Assemble the level from a pose that is ALREADY in the GPS-world frame.
 *
 * Split out for the session mint, which combines many sightings into one
 * world pose before it gets here — so the composition happens per sighting,
 * not once at the end.
 */
export function mintQrLevelFromWorld(
  input: MintQrLevelFromWorldInput
): MintQrLevelResult {
  const { world, zero, alignment, sizeM, nowIso } = input;
  if (zero === null || alignment.sampleCount < MIN_ALIGNMENT_SAMPLES) {
    return NO_ALIGNMENT_RESULT;
  }
  try {
    const geo = mintQrGeoPose({
      worldNuePosition: world.position,
      worldNueRotation: world.rotation,
      zero,
    });
    const level: QrLevel = {
      version: 1,
      qr: {
        physicalSizeM: sizeM,
        geo,
        mintQuality: {
          mintedAtIso: nowIso,
          alignmentSampleCount: alignment.sampleCount,
          // A zero or negative reported accuracy is meaningless, and the
          // schema rejects it — drop it rather than fail the whole mint.
          ...(alignment.gpsAccuracyM !== undefined &&
          Number.isFinite(alignment.gpsAccuracyM) &&
          alignment.gpsAccuracyM > 0
            ? { gpsAccuracyM: alignment.gpsAccuracyM }
            : {}),
          ...(input.quality ?? {}),
        },
      },
    };
    return { ok: true, level, json: serializeQrLevel(level) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
