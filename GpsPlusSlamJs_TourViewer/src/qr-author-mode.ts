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
  AUTHOR_DEFAULT_SIZE_M,
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
  manifest: "pending" | "settled" | "broken";
}):
  | "ready"
  | "not-measured"
  | "no-tour"
  | "manifest-pending"
  | "manifest-broken" {
  if (!state.measured) return "not-measured";
  if (!state.tourOpen) return "no-tour";
  if (state.manifest === "pending") return "manifest-pending";
  if (state.manifest === "broken") return "manifest-broken";
  return "ready";
}

/** Why the finish button is off, in the creator's words (empty when ready). */
export function finishBlockedHint(
  readiness: ReturnType<typeof finishReadiness>,
): string {
  switch (readiness) {
    case "manifest-pending":
      return "Finish unlocks once the tour's content list has loaded.";
    case "manifest-broken":
      return "The hosted zip's tour.json is broken; repair it before finishing, or the placement it holds would be lost.";
    default:
      return "";
  }
}

/** Above this the rebuild is a long whole-file pass on a phone; the copy
 *  says so before the creator taps. */
const LARGE_ARCHIVE_BYTES = 200_000_000;

/** What the finish button's surroundings say about the archive's size. */
export function archiveSizeNote(bytes: number): string {
  const mb = (bytes / 1_000_000).toFixed(0);
  return bytes >= LARGE_ARCHIVE_BYTES
    ? `The hosted zip is ${mb} MB: rebuilding it copies every entry on this phone and can take a while and a lot of memory.`
    : `The hosted zip is ${mb} MB.`;
}

/**
 * What a creator reads when the printed-size field is empty at AR entry.
 *
 * The example is DERIVED from the default the field is prefilled with, not
 * written out: the two drifted apart once already, and an example that is
 * not the default sends a creator looking for a number the page would have
 * supplied anyway (second testing session, F2).
 */
export const MISSING_SIZE_MESSAGE = `Enter the printed code's side length in metres (e.g. ${String(AUTHOR_DEFAULT_SIZE_M)}) in step 2 before starting.`;

/** The finish step's labels through its async cycle (async-UI rule). */
export const FINISH_LABELS = {
  reading: (bytes: number) =>
    `Finishing - reading the hosted zip (${(bytes / 1_000_000).toFixed(1)} MB)…`,
  rebuilding: (done: number, total: number) =>
    `Finishing - rebuilding ${String(done)} of ${String(total)} entries…`,
  /** The line the creator reads immediately BEFORE pressing the button, so
   *  it has to name the same action the button does (M2 review #3). */
  ready: (bytes: number, canShare = false) =>
    `The rebuilt zip is ready (${(bytes / 1_000_000).toFixed(1)} MB). ${
      canShare ? "Share it" : "Download it"
    }, then replace the hosted file in step 6.`,
  failed: (reason: string) => `Finishing failed: ${reason}`,
  download: "Download the rebuilt zip",
  saving: "Saving…",
  saved: (filename: string) =>
    `Saved as ${filename}. Now replace the hosted zip (step 6) - the link and the printed code stay the same.`,
  notSaved: "Not saved - tap the button again.",
  /** The share route's label and copy. Separate from the download route's
   *  because the two do different things to the hosted file, and `saved`
   *  states as fact something that is FALSE after a share: sharing hands
   *  the zip to another app, which normally stores it as a NEW file with a
   *  new id and a new link, while the printed code still points at the
   *  old one. */
  share: "Share the rebuilt zip",
  sharing: "Sharing…",
  shared: (filename: string) =>
    `Sent ${filename} to the app you chose. It has almost certainly saved a NEW file - so the printed code still points at the old one until you replace it (step 6).`,
  /** Deliberately not "you cancelled": the Web Share API reports a
   *  cancelled sheet and a failed share as the same error. */
  notShared: "Nothing was shared - tap the button again.",
} as const;

/** What the hand-off did: which mechanism ran, and whether the file left
 *  the page. Mirrors the framework's `ShareOrDownloadResult` without
 *  importing it, so this module stays free of storage types. */
export interface HandoffOutcome {
  route: "share" | "download";
  delivered: boolean;
}

/**
 * The finish step's button labels and status line, as pure functions of the
 * capability and the outcome.
 *
 * They are pure, and separate from the click handler, because three of the
 * four outcomes cannot be reached in an e2e run: a headless browser has no
 * share sheet, so the only way the SHARE copy is ever checked is here. The
 * copy is also the part that was wrong - `saved` states as fact that the
 * link and printed code are unchanged, which is true after a save and false
 * after a share, since sharing normally creates a new file with a new id.
 */
export function finishIdleLabel(canShare: boolean): string {
  return canShare ? FINISH_LABELS.share : FINISH_LABELS.download;
}

export function finishBusyLabel(canShare: boolean): string {
  return canShare ? FINISH_LABELS.sharing : FINISH_LABELS.saving;
}

/**
 * Which of the finish step's two help blocks to reveal.
 *
 * A pure function because the alternative is a branch reachable only by
 * completing an AR walkthrough on a device with a share sheet - i.e. by
 * nothing that runs in CI. `replaceHelp` is the instruction that keeps the
 * printed code working and belongs on both routes; `shareNote` is the
 * sentence that only makes sense when the zip went to another app.
 */
export function finishHelpVisibility(outcome: HandoffOutcome): {
  replaceHelp: boolean;
  shareNote: boolean;
} {
  if (!outcome.delivered) return { replaceHelp: false, shareNote: false };
  return { replaceHelp: true, shareNote: outcome.route === "share" };
}

export function finishHandoffStatus(
  outcome: HandoffOutcome,
  filename: string,
): string {
  if (!outcome.delivered) {
    return outcome.route === "share"
      ? FINISH_LABELS.notShared
      : FINISH_LABELS.notSaved;
  }
  return outcome.route === "share"
    ? FINISH_LABELS.shared(filename)
    : FINISH_LABELS.saved(filename);
}

/**
 * The warning a creator must see before printing a code whose identity
 * differs from every measurement their tour already holds - or `null` when
 * there is nothing to lose.
 *
 * **Why this exists, and why it is not a shortener feature.** A printed
 * code's identity is a hash of the text it carries, and the measured pose
 * is filed under that identity inside the hosted zip. Change the text -
 * move the file, swap in a short link, add a tracking parameter - and the
 * printed code asks for an id the archive does not hold. The visitor's app
 * reads that as "this code has no level", never says anything is wrong,
 * and simply waits out the scan gate into a location-only experience. The
 * creator's walk is gone and nothing tells them.
 *
 * That is reachable today with no new feature, which is why it is fixed
 * here rather than waiting on the shortener decision it also blocks.
 *
 * It WARNS rather than refuses. Re-printing under a new link is a
 * legitimate thing to do - it is the whole point of the shortener - and
 * the creator is the only one who knows whether the measurement was worth
 * keeping. What they must not have is silence.
 */
export function reprintOrphanWarning(
  linkCodeIds: readonly string[],
  measuredCodeIds: readonly string[],
): string | null {
  // No measurement means nothing to orphan. This is the common case: every
  // tour before its first walk, and every tour of a creator who never
  // measures.
  if (measuredCodeIds.length === 0) return null;
  // The question is about the LINK, not about this poster. One tour can
  // carry several codes - that is what the code number and the multi-code
  // PDF are for - and each gets a different identity, so a creator who
  // measured code 2 and is re-printing code 1 has changed nothing. Asking
  // only about the code in front of them told that creator their link had
  // changed and offered to put it back, which is advice to undo something
  // they never did (PR #442 review).
  //
  // So: if ANY measurement can still be produced by the current link, at
  // any of its code numbers, the link is intact and there is nothing to
  // warn about.
  if (measuredCodeIds.some((id) => linkCodeIds.includes(id))) return null;
  return (
    "Warning: this tour already holds a measurement, and it belongs to a " +
    "DIFFERENT printed code than the one above - the link must have changed " +
    "since it was measured. Printing and hanging this code means walking " +
    "step 4 again; the old measurement will not be found. To keep it, put " +
    "the original link back in step 1."
  );
}

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
