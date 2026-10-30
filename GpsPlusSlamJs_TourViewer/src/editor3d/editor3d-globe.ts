/**
 * The desktop editor's 3D view on the whole globe (the full-globe editor
 * plan 2026-10-27-1850, GV1b), behind its link switch (`globe=1`,
 * `globe-switch.ts`): the globe's view core (`createGlobeView`: the sky,
 * the sun, the surface, the world frame that follows the camera) with the
 * editor's relief and map under the camera, the tour drawn in the globe's
 * Earth-centred group (`globe-layer.ts`), the camera in the globe's eye
 * mode, opening at street level south of the tour. Without the switch the
 * OrbitControls view (`editor3d-scene.ts`) opens as before.
 *
 * The tour hangs in the Earth-centred group through one group of its own
 * whose matrix is the tour's frame (x east, y up, z south at the tour's
 * centre) in ECEF, so the stations layer works in the frame it always has
 * and a recentre of the world frame moves nothing.
 *
 * Each frame the visibility rule (`globe-editor-look.ts`'s `globeHidden`)
 * hides what is too small or too crowded on screen; under the relief's
 * ceiling the relief carries the ground, above it the globe's surface.
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
 * Not yet here (later steps of the plan): the layer chips for the clouds
 * and the buildings. The heavy clouds (the shell and its volume) are never
 * mounted.
 *
 * @see editor3d-globe.ts.md
 */
import * as THREE from "three";

import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import { solarPosition } from "gps-plus-slam-app-framework/geo/solar-position";
import { decodeFrameTexture } from "gps-plus-slam-app-framework/visualization/frame-texture-decoder";
import {
  createGlobeCameraControls,
  createGlobeView,
  creditsFor,
  mountGlobeViewAir,
  type GlobeView,
  type GlobeViewAir,
} from "gps-plus-slam-globe/view";

import { loadGlbModel } from "../glb-model.js";
import { mountLectern } from "../lectern-view.js";
import { createPinLabel } from "../pin-label.js";
import { manifestToWrite } from "../tour-document.js";
import { isStationLocked } from "../editor/editor-view.js";
import { STATION_PREFIX as STATION } from "../editor/editor-model.js";
import { tourCentre } from "../editor/tour-origin.js";
import type { GlobeSwitch } from "../editor/globe-switch.js";
import type {
  Editor3dDeps,
  Editor3dStats,
  Editor3dView,
} from "./editor3d-scene.js";
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
import {
  createViewRenderer,
  fillCredits,
  viewFailure,
} from "./editor3d-view-parts.js";
import { morphStanding, selectedStationOf } from "./editor3d-visibility.js";
import {
  GLOBE_EDITOR_LOOK,
  aimView,
  daylightStartMs,
  globeEditorSettings,
  globeHidden,
  reliefCarries,
  steppedView,
  streetView,
  viewPoseOf,
  type GlobeHiddenSet,
  type GlobeObjectOnScreen,
} from "./globe-editor-look.js";
import { GLOBE_GESTURES } from "./globe-gestures.js";
import { createGlobeLayer } from "./globe-layer.js";
import { UPLOADS, createUploadQueue } from "./upload-queue.js";

const DEG = Math.PI / 180;
/** The size an item is framed by (m): about a pin or a photo (the
 *  OrbitControls view's). */
const ITEM_RADIUS_M = 1.6;
/** One zoom step moves the camera this share of its distance to what it
 *  looks at. */
const ZOOM_SHARE = 0.35;
/** Top view looks this close to straight down (deg): exactly down has no
 *  heading to keep. */
const TOP_PITCH_DEG = -89;

/** The globe view in `deps.container`, once its loop has run. */
export async function openGlobeEditor(
  deps: Editor3dDeps,
  knobs: Pick<GlobeSwitch, "hidePx" | "crowdPx">,
): Promise<Editor3dView> {
  const state = deps.store.getState();
  const levels = deps.levels();
  const manifest = manifestToWrite(state.tourDocument);
  const codeGeos = [...levels.values()].flatMap((l) =>
    l.qr.geo === undefined ? [] : [l.qr.geo],
  );
  const centre = tourCentre(manifest?.stations ?? [], codeGeos);
  if (centre === null) {
    throw viewFailure("empty", "the tour has nothing with a position");
  }
  const { egm96Geoid } =
    await import("gps-plus-slam-osm/elevation/egm96").catch(
      (error: unknown) => {
        throw viewFailure("chunk", `the geoid did not load: ${String(error)}`);
      },
    );
  const geoid = egm96Geoid();
  const undulationAt = (p: { lat: number; lon: number }) =>
    geoid.undulationMetres({ lat: p.lat, lng: p.lon });

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

    let viewportPx = Math.max(1, deps.container.clientHeight);
    // The air (the blue sky, the haze over the relief), mounted once the
    // view and its relief exist; the view's sky alone is black at noon.
    let air: GlobeViewAir | null = null;
    const view: GlobeView = createGlobeView({
      canvas,
      fovYDeg: GLOBE_EDITOR_LOOK.fovYDeg,
      settings: globeEditorSettings,
      solarPosition,
      // First person: the near plane at a few centimetres, the far one
      // past the horizon.
      reversedDepth: true,
      createRenderer: (parameters) => createViewRenderer(parameters),
      seams: {
        driveCamera: () => {
          controls.pickFrom(
            relief ? ground.terrain.tiles.group : view.globe.tiles.group,
          );
          controls.update();
          view.recentreFrame();
        },
        update: (now) => {
          updateLayers(now);
        },
        afterSky: () => {
          air?.afterSky();
        },
        afterScene: () => {
          air?.afterScene();
        },
        // An edit's gesture holds the frame still too: its world points
        // would move under it.
        gestureBusy: () => controls.busy() || editing.gesture() !== null,
        frameChanged: () => {
          controls.release();
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
    // The tour's objects and the relief's plain ground: the sun alone
    // leaves their shaded sides black.
    scene.add(new THREE.HemisphereLight(0xe9eef5, 0x5d5a52, 0.9));

    const ground = createEditorTerrain({
      renderer,
      centre: { lat: centre.lat, lng: centre.lng },
      device: reliefDeviceClass(window.innerWidth),
      placement: "ecef",
    });
    undo.push(() => {
      ground.dispose();
    });
    globe.group.add(ground.terrain.tiles.group);
    undo.push(() => {
      ground.terrain.tiles.group.removeFromParent();
    });
    const { ellipsoid } = ground.terrain.tiles;
    const mountedAir = mountGlobeViewAir(view, {
      coarsePointer: window.matchMedia?.("(pointer: coarse)").matches === true,
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
    fillCredits(deps.credits, [
      ...creditsFor(globe.activeSources()),
      ...ground.credits,
    ]);
    undo.push(() => {
      deps.credits.replaceChildren();
    });

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
      viewportPx = Math.max(1, deps.container.clientHeight);
      layer.group.traverse((o) => {
        if ((o as THREE.Sprite).isSprite && o.name.startsWith("billboard")) {
          resizeBillboard(o as THREE.Sprite, billboardView());
        }
      });
    });
    resize.observe(deps.container);
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
    const controls = createGlobeCameraControls(scene, camera, canvas, globe, {
      onTake: () => undefined,
      // The editor zooms a double click itself (`zoomTowards`); the
      // library's own double-tap zoom would add a second, animated one.
      doubleTapZoom: false,
      eyeItems: () => eyeSpheres,
    });
    undo.push(() => {
      controls.dispose();
    });

    let relief = true;
    let hidden: GlobeHiddenSet = { stations: new Set(), codes: new Set() };
    let standing = 1;
    let frames = 0;
    let top = false;
    const frameTimes: number[] = [];
    let lastFrameAt: number | null = null;
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

    function updateLayers(now: number): void {
      if (lastFrameAt !== null) {
        frameTimes.push(now - lastFrameAt);
        if (frameTimes.length > 60) frameTimes.shift();
      }
      lastFrameAt = now;
      // The carrier of the ground by the camera's altitude.
      const altitudeM = ellipsoid.getPositionElevation(
        view.ecefCamera().position,
      );
      relief = reliefCarries(altitudeM, relief);
      globe.tiles.group.visible = !relief;
      ground.terrain.tiles.group.visible = relief;
      if (relief) {
        globe.updateClouds(renderer);
        ground.update(camera, renderer, now);
      } else {
        globe.update(camera, renderer);
      }

      camera.updateMatrixWorld();
      followFrame();
      // The hand-over at the camera's height; the globe's sun at its
      // eased exposure.
      air?.step();
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
      layer.setHidden(
        held === null
          ? hidden.stations
          : new Set([...hidden.stations, ...held]),
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

    const aimAt = (at: THREE.Vector3, radiusM: number) => {
      const place = placeOfTour(at);
      controls.release();
      view.placeView(
        aimView({ lat: place.lat, lng: place.lng }, place.heightM, radiusM),
      );
      controls.followIntro();
    };
    const placePose = (change: { headingDeg?: number; pitchDeg?: number }) => {
      const pose = poseNow();
      controls.release();
      view.placeView({ ...pose, ...change });
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
        const pose = poseNow();
        const groundM = ground.groundAt(pose.lat * DEG, pose.lng * DEG);
        const aboveM = Math.max(0, pose.altitudeKm * 1000 - (groundM ?? 0));
        controls.release();
        view.placeView(steppedView(pose, code, aboveM));
        controls.followIntro();
      },
      zoomTowards(pointer) {
        // Along the ray under the pointer: what is there stays there.
        const hit = editing.groundUnder(pointer);
        if (!("at" in hit)) return;
        controls.release();
        camera.position.lerp(
          new THREE.Vector3(hit.at.x, hit.at.y, hit.at.z),
          ZOOM_SHARE,
        );
        camera.updateMatrixWorld();
      },
    });
    undo.push(() => {
      editing.dispose();
    });

    // The first view: at street level south of the tour, on the tour's
    // drawn height (the ground is not loaded yet).
    const centreHeightM =
      centre.altM - undulationAt({ lat: centre.lat, lon: centre.lng });
    view.placeView(
      streetView({ lat: centre.lat, lng: centre.lng }, centreHeightM),
    );
    controls.followIntro();

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
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
          camera.quaternion,
        );
        worldOf(new THREE.Vector3(), worldPoint);
        camera.position.copy(worldPoint).addScaledVector(forward, -m);
        camera.updateMatrixWorld();
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
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
          camera.quaternion,
        );
        const toTour = camera.position.distanceTo(
          worldOf(new THREE.Vector3(), worldPoint),
        );
        camera.position.addScaledVector(
          forward,
          step * ZOOM_SHARE * Math.max(GLOBE_EDITOR_LOOK.backM, toTour),
        );
        camera.updateMatrixWorld();
      },
      northUp() {
        placePose({ headingDeg: 0 });
      },
      setRealTime(on) {
        if (on === realTime) return;
        realTime = on;
        startClock();
      },
      readout() {
        const pose = poseNow();
        const mean =
          frameTimes.length === 0
            ? 0
            : frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
        return {
          tiltDeg: 90 + pose.pitchDeg,
          headingDeg: pose.headingDeg,
          top,
          drawCalls: renderer.info.render.calls,
          frameMs: mean,
        };
      },
      setLayers(hiddenLayers) {
        layer.setShown({
          names: !hiddenLayers.includes("names"),
          codes: !hiddenLayers.includes("codes"),
        });
      },
      centre() {
        // The place under the camera, on the drawn ground where loaded.
        const pose = poseNow();
        const groundM = ground.groundAt(pose.lat * DEG, pose.lng * DEG);
        return {
          lat: pose.lat,
          lon: pose.lng,
          alt: groundM ?? pose.altitudeKm * 1000 - GLOBE_EDITOR_LOOK.eyeM,
        };
      },
      groundAt: (place) => ground.groundAt(place.lat * DEG, place.lon * DEG),
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
          // The tour's centre at its drawn height (the frame's origin is
          // on the ellipsoid, under it).
          target: [0, centreHeightM, 0],
          camera: [camera.position.x, camera.position.y, camera.position.z],
          distanceM: Math.hypot(
            cameraTour.x,
            cameraTour.y - centreHeightM,
            cameraTour.z,
          ),
          flying: false,
          top,
          ground: (tourNow?.stations ?? []).map((s) => ({
            id: s.id,
            drawnM: s.geo.alt - undulationAt(s.geo),
            groundM: ground.groundAt(s.geo.lat * DEG, s.geo.lon * DEG),
          })),
          globe: {
            carrier: relief ? "relief" : "globe",
            altitudeM: pose.altitudeKm * 1000,
            frameTarget: view.frameTarget(),
            hiddenStations: [...hidden.stations],
            hiddenCodes: [...hidden.codes],
            recentres: view.state().frameRecentres,
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
          },
        };
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
