/**
 * Viewer mode and the content placement; its own module. The default
 * passerby flow: the tour's own content (`tour.json`'s items) is placed
 * once the gate allows it and the GPS zero exists (`tryPlaceTour`), and
 * scanned codes relocalize the session via budgeted synthetic GPS votes
 * and REFINE the alignment under it. Until the tracking-quality phase
 * reports ready or a code placed the tour, the line coaches the visitor
 * (`waiting-ready`). A visitor never sees the walk, the zip's other
 * images, or the debug camera captures a `tour.json` may still carry. A
 * code scanned before any GPS fix sets the session zero itself
 * (`zeroFromCode`).
 *
 * What is placed is DRAWN per station:
 * the tour's items become parts of their station in the side table
 * (`station-content.ts`), and only the stations the store says are shown -
 * the present one, or all under "show all" - are decoded and stand in the
 * scene. `syncContent` follows the store on every dispatch and camera
 * frame.
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

import { registerFrameUpdate } from "gps-plus-slam-app-framework/ar/frame-loop";
import { tourItems } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import { renderTourStation } from "./content-placement.js";
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
  MAX_VOTED_LOCKS_PER_CODE,
} from "./qr-viewer-mode.js";
import type { QrVoteKeepAlive } from "./qr-vote-keep-alive.js";
import type { TourViewerSeams } from "./seams.js";
import { codePlacedTour, isPlacementReady } from "./tour-flow.js";
import type { TourSession } from "./tour-session.js";
import {
  isCodeIgnored,
  type ArController,
  type TourViewerHooks,
  type TourViewerSession,
  type TourViewerStore,
} from "./tour-viewer-session.js";
import { startEntryVoteSink } from "./viewer-vote-sink.js";
import { deviceSamples } from "./visit-log.js";
import type { ViewingLog } from "./viewing-log.js";
import {
  createStationContent,
  type ContentPart,
  type StationContent,
} from "./station-content.js";
import {
  selectPresentStationId,
  selectShowAllContent,
} from "./visitor-guide-slice.js";

/** The display downscale for a station's photos - the framework decoder's
 *  documented OOM mitigation (the recorder defaults to 2 for the same
 *  reason): full-res textures are a GPU-memory hazard (milestone review,
 *  finding 4). Since M2 only the shown station's photos are decoded, so
 *  the divisor is a margin, no longer the only bound. */
const PHOTO_DECODE_DIVISOR = 2;

/** What a drawn part logs (`placed`), less what its render reports. */
type PlacedBase = Omit<
  Parameters<ViewingLog["placed"]>[0],
  "count" | "skipped" | "station"
>;

type Scene = NonNullable<ReturnType<TourViewerSeams["getScene"]>>;

/** Properties, not methods: they are handed to the hooks object unbound. */
export interface ViewerPlacement {
  /** Creates the viewer tracking controller for THIS AR entry; false when
   *  there is no detector (the session is plain AR - still placing the
   *  tour's content). */
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
   *  cache in the page. That cache holds story media
   *  only, so an item photo is read from the archive again on every return
   *  until item photos join the prefetch. Absent: the
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

  /** The scanning gate's escape clock ran out; the escape waits for GPS. */
  let escapeClockElapsed = false;

  /**
   * Whether a device fix arrived in this AR entry: the store's GPS history
   * is this entry's (an AR exit resets it, while the session origin
   * survives), read through the one device-only filter, so a code's votes
   * never count as GPS.
   */
  function entryHasDeviceFix(): boolean {
    const state = arStore.getState();
    return (
      deviceSamples({
        gpsPositions: selectGpsPositions(state),
        odometryPositions: selectOdometryPositions(state),
      }).length > 0
    );
  }

  /**
   * "Continue with GPS only" once the clock ran out AND this entry has GPS
   * to continue with: a phone indoors may hold the permission and never get
   * a fix, and the escape would then promise a placement nothing can make.
   * Called when the clock runs out and on every device fix.
   */
  function offerEscapeWhenDue(): void {
    if (!escapeClockElapsed || ctx.scanGate.kind !== "scanning") return;
    if (ctx.scanGate.escapeOffered || !entryHasDeviceFix()) return;
    ctx.scanGate = { kind: "scanning", escapeOffered: true };
    escapeButton.hidden = false;
    hooks.renderArStatus();
  }

  function resetScanGate(): void {
    ctx.cancelEscapeClock?.();
    ctx.cancelEscapeClock = null;
    escapeClockElapsed = false;
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
    escapeClockElapsed = false;
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
      // get the escape - once a device fix gives it GPS to continue with.
      ctx.cancelEscapeClock = seams.schedule(() => {
        ctx.cancelEscapeClock = null;
        if (ctx.scanGate.kind !== "scanning") return;
        escapeClockElapsed = true;
        offerEscapeWhenDue();
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
          // A voted lock ends the wait for readiness; a later one refines
          // the alignment under the placed content. The gate is checked
          // HERE too: the framework dispatches a frame's votes BEFORE it
          // reports the lock, so the first voted lock arrives while the
          // gate still scans; the wait ends with the next budgeted vote
          // instead of relying on that ordering.
          placeOnVotedLock();
          hooks.renderArStatus();
        },
      }),
    );
    return true;
  }

  /** A voted lock once the gate allows it: the wait for tracking
   *  readiness ends, as the code lined the tour up. */
  function placeOnVotedLock(): void {
    if (authorMode || !gateAllowsPlacement(ctx.scanGate)) return;
    endReadinessWait();
  }

  /** The placement no longer waits for readiness, for the rest of this
   *  session and tour: a degraded dip does not bring the coaching back. */
  function endReadinessWait(): void {
    ctx.placementAttempted = true;
    ctx.placement = { kind: "idle" };
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
    storeDeviceFix(fix);
    // The escape waits for the first fix once its clock ran out.
    offerEscapeWhenDue();
  }

  function storeDeviceFix(fix: RecordGpsEventPayload): void {
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
   * the tour's content is placed once the gate allows it
   * (`tryPlaceContent`), and the line coaches the visitor until the
   * tracking-quality phase reports ready - or a code placed the tour
   * (`codePlacedTour`: on votes alone that phase reads `degraded`); then
   * the wait ends ONCE per session and tour. Every voted lock after the
   * gate ends it itself (`onVotedLock`), bypassing readiness; a later
   * voted lock refines the alignment under the placed content. Author mode
   * never places.
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
    // Nothing is placed until the gate allows it (DEC-N3).
    if (!gateAllowsPlacement(ctx.scanGate)) return;
    tryPlaceContent(current);
    if (ctx.placementAttempted) return;
    if (
      !isPlacementReady(selectTrackingQuality(arStore.getState())) &&
      !placedByCode()
    ) {
      ctx.placement = { kind: "waiting-ready" };
      return;
    }
    endReadinessWait();
  }

  /** What each drawn part logs, by part (`onMounted`). */
  const partLogs = new WeakMap<ContentPart, PlacedBase>();

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
          const base = partLogs.get(part);
          if (base !== undefined) {
            deps.viewingLog?.placed({
              ...base,
              count: rendered.count,
              skipped: [...rendered.skipped],
              station: stationId,
            });
          }
          hooks.renderArStatus();
        },
        // A part that could not be built (a label or plane constructor
        // throw) is said on the content's own channel (M5 review #5).
        onFailed: (_stationId, _part, error) => {
          ctx.contentError = describeOpenError(error, ctx.session?.archive.url);
          hooks.renderArStatus();
        },
      });
    }
    return ctx.stationContent;
  }

  /** The stations shown now: the present one, or every one under "show
   *  all" (the store, `visitor-guide-slice.ts`). */
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
                PHOTO_DECODE_DIVISOR,
                { maxPixels: TOUR_MAX_IMAGE_PIXELS },
              ),
          }),
      };
      partLogs.set(part, { what: "content", basis: "geo", zero });
      content.setPart(station.id, "items", part);
    }
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
