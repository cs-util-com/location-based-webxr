/**
 * The desktop editor's 3D view: the renderer, the scene, the
 * frame loop, the lost context and the disposal. Loaded by a dynamic
 * import from the editor page only when the view switch asks for it
 * (`view-switch.ts`), so neither the map page's own code nor the phone's
 * pages hold any of it.
 *
 * What it draws: the globe's relief on Mapterhorn's heights with the
 * OpenStreetMap map on it (`editor3d-terrain.ts`), the tour in it
 * (`editor3d-stations.ts`) and the credits both owe, under an orbit at
 * the editor's start view (`editor3d-camera.ts`). It reads the tour from
 * the store - what a save would write now (`manifestToWrite`), and again
 * whenever the document changes - and the selection from `editorView`.
 *
 * Editing (`editor3d-editing.ts`): the gizmo on the selection, its drags,
 * the keys and two-finger touch. The view writes a gesture's start and end
 * to `editorView` and nothing during it (the preview is the scene's); the
 * one edit of a finished gesture, a delete and a duplicate are the page's
 * (`Editor3dDeps.edits`), each one undo step.
 *
 * The page's shell drives the camera through the view: a flight to a
 * station, an item or a code (`flyTo`), Frame (`frame`), Top view
 * (`setTop`), zoom steps and north up (`editor3d-flight.ts`'s flights,
 * which any drag of the creator's cuts short), and shows or hides the
 * station names and the codes (`setLayers`); it reads the compass, the
 * tilt and the debug figures from `readout`.
 *
 * `openEditor3d` resolves once the first frame is drawn. It rejects with
 * an error whose `reason` is `empty` (nothing with a position to show) or
 * `webgl` (no WebGL); a context lost later is reported through
 * `events.contextLost`, and the page goes back to the map.
 *
 * @see editor3d-scene.ts.md
 */
import type { UnknownAction } from "@reduxjs/toolkit";
import * as THREE from "three";

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import { decodeFrameTexture } from "gps-plus-slam-app-framework/visualization/frame-texture-decoder";

import { loadGlbModel } from "../glb-model.js";
import { createPinLabel } from "../pin-label.js";
import { manifestToWrite, type TourDocumentState } from "../tour-document.js";
import {
  isStationLocked,
  type EditorViewState,
  type ShellLayer,
} from "../editor/editor-view.js";
import { STATION_PREFIX as STATION } from "../editor/editor-model.js";
import { tourCentre } from "../editor/tour-origin.js";
import {
  EDITOR_CAMERA,
  EDITOR_CLIP,
  createEditorCamera,
  editorClipPlanes,
} from "./editor3d-camera.js";
import {
  createBillboard,
  createCodeFace,
  createCodeSquare,
  resizeBillboard,
} from "./editor3d-marks.js";
import {
  FLIGHT,
  clampedPose,
  flightGoal,
  frameDistanceM,
  orbitPoseBetween,
  orbitPoseOf,
  orbitPosition,
  tourFrame,
  type OrbitPose,
} from "./editor3d-flight.js";
import {
  DEFAULT_CODE_SIZE_M,
  createStationsLayer,
} from "./editor3d-stations.js";
import { createSceneEditing, type GizmoPart } from "./editor3d-editing.js";
import type { InputPage } from "./editor3d-input.js";
import { createEditorTerrain, reliefDeviceClass } from "./editor3d-terrain.js";
import { morphStanding, selectedStationOf } from "./editor3d-visibility.js";

/** The store, as the 3D view reads it. */
interface Editor3dStore {
  getState(): {
    readonly tourDocument: TourDocumentState;
    readonly editorView: EditorViewState;
  };
  subscribe(listener: () => void): () => void;
  dispatch(action: UnknownAction): unknown;
}

/** The page's edits the view asks for (`editor3d-input.ts`'s page, less
 *  the store the view reads itself). */
export type Editor3dEdits = Omit<InputPage, "dispatch" | "selected">;

/** What the page hands the 3D view. */
export interface Editor3dDeps {
  /** The view's box, over the map (`#view3d`). */
  readonly container: HTMLElement;
  /** The credits' line in it. */
  readonly credits: HTMLElement;
  readonly store: Editor3dStore;
  /** The open tour's codes, by level id. */
  levels(): ReadonlyMap<string, QrLevel>;
  /** A content entry of the open tour (photos, models). */
  loadContent(entryName: string): Promise<Blob>;
  /** A lost context or an error once the view shows (before, the open
   *  rejects instead). */
  readonly events: { contextLost(): void; failed(): void };
  readonly edits: Editor3dEdits;
}

/** A shown 3D view. */
export interface Editor3dView {
  dispose(): void;
  /** For the page's checks (the dev server's test hook). */
  stats(): Editor3dStats;
  /** Tilt the orbit to `deg` from straight down, keeping its distance
   *  and heading (the page's checks; no control of the page uses it). */
  setTilt(deg: number): void;
  /** Move the orbit to `m` from its centre, keeping its tilt and heading
   *  (the page's checks), within the orbit's limits. */
  setDistance(m: number): void;
  /** Fly to the page's selection (`station:<id>`, an item's id or a
   *  code's level id): a station framed, an item or a code brought to a
   *  working distance. False for one the tour has no place for. */
  flyTo(selection: string): boolean;
  /** Fit the selection (null: the whole tour) into the view. */
  frame(selection: string | null): void;
  /** Look straight down (the left button then pans like a map), or go
   *  back to the tilt from before. */
  setTop(on: boolean): void;
  /** One zoom step in (1) or out (-1). */
  zoom(step: 1 | -1): void;
  /** Turn the view north up. */
  northUp(): void;
  /** What the shell shows of the camera and the drawing. */
  readout(): Editor3dReadout;
  /** The layers turned off (the station names and the codes are drawn
   *  here; the others have nothing to draw yet). */
  setLayers(hidden: readonly ShellLayer[]): void;
  /** Where the selection stands in the world (the page's checks). */
  pointOf(selection: string): readonly [number, number, number] | null;
  /** Cancel a gesture under way, writing nothing (an undo, a redo). */
  cancelGesture(): void;
  /** Where the selection (a station's point, an item's or a code's
   *  drawing), or a part of its gizmo, is on the canvas (CSS px; the
   *  page's checks). */
  screenOf(selection: string): readonly [number, number] | null;
  handleScreen(part: GizmoPart): readonly [number, number] | null;
  /** The gizmo's drawn sizes (px), or null without one (the page's
   *  checks). */
  gizmoSizes(): {
    readonly knobPx: number;
    readonly dotPx: number;
    readonly ringPx: number;
  } | null;
}

/** The camera and the drawing, for the shell's compass, view line and
 *  debug readout. */
export interface Editor3dReadout {
  /** Degrees from straight down. */
  readonly tiltDeg: number;
  /** The bearing the camera looks toward (degrees clockwise from north). */
  readonly headingDeg: number;
  readonly top: boolean;
  readonly drawCalls: number;
  /** The mean time between the last frames (ms). */
  readonly frameMs: number;
}

export interface Editor3dStats {
  readonly frames: number;
  /** The camera's clip planes in the last frame (m). */
  readonly near: number;
  readonly far: number;
  readonly tiltDeg: number;
  readonly standing: number;
  readonly stations: number;
  readonly codes: number;
  readonly shown: readonly string[];
  readonly renders: number;
  readonly osm: Record<string, unknown>;
  /** The orbit's centre in the world (m). */
  readonly target: readonly [number, number, number];
  /** The camera in the world (m). */
  readonly camera: readonly [number, number, number];
  readonly distanceM: number;
  /** A flight is under way. */
  readonly flying: boolean;
  readonly top: boolean;
  /** Each station's drawn height and the drawn ground under it (m over
   *  the ellipsoid; null where no ground has loaded). */
  readonly ground: readonly {
    id: string;
    drawnM: number;
    groundM: number | null;
  }[];
}

/** A failure with the reason the view switch says. */
function failure(
  reason: "empty" | "webgl" | "chunk" | "context-lost",
  message: string,
): Error {
  return Object.assign(new Error(message), { reason });
}

const BACKGROUND = 0x232427;
/** The size an item is framed by (m): about a pin or a photo. */
const ITEM_RADIUS_M = 1.6;
const DEG = Math.PI / 180;

function createRenderer(): THREE.WebGLRenderer {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (error) {
    throw failure(
      "webgl",
      `no WebGL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (renderer.getContext() === null) {
    renderer.dispose();
    throw failure("webgl", "no WebGL context");
  }
  return renderer;
}

function fillCredits(
  box: HTMLElement,
  credits: readonly { short: string; href: string }[],
): void {
  const parts: Node[] = [];
  credits.forEach((credit, i) => {
    if (i > 0) parts.push(document.createTextNode(" · "));
    const a = document.createElement("a");
    a.href = credit.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = credit.short;
    parts.push(a);
  });
  box.replaceChildren(...parts);
}

/** The 3D view in `deps.container`, once its first frame is drawn. */
export async function openEditor3d(deps: Editor3dDeps): Promise<Editor3dView> {
  const state = deps.store.getState();
  const levels = deps.levels();
  const manifest = manifestToWrite(state.tourDocument);
  const codeGeos = [...levels.values()].flatMap((l) =>
    l.qr.geo === undefined ? [] : [l.qr.geo],
  );
  const centre = tourCentre(manifest?.stations ?? [], codeGeos);
  if (centre === null) {
    throw failure("empty", "the tour has nothing with a position");
  }
  const { egm96Geoid } =
    await import("gps-plus-slam-osm/elevation/egm96").catch(
      (error: unknown) => {
        throw failure("chunk", `the geoid did not load: ${String(error)}`);
      },
    );
  const geoid = egm96Geoid();
  const undulationAt = (p: { lat: number; lon: number }) =>
    geoid.undulationMetres({ lat: p.lat, lng: p.lon });

  const renderer = createRenderer();
  // Everything made from here on is undone, last first, by `dispose` - and
  // by a failure before the first frame, so a failed open leaves no canvas
  // and no renderer behind.
  const undo: (() => void)[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const step of undo.splice(0).reverse()) {
      try {
        step();
      } catch {
        // One step that fails to free leaves the others to run.
      }
    }
  };
  undo.push(() => {
    renderer.dispose();
    // dispose() keeps the WebGL context: without this every open would
    // hold one more, up to the browser's limit, which then drops the
    // oldest (the lost-context listener is gone by now).
    renderer.forceContextLoss();
    renderer.domElement.remove();
  });
  /** True once the first frame is drawn and the view is handed out. */
  let shown = false;
  try {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const canvas = renderer.domElement;
    canvas.className = "view3d-canvas";
    deps.container.prepend(canvas);
    // The box is hidden until the first frame is drawn (the map stays in
    // view while the view loads): the window's size until it shows.
    const size = () => ({
      w: Math.max(1, deps.container.clientWidth || window.innerWidth),
      h: Math.max(1, deps.container.clientHeight || window.innerHeight),
    });
    renderer.setSize(size().w, size().h, false);

    const ground = createEditorTerrain({
      renderer,
      centre: { lat: centre.lat, lng: centre.lng },
      device: reliefDeviceClass(window.innerWidth),
    });
    undo.push(() => ground.dispose());
    const { ellipsoid } = ground.terrain.tiles;
    const ecefFromWorld = ground.worldFromEcef.clone().invert();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND);
    scene.fog = new THREE.Fog(
      BACKGROUND,
      EDITOR_CLIP.fogStartM,
      EDITOR_CLIP.fogEndM,
    );
    scene.add(new THREE.HemisphereLight(0xe9eef5, 0x5d5a52, 1.25));
    const sun = new THREE.DirectionalLight(0xfff6e8, 1.75);
    sun.position.set(-160, 260, 120);
    scene.add(sun);
    scene.add(ground.terrain.tiles.group);

    const target = new THREE.Vector3(
      0,
      centre.altM - undulationAt({ lat: centre.lat, lon: centre.lng }),
      0,
    );
    const cam = createEditorCamera({
      domElement: canvas,
      target,
      aspect: size().w / size().h,
    });
    undo.push(() => cam.dispose());
    const { camera, controls } = cam;
    const billboardView = () => ({
      viewportPx: size().h,
      fovDeg: EDITOR_CAMERA.fovDeg,
    });

    // The codes' printed face, this view's own: freed after the layer.
    const codeFace = createCodeFace();
    undo.push(() => codeFace.dispose());
    const layer = createStationsLayer({
      parent: scene,
      ellipsoid,
      worldFromEcef: ground.worldFromEcef,
      undulationAt,
      makeLabel: createPinLabel,
      loadPhotoTexture: async (entry) =>
        decodeFrameTexture(await deps.loadContent(entry), 2, {
          maxPixels: TOUR_MAX_IMAGE_PIXELS,
        }),
      loadContent: (entry) => deps.loadContent(entry),
      loadGlbModel,
      makeBillboard: (number, title, selected) =>
        createBillboard(number, title, selected, billboardView()),
      makeCodeSquare: (sizeM) => createCodeSquare(sizeM, codeFace),
    });
    undo.push(() => layer.dispose());
    layer.setTour(manifest, levels);
    fillCredits(deps.credits, ground.credits);
    undo.push(() => deps.credits.replaceChildren());

    // The tour as the view draws it, read again only when the document
    // changes (never per frame: it is the save's manifest).
    let documentNow = state.tourDocument;
    let tourNow = manifest;
    const unsubscribe = deps.store.subscribe(() => {
      const next = deps.store.getState().tourDocument;
      if (next === documentNow) return;
      documentNow = next;
      tourNow = manifestToWrite(next);
      layer.setTour(tourNow, deps.levels());
    });
    undo.push(unsubscribe);

    const resize = new ResizeObserver(() => {
      const { w, h } = size();
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      layer.group.traverse((o) => {
        if ((o as THREE.Sprite).isSprite && o.name.startsWith("billboard")) {
          resizeBillboard(o as THREE.Sprite, billboardView());
        }
      });
    });
    resize.observe(deps.container);
    undo.push(() => resize.disconnect());

    let firstFrame: () => void = () => undefined;
    let notShown: (error: unknown) => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => {
      firstFrame = resolve;
      notShown = reject;
    });
    // A lost context: before the first frame the open fails with it (else it
    // would resolve on a black canvas); once shown the page is told.
    const onLost = () => {
      if (shown) deps.events.contextLost();
      else notShown(failure("context-lost", "the WebGL context was lost"));
    };
    canvas.addEventListener("webglcontextlost", onLost);
    undo.push(() => canvas.removeEventListener("webglcontextlost", onLost));

    // The shell's flights (`editor3d-flight.ts`): the orbit is placed by
    // the flight while one runs, and any drag of the creator's ends it.
    let flight: {
      readonly from: OrbitPose;
      readonly to: OrbitPose;
      readonly startMs: number;
      readonly ms: number;
    } | null = null;
    const poseNow = (): OrbitPose =>
      orbitPoseOf(camera.position, controls.target);
    /** OrbitControls keeps a little momentum after a drag; a flight ends
     *  it, or the orbit would drift on from where the flight ended. Its
     *  public way: one update without damping spends what is left of the
     *  coast at once (the distance the orbit would have coasted anyway,
     *  a fraction of the drag's last move) and leaves no momentum; the
     *  flight then starts from there. */
    const dropMomentum = () => {
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = true;
    };
    const placeOrbit = (pose: OrbitPose) => {
      controls.target.copy(pose.target);
      orbitPosition(pose, camera.position);
      camera.lookAt(pose.target);
    };
    const fly = (goal: Partial<OrbitPose>, ms: number) => {
      dropMomentum();
      const from = poseNow();
      const to = clampedPose({ ...from, ...goal });
      flight = { from, to, startMs: performance.now(), ms };
    };
    const stepFlight = (now: number) => {
      if (flight === null) return false;
      const k = (now - flight.startMs) / flight.ms;
      placeOrbit(orbitPoseBetween(flight.from, flight.to, k));
      if (k >= 1) {
        flight = null;
        controls.update();
      }
      return true;
    };
    const endFlight = () => {
      flight = null;
    };
    controls.addEventListener("start", endFlight);
    undo.push(() => {
      controls.removeEventListener("start", endFlight);
    });

    // Top view: straight down, the left button pans like a map and the
    // right one tilts; the tilt from before is kept to go back to.
    let top = false;
    let topFrom: number = FLIGHT.untopPolarRad;
    const topControls = (on: boolean) => {
      controls.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
      controls.mouseButtons.RIGHT = on ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
      controls.touches.ONE = on ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
      controls.screenSpacePanning = on;
    };

    /** Where the selection stands, and the size a flight frames it by. */
    const placeOf = (
      selection: string,
    ): {
      at: THREE.Vector3;
      radiusM: number;
      kind: "station" | "item";
    } | null => {
      if (selection.startsWith("station:")) {
        const id = selection.slice("station:".length);
        const at = layer.pointOf(id);
        const radiusM = layer.radiusOf(id);
        return at === null || radiusM === null
          ? null
          : { at, radiusM, kind: "station" };
      }
      const item = layer.itemPointOf(selection);
      if (item !== null)
        return { at: item, radiusM: ITEM_RADIUS_M, kind: "item" };
      const code = layer.codePointOf(selection);
      if (code === null) return null;
      const printM =
        deps.levels().get(selection)?.qr.physicalSizeM ?? DEFAULT_CODE_SIZE_M;
      return {
        at: code,
        radiusM: Math.max(ITEM_RADIUS_M, printM),
        kind: "item",
      };
    };

    /** Fit the selection (null: the whole tour) into the view. */
    const frameView = (selection: string | null) => {
      const polarRad = Math.min(poseNow().polarRad, FLIGHT.flatCapRad);
      if (selection === null) {
        const points = (tourNow?.stations ?? []).flatMap((s) => {
          const at = layer.pointOf(s.id);
          return at === null ? [] : [{ at, radiusM: s.foundRadiusM }];
        });
        for (const id of deps.levels().keys()) {
          const at = layer.codePointOf(id);
          if (at !== null) points.push({ at, radiusM: 0 });
        }
        const whole = tourFrame(points);
        if (whole === null) return;
        fly(
          {
            target: whole.centre,
            distanceM: frameDistanceM(whole.radiusM),
            polarRad,
          },
          FLIGHT.frameMs,
        );
        return;
      }
      const place = placeOf(selection);
      if (place === null) return;
      const radiusM =
        place.kind === "station"
          ? place.radiusM * FLIGHT.stationMargin
          : place.radiusM;
      fly(
        {
          target: place.at,
          distanceM: frameDistanceM(radiusM),
          polarRad,
        },
        FLIGHT.frameMs,
      );
    };

    const editing = createSceneEditing({
      container: deps.container,
      canvas,
      scene,
      camera,
      controls,
      layer,
      ground,
      ecefFromWorld,
      undulationAt,
      tour: () => tourNow,
      stationLocked: (id) =>
        isStationLocked(deps.store.getState().editorView, id),
      page: {
        ...deps.edits,
        dispatch: (action) => deps.store.dispatch(action),
        selected: () => deps.store.getState().editorView.selected,
      },
      endFlight,
      dropMomentum,
      frame: frameView,
    });
    undo.push(() => {
      editing.dispose();
    });

    const frameTimes: number[] = [];
    let lastFrameAt: number | null = null;
    let frames = 0;
    let standing = 1;
    const ecef = new THREE.Vector3();
    // The camera's own: `groundUnder` reuses `ecef`, and the clip planes
    // read this after both samples are taken.
    const cameraEcef = new THREE.Vector3();
    const groundUnder = (worldPoint: THREE.Vector3): number | null => {
      ecef.copy(worldPoint).applyMatrix4(ecefFromWorld);
      const at = ellipsoid.getPositionToCartographic(ecef, {}) as {
        lat: number;
        lon: number;
      };
      return ground.groundAt(at.lat, at.lon);
    };
    const frame = (now: number) => {
      if (lastFrameAt !== null) {
        frameTimes.push(now - lastFrameAt);
        if (frameTimes.length > 60) frameTimes.shift();
      }
      lastFrameAt = now;
      if (!stepFlight(now)) controls.update();
      // A tilt by hand leaves Top view.
      if (top && flight === null && cam.tiltDeg() > 3) {
        top = false;
        topControls(false);
      }
      standing = morphStanding(cam.tiltDeg());
      const planes = editorClipPlanes({
        ellipsoid,
        cameraEcef: cameraEcef
          .copy(camera.position)
          .applyMatrix4(ecefFromWorld),
        samples: [
          { distanceM: 0, groundM: groundUnder(camera.position) },
          {
            distanceM: Math.hypot(
              camera.position.x - controls.target.x,
              camera.position.z - controls.target.z,
            ),
            groundM: groundUnder(controls.target),
          },
        ],
      });
      camera.near = planes.near;
      camera.far = planes.far;
      camera.updateProjectionMatrix();
      ground.update(camera, renderer, now);
      editing.update();
      const ui = deps.store.getState().editorView;
      layer.update({
        centre: controls.target,
        selectedStation: selectedStationOf(ui.selected, tourNow),
        stationSelected: ui.selected?.startsWith(STATION) ?? false,
        standing,
      });
      renderer.render(scene, camera);
      frames++;
      if (frames === 1) firstFrame();
    };
    // An error in a frame stops the drawing: before the first frame the
    // open fails with it, once shown the page is told (never a frozen view,
    // nor a load that never ends).
    renderer.setAnimationLoop((now) => {
      try {
        frame(now);
      } catch (error) {
        renderer.setAnimationLoop(null);
        if (shown) deps.events.failed();
        else notShown(error);
      }
    });
    undo.push(() => renderer.setAnimationLoop(null));

    await ready;
    shown = true;
    return {
      dispose,
      setTilt(deg) {
        const offset = camera.position.clone().sub(controls.target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.phi = Math.min(
          EDITOR_CAMERA.maxPolarAngle,
          Math.max(1e-4, deg * DEG),
        );
        camera.position
          .copy(controls.target)
          .add(new THREE.Vector3().setFromSpherical(spherical));
        controls.update();
      },
      flyTo(selection) {
        const place = placeOf(selection);
        if (place === null) return false;
        fly(flightGoal(poseNow(), place), FLIGHT.flyMs);
        return true;
      },
      frame: frameView,
      setTop(on) {
        if (on === top) return;
        top = on;
        topControls(on);
        if (on) {
          const polar = poseNow().polarRad;
          topFrom = polar > 0.1 ? polar : FLIGHT.untopPolarRad;
          fly({ polarRad: FLIGHT.topPolarRad }, FLIGHT.topMs);
        } else {
          fly({ polarRad: topFrom }, FLIGHT.topMs);
        }
      },
      zoom(step) {
        const { distanceM } = poseNow();
        fly(
          {
            distanceM:
              step > 0
                ? distanceM / FLIGHT.zoomStep
                : distanceM * FLIGHT.zoomStep,
          },
          FLIGHT.zoomMs,
        );
      },
      northUp() {
        fly({ azimuthRad: 0 }, FLIGHT.turnMs);
      },
      readout() {
        const pose = poseNow();
        const mean =
          frameTimes.length === 0
            ? 0
            : frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
        return {
          tiltDeg: cam.tiltDeg(),
          headingDeg: (((-pose.azimuthRad / DEG) % 360) + 360) % 360,
          top,
          drawCalls: renderer.info.render.calls,
          frameMs: mean,
        };
      },
      setLayers(hidden) {
        layer.setShown({
          names: !hidden.includes("names"),
          codes: !hidden.includes("codes"),
        });
      },
      pointOf(selection) {
        const place = placeOf(selection);
        return place === null ? null : [place.at.x, place.at.y, place.at.z];
      },
      cancelGesture() {
        editing.cancel();
      },
      screenOf(selection) {
        const at = editing.screenOf(selection);
        return at === null ? null : [at.x, at.y];
      },
      handleScreen(part) {
        const at = editing.handleScreen(part);
        return at === null ? null : [at.x, at.y];
      },
      gizmoSizes: () => editing.handleSizes(),
      setDistance(m) {
        const offset = camera.position.clone().sub(controls.target);
        offset.setLength(
          Math.min(
            EDITOR_CAMERA.maxDistanceM,
            Math.max(EDITOR_CAMERA.minDistanceM, m),
          ),
        );
        camera.position.copy(controls.target).add(offset);
        controls.update();
      },
      stats() {
        const now = tourNow;
        return {
          frames,
          near: camera.near,
          far: camera.far,
          tiltDeg: cam.tiltDeg(),
          standing,
          ...layer.stats(),
          osm: ground.osm.stats(),
          target: [controls.target.x, controls.target.y, controls.target.z],
          camera: [camera.position.x, camera.position.y, camera.position.z],
          distanceM: camera.position.distanceTo(controls.target),
          flying: flight !== null,
          top,
          ground: (now?.stations ?? []).map((s) => ({
            id: s.id,
            drawnM: s.geo.alt - undulationAt(s.geo),
            groundM: ground.groundAt(s.geo.lat * DEG, s.geo.lon * DEG),
          })),
        };
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
