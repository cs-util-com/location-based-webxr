/**
 * Viewer mode (QR-pose plan M4) and the photo placement (geo-join plan,
 * flows plan M4); its own module since the flows plan M6. The default
 * passerby flow: the tour's photos are placed at their capture spots once
 * the tracking-quality phase reports ready or a code placed the tour
 * (`tryPlaceTour`), scanned codes relocalize the session via budgeted
 * synthetic GPS votes and REFINE the alignment under the placed planes, and
 * the ring around a code is the fallback for a tour without a recording. A
 * code scanned before any GPS fix sets the session zero itself (QR-first
 * M1, `zeroFromCode`).
 *
 * What is placed is DRAWN per station (visitor plan 2026-10-18-2349 M2): the tour's items, the walk's photos (grouped by
 * `station-captures.ts`) and the ring (with the station nearest its code)
 * become parts of their station in the side table (`station-content.ts`),
 * and only the stations the store says are shown - the present one, or all
 * under "show all" - are decoded and stand in the scene; content no station
 * holds stands always. `syncContent` follows the store on every dispatch
 * and camera frame.
 *
 * A scanned code is also CHECKED after the scan (authoring plan
 * 2026-09-28-0953 §3.6, D20, M5c; `moved-code-check.ts`): on each new device
 * fix in the store. A code read as moved is VETOED - its keep-alive stops,
 * every vote is taken back (`ViewerVoteSink.retractVotes`), so the content
 * moves once to where GPS puts it; its later locks are ignored until wider
 * evidence lifts the veto (polish round C5); the gate and the line say so;
 * the viewing log records why.
 */

import { createQrTrackingController } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import { createFusedQrPoseSource } from "gps-plus-slam-app-framework/ar/qr/qr-fused-pose-source";
import { createQrVoteBudget } from "gps-plus-slam-app-framework/ar/qr/qr-vote-budget";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import {
  recordGpsEvent,
  recordQrDetection,
  selectGpsPositions,
  selectOdometryPositions,
  selectQrFusedEntries,
  selectTrackingQuality,
  selectZeroReference,
  setZeroPos,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";
import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import { decodeFrameTexture } from "gps-plus-slam-app-framework/visualization/frame-texture-decoder";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { Texture } from "three";

import { registerFrameUpdate } from "gps-plus-slam-app-framework/ar/frame-loop";
import { tourItems } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { bakeCaptureSpots, posesOfCaptureSpots } from "./capture-bake.js";
import { entriesForVisitor } from "./tour-read-set.js";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { CaptureWorldPose } from "./capture-geo-join.js";
import { renderTourStation } from "./content-placement.js";
import { type CaptureSpotsInWorld, worldCaptureSpots } from "./tour-content.js";
import { placeCapturedImagePlanes, placeImagePlanes } from "./image-planes.js";
import type { ViewerMode } from "./mode.js";
import {
  createMovedCodeChecks,
  type MovedCodeChecks,
  type MovedCodeVerdict,
  type RestoredCode,
} from "./moved-code-check.js";
import { describeOpenError } from "./open-errors.js";
import { tallyEvaluation, type FusedTallies } from "./qr-debug-readout.js";
import {
  gateAllowsPlacement,
  isLockableLevel,
  reconsiderScanGate as reconsiderGate,
  SCAN_GATE_ESCAPE_MS,
  scanGateAtSessionStart,
} from "./scan-gate.js";
import {
  buildViewerControllerConfig,
  createViewerKeepAlive,
  imagePlaneRingNue,
  MAX_VOTED_LOCKS_PER_CODE,
} from "./qr-viewer-mode.js";
import type { QrVoteKeepAlive } from "./qr-vote-keep-alive.js";
import type { TourViewerSeams } from "./seams.js";
import {
  codePlacedTour,
  isPlacementReady,
  type PlacementState,
} from "./tour-flow.js";
import type { TourSession } from "./tour-session.js";
import {
  isCodeIgnored,
  type ArController,
  type TourViewerHooks,
  type TourViewerSession,
  type TourViewerStore,
} from "./tour-viewer-session.js";
import { startEntryVoteSink } from "./viewer-vote-sink.js";
import type { ViewingLog } from "./viewing-log.js";
import {
  createStationContent,
  type ContentPart,
  type RenderedPart,
  type StationContent,
} from "./station-content.js";
import { capturesByStation, nearestStationId } from "./station-captures.js";
import {
  selectPresentStationId,
  selectShowAllContent,
} from "./visitor-guide-slice.js";

/** The display downscale for capture planes — the framework decoder's
 *  documented OOM mitigation (the recorder defaults to 2 for the same
 *  reason): full-res textures are a GPU-memory hazard (milestone review,
 *  finding 4). Since M2 only the shown station's photos are decoded, so
 *  the divisor is a margin, no longer the only bound. */
const CAPTURE_PLANE_DECODE_DIVISOR = 2;

/**
 * The side-table id of content no station holds (`station-captures.ts`): a
 * walk photo beyond every station's radius, the ring around a code beyond
 * every station's radius. Always shown (the table's `alwaysShown`, in its
 * own render lane), as all content was before M2. Never a tour id (tour
 * ids are path-safe ids without ":").
 */
const LOOSE_STATION = "loose:always";

/** What a drawn part logs (`placed`), less what its render reports. */
type PlacedBase = Omit<
  Parameters<ViewingLog["placed"]>[0],
  "count" | "skipped" | "station"
>;

type Scene = NonNullable<ReturnType<TourViewerSeams["getScene"]>>;

/** Properties, not methods: they are handed to the hooks object unbound. */
export interface ViewerPlacement {
  /** Creates the viewer tracking controller for THIS AR entry; false when
   *  there is no detector (the session is plain AR - still placing photos). */
  startViewerPipeline: () => boolean;
  /** Where the page's device GPS fixes go (`createGpsPositionHandler`'s
   *  `recordFix`): with the code keep-alive holding, the fix and its ring
   *  as ONE batch (D18); otherwise the plain `recordGpsEvent`. */
  recordDeviceFix: (fix: RecordGpsEventPayload) => void;
  /** The ready-triggered placement; cheap enough to run on every dispatch.
   *  Ends with `syncContent`. */
  tryPlaceTour: () => void;
  /** Draw the stations the store says are shown (the present one, or all),
   *  and advance their fades; every camera frame and dispatch. */
  syncContent: () => void;
  /** The session reached running, or a tour opened into a running
   *  session: derive the scan gate (M5) and arm its escape clock while it
   *  scans. Idle when no session runs. */
  startScanGate: () => void;
  /** A tour closed: the gate belonged to it (M5 review #8 - a waived gate
   *  used to survive into the next tour, which may carry a code). */
  resetScanGate: () => void;
  /** The tour's levels arrived (or could not be read): waive a scanning
   *  gate that cannot lock. */
  reconsiderScanGate: (
    levels: ReadonlyMap<string, QrLevel> | "unavailable",
  ) => void;
}

export function createViewerPlacement(deps: {
  ctx: TourViewerSession;
  mode: ViewerMode;
  arStore: TourViewerStore;
  arController: ArController;
  seams: TourViewerSeams;
  errorBox: HTMLElement;
  /** The gate's escape button (inside the overlay). */
  escapeButton: HTMLButtonElement;
  hooks: TourViewerHooks;
  /** The `?debug=1` viewer recording's `tourViewing/*` log (M1b); silent
   *  while no recording runs. Absent: nothing is logged. */
  viewingLog?: ViewingLog;
  /** The page clock: the QR controller's detection times and the moment a
   *  GPS fix ARRIVES, the one clock the keep-alive's hold runs on (M2b
   *  review #4), and the content's fades. Absent: `Date.now` - the
   *  controller's own default and what the status line reads the hold with. */
  now?: () => number;
  /** How a station's item photo is read: through the stations' prefetch
   *  cache in the page (visitor plan §9). That cache holds story media
   *  only, so an item photo is read from the archive again on every return
   *  until item photos join the prefetch (visitor plan M3). Absent: the
   *  open tour's own read. */
  loadContent?: (path: string) => Promise<Blob>;
}): ViewerPlacement {
  const {
    ctx,
    mode,
    arStore,
    arController,
    seams,
    errorBox,
    escapeButton,
    hooks,
  } = deps;
  const authorMode = mode === "creator";
  const now = deps.now ?? Date.now;
  /** Whether this session has a detector (set by startViewerPipeline). */
  let hasDetector = false;

  /** Pass a scanning gate; `text`: the code whose voted lock passed it. */
  function passGate(
    via: "code" | "skipped" | "ignored",
    text: string | null = null,
  ): void {
    if (ctx.scanGate.kind !== "scanning") return;
    ctx.cancelEscapeClock?.();
    ctx.cancelEscapeClock = null;
    escapeButton.hidden = true;
    ctx.scanGate = { kind: "passed", via };
    ctx.scanGateCodeText = via === "code" ? text : null;
    // Place first, render after: the line describes the placement state
    // the pass produced, not the one before it (M5 review #7).
    tryPlaceTour();
    hooks.renderArStatus();
  }

  /** A code the moved-code check ignores: a scanning gate passes as
   *  `ignored`, and a gate THIS code passed says it no longer counts
   *  (§7j #4); a gate another code passed stays with that code (M5c review
   *  M1). An escape or a waived gate stays as it is. */
  function markGateIgnored(text: string): void {
    if (ctx.scanGate.kind === "scanning") {
      passGate("ignored");
      return;
    }
    if (
      ctx.scanGate.kind === "passed" &&
      ctx.scanGate.via === "code" &&
      ctx.scanGateCodeText === text
    ) {
      ctx.scanGate = { kind: "passed", via: "ignored" };
      ctx.scanGateCodeText = null;
    }
  }

  /** The text of the latest detection: the code a lock reports on (the
   *  controller reports a frame's detection before its lock). */
  let lastDetectedText: string | null = null;
  /** That detection's pose (raw WebXR): an ignored code's lock computes no
   *  fused pose, so its probation check is pinned on this. */
  let lastDetectedPose: Pose | null = null;

  /**
   * An ignored code locked (polish round C5, the M0a review #1): an AR exit,
   * a frame change, or a veto read after a frame change ends the vetoed
   * code's check, and an ignored code casts no votes, so nothing would pin a
   * new one and the veto would hold for the tour again. Its lock pins a
   * probation check in the current entry and frame instead, starting vetoed
   * at the spread the veto was read on: it can only lift the veto.
   */
  function probationPin(text: string): void {
    const levelId = ctx.levelIdByText.get(text);
    const ignored =
      levelId === undefined ? undefined : ctx.ignoredCodes.get(levelId);
    const level = ctx.levelByText.get(text);
    const checks = ctx.movedCodeChecks;
    if (
      levelId === undefined ||
      ignored === undefined ||
      level === undefined ||
      level === null ||
      checks === null ||
      lastDetectedPose === null ||
      lastDetectedText !== text
    ) {
      return;
    }
    checks.pin({
      text,
      levelId,
      level,
      qrPoseWorld: lastDetectedPose,
      atMs: now(),
      zero: selectZeroReference(arStore.getState()),
      vetoSpreadM: ignored.vetoSpreadM,
    });
  }

  /**
   * A code alone starts the tour (QR-first plan 2026-10-14-0445 §3 M1): when
   * a code's pose is stable and the session has no zero yet, the zero is set
   * at the code's stored geo, so its votes land at once. The zero is only the
   * local tangent-plane origin and the votes are built around this point; a
   * later device fix joins the same frame (the coordinator sets a zero only
   * when the session has none). Called from the stable-pose gate, i.e. in the
   * controller's order BEFORE the frame's votes are dispatched and before the
   * moved-code check pins the code on the zero (§7 #9). A code without geo
   * cannot vote and sets nothing. With no device fix at all a wrongly placed
   * code cannot be detected: the moved-code check needs device fixes.
   */
  function zeroFromCode(text: string): void {
    if (selectZeroReference(arStore.getState()) !== null) return;
    const geo = ctx.levelByText.get(text)?.qr.geo;
    if (geo === undefined) return;
    arStore.dispatch(setZeroPos({ lat: geo.lat, lon: geo.lon }));
  }

  /** Whether a code's votes placed this tour (`tour-flow.ts`). The
   *  placement trigger then runs whatever the tracking-quality phase reads
   *  (§7 #9) - which changes only a scan whose one voted lock opened the
   *  gate, since every later voted lock starts the placement itself
   *  (`onVotedLock`). */
  const placedByCode = (): boolean => codePlacedTour(ctx);

  const ignoredLevelIds = (): ReadonlySet<string> =>
    new Set(ctx.ignoredCodes.keys());

  function resetScanGate(): void {
    ctx.cancelEscapeClock?.();
    ctx.cancelEscapeClock = null;
    escapeButton.hidden = true;
    ctx.scanGate = { kind: "idle" };
    ctx.scanGateCodeText = null;
    hooks.renderArStatus();
  }

  function startScanGate(): void {
    // Only a running session has a gate: a tour opened on the plain page
    // waits for its session, whose start derives the gate again.
    if (arController.getState().status !== "running") {
      resetScanGate();
      return;
    }
    ctx.cancelEscapeClock?.();
    ctx.cancelEscapeClock = null;
    ctx.scanGateCodeText = null;
    ctx.scanGate = scanGateAtSessionStart({
      mode,
      hasDetector,
      levels: ctx.currentLevels,
      ignoredLevelIds: ignoredLevelIds(),
    });
    // Without location there is no GPS to continue with (QR-first M1b-1):
    // no escape clock, so the button never shows.
    if (ctx.scanGate.kind === "scanning" && !ctx.codesOnly) {
      // Its own clock (plan review #11): a device without frames must still
      // get the escape.
      ctx.cancelEscapeClock = seams.schedule(() => {
        ctx.cancelEscapeClock = null;
        if (ctx.scanGate.kind !== "scanning") return;
        ctx.scanGate = { kind: "scanning", escapeOffered: true };
        escapeButton.hidden = false;
        hooks.renderArStatus();
      }, SCAN_GATE_ESCAPE_MS);
    }
    hooks.renderArStatus();
  }

  function reconsiderScanGate(
    levels: ReadonlyMap<string, QrLevel> | "unavailable",
  ): void {
    const next = reconsiderGate(ctx.scanGate, levels, ignoredLevelIds());
    if (next === ctx.scanGate) return;
    ctx.cancelEscapeClock?.();
    ctx.cancelEscapeClock = null;
    escapeButton.hidden = true;
    ctx.scanGate = next;
    tryPlaceTour();
    hooks.renderArStatus();
  }

  escapeButton.addEventListener("click", () => {
    passGate("skipped");
  });

  /** Levels are only useful with an open tour; the viewer pipeline reads
   *  them live so a tour opened AFTER entering AR still resolves. */
  function startViewerPipeline(): boolean {
    // FIRST, before the plain-AR return below (the seam contract, rule 1):
    // the entry clears every solver override, so no entry keeps a previous
    // one's soft trimming - a plain-AR entry casts no vote that would.
    const sink = startEntryVoteSink(arStore);
    ctx.viewerVoteSink = sink;
    const frontEnd = seams.createQrFrontEnd();
    hasDetector = frontEnd !== null;
    if (frontEnd === null) {
      // Viewing without a detector still works as plain AR — no error
      // state, the QR line just never appears.
      return false;
    }
    // The code's FUSED pose (QR near-frontal pose plan §60): the joint
    // rotation over its recent detections, gated on their agreement. One
    // source per pipeline start, i.e. per AR session (§61 #9); each code's
    // tracker takes its level's printed size (§61 #8 - resolved before the
    // code's first lock). Inert today: every TourViewer entry carries a raw
    // pose, which gives the position, and the rotation is size-free - the
    // size matters only for entries without one (milestone review of b4b #6).
    // Its counts (the ?debug=1 readout) and its last new evaluation (the
    // visitor hint), kept in this closure so a late evaluation of an ended
    // session reaches neither the next session's tallies nor its line
    // (plan §66, §67 #5 and #10).
    const tallies: FusedTallies = new Map();
    const fusedPose = createFusedQrPoseSource({
      entriesOf: (text) => selectQrFusedEntries(arStore.getState(), text),
      optionsFor: (text) => {
        const sizeM = ctx.levelByText.get(text)?.qr.physicalSizeM;
        return sizeM === undefined ? {} : { sizeM };
      },
      onEvaluated: (result, _ms, text) => {
        tallyEvaluation(tallies, text, result);
        if (live()) {
          ctx.viewerLastEvaluation = { text, result, atMs: performance.now() };
        }
      },
    });
    ctx.fusedPose = fusedPose;
    ctx.fusedTallies = tallies;
    ctx.viewerLastEvaluation = null;
    // This session's pipeline is live while its source is the session's: the
    // level lookup runs its callbacks inside the fetch the controller awaits,
    // before the controller's dispose guard (milestone review of b4b #3).
    const live = (): boolean => ctx.fusedPose === fusedPose;
    // Every viewer vote - a lock's ring here, the keep-alive's rings in
    // `recordDeviceFix` - goes through the entry's sink: one batch each, the
    // soft trimming on before the first (`viewer-vote-sink.ts`).
    const keepAlive = startKeepAlive();
    // Per AR entry like the keep-alive, reset per TOUR by the tour switch
    // (`endTourCodeVotes`, M2b review #6).
    const voteBudget = createQrVoteBudget(MAX_VOTED_LOCKS_PER_CODE);
    ctx.viewerVoteBudget = voteBudget;
    // Per AR entry like the keep-alive; the veto memory it feeds is per tour.
    const checks = startMovedCodeChecks();
    /** Whether the moved-code check made the viewer ignore this text's
     *  level (by level id: the memory outlives the per-text caches). */
    const isIgnored = (text: string): boolean => isCodeIgnored(ctx, text);
    /** The scan gate's part of a lock. */
    const gateOnLock = (level: QrLevel, hasVoted: boolean): void => {
      // The gate passes on the LOCK of a lockable level (M5; plan review
      // #1) whose code has cast votes: a lock before the store takes
      // votes, or while the pose converges, corrected nothing, and
      // passing on it placed the content through GPS alone while the
      // line said the code had worked (authoring plan 2026-09-28-0953
      // §2.2 B3). The escape button still passes a gate no vote reaches.
      if (!hasVoted || !isLockableLevel(level)) return;
      if (ctx.scanGate.kind === "scanning") {
        passGate("code", lastDetectedText);
        return;
      }
      // A working code after a veto (M5c review M1): the gate that said
      // "code ignored" names this code again.
      if (
        ctx.scanGate.kind === "passed" &&
        ctx.scanGate.via === "ignored" &&
        lastDetectedText !== null &&
        !isIgnored(lastDetectedText)
      ) {
        ctx.scanGate = { kind: "passed", via: "code" };
        ctx.scanGateCodeText = lastDetectedText;
        hooks.renderArStatus();
      }
    };
    ctx.qrController = createQrTrackingController(
      buildViewerControllerConfig({
        frontEnd,
        now,
        solvePose: (input) => seams.solveQrPose(input),
        getIntrinsics: (image) => seams.getIntrinsics(image),
        getLevels: () => ctx.currentLevels,
        // Only a lock's votes join the viewing log's per-lock batch; the
        // keep-alive's are recorded as stamped GPS events, never mislabelled
        // as the next lock's.
        dispatchVotes: (payloads) => {
          sink.castLockVotes(payloads);
          for (const payload of payloads) deps.viewingLog?.vote(payload);
        },
        keepAlive,
        voteBudget,
        isIgnored,
        onIgnoredLock: (text) => {
          if (!live()) return;
          ctx.viewerIgnoredText = text;
          markGateIgnored(text);
          probationPin(text);
          hooks.renderArStatus();
        },
        // The check pins a code on the pose its first voted lock used.
        onVotedPose: (code, atMs) => {
          if (!live()) return;
          const levelId = ctx.levelIdByText.get(code.text);
          if (levelId === undefined) return;
          checks.pin({
            ...code,
            levelId,
            atMs,
            zero: selectZeroReference(arStore.getState()),
          });
        },
        // recordGpsEvent silently no-ops until the session ZERO exists -
        // the budget must not be charged for dropped votes (M4 review #2).
        //
        // Tests the zero, not merely the slice (PR #386 review). Those are
        // two distinct reachable states - capture-geo-join treats them
        // separately - and in the window between them every locked frame
        // passed this gate, charged the budget and reported "Relocalizing
        // - N of 10 vote batches" while recordGpsEvent wrote nothing. At
        // the camera-frame cadence a second or two of looking at the poster
        // before the first fix spent the whole budget, after which that
        // code could never vote again. This is the same defect the
        // recorder was fixed for, left in the app the fix was ported FROM.
        canAcceptVotes: () => arStore.getState().gpsData?.zero != null,
        // The same convergence gate minting uses (M4 review #3): the
        // controller skips the vote — budget untouched — while null.
        // A stable pose before any device fix sets the zero from the code
        // (QR-first M1), before this frame's votes are built and dispatched.
        // No wait follows it: the votes' overrides keep the code's rotation
        // from the first lock (`VIEWER_SOFT_TRIM`, r863).
        resolveStablePose: (text) => {
          const pose = fusedPose.resolve(text);
          if (pose !== null) zeroFromCode(text);
          return pose;
        },
        recordDetection: (event) => {
          lastDetectedText = event.text;
          lastDetectedPose = event.qrPoseWorld;
          ctx.viewerUnknownCode = null; // a level-carrying detection supersedes it
          ctx.viewerUnusableCode = null;
          ctx.latestReprojectionPx = event.reprojectionErrorPx;
          arStore.dispatch(recordQrDetection(event));
          const level = ctx.levelByText.get(event.text) ?? null;
          // The status is still the previous frame's here (the controller
          // reports tracking after this frame's votes).
          deps.viewingLog?.detection(event, level, ctx.viewerQrStatus);
          ctx.qrDebugView?.update(
            event.qrPoseWorld,
            level?.qr.physicalSizeM ?? null,
          );
        },
        onLevelResolved: (text, level, levelId) => {
          if (!live()) return;
          ctx.levelByText.set(text, level);
          if (level !== null && levelId !== null) {
            ctx.levelIdByText.set(text, levelId);
          }
        },
        onLocked: (level, hasVoted) => {
          gateOnLock(level, hasVoted);
          // A station's code (tour kit plan K4), AFTER the gate: the lock
          // that passes it may also find the station the code anchors. Any
          // lock of a code the viewer trusts counts - an ignored code
          // reaches `onIgnoredLock` instead, and the guide checks the veto
          // again.
          const lockedId =
            lastDetectedText === null
              ? undefined
              : ctx.levelIdByText.get(lastDetectedText);
          if (lockedId !== undefined) hooks.stationCodeLocked(lockedId);
        },
        onError: (message) => {
          errorBox.textContent = `QR tracking failed: ${message}`;
        },
        onStatus: (status) => {
          ctx.viewerQrStatus = status;
          hooks.renderArStatus();
        },
        onUnknownCode: (code) => {
          if (!live()) return;
          ctx.viewerUnknownCode = code;
          hooks.renderArStatus();
        },
        onUnusableLevel: (code) => {
          if (!live()) return;
          ctx.viewerUnusableCode = code;
          hooks.renderArStatus();
        },
        onVotedLock: (text, votedLocks) => {
          deps.viewingLog?.votedLock(text, votedLocks);
          // Another code voted: the line about an ignored one no longer
          // describes what places the tour (M5c review M1).
          if (
            ctx.viewerIgnoredText !== null &&
            ctx.viewerIgnoredText !== text
          ) {
            ctx.viewerIgnoredText = null;
          }
          ctx.viewerLockedText = text;
          ctx.viewerVotedLocks = votedLocks;
          ctx.viewerReprojectionPx = ctx.latestReprojectionPx;
          // A lock after the ready-triggered placement refines the
          // alignment under the planes and places nothing; a lock during a
          // running join is dropped and the next budgeted lock retries
          // (flows plan review #4). The fire-and-forget carries a .catch
          // (PR #366 review): a throw below the loader's try/finally used
          // to reject unhandled inside an ~8 Hz detection callback.
          // The gate is checked HERE too (M5 review #3): the framework
          // dispatches a frame's votes BEFORE it reports the lock, so the
          // first voted lock arrives while the gate still scans; the ring
          // waits for the next budgeted vote instead of relying on that
          // ordering.
          placeOnVotedLock(text);
          hooks.renderArStatus();
        },
      }),
    );
    return true;
  }

  /** A voted lock's placement: the ring (or the join) once the gate
   *  allows it, unless planes are placed or loading. */
  function placeOnVotedLock(text: string): void {
    if (
      !gateAllowsPlacement(ctx.scanGate) ||
      ctx.imagePlanes !== null ||
      ctx.imagePlanesLoading
    ) {
      return;
    }
    void placeTourImagePlanes(text).catch((err: unknown) => {
      // The archive URL is known here — a Drive failure during plane
      // loading deserves the Drive-specific message too (milestone review,
      // finding 7).
      ctx.viewerPlanesError = describeOpenError(err, ctx.session?.archive.url);
      hooks.renderArStatus();
    });
  }

  /**
   * This AR entry's code keep-alive (authoring plan 2026-09-28-0953 §3.2,
   * M2b), and the one store subscription that stops it when the odometry
   * frame changes: a frame change (`qrDetected.frameEpoch`: an odometry
   * restart or loop closure) leaves the kept pose naming a place in the old
   * frame, so the hold ends there (M2b review #1), and so does the code's
   * trust ({@link endCodeTrust}); the code's next scan votes afresh in the
   * new one and lines the tour up again. The subscription ends itself once
   * the entry's keep-alive is no longer the session's (`endQrPipeline` at
   * AR exit, or the next entry's pipeline). Its votes are cast per device
   * fix by {@link recordDeviceFix}.
   */
  function startKeepAlive(): QrVoteKeepAlive {
    ctx.viewerKeepAlive?.stop();
    // Its state changes go to the viewing log (M1b review #5).
    const created = createViewerKeepAlive();
    const keepAlive = deps.viewingLog?.keepAlive(created) ?? created;
    ctx.viewerKeepAlive = keepAlive;
    const frameEpoch = (): number =>
      arStore.getState().qrDetected.frameEpoch ?? 0;
    let keptFrameEpoch = frameEpoch();
    const unsubscribe = arStore.subscribe(() => {
      if (ctx.viewerKeepAlive !== keepAlive) {
        unsubscribe();
        return;
      }
      const epoch = frameEpoch();
      if (epoch !== keptFrameEpoch) {
        keptFrameEpoch = epoch;
        keepAlive.stop();
        endCodeTrust();
      }
    });
    return keepAlive;
  }

  /**
   * A code's trust ends on events only: a veto ({@link vetoMovedCode}),
   * an odometry-frame change (here), an AR exit and a new tour (the
   * session's resets) - never by the clock, a count of fixes or a distance. After a frame change the votes
   * name places in the old frame, so nothing may read the tour as lined up
   * by a code: the stations' trust (`codeLinedUp`, the 1 m takeover
   * margin), the status line, the placement trigger. Unlike the veto the
   * code is not ignored and its votes stay; its next voted lock lines the
   * tour up again.
   */
  function endCodeTrust(): void {
    if (ctx.viewerLockedText === null && ctx.viewerVotedLocks === 0) return;
    ctx.viewerVotedLocks = 0;
    ctx.viewerLockedText = null;
    hooks.renderArStatus();
  }

  /**
   * This AR entry's moved-code checks (D20, M5c), and the one store
   * subscription that feeds them: whenever the GPS history changed, its new
   * device fixes are folded and judged (`moved-code-check.ts` reads device
   * fixes only), and a code read as moved is vetoed. An odometry frame
   * change ends every pin, as it ends the keep-alive. The subscription ends
   * itself once the entry's checks are no longer the session's. The
   * dispatches of the veto's own recovery are not judged again.
   */
  function startMovedCodeChecks(): MovedCodeChecks {
    const checks = createMovedCodeChecks({ onRestored: restoreMovedCode });
    ctx.movedCodeChecks = checks;
    const frameEpoch = (): number =>
      arStore.getState().qrDetected.frameEpoch ?? 0;
    let keptFrameEpoch = frameEpoch();
    let seenPositions: unknown = null;
    let judging = false;
    const unsubscribe = arStore.subscribe(() => {
      if (ctx.movedCodeChecks !== checks) {
        unsubscribe();
        return;
      }
      if (judging) return;
      const state = arStore.getState();
      const gpsPositions = selectGpsPositions(state);
      const epoch = frameEpoch();
      if (epoch !== keptFrameEpoch) {
        keptFrameEpoch = epoch;
        checks.frameChanged(gpsPositions.length);
      }
      // The store hands out a new array whenever the history changed.
      if (gpsPositions === seenPositions) return;
      seenPositions = gpsPositions;
      judging = true;
      try {
        const verdicts = checks.update(
          {
            gpsPositions,
            odometryPositions: selectOdometryPositions(state),
            zero: selectZeroReference(state),
          },
          now(),
        );
        for (const verdict of verdicts) vetoMovedCode(verdict);
      } finally {
        judging = false;
        seenPositions = selectGpsPositions(arStore.getState());
      }
    });
    return checks;
  }

  /**
   * The veto (owner decision 2026-10-02; re-judged since polish round C5,
   * `restoreMovedCode`): the code is ignored; the keep-alive stops, whichever
   * code it holds; every vote is taken back - the GPS
   * history reset and the device fixes re-fed with the soft keys off (the
   * M5a arm that lands on the GPS answer), so the content moves ONCE; the
   * gate and the line say the code is ignored; the viewing log records the
   * detector's inputs and the recovery.
   */
  function vetoMovedCode(verdict: MovedCodeVerdict): void {
    if (ctx.ignoredCodes.has(verdict.levelId)) return;
    ctx.ignoredCodes.set(verdict.levelId, {
      text: verdict.text,
      vetoSpreadM: verdict.evidence.spreadM,
    });
    // Whichever code it holds: every vote is taken back below, and a ring
    // of another code would go on feeding the GPS history - and the
    // tracking report read from it - while nothing reads the tour as lined
    // up by a code. That code's next lock votes again (the budget reset).
    ctx.viewerKeepAlive?.stop();
    const recovery = ctx.viewerVoteSink?.retractVotes() ?? {
      refedFixes: 0,
      batches: 0,
    };
    // No vote stands now: nothing reads the tour as lined up by a code -
    // the stations' trust, the status line, the placement trigger - until
    // a code votes again (r881 review M1).
    ctx.viewerVotedLocks = 0;
    ctx.viewerLockedText = null;
    // Every code's votes are gone, so every code may vote again by lock
    // (M5c review M2): a spent code the keep-alive holds would otherwise
    // cast nothing on its next lock. The vetoed code stays blocked by
    // `isIgnored`, which the budget never reaches.
    ctx.viewerVoteBudget?.reset();
    deps.viewingLog?.codeIgnored({
      text: verdict.text,
      levelId: verdict.levelId,
      evidence: verdict.evidence,
      recovery,
    });
    ctx.viewerIgnoredText = verdict.text;
    markGateIgnored(verdict.text);
    hooks.renderArStatus();
  }

  /**
   * A veto lifted (polish round C5, owner decision Q-C5): the check read
   * the code consistent again on wider evidence. The code is no longer
   * ignored, so its next lock votes and the check pins it again; the line
   * stops saying it is ignored. Votes taken back at the veto are not
   * restored: the next lock casts fresh ones.
   */
  function restoreMovedCode(restored: RestoredCode): void {
    if (!ctx.ignoredCodes.delete(restored.levelId)) return;
    if (ctx.viewerIgnoredText === restored.text) ctx.viewerIgnoredText = null;
    deps.viewingLog?.codeRestored({
      text: restored.text,
      levelId: restored.levelId,
      evidence: restored.evidence,
    });
    hooks.renderArStatus();
  }

  /**
   * A device GPS fix, as the coordinator built it (main.ts hands this to
   * `createGpsPositionHandler` as `recordFix`): the keep-alive's trigger
   * (M2b) and, with D18, the fix's way into the store. The cadence is the one
   * M0b/M0c measured - one ring with each device fix - and nothing but a
   * device fix triggers it, so the keep-alive never answers a vote (its own
   * or a lock's). A fix is scheduled by when it ARRIVED, on the clock the
   * locks are timed on; its Geolocation time only stamps the votes (M2b
   * review #4). While the keep-alive casts a ring for it, the fix and the
   * ring are ONE batch, the fix first: one solve per tick, the compass
   * easing compounded per stored event (core 1.26). Otherwise - no viewer
   * entry (author mode, outside AR), no kept code, the fade owing less than
   * a ring, a fix whose time is not finite - it is the plain
   * `recordGpsEvent` it always was.
   */
  function recordDeviceFix(fix: RecordGpsEventPayload): void {
    const sink = ctx.viewerVoteSink;
    if (sink === null) {
      arStore.dispatch(recordGpsEvent(fix));
      return;
    }
    const ring =
      ctx.viewerKeepAlive?.votesForFix({
        atMs: now(),
        stampMs: fix.rawGpsPoint.timestamp,
      }) ?? [];
    sink.recordFix(fix, ring);
  }

  /**
   * The placement trigger: with a tour open and a viewer session running,
   * the capture join runs ONCE per session+tour as soon as the
   * tracking-quality phase reports ready (DEC-F3) - or a code placed the
   * tour (`codePlacedTour`, QR-first M1: on votes alone that phase reads
   * `degraded`). The rule matters little: every voted lock AFTER the gate
   * starts the placement itself (`onVotedLock`), bypassing readiness; it
   * decides only a scan whose one voted lock opened the gate, and this
   * trigger's own latch (`placementAttempted`). A later voted lock refines
   * the alignment under the placed planes, or places the ring when the join
   * declined. Author mode never places.
   */
  function tryPlaceTour(): void {
    placeTour();
    syncContent();
  }

  function placeTour(): void {
    if (authorMode || ctx.placementUnsubscribe === null) return;
    const current = ctx.session;
    if (current === null) {
      ctx.placement = { kind: "idle" };
      return;
    }
    // Nothing is placed until the gate allows it (DEC-N3): the capture-spot
    // join below, the content here.
    if (!gateAllowsPlacement(ctx.scanGate)) return;
    tryPlaceContent(current);
    if (ctx.placementAttempted || ctx.imagePlanes !== null) return;
    if (ctx.imagePlanesLoading) return;
    if (
      !isPlacementReady(selectTrackingQuality(arStore.getState())) &&
      !placedByCode()
    ) {
      // Only over idle/waiting: a pre-ready lock whose ring failed leaves a
      // decline reason that the next dispatch must not overwrite
      // (milestone review, residual hardening).
      if (
        ctx.placement.kind === "idle" ||
        ctx.placement.kind === "waiting-ready"
      ) {
        ctx.placement = { kind: "waiting-ready" };
      }
      return;
    }
    // The baked spots live in tour.json (scan-pass plan S1): a tour whose
    // manifest is still loading must not decline its photos for lacking a
    // recording. The manifest's settle calls this trigger again.
    if (ctx.tourManifestStatus === "pending") return;
    ctx.placementAttempted = true;
    if (
      !current.hasRecording &&
      ctx.tourDocument.manifest()?.captureSpots === undefined
    ) {
      // No walk to place; the ring (if the tour has codes) waits for a lock.
      ctx.joinDeclined = true;
      ctx.placement = { kind: "declined", reason: "no recording in this tour" };
      hooks.renderArStatus();
      return;
    }
    // A code placed the tour: the join runs WITH its code, so a join that
    // declines falls back to the ring in the same run (r857 review #3).
    // Without it the run's loading latch dropped the ring of the lock that
    // placed the tour, and a glance gets no later lock to retry.
    const lockedText = placedByCode() ? ctx.viewerLockedText : null;
    void placeTourImagePlanes(lockedText).catch((err: unknown) => {
      ctx.viewerPlanesError = describeOpenError(err, current.archive.url);
      hooks.renderArStatus();
    });
    hooks.renderArStatus();
  }

  /** What each drawn part logs, by part (`onMounted`). */
  const partLogs = new WeakMap<ContentPart, PlacedBase>();
  /** What the status line learns when a part settles: its render, or null
   *  when it could not be built (the walk's and the ring's loose parts,
   *  whose decode the line waits for). */
  const partSettled = new WeakMap<
    ContentPart,
    (rendered: RenderedPart | null) => void
  >();

  /** A walk or ring part none of whose photos could be decoded: said on
   *  the photos' channel, so the line does not claim them. */
  function notePhotosFailed(part: ContentPart, rendered: RenderedPart): void {
    if (
      part.kind === "content" ||
      rendered.count > 0 ||
      rendered.skipped.length === 0
    ) {
      return;
    }
    const n = rendered.skipped.length;
    ctx.viewerPlanesError = `${String(n)} ${n === 1 ? "photo" : "photos"} could not be decoded`;
  }

  /** This session's side table (`station-content.ts`), created with the
   *  first part; disposed at the session's end and with its tour. */
  function stationContentFor(scene: Scene): StationContent {
    if (ctx.stationContent === null) {
      ctx.stationContent = createStationContent({
        scene,
        now,
        // Smooth fades on a phone: every rendered frame of the AR session.
        registerFrame: (fn) => registerFrameUpdate(fn),
        // Logged per station, each time it is drawn (visitor plan §3).
        onMounted: (stationId, rendered, part) => {
          notePhotosFailed(part, rendered);
          partSettled.get(part)?.(rendered);
          const base = partLogs.get(part);
          if (base !== undefined) {
            deps.viewingLog?.placed({
              ...base,
              count: rendered.count,
              skipped: [...rendered.skipped],
              ...(stationId === LOOSE_STATION ? {} : { station: stationId }),
            });
          }
          hooks.renderArStatus();
        },
        // A part that could not be built (a label or plane constructor
        // throw) is said on the content's own channel (M5 review #5).
        // A walk or ring part that could not be built is said on the
        // photos' channel instead.
        onFailed: (_stationId, part, error) => {
          const said = describeOpenError(error, ctx.session?.archive.url);
          if (part.kind === "content") ctx.contentError = said;
          else ctx.viewerPlanesError = said;
          partSettled.get(part)?.(null);
          hooks.renderArStatus();
        },
        // Content no station holds stands whatever the presence says, and
        // decodes in its own lane: a present station never waits behind it.
        alwaysShown: (stationId) => stationId === LOOSE_STATION,
      });
    }
    return ctx.stationContent;
  }

  /** The stations shown now: the present one, or every one under "show
   *  all" (the store, `visitor-guide-slice.ts`). Content no station holds
   *  is the table's own (`alwaysShown`). */
  function shownStationIds(): Set<string> {
    const state = arStore.getState();
    const ids = new Set<string>();
    if (selectShowAllContent(state)) {
      for (const station of ctx.tourDocument.manifest()?.stations ?? []) {
        ids.add(station.id);
      }
      return ids;
    }
    const present = selectPresentStationId(state);
    if (present !== null) ids.add(present);
    return ids;
  }

  /** What the side table was last told, to tell it only changes. */
  let shownKey: string | null = null;
  let shownTo: StationContent | null = null;

  function syncContent(): void {
    const content = ctx.stationContent;
    if (content === null) return;
    const ids = shownStationIds();
    const key = [...ids].join("\n");
    if (key !== shownKey || content !== shownTo) {
      shownKey = key;
      shownTo = content;
      content.show(ids);
    }
    content.update(now());
  }

  /**
   * The tour's placed content (`tour.json`, M5), once per session as soon
   * as the gate allows it and the GPS zero exists - its geo → NUE
   * conversion needs only the zero, and after a lock with votes the
   * alignment under it is corrected within a dispatch (plan §2.2). Each
   * station with items becomes a part of the side table: decoded and drawn
   * only while its content shows (visitor plan M2).
   */
  function tryPlaceContent(current: TourSession): void {
    if (ctx.contentAttempted || ctx.tourManifestStatus !== "settled") return;
    const manifest = ctx.tourDocument.manifest();
    if (manifest === null || tourItems(manifest).length === 0) return;
    const zero = selectZeroReference(arStore.getState());
    const scene = seams.getScene();
    if (zero === null || scene === null) return;
    ctx.contentAttempted = true;
    const content = stationContentFor(scene);
    // Through the session, which knows the folder the manifest sits under:
    // in a re-zipped (wrapped) archive the bytes are at `mytour/content/…`
    // while the manifest names `content/…` (PR #435 review).
    const loadContent =
      deps.loadContent ?? ((path: string) => current.loadContentEntry(path));
    for (const station of manifest.stations) {
      if (station.items.length === 0) continue;
      // One group per station, its pins and photos as children at their
      // local poses (tour editor plan W3).
      const part: ContentPart = {
        kind: "content",
        render: (parent, alive) =>
          renderTourStation(station, {
            scene: parent,
            zero,
            alive,
            makeLabel: (text) => seams.createLabel(text),
            loadPhotoTexture: async (entryName) =>
              // Measured before it is decoded (tour kit K4 review R2).
              decodeFrameTexture(
                await loadContent(entryName),
                CAPTURE_PLANE_DECODE_DIVISOR,
                { maxPixels: TOUR_MAX_IMAGE_PIXELS },
              ),
          }),
      };
      partLogs.set(part, { what: "content", basis: "geo", zero });
      content.setPart(station.id, "items", part);
    }
  }

  /** QD-3's payoff, once per session — capture-first (geo-join plan Rev 2):
   *  photos at their CAPTURE positions when the recording supports it, the
   *  ring around the code otherwise. Either way at the SCENE ROOT in raw
   *  GPS-world NUE. */
  async function placeTourImagePlanes(
    lockedText: string | null,
  ): Promise<void> {
    const current = ctx.session;
    const scene = seams.getScene();
    const zero = selectZeroReference(arStore.getState());
    if (current === null) return;
    if (zero === null) {
      // Unreachable in practice (`ready` needs GPS data, and a code's
      // votes need the zero it sets itself, QR-first M1), so this decline
      // is effectively never shown; kept so it is never silent and never
      // final (M6 review #9): give the attempt back so the trigger retries
      // on the next dispatch.
      ctx.placementAttempted = false;
      ctx.placement = {
        kind: "declined",
        reason: "waiting for a GPS fix or a scanned code",
      };
      hooks.renderArStatus();
      return;
    }
    if (scene === null) {
      // Cannot fire once the runtime started (the world group exists), but
      // a bare return would strand the line on the coaching hint for the
      // rest of the session (milestone review #3).
      ctx.placement = { kind: "declined", reason: "the AR scene is not ready" };
      hooks.renderArStatus();
      return;
    }
    // The ring needs the locked code's geo; the capture join does not
    // (flows plan M4: the code refines a placement, it no longer gates one).
    const geo =
      lockedText === null ? undefined : ctx.levelByText.get(lockedText)?.qr.geo;
    ctx.imagePlanesLoading = true;
    const generation = ctx.planesRunGeneration;
    try {
      // A join failure is a taxonomy entry, not a dead end (milestone
      // review, finding 2): whatever the replay/compute throws, the visitor
      // still gets the ring once a code locks, with the failure visible in
      // the status line. A join that already declined is not replayed per
      // lock.
      let joined = false;
      if (!ctx.joinDeclined) {
        try {
          joined = await placeJoinedCapturePlanes(
            current,
            scene,
            zero,
            generation,
          );
        } catch (err) {
          ctx.placement = {
            kind: "declined",
            reason: `reading the recording failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          };
        }
        if (!joined && generation === ctx.planesRunGeneration) {
          ctx.joinDeclined = true;
        }
      }
      if (
        !joined &&
        geo !== undefined &&
        generation === ctx.planesRunGeneration
      ) {
        const centerNue = calcRelativeCoordsInMeters(
          zero,
          { lat: geo.lat, lon: geo.lon },
          geo.alt,
          0,
        );
        const ringCenter = [centerNue[0], centerNue[1], centerNue[2]] as const;
        if (lockedText !== null) {
          placeRing(current, scene, zero, ringCenter, {
            text: lockedText,
            geo,
          });
        }
      }
    } finally {
      // Only the run that still owns the latch may clear it — a stale run's
      // finally must not clobber a successor's in-progress state (milestone
      // review, finding 6).
      if (generation === ctx.planesRunGeneration) {
        ctx.imagePlanesLoading = false;
      }
    }
  }

  /** True while the AR session is live — the liveness every post-await
   *  step re-checks. The controller STATUS, not the QR controller (flows
   *  plan review #2): with no BarcodeDetector the QR controller is null for
   *  the whole session, and the old guard threw every decoded photo away. */
  function sessionLive(): boolean {
    return arController.getState().status === "running";
  }

  /**
   * The recorded photos' spots for this run: the ones the creator's Finish
   * baked into `tour.json` (scan-pass plan S1, S-D11), else the same bake
   * run here over the tour's recording (a tour never finished since S1).
   * Null whenever the ring should be placed instead; the reason lands in
   * the AR status line so a decline is visible, never silent.
   */
  async function captureSpotsForRun(
    current: TourSession,
    generation: number,
  ): Promise<CaptureSpotsInWorld | null> {
    const manifest = ctx.tourDocument.manifest();
    const baked = manifest === null ? undefined : worldCaptureSpots(manifest);
    if (baked !== undefined) return baked;
    const bake = await bakeCaptureSpots(current, {
      // Same bail contract as `decodeJoinedPoses` below. `onChunk` alone
      // gave this run a place to NOTICE it had been superseded but no way
      // to act: it could skip the status label while the replay kept
      // dispatching into a store nobody would read - on device, during an
      // XR session, competing with the frame loop (PR #379 review).
      shouldContinue: () => generation === ctx.planesRunGeneration,
      onChunk: (done, total) => {
        if (generation !== ctx.planesRunGeneration) return;
        ctx.placement = { kind: "placing", phase: "reading-walk", done, total };
        hooks.renderArStatus();
      },
    });
    // An aborted replay's state is PARTIAL by construction, so its decline
    // names a wrong reason, into a UI a newer run now owns. Bail silently.
    if (generation !== ctx.planesRunGeneration) return null;
    if (bake.kind === "declined") {
      ctx.placement = { kind: "declined", reason: bake.reason };
      return null;
    }
    return bake.spots;
  }

  /**
   * The capture-time geo join's viewer glue: the photos' spots (baked or
   * baked here) → one walk part per station (baked spots keep their
   * station, spots joined live get the Finish's rule, `station-captures.ts`),
   * decoded only while that station shows. Returns false whenever the ring
   * should be placed instead. The count is the photos placed in the tour; a
   * photo that will not decode is left out when its station is drawn (the
   * viewing log's `skipped`).
   */
  async function placeJoinedCapturePlanes(
    current: TourSession,
    scene: Scene,
    viewerZero: { lat: number; lon: number },
    generation: number,
  ): Promise<boolean> {
    const spots = await captureSpotsForRun(current, generation);
    if (spots === null) return false;
    const grouped = capturesByStation(
      spots.captures,
      ctx.tourDocument.manifest()?.stations ?? [],
    );
    const groups = [
      ...grouped.byStation,
      [LOOSE_STATION, grouped.loose] as const,
    ]
      .map(([id, captures]) => ({
        id,
        poses: posesOfCaptureSpots({ ...spots, captures }),
      }))
      .filter((group) => group.poses.length > 0);
    const total = groups.reduce((sum, group) => sum + group.poses.length, 0);
    if (total === 0) {
      if (generation === ctx.planesRunGeneration) {
        ctx.placement = {
          kind: "declined",
          reason: "no readable capture photos",
        };
      }
      return false;
    }
    // Re-checked AFTER the awaits — same bail contract as the ring path
    // (M4 milestone review #4) plus the GENERATION token (finding 6): a run
    // the session outlived must not plant planes into a dead scene.
    if (
      generation !== ctx.planesRunGeneration ||
      ctx.imagePlanes !== null ||
      ctx.session !== current ||
      !sessionLive()
    ) {
      return true;
    }
    const content = stationContentFor(scene);
    const join = {
      fixes: spots.fixes,
      gpsAccuracyMedianM: spots.gpsAccuracyMedianM,
    };
    const handle = {
      count: total,
      dispose: () => {
        for (const group of groups) content.setPart(group.id, "walk", null);
      },
    };
    ctx.imagePlanes = handle;
    const owns = (): boolean => ctx.imagePlanes === handle;
    const looseCount =
      groups.find((group) => group.id === LOOSE_STATION)?.poses.length ?? 0;
    // HONEST label (finding 5): the replayed state exposes no solve-error
    // metric (meanAlignmentError is model-internal), so the line reports
    // what the numbers actually are — fixes and their median GPS accuracy
    // — never a claimed placement error (the copy lives in tour-flow).
    // The count is what STANDS (M2 review B1): the loose photos once
    // decoded; the ones at their stations are counted where they wait.
    const placed = (count: number): PlacementState => ({
      kind: "placed",
      placedKind: "capture-spots",
      count,
      atStations: total - looseCount,
      fixes: spots.fixes,
      gpsAccuracyMedianM: spots.gpsAccuracyMedianM,
    });
    ctx.placement =
      looseCount > 0
        ? {
            kind: "placing",
            phase: "loading-photos",
            done: 0,
            total: looseCount,
          }
        : placed(0);
    for (const group of groups) {
      const loose = group.id === LOOSE_STATION;
      const part = walkPart(
        current,
        group.poses,
        viewerZero,
        loose ? loadingProgress(owns) : undefined,
      );
      partLogs.set(part, {
        what: "capture-spots",
        basis: "geo",
        zero: viewerZero,
        join,
      });
      if (loose) {
        partSettled.set(part, (rendered) => {
          if (owns()) ctx.placement = placed(rendered?.count ?? 0);
        });
      }
      content.setPart(group.id, "walk", part);
    }
    hooks.renderArStatus();
    return true;
  }

  /** The line's "loading photos k/N" while content no station holds
   *  decodes up front, as long as this run's planes still stand. */
  function loadingProgress(
    owns: () => boolean,
  ): (done: number, total: number) => void {
    return (done, total) => {
      if (!owns()) return;
      ctx.placement = { kind: "placing", phase: "loading-photos", done, total };
      hooks.renderArStatus();
    };
  }

  /** One station's walk photos as a part: decoded when the station is
   *  drawn, each a plane facing as the camera faced (`image-planes.ts`).
   *  `onProgress` hears each photo tried (decoded or skipped). */
  function walkPart(
    current: TourSession,
    poses: readonly CaptureWorldPose[],
    viewerZero: { lat: number; lon: number },
    onProgress?: (done: number, total: number) => void,
  ): ContentPart {
    return {
      kind: "capture-spots",
      render: async (parent, alive) => {
        const { paired, skipped } = await decodeJoinedPoses(
          current,
          poses,
          viewerZero,
          alive,
          onProgress,
        );
        const textures = paired.map((entry) => entry.texture);
        const planes = withTexturesFreedOnThrow(textures, () =>
          placeCapturedImagePlanes({ scene: parent, poses: paired, textures }),
        );
        return {
          count: planes.count,
          skipped,
          dispose: () => {
            planes.dispose();
          },
        };
      },
    };
  }

  /** Decode each joined capture's photo and express its geo in the VIEWER's
   *  NUE frame; a broken image just leaves that capture out (named in
   *  `skipped`). The geo conversion runs BEFORE the decode so a conversion
   *  throw cannot leak an already-decoded texture (finding 7). Stops once
   *  the station is no longer drawn (`alive`, PR #367 review: decoding
   *  into a dead scene burned tens of seconds of GPU uploads). */
  async function decodeJoinedPoses(
    current: TourSession,
    poses: readonly CaptureWorldPose[],
    viewerZero: { lat: number; lon: number },
    alive: () => boolean,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{
    paired: {
      positionNue: readonly [number, number, number];
      rotationNue: readonly [number, number, number, number];
      texture: Texture;
    }[];
    skipped: string[];
  }> {
    const paired: {
      positionNue: readonly [number, number, number];
      rotationNue: readonly [number, number, number, number];
      texture: Texture;
    }[] = [];
    const skipped: string[] = [];
    for (const [index, pose] of poses.entries()) {
      if (!alive()) break;
      try {
        const nue = calcRelativeCoordsInMeters(
          viewerZero,
          { lat: pose.geo.lat, lon: pose.geo.lon },
          pose.geo.altitude,
          0,
        );
        const texture = await decodeFrameTexture(
          await current.loadEntry(pose.imageFile),
          CAPTURE_PLANE_DECODE_DIVISOR,
          { maxPixels: TOUR_MAX_IMAGE_PIXELS },
        );
        if (texture === null) {
          skipped.push(pose.imageFile);
          continue;
        }
        paired.push({
          positionNue: [nue[0], nue[1], nue[2]],
          rotationNue: pose.rotationNue,
          texture,
        });
      } catch {
        // A broken image (or a degenerate geo) just leaves that capture out.
        skipped.push(pose.imageFile);
      } finally {
        onProgress?.(index + 1, poses.length);
      }
    }
    return { paired, skipped };
  }

  /** Run a plane constructor over decoded textures; if it throws, the
   *  textures it was handed are freed before the throw goes on (M2 review
   *  S3: nothing else holds them). */
  function withTexturesFreedOnThrow<T>(
    textures: readonly Texture[],
    build: () => T,
  ): T {
    try {
      return build();
    } catch (error) {
      for (const texture of textures) texture.dispose();
      throw error;
    }
  }

  /**
   * The ring around a code (a tour without a usable walk), with the station
   * nearest the code within the station radius (beyond every one, or with
   * no station, it stands always): the first three streamed images, decoded
   * when that station is drawn. One that will not decode leaves a gap (the
   * viewing log's `skipped`).
   */
  function placeRing(
    current: TourSession,
    scene: Scene,
    zero: { lat: number; lon: number },
    centerNue: readonly [number, number, number],
    code: { text: string; geo: NonNullable<QrLevel["qr"]["geo"]> },
  ): void {
    const images = entriesForVisitor(current.entries, ctx.scanEntries)
      .filter((candidate) => candidate.isImage)
      .slice(0, 3);
    // The tour may have closed, the AR session ended, or a sibling run won.
    if (
      images.length === 0 ||
      ctx.imagePlanes !== null ||
      ctx.session !== current ||
      !sessionLive()
    ) {
      return;
    }
    const stationId =
      nearestStationId(ctx.tourDocument.manifest()?.stations ?? [], code.geo) ??
      LOOSE_STATION;
    const loose = stationId === LOOSE_STATION;
    const content = stationContentFor(scene);
    const handle = {
      count: images.length,
      dispose: () => {
        content.setPart(stationId, "ring", null);
      },
    };
    const owns = (): boolean => ctx.imagePlanes === handle;
    const progress = loose ? loadingProgress(owns) : undefined;
    const part: ContentPart = {
      kind: "ring",
      render: async (parent, alive) => {
        const textures: Texture[] = [];
        const skipped: string[] = [];
        for (const [index, entry] of images.entries()) {
          if (!alive()) break;
          try {
            const texture = await decodeFrameTexture(
              await current.loadEntry(entry.filename),
              1,
              { maxPixels: TOUR_MAX_IMAGE_PIXELS },
            );
            if (texture === null) skipped.push(entry.filename);
            else textures.push(texture);
          } catch {
            // A broken image just leaves a gap in the ring.
            skipped.push(entry.filename);
          } finally {
            progress?.(index + 1, images.length);
          }
        }
        const planes = withTexturesFreedOnThrow(textures, () =>
          placeImagePlanes({
            scene: parent,
            positionsNue: imagePlaneRingNue(centerNue, textures.length),
            textures,
            centerNue,
          }),
        );
        return {
          count: planes.count,
          skipped,
          dispose: () => {
            planes.dispose();
          },
        };
      },
    };
    partLogs.set(part, {
      what: "ring",
      basis: "code",
      zero,
      code: { text: code.text, geo: code.geo, centerNue },
    });
    // The durable end state (the async-UI rule): a ring no station holds
    // says its decode, then the photos that stand once it is drawn; a ring
    // held by a station is counted there, drawn only while it shows.
    ctx.imagePlanes = handle;
    if (loose) {
      partSettled.set(part, (rendered) => {
        if (!owns()) return;
        ctx.placement = {
          kind: "placed",
          placedKind: "ring",
          count: rendered?.count ?? 0,
          atStations: 0,
        };
      });
      ctx.placement = {
        kind: "placing",
        phase: "loading-photos",
        done: 0,
        total: images.length,
      };
    } else {
      ctx.placement = {
        kind: "placed",
        placedKind: "ring",
        count: 0,
        atStations: images.length,
      };
    }
    content.setPart(stationId, "ring", part);
    hooks.renderArStatus();
  }

  return {
    startViewerPipeline,
    recordDeviceFix,
    tryPlaceTour,
    syncContent,
    startScanGate,
    resetScanGate,
    reconsiderScanGate,
  };
}
