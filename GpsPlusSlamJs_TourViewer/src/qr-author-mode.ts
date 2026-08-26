/**
 * Author mode (QR-pose plan M3): the view-model that turns a printed QR into
 * a mintable GPS anchor. Runs the SAME tracking pipeline viewing will use
 * (so M5's error numbers are attributable), with the plan's three deltas:
 *
 * - **The printed size is an INPUT, not a measurement** (delta #1): the
 *   author enters the printed side length; no depth, no corner-based sizing.
 * - **A synthetic local `fetchLevel`** (delta #8): the decoded QR text is a
 *   printed LAUNCH URL — an HTML page — so a real fetch would fail
 *   validation and flap the controller status at the detection cadence. The
 *   synthetic level is GEO-LESS, which makes the controller emit detections
 *   without ever voting.
 * - **Minting reads the STABLE pose** (delta #2), never the jittery raw
 *   solve: detections land in the `qrDetected` slice and
 *   `selectStableQrPose` gates the mint.
 *
 * Frame contract for the mint: the slice's stable pose is in RAW WebXR/odom
 * space (that is what the controller composes with `getCameraPose`). The
 * GPS-world NUE pose the mint needs is `alignment × WEBXR_TO_NUE × pose` —
 * the same chain a QR-glued object under an aligned `arWorldGroup` carries.
 * The alignment TARGET matrix is used (not the lerped visual transform):
 * for minting, the converged solve is the honest frame.
 */

import { Matrix4, Quaternion as ThreeQuaternion, Vector3 } from "three";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import {
  serializeQrLevel,
  type QrLevel,
} from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  QrDetectionEvent,
  QrSolvePoseInput,
  QrTrackingControllerConfig,
} from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type {
  CameraIntrinsics,
  Pose,
  QrPoseSolution,
} from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type {
  QrFrontEnd,
  RgbaImage,
} from "gps-plus-slam-app-framework/ar/qr/qr-frontend";
import type {
  LatLong,
  Matrix4 as AlignmentMatrix,
} from "gps-plus-slam-app-framework/core";
import type { QrPoseStability } from "gps-plus-slam-app-framework/state";

/** Default printed side length (m) prefilled in the author panel.
 *  0.16, not 0.2 (PR #364 review): with the 8% quiet zone each side the
 *  printed content is sizeM × 1.16, and 0.2 m → 23.2 cm exceeds the ~19 cm
 *  printable width of A4/Letter — at the mandated 100% scale the symbol's
 *  edge modules are CLIPPED and the code does not decode. 0.16 m → 18.6 cm
 *  fits; larger sizes are allowed but warned about in the print panel. */
export const AUTHOR_DEFAULT_SIZE_M = 0.16;

/**
 * The mint gate's alignment requirement (milestone review #1): a non-null
 * alignment matrix is VACUOUS — the store ships an IDENTITY matrix from the
 * very first GPS fix, and an identity-composed mint stamps a heading that is
 * wrong by the session's arbitrary WebXR yaw. Requiring several solved-in
 * GPS fixes is the cheap honest floor; M5's field numbers may raise it.
 */
export const MIN_ALIGNMENT_SAMPLES = 3;

/** What the mint gate knows about the session's GPS alignment. */
export interface AuthorAlignmentInfo {
  hasMatrix: boolean;
  /** GPS fixes actually solved into the alignment (`selectGpsPositions`). */
  sampleCount: number;
  /** Median GPS accuracy (m) — recorded into `mintQuality`. */
  gpsAccuracyM?: number;
}

/**
 * Geo-less until minted (QD-4): `syntheticAccuracyM` is required by the
 * controller config but unreachable — a geo-less level never votes.
 */
const UNREACHABLE_SYNTHETIC_ACCURACY_M = 5;

/** The geo-less level the synthetic local fetch resolves for ANY text. */
export function syntheticAuthorLevel(sizeM: number): QrLevel {
  if (!Number.isFinite(sizeM) || sizeM <= 0) {
    throw new RangeError(
      `author mode: printed size must be a positive number of metres, got ${String(sizeM)}`,
    );
  }
  return { version: 1, qr: { physicalSizeM: sizeM } };
}

/** The device/store functions the author pipeline needs — seam-injected. */
export interface AuthorPipelineDeps {
  frontEnd: QrFrontEnd;
  solvePose(input: QrSolvePoseInput): QrPoseSolution | null;
  getCameraPose(): Pose | null;
  getIntrinsics(image: RgbaImage): CameraIntrinsics | null;
  /** onDetection → the `qrDetected` slice (`recordQrDetection`). */
  recordDetection(event: QrDetectionEvent): void;
  /** Controller failures MUST surface (async-UI rule) — a throwing detector
   *  otherwise leaves the panel saying "point the camera" forever. */
  onError(message: string): void;
}

/**
 * The tracking-controller configuration for authoring. `minIntervalMs: 0`
 * because the camera-frame source is the single cadence owner (Option A) —
 * two equal throttles in series drop ~1 frame per cycle.
 */
export function buildAuthorControllerConfig(
  sizeM: number,
  deps: AuthorPipelineDeps,
): QrTrackingControllerConfig {
  const level = syntheticAuthorLevel(sizeM);
  return {
    frontEnd: deps.frontEnd,
    solvePose: (input) => deps.solvePose(input),
    fetchLevel: () => Promise.resolve(level),
    dispatchVotes: () => {
      // Unreachable: a geo-less level never produces votes. Kept explicit
      // so a future schema change fails a test here instead of silently
      // voting during authoring.
    },
    onDetection: (event) => {
      deps.recordDetection(event);
    },
    getCameraPose: () => deps.getCameraPose(),
    getIntrinsics: (image) => deps.getIntrinsics(image),
    onError: (err) => {
      deps.onError(err instanceof Error ? err.message : String(err));
    },
    syntheticAccuracyM: UNREACHABLE_SYNTHETIC_ACCURACY_M,
    minIntervalMs: 0,
  };
}

/** What the author panel shows, and whether the mint button unlocks. */
export interface AuthorReadout {
  text: string;
  canMint: boolean;
}

/**
 * The author's only view into the mint gate: a stable pose AND a live GPS
 * alignment are both required, and each blocked state names what is missing
 * (plain-language rule — the author is standing at a poster, not reading a
 * plan file).
 */
export function authorStatusLine(
  detectedText: string | null,
  stability: QrPoseStability | null,
  alignment: AuthorAlignmentInfo,
): AuthorReadout {
  if (detectedText === null || stability === null) {
    return {
      text: "Point the camera at the printed code…",
      canMint: false,
    };
  }
  const spread = `spread ${(stability.translationSpreadM * 100).toFixed(1)} cm / ${stability.rotationSpreadDeg.toFixed(1)}°`;
  if (stability.status !== "stable") {
    return {
      text: `Measuring — ${String(stability.sampleCount)} samples, ${spread}. Hold steady.`,
      canMint: false,
    };
  }
  if (!alignment.hasMatrix || alignment.sampleCount < MIN_ALIGNMENT_SAMPLES) {
    return {
      text:
        `Pose stable (${spread}) — waiting for GPS alignment ` +
        `(${String(alignment.sampleCount)} of ${String(MIN_ALIGNMENT_SAMPLES)} fixes). ` +
        `Walk a few metres with GPS reception.`,
      canMint: false,
    };
  }
  return { text: `Pose stable (${spread}) — ready to mint.`, canMint: true };
}

export interface MintAuthorLevelInput {
  /** The STABLE aggregated pose, in RAW WebXR/odom space. */
  stablePose: Pose;
  /** `selectAlignmentMatrix` — column-major odom-NUE → GPS-world NUE. */
  alignmentMatrix: AlignmentMatrix | null;
  /** `selectZeroReference` — the session's GPS zero. */
  zero: LatLong | null;
  /** The mint gate's alignment info — enforced HERE too (defense in depth:
   *  the matrix alone is vacuous, see {@link MIN_ALIGNMENT_SAMPLES}). */
  alignment: AuthorAlignmentInfo;
  sizeM: number;
  /** Injected timestamp (ISO) — becomes `mintQuality.mintedAtIso`. */
  nowIso: string;
}

export type MintAuthorLevelResult =
  | { ok: true; level: QrLevel; json: string }
  | { ok: false; error: string };

/**
 * Compose the GPS-world NUE pose and mint the exportable level. Refuses in
 * plain words while the session has no GPS alignment or zero reference —
 * minting earlier would stamp a garbage anchor into the printed code.
 */
export function mintAuthorLevel(
  input: MintAuthorLevelInput,
): MintAuthorLevelResult {
  const { stablePose, alignmentMatrix, zero, alignment, sizeM, nowIso } = input;
  if (
    alignmentMatrix === null ||
    zero === null ||
    alignment.sampleCount < MIN_ALIGNMENT_SAMPLES
  ) {
    return {
      ok: false,
      error:
        "No usable GPS alignment yet — walk a few metres with GPS reception, then mint once the pose is stable.",
    };
  }
  try {
    const poseMatrix = new Matrix4().compose(
      new Vector3(...stablePose.position),
      new ThreeQuaternion(...stablePose.rotation),
      new Vector3(1, 1, 1),
    );
    const world = new Matrix4()
      .fromArray(alignmentMatrix)
      .multiply(WEBXR_TO_NUE)
      .multiply(poseMatrix);
    const position = new Vector3();
    const rotation = new ThreeQuaternion();
    world.decompose(position, rotation, new Vector3());
    rotation.normalize();

    const geo = mintQrGeoPose({
      worldNuePosition: { x: position.x, y: position.y, z: position.z },
      worldNueRotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      zero,
    });
    const level: QrLevel = {
      version: 1,
      qr: {
        physicalSizeM: sizeM,
        geo,
        // The full quality block (milestone review #7): M5's error
        // attribution needs to know what the alignment looked like at mint
        // time, not just when the mint happened.
        mintQuality: {
          mintedAtIso: nowIso,
          alignmentSampleCount: alignment.sampleCount,
          ...(alignment.gpsAccuracyM !== undefined &&
          Number.isFinite(alignment.gpsAccuracyM) &&
          alignment.gpsAccuracyM > 0
            ? { gpsAccuracyM: alignment.gpsAccuracyM }
            : {}),
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
