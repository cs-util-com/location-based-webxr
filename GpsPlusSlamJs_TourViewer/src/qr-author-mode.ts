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

import {
  MIN_ALIGNMENT_SAMPLES,
  type MintAlignmentInfo,
} from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
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
import type { QrPoseStability } from "gps-plus-slam-app-framework/state";

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
  alignment: MintAlignmentInfo,
): AuthorReadout {
  if (detectedText === null || stability === null) {
    return {
      text: "Hold the phone on the printed code so it fills the screen…",
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
  return {
    text: `Measured and stable (${spread}) — save the position.`,
    canMint: true,
  };
}

/** What the setup panel says once the code is measured: the next move. */
export function setupHint(state: {
  measured: boolean;
  tourOpen: boolean;
  hadLevel: boolean;
}): string {
  if (!state.measured) return "";
  if (!state.tourOpen) {
    return "Position saved. Open your tour in step 1 to finish - the measured code is written into that zip.";
  }
  return (
    (state.hadLevel
      ? "Position saved - it replaces the code this tour already carried. "
      : "Position saved. ") + "Place content, or tap Finish to rebuild the zip."
  );
}

/** Whether the finish button may run, and if not, why. */
export function finishReadiness(state: {
  measured: boolean;
  tourOpen: boolean;
}): "ready" | "not-measured" | "no-tour" {
  if (!state.measured) return "not-measured";
  if (!state.tourOpen) return "no-tour";
  return "ready";
}

/** The finish step's labels through its async cycle (async-UI rule). */
export const FINISH_LABELS = {
  reading: "Finishing - reading the hosted zip…",
  rebuilding: (done: number, total: number) =>
    `Finishing - rebuilding ${String(done)} of ${String(total)} entries…`,
  ready: (bytes: number) =>
    `The rebuilt zip is ready (${(bytes / 1_000_000).toFixed(1)} MB). Download it, then replace the hosted file in step 6.`,
  failed: (reason: string) => `Finishing failed: ${reason}`,
  download: "Download the rebuilt zip",
  saving: "Saving…",
  saved: (filename: string) =>
    `Saved as ${filename}. Now replace the hosted zip (step 6) - the link and the printed code stay the same.`,
  notSaved: "Not saved - tap the button again.",
} as const;

/** What the panel is about to print, and whether the author's input was
 *  taken literally. */
export interface PrintCodeSelection {
  codeIndex: number;
  /** True when the typed value was not a usable code number and 1 was used. */
  coerced: boolean;
}

/**
 * Read the "which code of the set" field.
 *
 * Blank means the first code — a creator printing one poster should not have
 * to think about this. Anything else unusable is ALSO treated as the first
 * code, but reported as coerced: two posters both printed as code 1 share one
 * identity and one level file, which is a silent mis-placement and exactly
 * what the per-code token exists to prevent. The panel says so rather than
 * swallowing it.
 */
export function codeIndexFromInput(raw: string): PrintCodeSelection {
  const trimmed = raw.trim();
  if (trimmed === "") return { codeIndex: 1, coerced: false };
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 1
    ? { codeIndex: value, coerced: false }
    : { codeIndex: 1, coerced: true };
}
