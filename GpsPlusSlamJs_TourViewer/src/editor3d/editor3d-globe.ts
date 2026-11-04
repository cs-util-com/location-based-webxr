/**
 * The desktop editor's 3D view on the whole globe (the full-globe editor
 * plan 2026-10-27-1850, GV1b), the default 3D view (off only with `globe=0`,
 * `globe-switch.ts`): the globe's view core (`createGlobeView`: the sky,
 * the sun, the surface, the world frame that follows the camera) with the
 * editor's relief and map under the camera, the tour drawn in the globe's
 * Earth-centred group (`globe-layer.ts`), the camera in the globe's eye
 * mode, opening at street level south of the tour. With `globe=0` the
 * OrbitControls view (`editor3d-scene.ts`) opens instead (temporary).
 *
 * The tour hangs in the Earth-centred group through one group of its own
 * whose matrix is the tour's frame (x east, y up, z south at the tour's
 * centre) in ECEF, so the stations layer works in the frame it always has
 * and a recentre of the world frame moves nothing.
 *
 * Each frame the visibility rule (`globe-editor-look.ts`'s `globeHidden`)
 * hides what is too small or too crowded on screen; the globe's relief
 * mount hands the ground between the relief (low) and the globe's surface
 * (high) across a band of heights, as in the globe lab.
 *
 * A tour opened afresh flies in from high above first, on the globe's own
 * meteor flight (`globe-approach-meteor.ts`, its knobs the link's), run
 * by `globe-approach-run.ts`: a bar at the top follows the fall under
 * "Loading tour", the stations pop in on arrival and the recorded
 * walk draws itself; any input in the view takes the camera where it is.
 * The flight places the camera only; the view's frame follows it by the
 * view's own recentring, never set from the camera's pose each frame (the
 * frame is no longer moved per frame). `stats().globe.frameChanges` counts the
 * frame's moves for the page's checks.
 *
 * Editing is the OrbitControls view's (`editor3d-editing.ts`), with the
 * globe's camera as its `EditingCamera`: a handle drag leases the controls
 * off, and the world frame holds still while any gesture runs (the view's
 * `gestureBusy`), so the gesture's world points stay valid. The routing
 * table's two extras (`globe-gestures.ts`) are wired here: the arrows with
 * nothing selected step the camera (`steppedView`), a double click on the
 * ground zooms one step toward it. Two fingers are the globe's controls'
 * (their pinch, twist and tilt, as in the globe lab): the input leaves the
 * camera free for them (`takesTwoFingers`), and a handle drag a second
 * finger interrupts is cancelled.
 *
 * A station is drawn only once its first upload ran (`upload-queue.ts`):
 * at most `UPLOADS.perFrame` stations a frame have their materials
 * compiled and their textures uploaded, so a tour of many stations does
 * not stall the first frame. The code squares share one face texture.
 *
 * The sky opens in daylight: the clock held at the tour's solar noon
 * (`daylightStartMs`), whatever the hour; the View menu's Real time runs
 * it at the real time now (`setRealTime`). The air over it is the globe
 * package's (`mountGlobeViewAir`: the ground sky blue in daylight, the
 * space pass, the haze over the relief), stepped after the camera is
 * placed; it sets the globe's sun to its eased exposure each frame.
 *
 * The air carries the globe lab's heavy clouds too (`globeViewClouds`: the
 * slab near the ground, the spherical volume from orbit down, the high
 * layer), on by default; the View menu's Clouds turns them off
 * (`setClouds`). The cloud shell's share is the relief mount's, as in the
 * lab.
 *
 * The OSM buildings (with their trees and roads) stand at the tour's
 * centre (`editor3d-globe-city.ts` over the Globe package's city, its
 * worker `globe-city-worker.ts`), on the relief's own height source; they
 * load once the camera is below 30 km, warm up from the approach's start,
 * draw see-through around the selection and stand in the clouds' depth.
 * The view's `setBuildings` shows or hides them (no chip yet);
 * `buildings=0` makes no city at all. Picking never meets them: the
 * stations are picked by the layer and the ground on the sampled relief.
 *
 * The approach starts where the globe lab's intro zooms out to (the whole
 * Earth in view at the page's aspect), and the controls zoom out as far as
 * the lab's. At speed the globe lab's speed streaks pour past the camera
 * (`createSpeedDustPass` in its look; `dust=0` turns them off): drawn
 * behind the Earth and, a quarter of them, over it before the air,
 * restarted wherever the camera is placed rather than flown.
 *
 * @see editor3d-globe.ts.md
 */
import * as THREE from "three";

import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import { solarPosition } from "gps-plus-slam-app-framework/geo/solar-position";
import { decodeFrameTexture } from "gps-plus-slam-app-framework/visualization/frame-texture-decoder";
import {
  createGlobeCameraControls,
  createGlobeCity,
  createGlobeImagery,
  createGlobeView,
  createSpeedDustPass,
  creditsFor,
  GIBS_ACKNOWLEDGEMENT,
  GLOBE_INTRO,
  GLOBE_VIEW_CLOUDS,
  globeViewClouds,
  globeZoomOutLimitM,
  mountGlobeRelief,
  mountGlobeViewAir,
  SPEED_DUST_LOOK,
  type GlobeView,
  type GlobeViewAir,
} from "gps-plus-slam-globe/view";
import {
  ellipsoidPointOfRay,
  groundPointOfRay,
} from "gps-plus-slam-globe/editor";

import { loadGlbModel } from "../glb-model.js";
import { mountLectern } from "../lectern-view.js";
import { createPinLabel } from "../pin-label.js";
import { manifestToWrite } from "../tour-document.js";
import { isStationLocked } from "../editor/editor-view.js";
import { STATION_PREFIX as STATION } from "../editor/editor-model.js";
import { tourCentre, tourReach } from "../editor/tour-origin.js";
import type { GlobeSwitch } from "../editor/globe-switch.js";
import type {
  Editor3dDeps,
  Editor3dStats,
  Editor3dView,
} from "./editor3d-scene.js";
import { createFrameClock, pauseWhenHidden } from "./frame-clock.js";
import { createSceneEditing } from "./editor3d-editing.js";
import {
  createBillboard,
  createCodeFace,
  createCodeSquare,
  resizeBillboard,
} from "./editor3d-marks.js";
import {
  DEFAULT_CODE_SIZE_M,
  createStationsLayer,
} from "./editor3d-stations.js";
import { createEditorTerrain, reliefDeviceClass } from "./editor3d-terrain.js";
import { mountEditorCity } from "./editor3d-globe-city.js";
import { mountCredits } from "./editor3d-credits.js";
import {
  createViewRenderer,
  drawnCounts,
  viewFailure,
} from "./editor3d-view-parts.js";
import { morphStanding, selectedStationOf } from "./editor3d-visibility.js";
import {
  GLOBE_EDITOR_LOOK,
  aimView,
  daylightStartMs,
  globeEditorSettings,
  globeHidden,
  steppedView,
  streetView,
  viewPoseOf,
  type GlobeHiddenSet,
  type GlobeObjectOnScreen,
} from "./globe-editor-look.js";
import {
  createMeteorApproach,
  meteorStartAltitudeM,
  tourArrivalProgress,
} from "./globe-approach-meteor.js";
import {
  ARRIVAL,
  walkDrawShare,
  type ArrivalTiming,
} from "./approach-arrival.js";
import {
  browserZoneHint,
  emptyTourCentre,
  emptyTourView,
} from "./empty-tour-view.js";
import { createArrivalMarks } from "./globe-approach-marks.js";
import { createApproachRun, type ApproachRun } from "./globe-approach-run.js";
import { GLOBE_GESTURES } from "./globe-gestures.js";
import { createGlobeLayer } from "./globe-layer.js";
import {
  createFrameDrawCalls,
  type FrameDrawCalls,
} from "./frame-draw-calls.js";
import {
  createGlobeInterfacePass,
  interfaceOverAir,
  type GlobeInterfacePass,
} from "./globe-interface-pass.js";
import { UPLOADS, createUploadQueue } from "./upload-queue.js";

const DEG = Math.PI / 180;
/** The size an item is framed by (m): about a pin or a photo (the
 *  OrbitControls view's). */
const ITEM_RADIUS_M = 1.6;
/** One zoom step (a button's, a double click's) moves the camera this
 *  share of its distance to the ground it looks at. */
const ZOOM_SHARE = 0.35;
/** Top view looks this close to straight down (deg): exactly down has no
 *  heading to keep. */
const TOP_PITCH_DEG = -89;
/** How far past the tour's extent (m) its drawn height stands in for
 *  ground not loaded; farther out no ground means no lift. */
const STAND_IN_REACH_M = 5000;

/** The higher of two heights; either alone where the other is null; null
 *  where both are. */
function higherOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  return b === null ? a : Math.max(a, b);
}

const probeAt = new THREE.Vector3();
const probeBox = new THREE.Box3();

/** A world point on the canvas (CSS px), null behind the camera or off it. */
function onCanvas(
  world: THREE.Vector3,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
): readonly [number, number] | null {
  const p = probeAt.copy(world).project(camera);
  if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) {
    return null;
  }
  return [
    ((p.x + 1) / 2) * canvas.clientWidth,
    ((1 - p.y) / 2) * canvas.clientHeight,
  ];
}

/**
 * Where the tour's first billboard (its anchor, bottom middle), a point of
 * the first found radius's ring (the one nearest the canvas's middle) and
 * the first lit model (its bounding box's centre) are on the canvas: the
 * test hook's probes for the clouds' shadow check. Allocates; the page's
 * checks only call it.
 */
function cloudProbes(
  tourFrame: THREE.Object3D,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
) {
  let billboard: THREE.Object3D | null = null;
  let ring: THREE.Mesh | null = null;
  let model: THREE.Object3D | null = null;
  tourFrame.traverseVisible((o) => {
    if (billboard === null && o.name.startsWith("billboard ")) billboard = o;
    if (ring === null && o.name === "found-radius" && o instanceof THREE.Mesh) {
      ring = o;
    }
    if (
      model === null &&
      o instanceof THREE.Mesh &&
      o.material instanceof THREE.MeshStandardMaterial
    ) {
      model = o;
    }
  });
  const world = (o: THREE.Object3D | null) =>
    o === null
      ? null
      : onCanvas(o.getWorldPosition(new THREE.Vector3()), camera, canvas);
  let ringPoint: readonly [number, number] | null = null;
  const found = ring as THREE.Mesh | null;
  if (found !== null) {
    const { innerRadius, outerRadius } = (found.geometry as THREE.RingGeometry)
      .parameters;
    const r = (innerRadius + outerRadius) / 2;
    let best = Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 2 * Math.PI;
      // The ring lies flat in its station's frame (y up).
      const at = onCanvas(
        found.localToWorld(
          new THREE.Vector3(r * Math.cos(a), 0, r * Math.sin(a)),
        ),
        camera,
        canvas,
      );
      if (at === null) continue;
      const d = Math.hypot(
        at[0] - canvas.clientWidth / 2,
        at[1] - canvas.clientHeight / 2,
      );
      if (d < best) {
        best = d;
        ringPoint = at;
      }
    }
  }
  const lit = model as THREE.Object3D | null;
  return {
    billboard: world(billboard),
    ring: ringPoint,
    model:
      lit === null
        ? null
        : onCanvas(
            probeBox.setFromObject(lit).getCenter(new THREE.Vector3()),
            camera,
            canvas,
          ),
  };
}

/**
 * The buildings' city, or null: with the link's `buildings=0`, in a
 * browser without workers, or when making it throws (the view opens
 * without buildings rather than not at all).
 */
function openCity<T>(on: boolean, make: () => T): T | null {
  if (!on || typeof Worker === "undefined") return null;
  try {
    return make();
  } catch {
    return null;
  }
}

/** The globe view in `deps.container`, once its loop has run. */
export async function openGlobeEditor(
  deps: Editor3dDeps,
  knobs: Pick<
    GlobeSwitch,
    | "hidePx"
    | "crowdPx"
    | "meteorDeg"
    | "meteorLandDeg"
    | "landAglM"
    | "startKm"
    | "dust"
    | "osmGain"
    | "osmGainMode"
    | "cloudShadow"
    | "cloudWind"
    | "buildings"
  >,
): Promise<Editor3dView> {
  const state = deps.store.getState();
  const levels = deps.levels();
  const manifest = manifestToWrite(state.tourDocument);
  const codeGeos = [...levels.values()].flatMap((l) =>
    l.qr.geo === undefined ? [] : [l.qr.geo],
  );
  const tourAt = tourCentre(manifest?.stations ?? [], codeGeos);
  // A tour with nothing positioned yet (a new one) opens over the
  // creator's part of the world, its first station placed on the ground.
  const zone = browserZoneHint();
  const centre = tourAt ?? emptyTourCentre(zone.offsetMin, zone.timeZone);
  const { egm96Geoid } =
    await import("gps-plus-slam-osm/elevation/egm96").catch(
      (error: unknown) => {
        throw viewFailure("chunk", `the geoid did not load: ${String(error)}`);
      },
    );
  const geoid = egm96Geoid();
  const undulationAt = (p: { lat: number; lon: number }) =>
    geoid.undulationMetres({ lat: p.lat, lng: p.lon });
  /** The tour's centre drawn (m over the ellipsoid): its file height less
   *  the geoid's N. */
  const centreHeightM =
    centre.altM - undulationAt({ lat: centre.lat, lon: centre.lng });
  /** Whether a place is near the tour as it is now (its stations and
   *  placed codes): where the tour's drawn height stands in for ground not
   *  loaded. Follows the edits (set again on each tour change). */
  const reachOf = (stations: ReturnType<typeof manifestToWrite>) =>
    tourReach(
      stations?.stations ?? [],
      [...deps.levels().values()].flatMap((l) =>
        l.qr.geo === undefined ? [] : [l.qr.geo],
      ),
      STAND_IN_REACH_M,
    );
  let nearTour = reachOf(manifest);

  // Everything made from here on is undone, last first, by `dispose` - and
  // by a failure before the view is handed out.
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
  let shown = false;
  try {
    const canvas = document.createElement("canvas");
    canvas.className = "view3d-canvas";
    deps.container.prepend(canvas);
    undo.push(() => {
      canvas.remove();
    });

    // The canvas, not the box: the bottom panel shortens it (pushes the
    // view up); the box is the height before the view shows.
    const canvasHeight = () =>
      canvas.clientHeight > 0
        ? canvas.clientHeight
        : deps.container.clientHeight;
    let viewportPx = Math.max(1, canvasHeight());
    // The air (the blue sky, the haze over the relief), mounted once the
    // view and its relief exist; the view's sky alone is black at noon.
    let air: GlobeViewAir | null = null;
    // The interface drawn after the air (`globe-interface-pass.ts`): the
    // clouds' shadow is composited over the whole frame.
    let interfacePass: GlobeInterfacePass | null = null;
    // The whole frame's draw calls (its passes summed), for the status bar.
    let drawCalls: FrameDrawCalls | null = null;
    // The main scene's share of them (its one render), and where the frame
    // stood when it began.
    let sceneFrom = 0;
    let sceneCalls = 0;
    let lastSceneCalls = 0;
    let lastFrameCalls = 0;
    // The approach on opening the tour while it runs (`globe-approach-run.ts`).
    let approach: ApproachRun | null = null;
    /** How the last approach ended, for the page's checks. */
    let approachEnded: ReturnType<ApproachRun["stats"]> | null = null;
    /** The arrival's timing of the approach (reduced motion or not). */
    let arrivalTiming: ArrivalTiming = ARRIVAL;
    /** How often the view's frame moved (its first placement included). */
    let frameChanges = 0;
    /** Whether the approach's flight placed the camera this frame: the
     *  streaks then follow the whole motion, else only the distance (the
     *  lab's default, so turning the globe does not streak sideways). */
    let flightDrives = false;
    // The speed streaks (the globe lab's speed dust, in its look).
    const dust = createSpeedDustPass();
    undo.push(() => {
      dust.dispose();
    });
    // The clouds' wind floor is the link's: built once, read each frame.
    const settings = globeEditorSettings({ windMps: knobs.cloudWind });
    const view: GlobeView = createGlobeView({
      canvas,
      fovYDeg: GLOBE_EDITOR_LOOK.fovYDeg,
      settings: () => settings,
      solarPosition,
      // Standard depth (the view's default): the clouds and the air read
      // the scene's depth as standard, and reversed depth measured no
      // better on the default 24-bit depth buffer.
      // The surface compiles the relief's band: the relief draws the
      // globe's look, its pixels kept by the carrier share; the stencil
      // lets the globe's surface fill every pixel the relief has not. The
      // fill also stops the surface's discard by the carrier share: the
      // relief mount below is a fill mount, and without it the ground had
      // holes where the relief had no tile yet.
      band: true,
      stencil: true,
      fill: true,
      createRenderer: (parameters) => createViewRenderer(parameters),
      seams: {
        driveCamera: () => {
          controls.pickFrom(
            relief ? ground.terrain.tiles.group : view.globe.tiles.group,
          );
          // The approach places the camera while it flies (the camera
          // only: the frame follows below); the controls take it from where
          // it is once it lands or is taken. Its clock starts at the first
          // drawn frame (this one, the first time).
          flightDrives = approach?.drive(performance.now()) === true;
          if (flightDrives) {
            controls.followIntro();
          } else {
            controls.update();
          }
          view.recentreFrame();
        },
        update: (now) => {
          drawCalls?.begin();
          updateLayers(now);
        },
        afterSky: () => {
          air?.afterSky();
        },
        // The streaks where the camera now is: behind the Earth (which
        // covers them), then a share over it, before the air (the lab's
        // order).
        beforeScene: () => {
          const pose = view.ecefCamera();
          dust.update({
            nowMs: performance.now(),
            position: pose.position,
            quaternion: pose.quaternion,
            altitudeM: ellipsoid.getPositionElevation(pose.position),
            fovDeg: camera.fov,
            aspect: camera.aspect,
            renderer,
            on: knobs.dust === 1,
            exposureMs: SPEED_DUST_LOOK.exposureMs,
            widthPx: SPEED_DUST_LOOK.widthPx,
            radialOnly: !flightDrives,
            look: { count: SPEED_DUST_LOOK.count, gain: SPEED_DUST_LOOK.gain },
          });
          dust.render(renderer, 1 - SPEED_DUST_LOOK.over);
          // Above the deck the interface stays in the scene's pass, under
          // the clouds (their composites write no depth).
          interfacePass?.lift(
            interfaceOverAir(
              ellipsoid.getPositionElevation(pose.position),
              GLOBE_VIEW_CLOUDS.cloudShellKm * 1000,
            ),
          );
          sceneFrom = drawCalls?.now() ?? 0;
        },
        afterScene: () => {
          sceneCalls = (drawCalls?.now() ?? 0) - sceneFrom;
          dust.render(renderer, SPEED_DUST_LOOK.over);
          air?.afterScene();
          interfacePass?.draw();
          drawCalls?.end();
          lastSceneCalls = sceneCalls;
          lastFrameCalls = drawCalls?.calls() ?? 0;
        },
        // An edit's gesture holds the frame still too: its world points
        // would move under it.
        gestureBusy: () => controls.busy() || editing.gesture() !== null,
        // A frame move (the first view's too): the controls let go, and the
        // editing's ECEF matrices follow at once, not at the next frame.
        frameChanged: () => {
          frameChanges++;
          controls.release();
          followFrame();
        },
      },
    });
    const { renderer, scene, camera, globe } = view;
    undo.push(() => {
      view.dispose();
      // dispose() keeps the WebGL context: without this every open would
      // hold one more, up to the browser's limit.
      renderer.forceContextLoss();
    });
    drawCalls = createFrameDrawCalls(renderer.info);
    const frameCounter = drawCalls;
    undo.push(() => frameCounter.dispose());
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Daylight over the tour by default (held at its solar noon); the real
    // time now on request.
    let realTime = false;
    const startClock = () => {
      view.startClock(
        realTime
          ? { startMs: null, scale: null }
          : { startMs: daylightStartMs(Date.now(), centre.lng), scale: null },
      );
    };
    startClock();
    // The tour's objects and the relief: the sun alone leaves their shaded
    // sides black.
    const daylight = new THREE.HemisphereLight(0xe9eef5, 0x5d5a52, 0.9);
    scene.add(daylight);

    const ground = createEditorTerrain({
      renderer,
      centre: { lat: centre.lat, lng: centre.lng },
      device: reliefDeviceClass(window.innerWidth),
      placement: "ecef",
      // The globe's own ground and look (as the globe lab's relief), so
      // the ground keeps its colour where the relief takes over.
      imagery: createGlobeImagery(),
      template: globe.template,
      osmGain: knobs.osmGain,
      osmGainMode: knobs.osmGainMode,
    });
    undo.push(() => {
      ground.dispose();
    });
    globe.group.add(ground.terrain.tiles.group);
    undo.push(() => {
      ground.terrain.tiles.group.removeFromParent();
    });
    // The ground handed between the globe's surface and the relief across
    // the band of heights, as in the globe lab; before the haze, so the
    // relief's tiles get their stencil role first.
    const reliefMount = mountGlobeRelief({
      globe,
      relief: ground.terrain,
      fill: true,
    });
    undo.push(() => {
      reliefMount.dispose();
    });
    const { ellipsoid } = ground.terrain.tiles;
    // The buildings at the tour's centre, on the relief's height source;
    // none with `buildings=0` or without module workers.
    const editorCity = openCity(knobs.buildings === 1, () =>
      mountEditorCity({
        city: createGlobeCity({
          parent: globe.group,
          ellipsoid,
          heightsUrl: ground.heights.url,
          // The library's own parameter types are narrower than the city's
          // seam (it hands the worker's reply through as it came).
          loadCityThree: () => import("gps-plus-slam-osm/three") as never,
          createWorker: () =>
            new Worker(new URL("./globe-city-worker.ts", import.meta.url), {
              type: "module",
            }),
        }),
        place: { lat: centre.lat, lng: centre.lng },
        zoom: ground.heights.globalZoom,
      }),
    );
    undo.push(() => {
      editorCity?.dispose();
    });
    const mountedAir = mountGlobeViewAir(view, {
      coarsePointer: window.matchMedia?.("(pointer: coarse)").matches === true,
      clouds: globeViewClouds(view, {
        shadow: knobs.cloudShadow,
        // The buildings hide the clouds behind them, as the relief does.
        extra: () => editorCity?.extra() ?? [],
      }),
    });
    air = mountedAir;
    undo.push(() => {
      air = null;
      mountedAir.dispose();
    });
    // Before the relief loads: every tile it loads is hazed.
    mountedAir.haze(ground.terrain.tiles);

    // The tour's frame in ECEF, under the Earth-centred group.
    const earth = createGlobeLayer(globe.group);
    undo.push(() => {
      earth.dispose();
    });
    const { frame: tourFrame, tourFromEcef } = earth.mountTour(
      ellipsoid,
      centre,
    );

    const billboardView = () => ({
      viewportPx,
      fovDeg: GLOBE_EDITOR_LOOK.fovYDeg,
    });
    const codeFace = createCodeFace();
    undo.push(() => {
      codeFace.dispose();
    });
    const layer = createStationsLayer({
      parent: tourFrame,
      ellipsoid,
      worldFromEcef: tourFromEcef,
      undulationAt,
      makeLabel: createPinLabel,
      makeLectern: mountLectern,
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
    undo.push(() => {
      layer.dispose();
    });
    layer.setTour(manifest, levels);

    // Each station's first upload, a few a frame; one not admitted yet is
    // not drawn (an object drawn before its upload stalls the frame it
    // first shows in).
    const uploads = createUploadQueue({ perFrame: UPLOADS.perFrame });
    const admitted = new Set<string>();
    const stage = (id: string) => {
      const objects = layer.stationObjects(id);
      if (objects === null) return;
      for (const object of objects) {
        const was = object.visible;
        object.visible = true;
        renderer.compile(object, camera, scene);
        object.traverse((o) => {
          const material = (o as Partial<THREE.Mesh>).material;
          const list = Array.isArray(material)
            ? material
            : material === undefined
              ? []
              : [material];
          for (const m of list) {
            const map = (m as THREE.MeshBasicMaterial).map;
            if (map) renderer.initTexture(map);
          }
        });
        object.visible = was;
      }
      admitted.add(id);
    };
    /** Queue the stations not admitted yet, forget the ones gone; the
     *  stations to hold back from drawing (null: none). */
    const unadmitted = (): Set<string> | null => {
      const ids = new Set((tourNow?.stations ?? []).map((s) => s.id));
      for (const id of admitted) if (!ids.has(id)) admitted.delete(id);
      let held: Set<string> | null = null;
      for (const id of ids) {
        if (admitted.has(id)) continue;
        if (!uploads.has(id))
          uploads.add(id, () => {
            stage(id);
          });
        (held ??= new Set()).add(id);
      }
      return held;
    };
    // The globe's imagery is NASA GIBS's, which asks for its
    // acknowledgement in full: it sits under the list.
    undo.push(
      mountCredits(
        deps.credits,
        [...creditsFor(globe.activeSources()), ...ground.credits],
        { note: GIBS_ACKNOWLEDGEMENT },
      ),
    );

    let documentNow = state.tourDocument;
    let tourNow = manifest;
    const unsubscribe = deps.store.subscribe(() => {
      const next = deps.store.getState().tourDocument;
      if (next === documentNow) return;
      documentNow = next;
      tourNow = manifestToWrite(next);
      nearTour = reachOf(tourNow);
      layer.setTour(tourNow, deps.levels());
    });
    undo.push(unsubscribe);

    // The arrival's rings and the recorded walk, in the tour's frame.
    const marks = createArrivalMarks(tourFrame);
    undo.push(() => {
      marks.dispose();
    });
    marks.resize(canvas.clientWidth, canvas.clientHeight);
    type WalkCaptures = ReturnType<NonNullable<Editor3dDeps["walk"]>>;
    /** The walk as last read from the page: a new array is a new walk
     *  (`deps.walk` keeps its array while the walk is unchanged). */
    let walkFrom: WalkCaptures | undefined;
    /** When a walk that came after the stations popped in began drawing;
     *  null when the arrival draws it (or there is none). */
    let lateWalkAt: number | null = null;
    const walkPoints = (
      captures: NonNullable<WalkCaptures>,
    ): THREE.Vector3[] => {
      const ecef = new THREE.Vector3();
      return captures.flatMap((c) => {
        if (![c.lat, c.lon, c.alt].every(Number.isFinite)) return [];
        // As a station is drawn: its height over the ellipsoid less N.
        ellipsoid.getCartographicToPosition(
          c.lat * DEG,
          c.lon * DEG,
          c.alt - undulationAt(c),
          ecef,
        );
        return [ecef.clone().applyMatrix4(tourFromEcef)];
      });
    };

    const resize = new ResizeObserver(() => {
      viewportPx = Math.max(1, canvasHeight());
      marks.resize(canvas.clientWidth, canvas.clientHeight);
      layer.group.traverse((o) => {
        if ((o as THREE.Sprite).isSprite && o.name.startsWith("billboard")) {
          resizeBillboard(o as THREE.Sprite, billboardView());
        }
      });
    });
    resize.observe(deps.container);
    resize.observe(canvas);
    undo.push(() => {
      resize.disconnect();
    });

    // A tour point (the layer's frame) in the world, and back.
    const worldOf = (tourPoint: THREE.Vector3, out = new THREE.Vector3()) =>
      out.copy(tourPoint).applyMatrix4(tourFrame.matrixWorld);
    const tourFromWorld = new THREE.Matrix4();
    const ecefFromTour = tourFrame.matrix;
    /** A tour point as a place (degrees) and its height over the
     *  ellipsoid. */
    const placeOfTour = (tourPoint: THREE.Vector3) => {
      const at = ellipsoid.getPositionToCartographic(
        tourPoint.clone().applyMatrix4(ecefFromTour),
        { lat: 0, lon: 0, height: 0 },
      );
      return { lat: at.lat / DEG, lng: at.lon / DEG, heightM: at.height };
    };

    /** Where the selection stands (the tour's frame) and its size. */
    const placeOf = (
      selection: string,
    ): { at: THREE.Vector3; radiusM: number } | null => {
      if (selection.startsWith(STATION)) {
        const id = selection.slice(STATION.length);
        const at = layer.pointOf(id);
        const radiusM = layer.radiusOf(id);
        return at === null || radiusM === null ? null : { at, radiusM };
      }
      const item = layer.itemPointOf(selection);
      if (item !== null) return { at: item, radiusM: ITEM_RADIUS_M };
      const code = layer.codePointOf(selection);
      if (code === null) return null;
      const printM =
        deps.levels().get(selection)?.qr.physicalSizeM ?? DEFAULT_CODE_SIZE_M;
      return { at: code, radiusM: Math.max(ITEM_RADIUS_M, printM) };
    };

    // The camera: the globe's controls in eye mode, the stations' found
    // radii as the items the near plane keeps clear of.
    const eyeSpheres: THREE.Sphere[] = [];
    /** The SAMPLED ground a world ray meets, to its origin's horizon. */
    const groundPoint = groundPointOfRay(ground.terrain);
    const controls = createGlobeCameraControls(scene, camera, canvas, globe, {
      // The creator's own gesture ends the approach where it is.
      onTake: () => {
        approach?.takeOver(performance.now());
      },
      // The editor zooms a double click itself (`zoomTowards`); the
      // library's own double-tap zoom would add a second, animated one.
      doubleTapZoom: false,
      eyeItems: () => eyeSpheres,
      // A pinch, a drag and the wheel step toward the SAMPLED ground under
      // the fingers: the relief's drawn mesh can lie kilometres off it.
      groundRay: groundPoint,
    });
    undo.push(() => {
      controls.dispose();
    });
    /** The aspect the first frame will have: the canvas's (the box less
     *  the bottom panel), once laid out, else the window's (the box is
     *  hidden until the view opens). */
    const expectedAspect =
      canvas.clientWidth > 0 && canvas.clientHeight > 0
        ? canvas.clientWidth / canvas.clientHeight
        : window.innerWidth / Math.max(1, window.innerHeight);
    /** Where the approach starts, from the Earth's centre (m). */
    const startCentreM =
      meteorStartAltitudeM({
        radiusM: view.radius,
        fovYDeg: GLOBE_EDITOR_LOOK.fovYDeg,
        aspect: expectedAspect,
        startKm: knobs.startKm,
      }) + view.radius;
    // As far out as the globe lab's controls (its intro's distance, at
    // least twice the fit at the aspect now), and never nearer than the
    // approach's start: a takeover there is not pulled in.
    controls.limit(() =>
      Math.max(
        startCentreM,
        globeZoomOutLimitM({
          maxM: GLOBE_INTRO.maxKm * 1000,
          radiusM: view.radius,
          fovYDeg: GLOBE_EDITOR_LOOK.fovYDeg,
          aspect: camera.aspect,
          fitM: view.fitDistance(),
        }),
      ),
    );

    let relief = true;
    let hidden: GlobeHiddenSet = { stations: new Set(), codes: new Set() };
    let standing = 1;
    let frames = 0;
    let top = false;
    const frameClock = createFrameClock();
    undo.push(pauseWhenHidden(frameClock));
    const cameraTour = new THREE.Vector3();
    const look = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const worldPoint = new THREE.Vector3();

    /** Where a world point lands on the canvas (CSS px), null behind. */
    const screenOfWorld = (point: THREE.Vector3) => {
      projected.copy(point).applyMatrix4(camera.matrixWorldInverse);
      if (projected.z >= 0) return null;
      projected.copy(point).project(camera);
      return {
        x: ((projected.x + 1) / 2) * canvas.clientWidth,
        y: ((1 - projected.y) / 2) * canvas.clientHeight,
      };
    };

    /** The tour's objects as the camera sees them now. */
    const onScreen = (): GlobeObjectOnScreen[] => {
      const out: GlobeObjectOnScreen[] = [];
      for (const s of tourNow?.stations ?? []) {
        const at = layer.pointOf(s.id);
        if (at === null) continue;
        worldOf(at, worldPoint);
        out.push({
          id: s.id,
          kind: "station",
          radiusM: s.foundRadiusM,
          distanceM: camera.position.distanceTo(worldPoint),
          screen: screenOfWorld(worldPoint),
        });
      }
      for (const [id, level] of deps.levels()) {
        const at = layer.codePointOf(id);
        if (at === null) continue;
        worldOf(at, worldPoint);
        out.push({
          id,
          kind: "code",
          radiusM: (level.qr.physicalSizeM ?? DEFAULT_CODE_SIZE_M) / 2,
          distanceM: camera.position.distanceTo(worldPoint),
          screen: screenOfWorld(worldPoint),
        });
      }
      return out;
    };

    /** The view's pose read back (its compass, tilt and verbs). */
    const poseNow = () => viewPoseOf(ellipsoid, view.ecefCamera());

    const up = new THREE.Vector3();
    const endEcef = new THREE.Vector3();
    const ecefOfWorldNow = new THREE.Matrix4();
    const endPlace = { lat: 0, lon: 0, height: 0 };
    /**
     * A camera move (the world) lifted at its end so the camera ends
     * `eyeM` over the higher of the loaded grounds under its start and
     * under its end (a slope rising ahead counts); its level part is kept
     * whole, so from eye height a step walks forward. Unchanged where it
     * ends higher than that. With no ground loaded at either the tour's own
     * drawn height stands in (a double click there aims at the ellipsoid),
     * within `STAND_IN_REACH_M` of the tour's extent; farther out the move
     * is not lifted.
     */
    const keepOverGround = (move: THREE.Vector3): THREE.Vector3 => {
      const pose = poseNow();
      ecefOfWorldNow.copy(globe.group.matrixWorld).invert();
      endEcef.copy(camera.position).add(move).applyMatrix4(ecefOfWorldNow);
      ellipsoid.getPositionToCartographic(endEcef, endPlace);
      const floorM =
        higherOf(
          ground.groundAt(pose.lat * DEG, pose.lng * DEG),
          ground.groundAt(endPlace.lat, endPlace.lon),
        ) ??
        (nearTour({ lat: endPlace.lat / DEG, lon: endPlace.lon / DEG })
          ? centreHeightM
          : null);
      if (floorM === null) return move;
      const liftM = floorM + GLOBE_EDITOR_LOOK.eyeM - endPlace.height;
      if (liftM <= 0) return move;
      ellipsoid
        .getPositionToNormal(endEcef, up)
        .transformDirection(globe.group.matrixWorld);
      return move.addScaledVector(up, liftM);
    };

    /** The page's walk read again when its array changed. After the
     *  arrival's walk began (or the approach ended) a walk that comes now
     *  draws itself from now, not whole in one frame. */
    function readWalk(now: number, run: ApproachRun | null, stations: number) {
      const captures = deps.walk?.() ?? null;
      if (captures === walkFrom) return;
      walkFrom = captures;
      marks.setWalk(captures === null ? null : walkPoints(captures));
      const begun =
        run === null ? approachEnded !== null : run.walk(now, stations) > 0;
      lateWalkAt = captures !== null && begun ? now : null;
    }

    /** The share of the walk to draw at `now`: a late walk's own, else the
     *  arrival's, whole with no approach running. */
    function walkShareAt(
      now: number,
      run: ApproachRun | null,
      stations: number,
    ): number {
      if (lateWalkAt !== null) {
        return walkDrawShare(now - lateWalkAt, arrivalTiming);
      }
      return run === null ? 1 : run.walk(now, stations);
    }

    /**
     * The approach's part of a frame at `now`: its bar stepped
     * from the camera's altitude, the stations it holds back or grows, the
     * rings and the walk. The stations not to draw this frame, null for
     * none. With no approach running, the walk is drawn whole once known.
     */
    function approachFrame(now: number, altitudeM: number): string[] | null {
      const stations = tourNow?.stations ?? [];
      const run = approach;
      readWalk(now, run, stations.length);
      if (run === null) {
        marks.drawWalk(walkShareAt(now, null, 0));
        return null;
      }
      run.step(now, altitudeM / 1000);
      if (run.holdsStations()) return stations.map((s) => s.id);
      const notYet: string[] = [];
      const growth = new Map<string, number>();
      stations.forEach((s, i) => {
        const pop = run.pop(i, now);
        const at = layer.pointOf(s.id);
        if (pop?.ring && at !== null) {
          const groundM = ground.groundAt(s.geo.lat * DEG, s.geo.lon * DEG);
          marks.ring(
            s.id,
            new THREE.Vector3(
              at.x,
              groundM ?? at.y - GLOBE_EDITOR_LOOK.eyeM,
              at.z,
            ),
            {
              radius: pop.ring.radius * Math.max(1, s.foundRadiusM),
              opacity: pop.ring.opacity,
            },
          );
        } else {
          marks.ring(s.id, null, null);
        }
        if (pop === null) return;
        if (pop.scale <= 0) notYet.push(s.id);
        else growth.set(s.id, pop.scale);
      });
      layer.setGrowth(growth);
      marks.drawWalk(walkShareAt(now, run, stations.length));
      if (run.finished(now, stations.length)) {
        layer.setGrowth(new Map());
        for (const s of stations) marks.ring(s.id, null, null);
        approachEnded = run.stats();
        run.dispose();
        approach = null;
      }
      return notYet;
    }

    /** The relief's hand-over state for the stats. */
    function reliefLoad() {
      const tiles = ground.terrain.tiles;
      // The library's counters (untyped in 0.5.3).
      const { queued, downloading, parsing, loaded, failed } = (
        tiles as unknown as {
          stats: Record<
            "queued" | "downloading" | "parsing" | "loaded" | "failed",
            number
          >;
        }
      ).stats;
      return {
        share: reliefMount.share(),
        target: reliefMount.target(),
        settled: reliefMount.reliefSettled(),
        loadProgress: tiles.loadProgress,
        queued,
        downloading,
        parsing,
        loaded,
        failed,
        // The relief's tile cache against its device budget (bytes); the
        // library's types leave its `cachedBytes` out.
        cacheBytes: (tiles.lruCache as unknown as { cachedBytes: number })
          .cachedBytes,
        cacheMaxBytes: tiles.lruCache.maxBytesSize,
      };
    }

    function updateLayers(now: number): void {
      frameClock.tick(now);
      // The ground's share on the relief by the camera's altitude (the
      // band's hand-over); the carrier the page reports and picks on is
      // the one holding most of it.
      const altitudeM = ellipsoid.getPositionElevation(
        view.ecefCamera().position,
      );
      reliefMount.step(now, { altitudeM });
      relief = reliefMount.share() >= 0.5;
      reliefMount.draw({
        camera,
        renderer,
        updateRelief: () => ground.update(camera, renderer, now),
      });

      camera.updateMatrixWorld();
      followFrame();
      // The hand-over at the camera's height; the globe's sun at its
      // eased exposure.
      air?.step({
        shareClouds: (flat) => reliefMount.shareClouds(true, flat),
      });
      tourFromWorld.copy(tourFrame.matrixWorld).invert();
      cameraTour.copy(camera.position).applyMatrix4(tourFromWorld);
      // The tilt from straight down, in the tour's frame.
      look
        .set(0, 0, -1)
        .applyQuaternion(camera.quaternion)
        .transformDirection(tourFromWorld);
      standing = morphStanding(
        Math.acos(Math.max(-1, Math.min(1, -look.y))) / DEG,
      );

      const ui = deps.store.getState().editorView;
      const selectedStation = selectedStationOf(ui.selected, tourNow);
      hidden = globeHidden(
        onScreen(),
        hidden,
        {
          hidePx: knobs.hidePx,
          crowdPx: knobs.crowdPx,
          fovYDeg: GLOBE_EDITOR_LOOK.fovYDeg,
          viewportPx,
        },
        selectedStation,
      );
      const held = unadmitted();
      const arriving = approachFrame(now, altitudeM);
      const notShown = [
        ...hidden.stations,
        ...(held ?? []),
        ...(arriving ?? []),
      ];
      layer.setHidden(
        notShown.length === hidden.stations.size
          ? hidden.stations
          : new Set(notShown),
        hidden.codes,
      );
      layer.update({
        centre: cameraTour,
        selectedStation,
        stationSelected: ui.selected?.startsWith(STATION) ?? false,
        standing,
        camera: cameraTour,
        viewportPx,
        fovDeg: GLOBE_EDITOR_LOOK.fovYDeg,
      });
      // After the layer's update: a station's billboard is made there.
      uploads.step();
      stepCity(altitudeM, ui.selected);

      // The near plane keeps clear of the drawn stations.
      eyeSpheres.length = 0;
      for (const s of tourNow?.stations ?? []) {
        if (hidden.stations.has(s.id)) continue;
        const at = layer.pointOf(s.id);
        if (at === null) continue;
        eyeSpheres.push(new THREE.Sphere(worldOf(at), s.foundRadiusM));
      }
      editing.update();
      frames++;
    }

    // The buildings' frame: their load and fade by the camera's altitude,
    // and the see-through around the selection (world space).
    const seeAt = new THREE.Vector3();
    const seeUp = new THREE.Vector3();
    /** The buildings' data loads during the approach's fall, so they
     *  stand on landing. */
    function warmCity(): void {
      editorCity?.warmUp();
    }
    function stepCity(altitudeM: number, selected: string | null): void {
      if (editorCity === null) return;
      const place = selected === null ? null : placeOf(selected);
      editorCity.step({
        altitudeM,
        selection:
          place === null
            ? null
            : {
                at: worldOf(place.at, seeAt),
                up: seeUp
                  .set(0, 1, 0)
                  .transformDirection(tourFrame.matrixWorld),
                radiusM: place.radiusM,
              },
      });
    }

    const aimAt = (at: THREE.Vector3, radiusM: number) => {
      const place = placeOfTour(at);
      const goal = aimView(
        { lat: place.lat, lng: place.lng },
        place.heightM,
        radiusM,
      );
      // Mid-approach a flight to a station (a pick in the list) sends the
      // approach there instead of jumping.
      if (approach?.retarget({ lat: place.lat, lng: place.lng }, place.heightM))
        return;
      controls.release();
      view.placeView(goal);
      dust.reset();
      controls.followIntro();
    };
    const placePose = (change: { headingDeg?: number; pitchDeg?: number }) => {
      approach?.takeOver(performance.now());
      const pose = poseNow();
      controls.release();
      view.placeView({ ...pose, ...change });
      dust.reset();
      controls.followIntro();
    };
    /** Fit the selection (null: the whole tour) into the view. */
    const frameView = (selection: string | null) => {
      if (selection !== null) {
        const place = placeOf(selection);
        if (place !== null) aimAt(place.at, place.radiusM);
        return;
      }
      const points = (tourNow?.stations ?? []).flatMap((s) => {
        const at = layer.pointOf(s.id);
        return at === null ? [] : [at];
      });
      if (points.length === 0) return;
      const box = new THREE.Box3().setFromPoints(points);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      aimAt(sphere.center, sphere.radius);
    };

    // ECEF and the world, read live by the editing: the world frame
    // follows the camera (`followFrame` each frame).
    const worldFromEcef = new THREE.Matrix4();
    const ecefFromWorld = new THREE.Matrix4();
    function followFrame(): void {
      tourFrame.updateWorldMatrix(true, true);
      worldFromEcef.copy(globe.group.matrixWorld);
      ecefFromWorld.copy(worldFromEcef).invert();
    }
    followFrame();
    // The interface's roots: the tour's frame (stations, codes, marks,
    // models' sections) and what the editing adds to the scene (the
    // gizmo); one array, refilled each frame.
    const interfaceRoots: THREE.Object3D[] = [];
    interfacePass = createGlobeInterfacePass({
      renderer,
      scene,
      camera,
      roots: () => {
        interfaceRoots.length = 0;
        interfaceRoots.push(tourFrame);
        for (const child of scene.children) {
          if (child !== globe.group) interfaceRoots.push(child);
        }
        return interfaceRoots;
      },
      lights: [daylight],
    });
    undo.push(() => {
      interfacePass = null;
    });
    /** The buildings' part of the stats, their parity measured against
     *  the relief at the tour's centre. */
    const cityStats = () =>
      editorCity?.stats(ground.groundAt(centre.lat * DEG, centre.lng * DEG)) ??
      null;
    /** The clouds' part of the stats (see the comment there). */
    const cloudStats = () => ({
      driftRate: view.state().cloudDriftRate,
      lonOffsetRad: view.state().cloudLonOffsetRad,
      shadow: knobs.cloudShadow,
      windMps: knobs.cloudWind,
      probes: cloudProbes(tourFrame, camera, canvas),
      shell: air?.cloudShell() ?? null,
      interfaceLifted: interfacePass?.lifted() ?? 0,
    });
    const editing = createSceneEditing({
      container: deps.container,
      canvas,
      scene,
      camera,
      view: {
        lock: (on) => {
          controls.lease(on);
        },
        takesTwoFingers: true,
        twoFingerStart: () => undefined,
        twoFinger: () => undefined,
        lookAt: () => camera.position,
      },
      layer,
      ground,
      worldFromEcef,
      ecefFromWorld,
      layerToWorld: tourFrame.matrixWorld,
      undulationAt,
      tour: () => tourNow,
      stationLocked: (id) =>
        isStationLocked(deps.store.getState().editorView, id),
      page: {
        ...deps.edits,
        dispatch: (action) => deps.store.dispatch(action),
        selected: () => deps.store.getState().editorView.selected,
      },
      frame: frameView,
      models: {
        view() {
          const ui = deps.store.getState().editorView;
          return {
            selected: ui.selected,
            focus: ui.modelFocus,
            pick: ui.modelPick,
          };
        },
        edit: (id, edit) => deps.edits.model(id, edit),
      },
      // The routing table's click distance: a release that moved less is a
      // click, more a drag the controls already had.
      clickPx: GLOBE_GESTURES.dragPx,
      stepCamera(code) {
        approach?.takeOver(performance.now());
        const pose = poseNow();
        const groundM = ground.groundAt(pose.lat * DEG, pose.lng * DEG);
        const aboveM = Math.max(0, pose.altitudeKm * 1000 - (groundM ?? 0));
        controls.release();
        view.placeView(steppedView(pose, code, aboveM));
        dust.reset();
        controls.followIntro();
      },
      zoomTowards(pointer) {
        // Along the ray under the pointer: what is there stays there. The
        // sampled ground to the camera's horizon, else the ellipsoid
        // (heights not loaded there yet); the sky has neither.
        const ray = editing.rayUnder(pointer);
        const at =
          groundPoint(ray) ?? ellipsoidPointOfRay(ground.terrain.tiles, ray);
        if (at === null) return;
        approach?.takeOver(performance.now());
        controls.release();
        camera.position.add(
          keepOverGround(at.sub(camera.position).multiplyScalar(ZOOM_SHARE)),
        );
        camera.updateMatrixWorld();
        dust.reset();
      },
    });
    undo.push(() => {
      editing.dispose();
    });

    // The first view without an approach: at street level south of the
    // tour, on its drawn height (the ground is not loaded yet).
    const street = streetView(
      { lat: centre.lat, lng: centre.lng },
      centreHeightM,
    );
    // Opening a tour (not a restored draft, not a switch back from the
    // map): the approach from high above, its bar over the view.
    if (tourAt === null) {
      // Nowhere to fly to: the whole Earth from the approach's start
      // height, and no approach to wait for.
      view.placeView(
        emptyTourView(centre, (startCentreM - view.radius) / 1000),
      );
      deps.approach?.ended?.("landed");
    } else if (deps.approach !== undefined) {
      const reducedMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ===
        true;
      // The frame at the tour, once: the flight moves the camera only.
      view.setFrameTarget({ lat: centre.lat, lng: centre.lng });
      warmCity();
      const driver = createMeteorApproach({
        ellipsoid,
        view,
        controls,
        tour: { lat: centre.lat, lng: centre.lng },
        groundM: centreHeightM,
        knobs,
        // Paced by what loads at the tour: the relief's ground there and
        // nothing of it loading, then its stations' first uploads.
        progress: () =>
          tourArrivalProgress({
            stations: tourNow?.stations.length ?? 0,
            admitted: admitted.size,
            groundKnown:
              ground.groundAt(centre.lat * DEG, centre.lng * DEG) !== null,
            reliefSettled: reliefMount.reliefSettled(),
          }),
        reliefGroundM: (p) => ground.groundAt(p.lat * DEG, p.lng * DEG),
        reducedMotion,
        aspect: expectedAspect,
        resetSpeed: () => {
          dust.reset();
        },
        ...(deps.approach.durationMs === undefined
          ? {}
          : { durationMs: deps.approach.durationMs }),
      });
      const run = createApproachRun({
        box: deps.container,
        driver,
        reducedMotion,
        ...(deps.approach.ended === undefined
          ? {}
          : { onDone: deps.approach.ended }),
      });
      arrivalTiming = run.timing;
      approach = run;
      undo.push(() => {
        approach = null;
        run.dispose();
      });
    } else {
      view.placeView(street);
      dust.reset();
    }
    controls.followIntro();
    /** An input in the 3D view takes the camera where it is. */
    const takeOver = () => {
      approach?.takeOver(performance.now());
    };
    canvas.addEventListener("pointerdown", takeOver, { capture: true });
    canvas.addEventListener("wheel", takeOver, {
      capture: true,
      passive: true,
    });
    undo.push(() => {
      canvas.removeEventListener("pointerdown", takeOver, { capture: true });
      canvas.removeEventListener("wheel", takeOver, { capture: true });
    });

    /** The tour's centre at its drawn height in the world (what the zoom
     *  and the distance are measured to, as `stats().distanceM` is; the
     *  frame's origin is on the ellipsoid, under it). */
    const tourTarget = () =>
      worldOf(new THREE.Vector3(0, centreHeightM, 0), worldPoint);

    let firstTick: () => void = () => undefined;
    let notShown: (error: unknown) => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => {
      firstTick = resolve;
      notShown = reject;
    });
    const onLost = () => {
      if (shown) deps.events.contextLost();
      else notShown(viewFailure("context-lost", "the WebGL context was lost"));
    };
    canvas.addEventListener("webglcontextlost", onLost);
    undo.push(() => {
      canvas.removeEventListener("webglcontextlost", onLost);
    });

    // The box is hidden until the open resolves: the view's fit needs a
    // laid-out canvas, so the loop draws once the box shows, and the open
    // resolves on its first tick. A frame that throws stops the drawing;
    // the page is told.
    renderer.setAnimationLoop(() => {
      if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
        // Not drawn: the gap until the next drawn frame is no slow frame.
        frameClock.pause();
        firstTick();
        return;
      }
      try {
        view.frame();
        firstTick();
      } catch (error) {
        renderer.setAnimationLoop(null);
        if (shown) deps.events.failed();
        else notShown(error);
      }
    });
    undo.push(() => {
      renderer.setAnimationLoop(null);
    });

    await ready;
    shown = true;

    return {
      dispose,
      setTilt(deg) {
        placePose({ pitchDeg: Math.min(89, Math.max(0, deg)) - 90 });
      },
      setDistance(m) {
        approach?.takeOver(performance.now());
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
          camera.quaternion,
        );
        camera.position.copy(tourTarget()).addScaledVector(forward, -m);
        camera.updateMatrixWorld();
        dust.reset();
      },
      flyTo(selection) {
        const place = placeOf(selection);
        if (place === null) return false;
        aimAt(place.at, place.radiusM);
        return true;
      },
      frame: frameView,
      setTop(on) {
        if (on === top) return;
        top = on;
        placePose({
          pitchDeg: on ? TOP_PITCH_DEG : GLOBE_EDITOR_LOOK.aimPitchDeg,
        });
      },
      zoom(step) {
        approach?.takeOver(performance.now());
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
          camera.quaternion,
        );
        // Measured to the ground under the screen's centre; to the tour
        // where none answers (the sky, heights not loaded).
        const ahead = groundPoint(
          new THREE.Ray(camera.position.clone(), forward.clone()),
        );
        const toWhat =
          ahead === null
            ? camera.position.distanceTo(tourTarget())
            : ahead.distanceTo(camera.position);
        const move = forward.multiplyScalar(
          step * ZOOM_SHARE * Math.max(GLOBE_EDITOR_LOOK.backM, toWhat),
        );
        camera.position.add(keepOverGround(move));
        camera.updateMatrixWorld();
        dust.reset();
      },
      northUp() {
        placePose({ headingDeg: 0 });
      },
      setClouds(on) {
        air?.setClouds(on);
      },
      setBuildings(on) {
        editorCity?.setShown(on);
      },
      setRealTime(on) {
        if (on === realTime) return;
        realTime = on;
        startClock();
      },
      readout() {
        const pose = poseNow();
        return {
          tiltDeg: 90 + pose.pitchDeg,
          headingDeg: pose.headingDeg,
          top,
          ...drawnCounts(renderer),
          // The whole frame's calls: the ground's update may draw before
          // the scene's render.
          drawCalls: drawCalls?.calls() ?? 0,
          frameMs: frameClock.meanMs(),
          worstFrameMs: frameClock.worstMs(),
          slowFrames: frameClock.slowFrames(),
          frameCount: frameClock.count(),
          recentFrameMs: frameClock.recentMs(),
          mapLoad: ground.osm.mapLoad(),
        };
      },
      mapTiles: (limit) => ground.osm.mapTiles(limit),
      retryMap: () => ground.osm.retryNow(),
      lastMapRetry: () => ground.osm.lastRetry(),
      setLayers(hiddenLayers) {
        layer.setShown({
          names: !hiddenLayers.includes("names"),
          codes: !hiddenLayers.includes("codes"),
        });
        marks.showWalk(!hiddenLayers.includes("walk"));
      },
      // The tour file's heights (ellipsoidal): the drawn ground plus N.
      // With no ground loaded under the camera: eye height under it near
      // the ground; none above the relief's ceiling (a station kilometres
      // in the air is no place).
      centre() {
        const pose = poseNow();
        if (ground.groundAt(pose.lat * DEG, pose.lng * DEG) !== null)
          return editing.centre();
        const altitudeM = pose.altitudeKm * 1000;
        if (altitudeM > GLOBE_EDITOR_LOOK.reliefCeilingM) return null;
        const place = { lat: pose.lat, lon: pose.lng };
        return {
          ...place,
          alt: altitudeM - GLOBE_EDITOR_LOOK.eyeM + undulationAt(place),
        };
      },
      groundAt: (place) => editing.groundAt(place),
      origin: () => ({ lat: centre.lat, lng: centre.lng }),
      turn: (selection, deg) => editing.turn(selection, deg),
      pointOf(selection) {
        const place = placeOf(selection);
        if (place === null) return null;
        const p = worldOf(place.at);
        return [p.x, p.y, p.z];
      },
      cancelGesture() {
        editing.cancel();
      },
      screenOf(selection) {
        const place = placeOf(selection);
        if (place === null) return null;
        const at = screenOfWorld(worldOf(place.at));
        return at === null ? null : [at.x, at.y];
      },
      handleScreen(part) {
        const at = editing.handleScreen(part);
        return at === null ? null : [at.x, at.y];
      },
      gizmoSizes: () => editing.handleSizes(),
      modelParts: () => editing.modelParts(),
      modelScreenOf(id, at) {
        const p = editing.modelScreenOf(id, at);
        return p === null ? null : [p.x, p.y];
      },
      stats(): Editor3dStats {
        const pose = poseNow();
        return {
          frames,
          near: camera.near,
          far: camera.far,
          tiltDeg: 90 + pose.pitchDeg,
          standing,
          ...layer.stats(),
          codePx: [],
          osm: { ...ground.osm.stats(), coverage: ground.osm.coverage() },
          mapLoad: ground.osm.mapLoad(),
          // The tour's centre at its drawn height (the frame's origin is
          // on the ellipsoid, under it).
          target: [0, centreHeightM, 0],
          camera: [camera.position.x, camera.position.y, camera.position.z],
          distanceM: Math.hypot(
            cameraTour.x,
            cameraTour.y - centreHeightM,
            cameraTour.z,
          ),
          flying: approach?.stats().flying ?? false,
          top,
          ground: (tourNow?.stations ?? []).map((s) => ({
            id: s.id,
            drawnM: s.geo.alt - undulationAt(s.geo),
            groundM: ground.groundAt(s.geo.lat * DEG, s.geo.lon * DEG),
          })),
          globe: {
            carrier: relief ? "relief" : "globe",
            // What the hand-over waits for: the band's share and target,
            // the relief's view settled, and its tiles still loading (a
            // tile parses until its street map's texture is in).
            relief: reliefLoad(),
            altitudeM: pose.altitudeKm * 1000,
            // Where the camera is and looks, and the sampled ground under
            // it: what a pinch's direction and size are measured by.
            pose,
            groundUnderCameraM: ground.groundAt(pose.lat * DEG, pose.lng * DEG),
            frameTarget: view.frameTarget(),
            hiddenStations: [...hidden.stations],
            hiddenCodes: [...hidden.codes],
            recentres: view.state().frameRecentres,
            frameChanges,
            uploads: { ...uploads.stats(), admitted: admitted.size },
            clock: {
              realTime,
              sceneMs: view.sceneMs(),
              sunElevationDeg:
                solarPosition(view.sceneMs(), centre.lat, centre.lng)
                  .elevationRad / DEG,
            },
            surface: globe.state(),
            air: air?.state() ?? null,
            approach: approach?.stats() ?? approachEnded,
            marks: marks.stats(),
            // The speed streaks as last stepped, and the camera's distance
            // from the Earth's centre against the fit (the start's check).
            dust: dust.state(),
            centreM: view.ecefCamera().position.length(),
            fitM: view.fitDistance(),
            startCentreM,
            // The clouds' drift (deg/s and the map's offset now, rad), their
            // knobs, and where the interface and the ground are on the
            // canvas: what the clouds' shadow and motion checks read.
            clouds: cloudStats(),
            // The last 60 frame intervals (ms), for a frame-time check.
            frameTimesMs: frameClock.recentMs(),
            // The last finished frame's draw calls, all passes and the main
            // scene's render alone: the Performance tab's figure must hold at
            // least the scene's.
            drawCalls: {
              frame: lastFrameCalls,
              scene: lastSceneCalls,
            },
          },
          // The buildings: tiles, buildings, the worker's state, their
          // geometry's size and the height parity with the relief at the
          // tour's centre.
          city: cityStats(),
        };
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
