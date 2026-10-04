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
 * - **Minting reads the STABLE fused pose** (delta #2; QR near-frontal
 *   pose plan §60), never the jittery raw solve: detections land in the
 *   `qrDetected` slice and the fused pose over them (`createFusedQrPoseSource`)
 *   gates the mint.
 *
 * Frame contract for the mint: the slice's stable pose is in RAW WebXR/odom
 * space (the controller composes it with each frame's capture pose). The
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
  QrPoseSolution,
} from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type {
  QrFrontEnd,
  RgbaImage,
} from "gps-plus-slam-app-framework/ar/qr/qr-frontend";
import type { QrFusedPose } from "gps-plus-slam-app-framework/ar/qr/qr-fused-pose";

import {
  downloadSafeName,
  nameSurvivesDownload,
} from "./content-disposition.js";
import type { CodeTourStatus } from "./scan-open.js";

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
  fused: QrFusedPose | null,
  alignment: MintAlignmentInfo,
  /** The print-size check has no answer for this code yet (S3a). */
  sizeCheckPending = false,
): AuthorReadout {
  if (detectedText === null || fused === null || fused.status === "unknown") {
    return {
      text: "Hold the phone on the printed code so it fills the screen…",
      canMint: false,
    };
  }
  if (fused.status !== "stable") {
    return {
      text: `Measuring — ${waitingFor(fused.notStableReason)}`,
      canMint: false,
    };
  }
  if (!alignment.hasMatrix || alignment.sampleCount < MIN_ALIGNMENT_SAMPLES) {
    return {
      text:
        `Pose stable — waiting for GPS alignment ` +
        `(${String(alignment.sampleCount)} of ${String(MIN_ALIGNMENT_SAMPLES)} fixes). ` +
        `Walk a few metres with GPS reception.`,
      canMint: false,
    };
  }
  return {
    // The print-size check needs a sideways step that nothing else asks for
    // (QR size consensus plan §12 #3); the mint is not held for it.
    text: sizeCheckPending
      ? `Measured and stable — save the position. ${SIZE_CHECK_HINT}`
      : "Measured and stable — save the position.",
    canMint: true,
  };
}

/** What the ready line adds while the print-size check has no answer. */
const SIZE_CHECK_HINT = "Take a step sideways to check the print size.";

const cmText = (m: number): string => (m * 100).toFixed(1);

/**
 * The print-size offer (QR size consensus plan §11-§12, S3a): the measured
 * size is approximate, the ruler decides, and the field's own unit (metres)
 * stands beside the centimetres.
 */
export function sizeOfferView(
  measuredM: number,
  typedM: number,
): { text: string; useLabel: string; keepLabel: string } {
  return {
    text:
      `Print measures ~${cmText(measuredM)} cm, the size field says ` +
      `${cmText(typedM)} cm. Check it with a ruler.`,
    useLabel: `Use ${cmText(measuredM)} cm`,
    keepLabel: `Keep ${cmText(typedM)} cm`,
  };
}

/** The confirmation after adopting a measured size: measuring starts over. */
export function adoptedSizeNote(sizeM: number): string {
  return `Now using ${cmText(sizeM)} cm (${String(sizeM)} m) - walk slowly around the code again, then save the position.`;
}

/**
 * What the fused pose is waiting for, in plain words (QR near-frontal pose
 * plan §61 #11). Never "hold steady": moving the CAMERA around the code is
 * what resolves its tilt.
 */
export function waitingFor(reason: QrFusedPose["notStableReason"]): string {
  switch (reason) {
    case "fit":
      return "keep moving slowly, still measuring.";
    case "fallback":
      return "the views disagree, keep going.";
    case "motion":
      // A wall code cannot be held; there this is mostly a false "turning"
      // from a relabelled frame (milestone review of b4b #11).
      return "the code seemed to move, keep it in view.";
    case "order":
      return "code not read clearly, move closer.";
    default:
      return "walk slowly around the code.";
  }
}

/** A failed open's cause, in the creator's words - short, unlike
 *  `describeOpenError`, because it shares the panel with the readout. */
function openCauseText(cause: CodeTourStatus & { kind: "failed" }): string {
  switch (cause.cause) {
    case "missing":
      return "file not found (not uploaded or shared yet?)";
    case "cors":
      return "the host refused the browser access";
    case "corrupt":
      return "the file is not a readable tour";
    default:
      return "the link cannot be opened as a tour";
  }
}

/** What the panel says about the code in view (scan-to-open plan §9 #9);
 *  empty when there is nothing to say. */
export function codeTourLine(status: CodeTourStatus): string {
  switch (status.kind) {
    case "quiet":
      return "";
    case "opening":
      return "Opening the tour this code points to…";
    case "not-a-tour":
      return "This code does not point to a tour - print one in step 2.";
    case "measured-for-another":
      return `You measured the code of ${status.label} - scan it again to open that tour.`;
    case "added-to-open-tour":
      return "This code is from another tour - it is added to the open tour as one more code.";
    case "unknown":
      return "Cannot tell which tour this code is from - it is added to the open tour.";
    case "failed":
      return status.retrying
        ? `Could not open the tour: ${openCauseText(status)}. Keep the code in view to try again.`
        : `Could not open the tour: ${openCauseText(status)}. Fix the link, then restart AR.`;
  }
}

/**
 * The first thing the panel says in an AR visit (authoring plan
 * 2026-09-28-0953 §3.2a, decision D5): look at the tour's code first, until
 * this visit has seen it. A later visit's notes are corrected through the
 * code only when the code was seen in that visit (D10b); the owner chose a
 * hint over a rule, so nothing is blocked while it shows. Empty with no
 * tour open - there is no "code of this tour" yet.
 */
export function entryHint(state: {
  tourOpen: boolean;
  codeSeen: boolean;
}): string {
  if (!state.tourOpen || state.codeSeen) return "";
  return "First, point the camera at the code you scanned to open this tour.";
}

/**
 * The one line that says a code correction was refused (M2c review #2):
 * the code seen here is further from its saved position, or turned
 * further, than two visits' GPS plausibly disagree - a second print or a
 * moved poster, not GPS - so this visit's notes follow GPS instead.
 */
export function correctionRefusedLine(refusal: {
  horizontalM: number;
  yawDeg: number;
  maxHorizontalM: number;
}): string {
  const where =
    refusal.horizontalM > refusal.maxHorizontalM
      ? `${String(Math.round(refusal.horizontalM))} m`
      : `turned ${String(Math.round(refusal.yawDeg))}°`;
  return `Code seen ${where} from its saved position - a second print or a moved poster? Not used; this visit follows GPS`;
}

/**
 * The explicit replace's confirm question (authoring plan 2026-09-28-0953
 * §3.4, M4; M4 review #3), with the replace's size when this visit's
 * sighting of the code gives one (`sightedCodeOffset`).
 *
 * WHAT IT MUST SAY: the notes' STORED positions do not change, but every
 * visitor is lined up with the code - so notes placed against the old code
 * position will appear shifted, by about the distance the code moves (and
 * by more the further they stand from it, when it also turns).
 *
 * Rounding: one decimal below 10 m (a 0.4 m replace is not "0 m"), whole
 * metres above, where GPS-level error makes decimals noise; a turn below
 * 1° is left out - a note 20 m away moves under 0.35 m for it.
 *
 * Notes never move with the code (owner decision D19): each keeps its own
 * saved position, so this says what happens and offers no option to move
 * them along.
 */
export function replaceCodeConfirmText(
  size: { horizontalM: number; yawDeg: number } | null,
): string {
  const question =
    "Replace the code's saved position with this new measurement? Everyone who opens the tour is lined up with the code, so it moves for them too";
  const notes =
    "Notes already placed keep their saved positions, so to visitors the ones placed against the old position will appear shifted";
  if (size === null) return `${question}. ${notes}.`;
  const metres =
    size.horizontalM < 10
      ? (Math.round(size.horizontalM * 10) / 10).toFixed(1)
      : String(Math.round(size.horizontalM));
  const turn =
    size.yawDeg >= 1 ? ` and turns ${String(Math.round(size.yawDeg))}°` : "";
  const further =
    turn === "" ? "" : ", and more the further they are from the code";
  return `${question}: it moves about ${metres} m${turn}. ${notes} by about that much${further}.`;
}

/** What the setup panel says once the code is measured: the next move. */
export function setupHint(state: {
  measured: boolean;
  tourOpen: boolean;
  hadLevel: boolean;
  /** The level in hand is a stored pose this visit did not measure (a
   *  hosted or draft level, or an earlier visit's): it is kept, never
   *  replaced by a new measurement (D10b). */
  keptStored?: boolean;
}): string {
  if (!state.measured) return "";
  // With no tour open, `codeTourLine` says what is happening to the tour
  // the code names (scan-to-open plan §9 #9).
  if (!state.tourOpen) return "Position saved.";
  if (state.keptStored === true) {
    return "Saved position kept. Place content, or tap Finish to rebuild the zip.";
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
    }, then put it in place of the hosted file - the steps appear below.`,
  /** A Drive tour's ready line. It carries the one warning that only helps
   *  BEFORE the tap: a repeat download is saved as "name (1).zip", which
   *  Drive treats as a new file (Drive replace plan §5 #1, milestone
   *  review #1). */
  readyDrive: (bytes: number, filename: string) =>
    `The rebuilt zip is ready (${(bytes / 1_000_000).toFixed(1)} MB). Before you save: delete any older ${filename} from this phone's Downloads, or the phone names the new one "${repeatDownloadName(filename)}". Then tap "Save the zip to this phone" - the Drive steps appear below.`,
  failed: (reason: string) => `Finishing failed: ${reason}`,
  download: "Download the rebuilt zip",
  /** A Drive tour's route: the zip must land in Downloads for the Drive
   *  website's upload (Drive replace plan §2 decision 4). */
  saveToPhone: "Save the zip to this phone",
  saving: "Saving…",
  saved: (filename: string) =>
    `Saved as ${filename}. Now replace the hosted zip (steps below) - the link and the printed code stay the same.`,
  savedToPhone: (filename: string) =>
    `Saved as ${filename} in Downloads. Now follow the Drive steps below - the link and the printed code stay the same.`,
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
    `Sent ${filename} to the app you chose. It has almost certainly saved a NEW file - so the printed code still points at the old one until you replace it (steps below).`,
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
export function finishIdleLabel(canShare: boolean, drive = false): string {
  if (canShare) return FINISH_LABELS.share;
  return drive ? FINISH_LABELS.saveToPhone : FINISH_LABELS.download;
}

/** How the rebuilt zip leaves the page. */
export type FinishRoute = "share" | "download";

/**
 * A Drive-hosted tour always SAVES to the device (Drive replace plan §2
 * decision 4): the only replace that works on a phone is the Drive
 * website's upload, which needs the zip in Downloads - a share hands it to
 * another app instead. Other hosts share where the device prefers it.
 */
export function finishRoute(state: {
  canShare: boolean;
  drive: boolean;
}): FinishRoute {
  if (state.drive) return "download";
  return state.canShare ? "share" : "download";
}

/**
 * The Drive steps for putting the rebuilt zip in place of the hosted one
 * from a phone (Drive replace plan §2, §5): the owner's working flow, in
 * a new tab so these steps stay on screen (§5 #6), with the checks for the
 * two ways it silently fails - a repeat download saved as "name (1).zip"
 * (§5 #1), and a name the phone changes on save (§5 #7, `rename`).
 */
export function driveReplaceSteps(
  name: string,
  /** False when the host sent no name and `name` is the page's guess: the
   *  creator must then check the Drive file carries it (plan §4). */
  nameKnown = true,
): {
  /** The name to give the Drive file first, when a phone would not keep
   *  this one; null when it would. */
  rename: string | null;
  steps: string[];
} {
  const rename = nameSurvivesDownload(name) ? null : downloadSafeName(name);
  const saved = rename ?? name;
  const first: string[] = [];
  if (rename !== null) {
    first.push(
      `First rename the file on Drive to "${rename}" - a phone cannot save "${name}" unchanged, and Drive replaces only a file of the same name.`,
    );
  } else if (!nameKnown) {
    first.push(
      `Check that the file on Drive is named "${saved}" - Drive replaces only a file of the same name. Rename it on Drive if not.`,
    );
  }
  return {
    rename,
    steps: [
      ...first,
      // After the save, so a check rather than a warning (the warning is
      // `readyDrive`): picking "name.zip" beside a new "name (1).zip"
      // would upload the OLD zip over the tour (milestone review #1).
      `Check the new file in Downloads is named ${saved}. If it is "${repeatDownloadName(saved)}", delete every copy of ${saved}, then tap "Save the zip to this phone" again.`,
      `Open a new tab in Chrome (or your browser), type drive.google.com, then tick "Desktop site" in the ⋮ menu.`,
      `Open the folder with your tour, tap New, then File upload, and pick ${saved}.`,
      `Choose "Replace existing file", then Upload. If Drive does not ask, it uploaded a second copy - delete that copy. Keep the tab open until the upload finishes.`,
    ],
  };
}

/** The name Chrome gives a download whose name is already taken. */
function repeatDownloadName(filename: string): string {
  return `${filename.replace(/\.zip$/i, "")} (1).zip`;
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
  /** A Drive tour's save names Downloads and the Drive steps (plan §5 #5). */
  drive = false,
): string {
  if (!outcome.delivered) {
    return outcome.route === "share"
      ? FINISH_LABELS.notShared
      : FINISH_LABELS.notSaved;
  }
  if (drive && outcome.route === "download") {
    return FINISH_LABELS.savedToPhone(filename);
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
 * Reachable today with no new feature, which is why it is fixed here
 * rather than waiting on the shortener decision it also blocks. The
 * trigger, precisely: moving the hosted file breaks the LINK, which is a
 * LOUD failure - a visitor gets a dead URL. What strands a measurement
 * quietly is changing the link and then RE-PRINTING, because only then
 * does the printed text, and with it the identity, change.
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
