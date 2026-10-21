/**
 * The visitor's stations, composed (tour kit plan K4): the station guide
 * (`station-guide.ts`), the story panel (`scene-view.ts`), the AR stage
 * (`scene-stage.ts`) and the one sound channel (`scene-audio.ts`), wired to
 * the page's session object, store and seams. Glue: the behaviour lives in
 * those modules and is tested there; the e2e suite drives this composition
 * (`playwright-tests/stations.spec.js`). The walk's sheet, its away block
 * and its toasts (visitor walk W4 build plan M2) are drawn from here too,
 * from the guide's `view()` and the store's walk (`walk-sheet-model.ts`).
 */

import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectTrackingQuality,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import type { TourAsset } from "gps-plus-slam-app-framework/ar/tour-stations";
import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import { decodeFrameTexture } from "gps-plus-slam-app-framework/visualization/frame-texture-decoder";
import { registerFrameUpdate } from "gps-plus-slam-app-framework/ar/frame-loop";

import type { ViewerMode } from "./mode.js";
import { selectStationContentShown } from "./visitor-guide-slice.js";
import { pictureProblem } from "./image-cap.js";
import { createKeyedChain } from "./keyed-chain.js";
import { createBreadcrumbTrail } from "./breadcrumbs.js";
import { gateAllowsPlacement } from "./scan-gate.js";
import { createSceneAudio } from "./scene-audio.js";
import { createSceneStage } from "./scene-stage.js";
import { createSceneView, type SceneViewDom } from "./scene-view.js";
import type { TourViewerSeams } from "./seams.js";
import {
  wireStationGuide,
  type StationGuideDom,
  type StationTour,
} from "./station-guide.js";
import { createStationPrefetch, decodeFigure } from "./station-prefetch.js";
import { createStationRelocator, firstDeviceFix } from "./tour-relocation.js";
import { alignmentReady, codeLinedUp, isPlacementReady } from "./tour-flow.js";
import type {
  TourViewerSession,
  TourViewerStore,
} from "./tour-viewer-session.js";
import { visitorPosition } from "./visitor-position.js";
import { visitorStartView } from "./visitor-start.js";
import {
  selectWalkProgress,
  selectWalkSheet,
  selectWelcomePending,
  sheetSet,
  welcomeSet,
} from "./visitor-walk-slice.js";
import {
  wireWalkSheet,
  type WalkSheetDom,
  type WalkSheetView,
} from "./walk-sheet.js";
import {
  awayModel,
  walkHasProgress,
  walkSheetModel,
} from "./walk-sheet-model.js";
import type { WalkToast } from "./walk-toast.js";

/** Said once when a visitor comes back into AR with progress (W4). */
const WELCOME_BACK = "Welcome back - your progress is kept.";

/** Whether `progress` is the walk of the tour with these stations: a
 *  closed tour's walk stays in the store until the guide's next run. */
function walkOfTour(
  progress: { readonly stations: readonly { readonly id: string }[] },
  stations: readonly { readonly id: string }[],
): boolean {
  return (
    progress.stations.length === stations.length &&
    progress.stations.every((s, i) => s.id === stations[i]?.id)
  );
}

/**
 * Whether the visitor's stations may be offered now: a visitor's running
 * session whose scan gate allows placement. (Until r863 the stations also
 * waited for the compass wait; a code's rotation now stands from its first
 * lock, `viewer-vote-sink.ts` `VIEWER_SOFT_TRIM`.) Offered, they are found
 * on the alignment's position while it is ready (`tour-flow.ts`
 * `alignmentReady`, re-read by the guide each tick) and on the fresh
 * device fix while it is not, since the alignment is the identity from the
 * first fix. Pointed at, guided to and given a figure they are only once
 * the AR entry's alignment was ready (a heading; the guide latches it).
 */
export function stationPlacementAllowed(
  ctx: Pick<TourViewerSession, "placementUnsubscribe" | "scanGate">,
  mode: ViewerMode,
): boolean {
  return (
    mode === "visitor" &&
    ctx.placementUnsubscribe !== null &&
    gateAllowsPlacement(ctx.scanGate)
  );
}

/**
 * What the station guide reads of the alignment each tick: whether a code
 * lined it up (the viewer pipeline's voted locks this AR entry,
 * `tour-flow.ts` `codeLinedUp`), whether it is ready to be judged by
 * (`alignmentReady`, the readiness the walk's photos wait for), and
 * whether the tracking report reads ready (`isPlacementReady`; a lined-up
 * code's votes feed it too, so the guide latches its heading on it only
 * while no code is lined up).
 */
export function stationAlignmentSignals(
  ctx: Pick<TourViewerSession, "viewerLockedText" | "viewerVotedLocks">,
  arStore: Pick<TourViewerStore, "getState">,
): {
  codeLinedUp: () => boolean;
  alignmentReady: () => boolean;
  trackingReady: () => boolean;
} {
  const votes = () => ({
    lockedText: ctx.viewerLockedText,
    votedLocks: ctx.viewerVotedLocks,
  });
  return {
    codeLinedUp: () => codeLinedUp(votes()),
    alignmentReady: () =>
      alignmentReady(selectTrackingQuality(arStore.getState()), votes()),
    trackingReady: () =>
      isPlacementReady(selectTrackingQuality(arStore.getState())),
  };
}

/** Properties, not methods: they are handed to the hooks object unbound. */
export interface VisitorStations {
  /** Re-judge (a store change, a camera frame). */
  tick: () => void;
  /** Read one of the open tour's entries through the stations' cache: the
   *  station content's photos (`viewer-placement.ts`) share it. */
  loadContent: (path: string) => Promise<Blob>;
  codeLocked: (levelId: string) => void;
  /** Inside the "Start the tour" tap. */
  unlockAudio: () => void;
  /** The AR session ended or the tour closed: the story stops and the HUD
   *  goes; the progress stays with the open tour (a new tour starts anew). */
  stop: () => void;
  /** The visitor has progress on the open tour (W4 build plan M2, §1.8):
   *  the start page shows it, and the start reads "Back to the tour". */
  progressKept: () => boolean;
  /** The walk's sheet shows now: the guide runs (W4 build plan M2). */
  walkShown: () => boolean;
}

export function wireVisitorStations(deps: {
  ctx: TourViewerSession;
  mode: ViewerMode;
  arStore: TourViewerStore;
  seams: Pick<
    TourViewerSeams,
    | "getScene"
    | "getArPose"
    | "createWayfindingHud"
    | "loadGlbModel"
    | "createAudioElement"
  >;
  dom: {
    guide: StationGuideDom;
    scene: SceneViewDom;
    skipButton: HTMLButtonElement;
    continueButton: HTMLButtonElement;
    playNextButton: HTMLButtonElement;
    doc: Document;
  };
  now: () => number;
  schedule: (fn: () => void, ms: number) => () => void;
  /** The test switch `?relocate=here` (owner decision S-D9): move the
   *  tour's geo stations to the phone's first GPS fix. Off by default. */
  relocate?: { onRelocated: () => void };
  /** The walk's sheet and its toast (W4 build plan M2); absent: no sheet
   *  (the line and the skip button alone, as before). */
  walk?: {
    dom: WalkSheetDom;
    toast: WalkToast;
    /** The session's own way out (the completion card's "Exit AR"). */
    exitAr: () => void;
    /** The sheet came or went: the AR status re-routes its sentence
     *  (a placement wait gives way to a shown walk). */
    onShownChange?: () => void;
  };
}): VisitorStations {
  const { ctx, arStore, seams, dom } = deps;
  const relocator = createStationRelocator(
    deps.relocate !== undefined,
    deps.relocate?.onRelocated,
  );
  /** The phone's first DEVICE fix, for the test relocation (never a
   *  code's vote: QR-first M1 review #3). */
  function firstFix(): { lat: number; lon: number; alt: number } | null {
    return firstDeviceFix(selectGpsPositions(arStore.getState()));
  }
  const objectUrls = {
    create: (blob: Blob) => URL.createObjectURL(blob),
    revoke: (url: string) => {
      URL.revokeObjectURL(url);
    },
  };
  const audio = createSceneAudio({
    createElement: () => seams.createAudioElement(),
    objectUrls,
  });
  // The open tour's assets by id, built once per manifest (K4 review R13:
  // it was rebuilt on every read).
  let indexed: { manifest: unknown; byId: Map<string, TourAsset> } | null =
    null;
  const assetsById = (): ReadonlyMap<string, TourAsset> => {
    const manifest = ctx.tourDocument.manifest();
    if (indexed?.manifest !== manifest) {
      indexed = {
        manifest,
        byId: new Map((manifest?.assets ?? []).map((a) => [a.id, a])),
      };
    }
    return indexed.byId;
  };
  // Media are read ahead as the visitor approaches (`station-prefetch.ts`),
  // and the story's own reads go through the same cache. The cache lives
  // with the open tour's manifest: kept across AR sessions, dropped when
  // the tour closes or another opens (K4 review R15).
  const prefetch = createStationPrefetch({
    assets: assetsById,
    tour: () => ctx.tourDocument.manifest(),
    read: (path) => {
      const session = ctx.session;
      if (session === null) return Promise.reject(new Error("no tour open"));
      return session.loadContentEntry(path);
    },
  });
  // The decode cap: one figure decoded at a time, a large one scaled down.
  const decodes = createKeyedChain();
  const breadcrumbs = createBreadcrumbTrail({
    getScene: () => seams.getScene(),
  });
  // The guide is created below; the stage reads its poses late. The
  // figure's pose waits for a heading (`figurePoseOf`, r881 re-review
  // M-B): the stage parks the figure and the story says so.
  let poseOf: (id: string) => ReturnType<typeof guide.poseOf> = () => null;
  const stage = createSceneStage({
    getScene: () => seams.getScene(),
    poseOf: (id) => poseOf(id),
    // The figure measured from its own header (K4 review R2), and the
    // decoder holds the same cap again.
    decodeTexture: (blob) =>
      decodes.run("figure", () =>
        decodeFigure(blob, (b, divisor) =>
          decodeFrameTexture(b, divisor, {
            maxPixels: TOUR_MAX_IMAGE_PIXELS,
          }),
        ),
      ),
    loadModel: (blob) => seams.loadGlbModel(blob),
    // The figure fades with its station's content (`follow` below).
    now: deps.now,
    registerFrame: registerFrameUpdate,
  });
  // The sheet is drawn after a guide call, never from inside one.
  const calls = createCallGuard(() => {
    renderSheet();
  });
  const view = createSceneView({
    dom: dom.scene,
    // A getter: the open tour's assets, read when a step needs one.
    get assets() {
      return assetsById();
    },
    loadAsset: (path) => prefetch.load(path),
    audio,
    stage,
    checkPicture: (blob) => pictureProblem(blob),
    createChoiceButton: (label, onClick) => {
      const button = dom.doc.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = label;
      button.dataset["testid"] = "scene-choice";
      button.addEventListener("click", onClick);
      return button;
    },
    schedule: deps.schedule,
    objectUrls,
    onStoryEnd: (stationId) => {
      calls.during(() => {
        guide.storyEnded(stationId);
      });
    },
    // A story's step changed, or it ended: its dots and the peek follow,
    // after the guide call it happened in (never a half-made view).
    onChange: () => {
      calls.request();
    },
  });
  /** The open tour's stations as the guide reads them. */
  function guideTour(): StationTour | null {
    const manifest = ctx.tourDocument.manifest();
    if (ctx.tourManifestStatus !== "settled" || manifest === null) {
      return null;
    }
    const stations = relocator(manifest.stations, firstFix());
    if (stations === null) return null;
    return { stations, order: manifest.order };
  }
  const guide = wireStationGuide({
    dom: dom.guide,
    tour: guideTour,
    placementAllowed: () => stationPlacementAllowed(ctx, deps.mode),
    zero: () => selectZeroReference(arStore.getState()),
    visitor: () => {
      const state = arStore.getState();
      return visitorPosition({
        alignment: selectAlignmentMatrix(state),
        arPose: seams.getArPose(),
        gpsPositions: selectGpsPositions(state),
        zero: selectZeroReference(state),
      });
    },
    ...stationAlignmentSignals(ctx, arStore),
    startHud: (getTargets) => seams.createWayfindingHud({ getTargets }),
    now: deps.now,
    // The present station (visitor plan 2026-10-18-2349 M1): judged here,
    // drawn per station from M2 on.
    guideStore: arStore,
    // The visitor's walk (W4 build plan M1): in the page's store too.
    walkStore: arStore,
    onFound: (station) => {
      view.offer(station);
    },
    onApproach: (station, distanceM, activateM) => {
      prefetch.approach(station, distanceM, activateM);
    },
    onDone: (stationId) => {
      prefetch.done(stationId);
    },
    onUpcoming: (station) => {
      prefetch.ahead(station);
    },
    onEndStory: (stationId) => {
      view.end(stationId);
    },
    onVisitor: (nue) => {
      stage.faceVisitor(nue);
    },
    onGuide: (visitor, target) => {
      breadcrumbs.update(visitor, target);
    },
  });
  poseOf = (id) => guide.figurePoseOf(id);

  const walk = deps.walk;
  /** The note last said in the toast (it lasts 6 s in the store): the
   *  toast's dedup, a DOM resource like the toast's own (`walk-toast.ts`),
   *  not walk state any view reads. */
  let saidNote: string | null = null;
  /** What the last render drew (the sheet shown or not): a mirror of the
   *  DOM, read by the status and compared to call `onShownChange`. */
  let sheetShown = false;
  const sheetView: WalkSheetView | null =
    walk === undefined
      ? null
      : wireWalkSheet({
          dom: walk.dom,
          sheet: () => selectWalkSheet(arStore.getState()),
          setSheet: (sheet) => {
            arStore.dispatch(sheetSet(sheet));
            renderSheet();
          },
          keepListening: () => {
            calls.during(() => {
              guide.cancelAsk();
            });
            renderSheet();
          },
          exit: () => {
            walk.exitAr();
          },
        });

  /** The open tour's walk with progress, or null (the away block's, and
   *  the start's "Back to the tour"). */
  function keptWalk(): {
    tour: StationTour;
    progress: NonNullable<ReturnType<typeof selectWalkProgress>>;
  } | null {
    const tour = guideTour();
    const progress = selectWalkProgress(arStore.getState());
    if (tour === null || progress === null) return null;
    if (!walkOfTour(progress, tour.stations)) return null;
    return walkHasProgress(progress) ? { tour, progress } : null;
  }

  function markShown(shown: boolean): void {
    if (shown === sheetShown) return;
    sheetShown = shown;
    walk?.onShownChange?.();
  }

  /** The sheet, from the guide's view and the store's walk: hidden while
   *  the guide does not run, and the away block in its place outside AR. */
  function renderSheet(): void {
    if (sheetView === null || walk === undefined) return;
    const guideView = guide.view();
    const tour = guideTour();
    const state = arStore.getState();
    const progress = selectWalkProgress(state);
    if (guideView === null || tour === null || progress === null) {
      sheetView.render(null, NO_SHEET);
      markShown(false);
      return;
    }
    const playing = view.playing();
    const sheet = selectWalkSheet(state);
    const model = walkSheetModel({
      stations: tour.stations,
      order: tour.order,
      tourTitle: visitorStartView(ctx.tourDocument.manifest()).title,
      progress,
      view: guideView,
      story: playing === null ? null : { stationId: playing },
      sheet,
    });
    sheetView.render(model, {
      sheet,
      quick: guideView.quick,
      position: guideView.position,
      story:
        playing === null
          ? null
          : { stationId: playing, progress: view.progress() },
    });
    sheetView.renderAway(null);
    markShown(true);
    // What a skip did is said once (W4: a toast, not the line), and the
    // welcome back with it: one render's words are one toast.
    const words: string[] = [];
    if (guideView.note !== saidNote) {
      saidNote = guideView.note;
      if (guideView.note !== null) words.push(guideView.note);
    }
    if (selectWelcomePending(state)) {
      arStore.dispatch(welcomeSet(false));
      words.push(WELCOME_BACK);
      // Only the toast says it, and its root is aria-hidden.
      walk.toast.announce(WELCOME_BACK);
    }
    walk.toast.say(words);
  }

  /** Outside AR: the walk's progress on the start page (W4, §1.8). */
  function renderAway(): void {
    if (sheetView === null) return;
    const kept = keptWalk();
    sheetView.renderAway(
      kept === null
        ? null
        : awayModel({
            stations: kept.tour.stations,
            order: kept.tour.order,
            progress: kept.progress,
          }),
    );
  }

  /** A tap on the skip button or the story card's end control: the guide
   *  does what the label showed. */
  function quickTapped(): void {
    calls.during(() => {
      guide.skipTapped();
    });
    renderSheet();
  }

  dom.skipButton.addEventListener("click", quickTapped);
  walk?.dom.storyEnd.addEventListener("click", quickTapped);
  dom.continueButton.addEventListener("click", () => {
    view.continueTapped();
  });
  dom.playNextButton.addEventListener("click", () => {
    view.playNextNow();
  });

  return {
    tick: () => {
      calls.during(() => {
        guide.tick();
      });
      // The figure shows only where its station's content does.
      stage.follow((id) => selectStationContentShown(arStore.getState(), id));
      renderSheet();
    },
    loadContent: (path) => prefetch.load(path),
    // A lock only improved the position (D16): the guide re-judges now.
    codeLocked: () => {
      calls.during(() => {
        guide.codeLocked();
      });
      renderSheet();
    },
    unlockAudio: () => {
      audio.unlock();
    },
    stop: () => {
      calls.during(() => {
        view.stopAll();
        guide.endSession();
      });
      // A tour close has already dropped the manifest: the cache goes now;
      // a session end keeps it for the next session (R15).
      prefetch.sync();
      // The sheet goes with the session; the progress shows on the start
      // page, and the next entry welcomes the visitor back (W4, §1.8) at
      // the peek, as W4 does, even when the list was open on leaving.
      saidNote = null;
      arStore.dispatch(welcomeSet(keptWalk() !== null));
      arStore.dispatch(sheetSet("peek"));
      renderSheet();
      renderAway();
    },
    progressKept: () => keptWalk() !== null,
    walkShown: () => sheetShown,
  };
}

/**
 * A render that waits for the calls in progress (W4 build plan M2 review):
 * `request` inside `during` defers it to the end of the outermost call,
 * once; outside any call it renders at once. A story's `onChange` fires
 * from inside a guide call (a find starts the story), where the guide's
 * view is half made and its walk batch has not reached the store yet.
 */
export function createCallGuard(render: () => void): {
  during(call: () => void): void;
  request(): void;
} {
  let depth = 0;
  let pending = false;
  return {
    during(call) {
      depth += 1;
      try {
        call();
      } finally {
        depth -= 1;
        if (depth === 0 && pending) {
          pending = false;
          render();
        }
      }
    },
    request() {
      if (depth > 0) pending = true;
      else render();
    },
  };
}

/** The sheet's extras while it is hidden (read by nothing). */
const NO_SHEET = {
  sheet: "peek",
  quick: null,
  position: "pending",
  story: null,
} as const;
