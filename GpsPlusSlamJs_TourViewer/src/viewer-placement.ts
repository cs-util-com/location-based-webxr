/**
 * Viewer mode (QR-pose plan M4) and the photo placement (geo-join plan,
 * flows plan M4); its own module since the flows plan M6. The default
 * passerby flow: the tour's photos are placed at their capture spots once
 * the tracking-quality phase reports ready (`tryPlaceTour`), scanned codes
 * relocalize the session via budgeted synthetic GPS votes and REFINE the
 * alignment under the placed planes, and the ring around a code is the
 * fallback for a tour without a recording.
 */

import { createQrTrackingController } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import {
  recordGpsEvent,
  recordQrDetection,
  replayActions,
  selectStableQrPose,
  selectTrackingQuality,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import { decodeFrameTexture } from "gps-plus-slam-app-framework/visualization/frame-texture-decoder";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { Texture } from "three";

import {
  assessReplayedJoin,
  computeCaptureGeoJoin,
  preflightCaptureJoin,
  type ReplayedJoinState,
} from "./capture-geo-join.js";
import { renderTourObjects } from "./content-placement.js";
import { placeCapturedImagePlanes, placeImagePlanes } from "./image-planes.js";
import type { ViewerMode } from "./mode.js";
import { describeOpenError } from "./open-errors.js";
import {
  gateAllowsPlacement,
  isLockableLevel,
  reconsiderScanGate as reconsiderGate,
  SCAN_GATE_ESCAPE_MS,
  scanGateAtSessionStart,
} from "./scan-gate.js";
import {
  buildViewerControllerConfig,
  imagePlaneRingNue,
} from "./qr-viewer-mode.js";
import type { TourViewerSeams } from "./seams.js";
import { isPlacementReady } from "./tour-flow.js";
import type { TourSession } from "./tour-session.js";
import type {
  ArController,
  TourViewerHooks,
  TourViewerSession,
  TourViewerStore,
} from "./tour-viewer-session.js";

/** The display downscale for capture planes — the framework decoder's
 *  documented OOM mitigation (the recorder defaults to 2 for the same
 *  reason): D4 places ALL captures, and full-res textures for a long walk
 *  are a GPU-memory hazard the owner's decision did not include
 *  (milestone review, finding 4). */
const CAPTURE_PLANE_DECODE_DIVISOR = 2;

type Scene = NonNullable<ReturnType<TourViewerSeams["getScene"]>>;

/** Properties, not methods: they are handed to the hooks object unbound. */
export interface ViewerPlacement {
  /** Creates the viewer tracking controller for THIS AR entry; false when
   *  there is no detector (the session is plain AR - still placing photos). */
  startViewerPipeline: () => boolean;
  /** The ready-triggered placement; cheap enough to run on every dispatch. */
  tryPlaceTour: () => void;
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
  /** Whether this session has a detector (set by startViewerPipeline). */
  let hasDetector = false;

  function passGate(via: "code" | "skipped"): void {
    if (ctx.scanGate.kind !== "scanning") return;
    ctx.cancelEscapeClock?.();
    ctx.cancelEscapeClock = null;
    escapeButton.hidden = true;
    ctx.scanGate = { kind: "passed", via };
    // Place first, render after: the line describes the placement state
    // the pass produced, not the one before it (M5 review #7).
    tryPlaceTour();
    hooks.renderArStatus();
  }

  function resetScanGate(): void {
    ctx.cancelEscapeClock?.();
    ctx.cancelEscapeClock = null;
    escapeButton.hidden = true;
    ctx.scanGate = { kind: "idle" };
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
    ctx.scanGate = scanGateAtSessionStart({
      mode,
      hasDetector,
      levels: ctx.currentLevels,
    });
    if (ctx.scanGate.kind === "scanning") {
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
    const next = reconsiderGate(ctx.scanGate, levels);
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
    const frontEnd = seams.createQrFrontEnd();
    hasDetector = frontEnd !== null;
    if (frontEnd === null) {
      // Viewing without a detector still works as plain AR — no error
      // state, the QR line just never appears.
      return false;
    }
    ctx.qrController = createQrTrackingController(
      buildViewerControllerConfig({
        frontEnd,
        solvePose: (input) => seams.solveQrPose(input),
        getCameraPose: () => seams.getCameraPose(),
        getIntrinsics: (image) => seams.getIntrinsics(image),
        getLevels: () => ctx.currentLevels,
        dispatchVote: (payload) => {
          arStore.dispatch(recordGpsEvent(payload));
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
        resolveStablePose: (text) =>
          selectStableQrPose(arStore.getState(), text),
        recordDetection: (event) => {
          ctx.viewerUnknownCode = null; // a level-carrying detection supersedes it
          ctx.viewerUnusableCode = null;
          ctx.latestReprojectionPx = event.reprojectionErrorPx;
          arStore.dispatch(recordQrDetection(event));
          const level = ctx.levelByText.get(event.text) ?? null;
          ctx.qrDebugView?.update(
            event.qrPoseWorld,
            level?.qr.physicalSizeM ?? null,
          );
        },
        onLevelResolved: (text, level) => {
          ctx.levelByText.set(text, level);
        },
        onLocked: (level) => {
          // The gate passes on the LOCK against a lockable level, not on a
          // vote (M5; plan review #1).
          if (isLockableLevel(level)) passGate("code");
        },
        onError: (message) => {
          errorBox.textContent = `QR tracking failed: ${message}`;
        },
        onStatus: (status) => {
          ctx.viewerQrStatus = status;
          hooks.renderArStatus();
        },
        onUnknownCode: (code) => {
          ctx.viewerUnknownCode = code;
          hooks.renderArStatus();
        },
        onUnusableLevel: (code) => {
          ctx.viewerUnusableCode = code;
          hooks.renderArStatus();
        },
        onVotedLock: (text, votedLocks) => {
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
          if (
            gateAllowsPlacement(ctx.scanGate) &&
            ctx.imagePlanes === null &&
            !ctx.imagePlanesLoading
          ) {
            void placeTourImagePlanes(text).catch((err: unknown) => {
              // The archive URL is known here — a Drive failure during
              // plane loading deserves the Drive-specific message too
              // (milestone review, finding 7).
              ctx.viewerPlanesError = describeOpenError(
                err,
                ctx.session?.archive.url,
              );
              hooks.renderArStatus();
            });
          }
          hooks.renderArStatus();
        },
      }),
    );
    return true;
  }

  /**
   * The placement trigger: with a tour open and a viewer session running,
   * the capture join runs ONCE per session+tour as soon as the
   * tracking-quality phase reports ready (DEC-F3). A later voted lock
   * refines the alignment under the placed planes, or places the ring when
   * the join declined. Author mode never places.
   */
  function tryPlaceTour(): void {
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
    if (!isPlacementReady(selectTrackingQuality(arStore.getState()))) {
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
    ctx.placementAttempted = true;
    if (!current.hasRecording) {
      // No walk to place; the ring (if the tour has codes) waits for a lock.
      ctx.joinDeclined = true;
      ctx.placement = { kind: "declined", reason: "no recording in this tour" };
      hooks.renderArStatus();
      return;
    }
    void placeTourImagePlanes(null).catch((err: unknown) => {
      ctx.viewerPlanesError = describeOpenError(err, current.archive.url);
      hooks.renderArStatus();
    });
    hooks.renderArStatus();
  }

  /**
   * The tour's placed content (`tour.json`, M5): rendered once per session
   * as soon as the gate allows it and the GPS zero exists - its geo → NUE
   * conversion needs only the zero, and after a lock with votes the
   * alignment under it is corrected within a dispatch (plan §2.2).
   */
  function tryPlaceContent(current: TourSession): void {
    if (ctx.contentAttempted || ctx.tourManifestStatus !== "settled") return;
    const manifest = ctx.tourManifest;
    if (manifest === null || manifest.objects.length === 0) return;
    const zero = selectZeroReference(arStore.getState());
    const scene = seams.getScene();
    if (zero === null || scene === null) return;
    // Latched before the await on purpose (M5 review #5 weighed the
    // give-back): the only failures below are a label or plane constructor
    // throw, which is deterministic - giving the attempt back would retry
    // it on every dispatch at the frame cadence.
    ctx.contentAttempted = true;
    const generation = ctx.planesRunGeneration;
    void renderTourObjects(manifest.objects, {
      scene,
      zero,
      makeLabel: (text) => seams.createLabel(text),
      // Through the session, which knows the folder the manifest sits
      // under: in a re-zipped (wrapped) archive the bytes are at
      // `mytour/content/…` while the manifest names `content/…`
      // (PR #435 review).
      loadPhotoTexture: async (entryName) =>
        decodeFrameTexture(
          await current.loadContentEntry(entryName),
          CAPTURE_PLANE_DECODE_DIVISOR,
        ),
    }).then(
      (rendered) => {
        // A run the session outlived must not plant into a dead scene.
        if (generation !== ctx.planesRunGeneration || ctx.session !== current) {
          rendered.dispose();
          return;
        }
        ctx.contentRendered = rendered;
        hooks.renderArStatus();
      },
      (err: unknown) => {
        ctx.contentError = describeOpenError(err, current.archive.url);
        hooks.renderArStatus();
      },
    );
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
      // Unreachable in practice (`ready` needs GPS data, which sets the
      // zero) but never silent and never final (M6 review #9): give the
      // attempt back so the trigger retries on the next dispatch.
      ctx.placementAttempted = false;
      ctx.placement = {
        kind: "declined",
        reason: "waiting for the first GPS fix",
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
        await placeDecodedPlanes(current, scene, [
          centerNue[0],
          centerNue[1],
          centerNue[2],
        ]);
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
   * The capture-time geo join's viewer glue: gates → chunked replay →
   * per-capture placement. Returns false whenever the ring should be placed
   * instead; the reason lands in the AR status line so a decline is
   * visible, never silent.
   */
  async function placeJoinedCapturePlanes(
    current: TourSession,
    scene: Scene,
    viewerZero: { lat: number; lon: number },
    generation: number,
  ): Promise<boolean> {
    const [meta, actions] = await Promise.all([
      current.loadSessionMeta(),
      current.loadRecordingActions(),
    ]);
    if (actions === null) {
      ctx.placement = { kind: "declined", reason: "no recording in this tour" };
      return false;
    }
    const pre = preflightCaptureJoin(
      meta,
      actions.map((a) => a.type),
    );
    if (!pre.ok) {
      ctx.placement = { kind: "declined", reason: pre.reason };
      return false;
    }
    const state = (await replayActions(actions, {
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
    })) as unknown as ReplayedJoinState;
    // An aborted replay returns a PARTIAL state by construction, so
    // `assessReplayedJoin` would decline it and write a status naming the
    // missing GPS data - a wrong reason, into a UI a newer run now owns.
    // Bail silently instead.
    if (generation !== ctx.planesRunGeneration) return false;
    const verdict = assessReplayedJoin(state);
    if (!verdict.ok) {
      ctx.placement = { kind: "declined", reason: verdict.reason };
      return false;
    }
    const paired = await decodeJoinedPoses(
      current,
      computeCaptureGeoJoin(state),
      viewerZero,
      generation,
    );
    // Re-checked AFTER the awaits — same bail contract as the ring path
    // (M4 milestone review #4) plus the GENERATION token (finding 6): every
    // loser frees its textures, and a run the session outlived must not
    // plant planes into a dead scene.
    if (
      paired.length === 0 ||
      generation !== ctx.planesRunGeneration ||
      ctx.imagePlanes !== null ||
      ctx.session !== current ||
      !sessionLive()
    ) {
      for (const entry of paired) entry.texture.dispose();
      if (paired.length === 0 && generation === ctx.planesRunGeneration) {
        ctx.placement = {
          kind: "declined",
          reason: "no readable capture photos",
        };
      }
      return paired.length === 0 ? false : true;
    }
    ctx.imagePlanes = placeCapturedImagePlanes({
      scene,
      poses: paired,
      textures: paired.map((entry) => entry.texture),
    });
    // HONEST label (finding 5): the replayed state exposes no solve-error
    // metric (meanAlignmentError is model-internal), so the line reports
    // what the numbers actually are — fixes and their median GPS accuracy
    // — never a claimed placement error (the copy lives in tour-flow).
    ctx.placement = {
      kind: "placed",
      placedKind: "capture-spots",
      count: ctx.imagePlanes.count,
      fixes: verdict.quality.pairCount,
      gpsAccuracyMedianM: verdict.quality.gpsAccuracyMedianM,
    };
    hooks.renderArStatus();
    return true;
  }

  /** Decode each joined capture's photo and express its geo in the VIEWER's
   *  NUE frame; a broken image just leaves that capture out. The geo
   *  conversion runs BEFORE the decode so a conversion throw cannot leak an
   *  already-decoded texture (finding 7), and the decode — the slowest
   *  phase — reports progress (finding 4's async-UI half). */
  async function decodeJoinedPoses(
    current: TourSession,
    poses: readonly ReturnType<typeof computeCaptureGeoJoin>[number][],
    viewerZero: { lat: number; lon: number },
    generation: number,
  ): Promise<
    {
      positionNue: readonly [number, number, number];
      rotationNue: readonly [number, number, number, number];
      texture: Texture;
    }[]
  > {
    const paired: {
      positionNue: readonly [number, number, number];
      rotationNue: readonly [number, number, number, number];
      texture: Texture;
    }[] = [];
    let index = 0;
    for (const pose of poses) {
      index += 1;
      // A bumped token means the session ended or a newer run won: STOP
      // decoding into a dead scene (PR #367 review — noticing the token
      // only for the status text kept burning tens of seconds of decode +
      // GPU uploads the caller would immediately dispose).
      if (generation !== ctx.planesRunGeneration) break;
      ctx.placement = {
        kind: "placing",
        phase: "loading-photos",
        done: index,
        total: poses.length,
      };
      hooks.renderArStatus();
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
        );
        if (texture === null) continue;
        paired.push({
          positionNue: [nue[0], nue[1], nue[2]],
          rotationNue: pose.rotationNue,
          texture,
        });
      } catch {
        // A broken image (or a degenerate geo) just leaves that capture out.
      }
    }
    return paired;
  }

  async function placeDecodedPlanes(
    current: TourSession,
    scene: Scene,
    centerNue: readonly [number, number, number],
  ): Promise<void> {
    const textures = await decodeTourTextures(current);
    // Re-checked AFTER the awaits: the tour may have closed, the AR session
    // may have ended, or a sibling run may have won — every bail path must
    // FREE its textures, not leak them (M4 milestone review #4).
    if (
      textures.length === 0 ||
      ctx.imagePlanes !== null ||
      ctx.session !== current ||
      !sessionLive()
    ) {
      for (const texture of textures) texture.dispose();
      return;
    }
    ctx.imagePlanes = placeImagePlanes({
      scene,
      positionsNue: imagePlaneRingNue(centerNue, textures.length),
      textures,
      centerNue,
    });
    // Confirm the ring (milestone review #2): the async-UI rule wants the
    // durable end state, and the decline copy alone read as "pending". The
    // count is the SCENE's (M6 review #7), not the texture list's.
    ctx.placement = {
      kind: "placed",
      placedKind: "ring",
      count: ctx.imagePlanes.count,
    };
    hooks.renderArStatus();
  }

  /** First three streamed images → upright textures; a broken image just
   *  leaves a gap in the ring. */
  async function decodeTourTextures(current: TourSession): Promise<Texture[]> {
    const textures: Texture[] = [];
    for (const entry of current.entries
      .filter((candidate) => candidate.isImage)
      .slice(0, 3)) {
      try {
        const texture = await decodeFrameTexture(
          await current.loadEntry(entry.filename),
        );
        if (texture !== null) textures.push(texture);
      } catch {
        // A broken image just leaves a gap in the ring.
      }
    }
    return textures;
  }

  return {
    startViewerPipeline,
    tryPlaceTour,
    startScanGate,
    resetScanGate,
    reconsiderScanGate,
  };
}
