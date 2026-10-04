/**
 * The visitor's stations, composed (tour kit plan K4): the station guide
 * (`station-guide.ts`), the story panel (`scene-view.ts`), the AR stage
 * (`scene-stage.ts`) and the one sound channel (`scene-audio.ts`), wired to
 * the page's session object, store and seams. Glue: the behaviour lives in
 * those modules and is tested there; the e2e suite drives this composition
 * (`playwright-tests/stations.spec.js`).
 */

import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import { decodeFrameTexture } from "gps-plus-slam-app-framework/visualization/frame-texture-decoder";

import type { ViewerMode } from "./mode.js";
import { createKeyedChain } from "./keyed-chain.js";
import { createBreadcrumbTrail } from "./breadcrumbs.js";
import { gateAllowsPlacement } from "./scan-gate.js";
import { createSceneAudio } from "./scene-audio.js";
import { createSceneStage } from "./scene-stage.js";
import { createSceneView, type SceneViewDom } from "./scene-view.js";
import type { TourViewerSeams } from "./seams.js";
import { wireStationGuide, type StationGuideDom } from "./station-guide.js";
import { createStationPrefetch, decodeDivisor } from "./station-prefetch.js";
import type {
  TourViewerSession,
  TourViewerStore,
} from "./tour-viewer-session.js";
import { visitorPosition } from "./visitor-position.js";

/** Properties, not methods: they are handed to the hooks object unbound. */
export interface VisitorStations {
  /** Re-judge (a store change, a camera frame). */
  tick: () => void;
  codeLocked: (levelId: string) => void;
  /** Inside the "Start the tour" tap. */
  unlockAudio: () => void;
  /** The AR session ended or the tour closed: the story stops and the HUD
   *  goes; the progress stays with the open tour (a new tour starts anew). */
  stop: () => void;
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
}): VisitorStations {
  const { ctx, arStore, seams, dom } = deps;
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
  const assetsById = () =>
    new Map((ctx.tourManifest?.assets ?? []).map((asset) => [asset.id, asset]));
  // Media are read ahead as the visitor approaches (`station-prefetch.ts`),
  // and the story's own reads go through the same cache. The cache lives
  // with the open tour's manifest: kept across AR sessions, dropped when
  // the tour closes or another opens (K4 review R15).
  const prefetch = createStationPrefetch({
    assets: assetsById,
    tour: () => ctx.tourManifest,
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
  // The guide is created below; the stage reads its poses late.
  let poseOf: (id: string) => ReturnType<typeof guide.poseOf> = () => null;
  const stage = createSceneStage({
    getScene: () => seams.getScene(),
    poseOf: (id) => poseOf(id),
    decodeTexture: (blob, size) =>
      decodes.run("figure", () =>
        decodeFrameTexture(blob, decodeDivisor(size)),
      ),
    loadModel: (blob) => seams.loadGlbModel(blob),
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
      guide.storyEnded(stationId);
    },
  });
  const guide = wireStationGuide({
    dom: dom.guide,
    tour: () => {
      const manifest = ctx.tourManifest;
      if (ctx.tourManifestStatus !== "settled" || manifest === null) {
        return null;
      }
      return {
        stations: manifest.stations,
        order: manifest.order,
        levels: ctx.currentLevels,
      };
    },
    placementAllowed: () =>
      deps.mode === "visitor" &&
      ctx.placementUnsubscribe !== null &&
      gateAllowsPlacement(ctx.scanGate),
    zero: () => selectZeroReference(arStore.getState()),
    visitor: () => {
      const state = arStore.getState();
      return visitorPosition({
        alignment: selectAlignmentMatrix(state),
        arPose: seams.getArPose(),
        gpsPositions: selectGpsPositions(state),
      });
    },
    isIgnoredCode: (levelId) => ctx.ignoredCodes.has(levelId),
    startHud: (getTargets) => seams.createWayfindingHud({ getTargets }),
    now: deps.now,
    onFound: (station) => {
      view.offer(station);
    },
    onApproach: (station, distanceM, activateM) => {
      prefetch.approach(station, distanceM, activateM);
    },
    onDone: (stationId) => {
      prefetch.done(stationId);
    },
    onVisitor: (nue) => {
      stage.faceVisitor(nue);
    },
    onGuide: (visitor, target) => {
      breadcrumbs.update(visitor, target);
    },
  });
  poseOf = (id) => guide.poseOf(id);

  dom.skipButton.addEventListener("click", () => {
    guide.skipTapped();
  });
  dom.continueButton.addEventListener("click", () => {
    view.continueTapped();
  });
  dom.playNextButton.addEventListener("click", () => {
    view.playNextNow();
  });

  return {
    tick: () => {
      guide.tick();
    },
    codeLocked: (levelId) => {
      guide.codeLocked(levelId);
    },
    unlockAudio: () => {
      audio.unlock();
    },
    stop: () => {
      view.stopAll();
      guide.endSession();
      // A tour close has already dropped the manifest: the cache goes now;
      // a session end keeps it for the next session (R15).
      prefetch.sync();
    },
  };
}
