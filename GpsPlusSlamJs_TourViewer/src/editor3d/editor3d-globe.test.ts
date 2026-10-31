// @vitest-environment jsdom
/**
 * Why these tests matter: `editor3d-globe.ts` is wiring - the globe's view
 * core, its camera controls, the editing and the page's checks - and each
 * of its promises lives in a line that looks right in isolation:
 * - a gesture holds the world frame still (`gestureBusy`), and a frame
 *   move releases the controls and refreshes the editing's ECEF matrices
 *   (else the first frames read the world through the identity);
 * - the page's ground heights are the tour file's ellipsoidal heights
 *   (the drawn ground plus the geoid's N), as the editing's are;
 * - the zoom and the distance the checks set are measured to the tour's
 *   centre at its drawn height, as `stats().distanceM` is - not to the
 *   frame's origin on the ellipsoid, hundreds of metres below a tour on a
 *   hill;
 * - dispose stops the loop before anything is freed, and takes the
 *   context-lost listener off before it forces the loss itself.
 * Here the view core, the controls, the relief, the stations layer and
 * the input are fakes (no WebGL in jsdom); the frames are real: the fake
 * view places its camera through the globe's own `viewPoseEcef`, and the
 * editing is the real one, so the geoid's N is really added where it is.
 */
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { worldFromEcefAt } from "gps-plus-slam-globe/editor";
import { WGS84_ELLIPSOID } from "gps-plus-slam-globe/test-utils/view-pose";

import type { Editor3dDeps, Editor3dView } from "./editor3d-scene.js";
import { openGlobeEditor } from "./editor3d-globe.js";
import { GLOBE_EDITOR_LOOK } from "./globe-editor-look.js";

const DEG = Math.PI / 180;
/** The geoid's N everywhere in these tests (m). */
const N = 47;
/** The relief's drawn height everywhere (m over the ellipsoid). */
const DRAWN_M = 500;
const MUNICH = { lat: 48.1374, lon: 11.5755 };

interface Pose {
  lat: number;
  lng: number;
  altitudeKm: number;
  headingDeg: number;
  pitchDeg: number;
}

/** What the mocks below record and hand back; hoisted with them. */
interface Fakes {
  log: string[];
  manifest: unknown;
  gesture: string | null;
  busy: boolean;
  seams: null | Record<string, (...args: unknown[]) => unknown>;
  view: null | {
    camera: THREE.PerspectiveCamera;
    globe: { group: THREE.Group };
    setFrameTarget(target: { lat: number; lng: number }): void;
    placeView(pose: Pose): void;
  };
  controls: null | { release: { mock: { calls: unknown[] } } };
  /** The relief's ground everywhere (drawn, m over the ellipsoid), as its
   *  sampled heights and `groundAt` read it; null: none loaded. */
  groundM: number | null;
  /** The scene the editing hands its input (its double-click zoom). */
  inputScene: null | {
    zoomTowards?(pointer: { x: number; y: number }): void;
  };
}

const fakes = vi.hoisted((): Fakes => ({
  log: [],
  manifest: null,
  gesture: null,
  busy: false,
  seams: null,
  view: null,
  controls: null,
  groundM: 500,
  inputScene: null,
}));

vi.mock("gps-plus-slam-osm/elevation/egm96", () => ({
  egm96Geoid: () => ({ undulationMetres: () => 47 }),
}));

vi.mock("gps-plus-slam-globe/view", async (importOriginal) => {
  const THREE = await import("three");
  const { worldFromEcefAt } = await import("gps-plus-slam-globe/editor");
  const { WGS84_ELLIPSOID, viewPoseEcef } =
    await import("gps-plus-slam-globe/test-utils/view-pose");
  return {
    ...(await importOriginal<object>()),
    creditsFor: () => [],
    mountGlobeViewAir: () => ({
      afterSky() {},
      step() {},
      afterScene() {},
      haze() {},
      state: () => null,
      dispose: () => fakes.log.push("air-dispose"),
    }),
    createGlobeCameraControls: () => {
      const controls = {
        pickFrom: vi.fn(),
        update: vi.fn(),
        release: vi.fn(),
        lease: vi.fn(),
        busy: () => fakes.busy,
        followIntro: vi.fn(),
        dispose: vi.fn(),
      };
      fakes.controls = controls;
      return controls;
    },
    createGlobeView: (options: {
      seams: Record<string, (...args: unknown[]) => unknown>;
    }) => {
      fakes.seams = options.seams;
      const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1e7);
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      let target: { lat: number; lng: number } | null = null;
      const rotation = new THREE.Quaternion();
      const ecefCamera = () => {
        const inverse = group.matrix.clone().invert();
        rotation.setFromRotationMatrix(group.matrix);
        return {
          position: camera.position.clone().applyMatrix4(inverse),
          quaternion: rotation.clone().invert().multiply(camera.quaternion),
        };
      };
      const place = (pose: {
        position: THREE.Vector3;
        quaternion: THREE.Quaternion;
      }) => {
        rotation.setFromRotationMatrix(group.matrix);
        camera.position.copy(pose.position).applyMatrix4(group.matrix);
        camera.quaternion.copy(rotation).multiply(pose.quaternion);
        camera.updateMatrixWorld();
      };
      // As the view core's: the camera keeps its ECEF pose, the seam is told.
      const setFrameTarget = (next: { lat: number; lng: number }) => {
        if (target?.lat === next.lat && target.lng === next.lng) return;
        const before = ecefCamera();
        worldFromEcefAt(WGS84_ELLIPSOID, next, group.matrix);
        target = { ...next };
        group.updateMatrixWorld(true);
        place(before);
        options.seams.frameChanged?.(target);
      };
      const renderer = {
        info: { render: { calls: 0 } },
        setPixelRatio() {},
        compile() {},
        initTexture() {},
        forceContextLoss: () => fakes.log.push("force-context-loss"),
        setAnimationLoop: (loop: (() => void) | null) => {
          fakes.log.push(loop === null ? "loop-off" : "loop-on");
          // jsdom lays nothing out: the first tick resolves the open.
          loop?.();
        },
      };
      const view = {
        renderer,
        scene: new THREE.Scene(),
        camera,
        globe: {
          group,
          tiles: { group: new THREE.Group(), ellipsoid: WGS84_ELLIPSOID },
          activeSources: () => [],
          update() {},
          updateClouds() {},
          state: () => ({}),
        },
        startClock() {},
        recentreFrame() {},
        frame() {},
        frameTarget: () => target,
        state: () => ({ frameRecentres: 0 }),
        sceneMs: () => 0,
        ecefCamera,
        setFrameTarget,
        placeView(pose: Pose) {
          const ecef = viewPoseEcef(WGS84_ELLIPSOID, pose);
          setFrameTarget({ lat: pose.lat, lng: pose.lng });
          place(ecef);
        },
        dispose: () => fakes.log.push("view-dispose"),
      };
      fakes.view = view;
      return view;
    },
  };
});

vi.mock("./editor3d-terrain.js", async () => {
  const THREE = await import("three");
  const { WGS84_ELLIPSOID } =
    await import("gps-plus-slam-globe/test-utils/view-pose");
  return {
    reliefDeviceClass: () => "desktop",
    createEditorTerrain: () => ({
      terrain: {
        tiles: { group: new THREE.Group(), ellipsoid: WGS84_ELLIPSOID },
        plugin: { sampleCartographicElevation: () => fakes.groundM },
      },
      groundAt: () => fakes.groundM,
      update() {},
      credits: [],
      osm: { stats: () => ({}), coverage: () => 0 },
      dispose() {},
    }),
  };
});

vi.mock("./editor3d-stations.js", async () => {
  const THREE = await import("three");
  return {
    DEFAULT_CODE_SIZE_M: 0.2,
    createStationsLayer: () => ({
      group: new THREE.Group(),
      setTour() {},
      stationObjects: () => null,
      pointOf: () => null,
      radiusOf: () => null,
      itemPointOf: () => null,
      codePointOf: () => null,
      setHidden() {},
      update() {},
      setShown() {},
      setPreview() {},
      pick: () => null,
      modelObject: () => null,
      stats: () => ({}),
      dispose() {},
    }),
  };
});

vi.mock("./editor3d-marks.js", () => ({
  createBillboard: () => null,
  createCodeFace: () => ({ dispose() {} }),
  createCodeSquare: () => null,
  resizeBillboard() {},
}));

vi.mock("./editor3d-gizmo.js", async () => {
  const THREE = await import("three");
  return {
    drawGizmoPictures: () => ({}),
    createGizmo: () => ({
      parts: { disc: new THREE.Mesh(), knob: new THREE.Sprite(), dots: [] },
      update() {},
      dispose() {},
    }),
  };
});

vi.mock("./editor3d-model-parts.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createModelParts: () => ({ update() {}, stats: () => ({}), dispose() {} }),
}));

vi.mock("./editor3d-input.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createSceneInput: (options: { scene: Fakes["inputScene"] }) => {
    fakes.inputScene = options.scene;
    return {
      gesture: () => fakes.gesture,
      frame() {},
      cancel() {},
      dispose() {},
    };
  },
}));

vi.mock("../tour-document.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  manifestToWrite: () => fakes.manifest,
}));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

/** A tour of one station at Munich, its centre drawn `heightM` over the
 *  ellipsoid (its file height N more). */
function tourAt(heightM: number) {
  fakes.manifest = {
    stations: [
      {
        id: "s1",
        geo: { ...MUNICH, alt: heightM + N },
        foundRadiusM: 5,
      },
    ],
  };
}

function deps(): Editor3dDeps {
  const container = document.createElement("div");
  document.body.append(container);
  return {
    container,
    credits: document.createElement("div"),
    store: {
      getState: () => ({
        tourDocument: {},
        editorView: { selected: null, modelFocus: null, modelPick: null },
      }),
      subscribe: () => () => undefined,
      dispatch: () => undefined,
    },
    levels: () => new Map(),
    loadContent: () => Promise.reject(new Error("none here")),
    events: { contextLost() {}, failed() {} },
    edits: {},
  } as unknown as Editor3dDeps;
}

let open: Editor3dView | null = null;
async function openAt(heightM: number): Promise<Editor3dView> {
  tourAt(heightM);
  open = await openGlobeEditor(deps(), { hidePx: 4, crowdPx: 16 });
  return open;
}

/** The camera's place (degrees) read from the fake view's ECEF pose. */
function cameraPlace(): { lat: number; lon: number } {
  const view = fakes.view;
  if (view === null) throw new Error("no view");
  const ecef = view.camera.position
    .clone()
    .applyMatrix4(view.globe.group.matrix.clone().invert());
  const c = WGS84_ELLIPSOID.getPositionToCartographic(ecef, {
    lat: 0,
    lon: 0,
    height: 0,
  });
  return { lat: c.lat / DEG, lon: c.lon / DEG };
}

/** The camera placed at the tour's latitude less `southM`, `aboveM` over
 *  `groundM` (or the ellipsoid), looking north `pitchDeg`. */
function placeCamera(
  aboveM: number,
  pitchDeg: number,
  groundM: number | null,
  southM = 0,
): void {
  fakes.view?.placeView({
    lat: MUNICH.lat - southM / 111_200,
    lng: MUNICH.lon,
    altitudeKm: ((groundM ?? 0) + aboveM) / 1000,
    headingDeg: 0,
    pitchDeg,
  });
}

/** A world point's height over the ellipsoid. */
function heightOfWorld(point: THREE.Vector3): number {
  const view = fakes.view;
  if (view === null) throw new Error("no view");
  const ecef = point
    .clone()
    .applyMatrix4(view.globe.group.matrix.clone().invert());
  return WGS84_ELLIPSOID.getPositionToCartographic(ecef, {
    lat: 0,
    lon: 0,
    height: 0,
  }).height;
}

/** The camera's forward (the world). */
function forwardOf(camera: THREE.Camera): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
}

/** The tour's centre at its drawn height, in the world now. */
function tourCentreWorld(heightM: number): THREE.Vector3 {
  const view = fakes.view;
  if (view === null) throw new Error("no view");
  const ecefFromTour = worldFromEcefAt(
    WGS84_ELLIPSOID,
    { lat: MUNICH.lat, lng: MUNICH.lon },
    new THREE.Matrix4(),
  ).invert();
  return new THREE.Vector3(0, heightM, 0)
    .applyMatrix4(ecefFromTour)
    .applyMatrix4(view.globe.group.matrix);
}

beforeEach(() => {
  fakes.log.length = 0;
  fakes.gesture = null;
  fakes.busy = false;
  fakes.groundM = DRAWN_M;
  fakes.inputScene = null;
});
afterEach(() => {
  open?.dispose();
  open = null;
  document.body.replaceChildren();
});

describe("openGlobeEditor's wiring", () => {
  it("holds the world frame still while a gesture runs", async () => {
    await openAt(0);
    const busy = () => fakes.seams?.gestureBusy?.();
    expect(busy()).toBe(false);
    fakes.gesture = "move";
    expect(busy()).toBe(true);
    fakes.gesture = null;
    fakes.busy = true;
    expect(busy()).toBe(true);
  });

  it("releases the controls when the world frame moves", async () => {
    await openAt(0);
    const before = fakes.controls?.release.mock.calls.length ?? 0;
    fakes.view?.setFrameTarget({ lat: 47.3, lng: 11.4 });
    expect(fakes.controls?.release.mock.calls.length).toBe(before + 1);
  });

  // Why: the editing reads the world through the ECEF matrices; they must
  // follow every frame move (the first view's included), not wait for the
  // first drawn frame.
  it("reads the place under the camera right after a frame move", async () => {
    const view = await openAt(0);
    const at = cameraPlace();
    expect(view.centre()?.lat).toBeCloseTo(at.lat, 6);
    expect(view.centre()?.lon).toBeCloseTo(at.lon, 6);
    fakes.view?.setFrameTarget({ lat: 47.3, lng: 11.4 });
    expect(view.centre()?.lat).toBeCloseTo(at.lat, 6);
    expect(view.centre()?.lon).toBeCloseTo(at.lon, 6);
  });

  // Why: the page writes these heights into the tour file, whose heights
  // are ellipsoidal; the drawn ground is N lower.
  it("gives the page's ground heights with the geoid's N added", async () => {
    const view = await openAt(0);
    expect(view.centre()?.alt).toBeCloseTo(DRAWN_M + N, 6);
    expect(view.groundAt(MUNICH)).toBeCloseTo(DRAWN_M + N, 6);
  });

  // Why: measured from the frame's origin on the ellipsoid, a tour on a
  // hill would be zoomed and distanced from a point hundreds of metres
  // under it. Swept over tour heights 0 (where both agree), 515 and 2500 m.
  it.each([0, 515, 2500])(
    "measures the zoom and the distance to the tour's centre at %s m",
    async (heightM) => {
      // No ground under the screen's centre: the tour is what is measured.
      fakes.groundM = null;
      const view = await openAt(heightM);
      const camera = fakes.view?.camera;
      if (camera === undefined) throw new Error("no camera");
      const centre = tourCentreWorld(heightM);
      view.setDistance(1000);
      expect(camera.position.distanceTo(centre)).toBeCloseTo(1000, 3);
      view.zoom(1);
      expect(camera.position.distanceTo(centre)).toBeCloseTo(650, 3);
      view.zoom(-1);
      const out = 650 + 0.35 * Math.max(GLOBE_EDITOR_LOOK.backM, 650);
      expect(camera.position.distanceTo(centre)).toBeCloseTo(out, 3);
    },
  );

  // Why: the double click's (and the double tap's) zoom found the ground
  // with the default reach (5 km) and did nothing past it, nor where no
  // heights had loaded. From any height it steps a share toward the
  // sampled ground under the pointer, to its horizon, and toward the
  // ellipsoid where no ground answers. Swept over three heights, each with
  // the ground beyond 5 km, loaded (200 m) and not.
  it.each([
    [300, -2, 200],
    [8_000, -20, 200],
    [40_000, -30, 200],
    [300, -2, null],
    [8_000, -20, null],
    [40_000, -30, null],
  ])(
    "zooms a double click from %s m up (%s deg) toward the ground at %s m",
    async (aboveM, pitchDeg, groundM) => {
      fakes.groundM = groundM;
      await openAt(0);
      const camera = fakes.view?.camera;
      const zoomTowards = fakes.inputScene?.zoomTowards;
      if (camera === undefined || zoomTowards === undefined)
        throw new Error("no camera or zoom");
      placeCamera(aboveM, pitchDeg, groundM);
      const before = camera.position.clone();
      const forward = forwardOf(camera);
      // jsdom lays nothing out: the canvas counts 1 px, so 0.5 is its middle.
      zoomTowards({ x: 0.5, y: 0.5 });
      const move = camera.position.clone().sub(before);
      expect(move.length()).toBeGreaterThan(aboveM * 0.3);
      expect(move.clone().normalize().dot(forward)).toBeCloseTo(1, 6);
      // The point stepped toward: the move is ZOOM_SHARE (0.35) of the way.
      const target = before.clone().addScaledVector(move, 1 / 0.35);
      expect(heightOfWorld(target)).toBeCloseTo(groundM ?? 0, 0);
    },
  );

  // Why: the zoom buttons stepped a share of the distance to the TOUR: 50
  // km from it, 300 m up and looking 45 degrees down, one step flew 17.5
  // km forward, kilometres under the ground. They step a share of the
  // distance to the ground under the screen's centre instead.
  it("zooms a button step toward the ground ahead, not the far tour", async () => {
    fakes.groundM = 200;
    await openAt(0);
    const camera = fakes.view?.camera;
    if (camera === undefined) throw new Error("no camera");
    placeCamera(300, -45, 200, 50_000);
    const before = camera.position.clone();
    open?.zoom(1);
    const moved = camera.position.distanceTo(before);
    expect(moved).toBeCloseTo(0.35 * 300 * Math.SQRT2, -1);
    expect(heightOfWorld(camera.position) - 200).toBeGreaterThan(
      GLOBE_EDITOR_LOOK.eyeM,
    );
  });

  // Why: a step is at least a share of `backM` (30 m), so close over the
  // ground one step forward could take the camera under it. Swept from
  // just over eye height to 40 m, steep and shallow: never under eye
  // height.
  it.each([
    [1.8, -45],
    [3, -45],
    [10, -80],
    [40, -60],
    [3, -10],
  ])(
    "never steps under eye height from %s m up at %s deg",
    async (aboveM, pitchDeg) => {
      fakes.groundM = 200;
      await openAt(0);
      const camera = fakes.view?.camera;
      if (camera === undefined) throw new Error("no camera");
      placeCamera(aboveM, pitchDeg, 200);
      open?.zoom(1);
      expect(heightOfWorld(camera.position) - 200).toBeGreaterThanOrEqual(
        GLOBE_EDITOR_LOOK.eyeM - 1e-3,
      );
    },
  );

  // Why: with no ground loaded the place under the camera was given at
  // the CAMERA's height, so "+" from 3 km up put a station 3 km in the
  // air. Near the ground it is now the camera's height less eye height;
  // above the relief's ceiling there is none (the page says why). Swept
  // either side of the ceiling.
  it.each([
    GLOBE_EDITOR_LOOK.eyeM,
    300,
    GLOBE_EDITOR_LOOK.reliefCeilingM - 100,
  ])(
    "gives eye height under a camera %s m up with no ground loaded",
    async (aboveM) => {
      fakes.groundM = null;
      const view = await openAt(0);
      placeCamera(aboveM, -30, null);
      const at = view.centre();
      if (at === null) throw new Error("no centre");
      expect(at.alt).toBeCloseTo(aboveM - GLOBE_EDITOR_LOOK.eyeM + N, 3);
      expect(at.lat).toBeCloseTo(MUNICH.lat, 6);
    },
  );
  it.each([GLOBE_EDITOR_LOOK.reliefCeilingM + 100, 40_000])(
    "gives no place under a camera %s m up with no ground loaded",
    async (aboveM) => {
      fakes.groundM = null;
      const view = await openAt(0);
      placeCamera(aboveM, -30, null);
      expect(view.centre()).toBeNull();
    },
  );

  // Why: a frame drawn while the view is being freed draws with freed
  // parts; and the loss dispose forces must not reach the page as a lost
  // context. The air (its sky and haze passes) is freed too, before the
  // view it was mounted on: no test held that, so a lost dispose would
  // have leaked it on every close.
  it("stops the loop first, frees the air before the view, and drops the lost-context listener before forcing the loss", async () => {
    const view = await openAt(0);
    const canvas = document.querySelector("canvas");
    if (canvas === null) throw new Error("no canvas");
    const remove = vi.spyOn(canvas, "removeEventListener");
    remove.mockImplementation((type) => {
      if (type === "webglcontextlost") fakes.log.push("listener-off");
    });
    fakes.log.length = 0;
    view.dispose();
    open = null;
    expect(fakes.log[0]).toBe("loop-off");
    expect(fakes.log.filter((e) => e === "air-dispose")).toHaveLength(1);
    expect(fakes.log.indexOf("air-dispose")).toBeLessThan(
      fakes.log.indexOf("view-dispose"),
    );
    expect(fakes.log.indexOf("listener-off")).toBeGreaterThanOrEqual(0);
    expect(fakes.log.indexOf("listener-off")).toBeLessThan(
      fakes.log.indexOf("force-context-loss"),
    );
  });
});
