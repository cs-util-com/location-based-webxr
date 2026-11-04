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
import { GIBS_ACKNOWLEDGEMENT } from "gps-plus-slam-globe/view";
import { WGS84_ELLIPSOID } from "gps-plus-slam-globe/test-utils/view-pose";

import type { Editor3dDeps, Editor3dView } from "./editor3d-scene.js";
import { openGlobeEditor } from "./editor3d-globe.js";
import { GLOBE_EDITOR_LOOK } from "./globe-editor-look.js";
import { readGlobeSwitch } from "../editor/globe-switch.js";

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
    renderer: { render(scene: THREE.Scene, camera: THREE.Camera): void };
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    globe: { group: THREE.Group };
    setFrameTarget(target: { lat: number; lng: number }): void;
    placeView(pose: Pose): void;
  };
  controls: null | { release: { mock: { calls: unknown[] } } };
  /** The zoom-out limit the editor gave the controls (`limit`). */
  zoomOutLimit: null | (() => number);
  /** What the renderer drew after the scene, in order: the streaks (with
   *  their weight) and the air. */
  draws: string[];
  /** The streaks' mesh as last drawn (the pass's own). */
  dustMesh: THREE.Mesh | null;
  /** The relief's ground everywhere (drawn, m over the ellipsoid), as its
   *  sampled heights and `groundAt` read it; null: none loaded. */
  groundM: number | null;
  /** The ground's rise per metre north of the tour (0.3: a 30 % grade
   *  climbing north); 0: level. */
  grade: number;
  /** How far north of the tour (m) the loaded ground reaches; past it
   *  none is loaded. Null: everywhere. */
  groundEndsNorthM: number | null;
  /** The ground (drawn, m) at a latitude (radians), as `groundM`,
   *  `grade` and `groundEndsNorthM` make it; null: none loaded. */
  groundAt(latRad: number): number | null;
  /** The scene the editing hands its input (its double-click zoom). */
  inputScene: null | {
    zoomTowards?(pointer: { x: number; y: number }): void;
  };
  /** How often the map's coverage was read. */
  coverageCalls: number;
  /** The options the view was made with. */
  viewOptions: null | {
    band?: boolean;
    stencil?: boolean;
    fill?: boolean;
    reversedDepth?: boolean;
  };
  /** The options the air was mounted with. */
  airOptions: null | { clouds?: unknown };
  /** The frames the air was stepped with. */
  airSteps: { shareClouds?: (flat: number) => number }[];
  /** What the air's cloud switch was told. */
  cloudsOn: boolean[];
  /** The share of the ground the relief mount reports (1: the relief
   *  carries all of it, 0: the globe's surface). */
  reliefShare: number;
  /** The relief mount: what it was made with and how it was driven. */
  reliefMount: null | {
    options: { globe: unknown; relief: unknown; fill: boolean };
    altitudesM: number[];
    cloudShares: number[];
    /** The flat layer's shares the cloud shell was asked for. */
    cloudFlats: number[];
    disposed: boolean;
  };
  /** What the relief was made with. */
  terrainInput: null | {
    imagery?: unknown;
    template?: unknown;
    osmGain?: number;
    osmGainMode?: string;
  };
  /** Whether the stations layer hands out its objects (a station is then
   *  admitted at its first upload); false: none ever is. */
  admits: boolean;
  /** Whether the relief mount says nothing of the relief is loading. */
  settled: boolean;
  /** The whole-Earth imagery the view's module hands out. */
  imagery: object;
}

const fakes = vi.hoisted((): Fakes => ({
  log: [],
  manifest: null,
  gesture: null,
  busy: false,
  seams: null,
  view: null,
  controls: null,
  zoomOutLimit: null,
  draws: [],
  dustMesh: null,
  groundM: 500,
  grade: 0,
  groundEndsNorthM: null,
  groundAt(latRad: number): number | null {
    if (this.groundM === null) return null;
    const northM = ((latRad * 180) / Math.PI - 48.1374) * 111_200;
    if (this.groundEndsNorthM !== null && northM > this.groundEndsNorthM)
      return null;
    return this.groundM + this.grade * northM;
  },
  inputScene: null,
  coverageCalls: 0,
  viewOptions: null,
  terrainInput: null,
  imagery: { name: "whole-Earth imagery" },
  reliefShare: 1,
  reliefMount: null,
  admits: false,
  settled: true,
  airOptions: null,
  airSteps: [],
  cloudsOn: [],
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
    // The air's clouds factory: the air is faked, so it is only passed on.
    globeViewClouds: () => () => null,
    createGlobeImagery: () => fakes.imagery,
    mountGlobeRelief: (options: {
      globe: unknown;
      relief: unknown;
      fill: boolean;
    }) => {
      const mount: NonNullable<Fakes["reliefMount"]> = {
        options,
        altitudesM: [],
        cloudShares: [],
        cloudFlats: [],
        disposed: false,
      };
      fakes.reliefMount = mount;
      return {
        step: (_nowMs: number, frame: { altitudeM: number }) => {
          mount.altitudesM.push(frame.altitudeM);
          return fakes.reliefShare;
        },
        draw: (frame: { updateRelief(): void }) => {
          if (fakes.reliefShare > 0) {
            frame.updateRelief();
          }
        },
        shareClouds: (on: boolean, flat: number) => {
          mount.cloudFlats.push(flat);
          const share = on ? fakes.reliefShare : 0;
          mount.cloudShares.push(share);
          return share;
        },
        share: () => fakes.reliefShare,
        target: () => fakes.reliefShare,
        reliefSettled: () => fakes.settled,
        release: {},
        dispose: () => {
          mount.disposed = true;
        },
      };
    },
    mountGlobeViewAir: (_view: unknown, options: Fakes["airOptions"]) => {
      fakes.airOptions = options;
      return {
        afterSky() {},
        step: (frame: Fakes["airSteps"][number] = {}) => {
          fakes.airSteps.push(frame);
        },
        afterScene: () => {
          fakes.draws.push("air");
        },
        haze() {},
        setClouds: (on: boolean) => fakes.cloudsOn.push(on),
        cloudShell: () => null,
        state: () => null,
        dispose: () => fakes.log.push("air-dispose"),
      };
    },
    createGlobeCameraControls: () => {
      const controls = {
        pickFrom: vi.fn(),
        update: vi.fn(),
        release: vi.fn(),
        lease: vi.fn(),
        busy: () => fakes.busy,
        followIntro: vi.fn(),
        limit: vi.fn((limitM: () => number) => {
          fakes.zoomOutLimit = limitM;
        }),
        dispose: vi.fn(),
      };
      fakes.controls = controls;
      return controls;
    },
    createGlobeView: (options: {
      seams: Record<string, (...args: unknown[]) => unknown>;
      band?: boolean;
    }) => {
      fakes.seams = options.seams;
      fakes.viewOptions = options;
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
        // As three.js keeps it: each render adds its call, resetting first
        // only with `autoReset`.
        info: {
          autoReset: true,
          render: { calls: 0 },
          reset() {
            renderer.info.render.calls = 0;
          },
        },
        setPixelRatio() {},
        compile() {},
        initTexture() {},
        getDrawingBufferSize: (size: THREE.Vector2) => size.set(800, 600),
        getPixelRatio: () => 1,
        // The streaks, and the interface pass over the view's scene (the
        // view itself is faked).
        render: (drawn: THREE.Scene) => {
          if (renderer.info.autoReset) renderer.info.reset();
          renderer.info.render.calls++;
          if (drawn === fakes.view?.scene) {
            fakes.draws.push("interface");
            return;
          }
          const mesh = drawn.children[0] as THREE.Mesh<
            THREE.BufferGeometry,
            THREE.ShaderMaterial
          >;
          fakes.dustMesh = mesh;
          fakes.draws.push(`dust ${mesh.material.uniforms.uWeight?.value}`);
        },
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
          template: new THREE.MeshStandardMaterial(),
          surfaceUniforms: { uCarrierShare: { value: 0 } },
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
        // As the view core's: the camera only, the frame kept.
        placeCameraEcef(position: THREE.Vector3, quaternion: THREE.Quaternion) {
          place({ position, quaternion });
        },
        fitDistance: () => 20_000_000,
        radius: WGS84_ELLIPSOID.radius.x,
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
    createEditorTerrain: (input: Fakes["terrainInput"]) => {
      fakes.terrainInput = input;
      return {
        terrain: {
          tiles: {
            group: new THREE.Group(),
            ellipsoid: WGS84_ELLIPSOID,
            loadProgress: 0.75,
            stats: {
              queued: 4,
              downloading: 2,
              parsing: 1,
              loaded: 40,
              failed: 0,
            },
            lruCache: { cachedBytes: 5_000_000, maxBytesSize: 64_000_000 },
          },
          plugin: {
            sampleCartographicElevation: (latRad: number) =>
              fakes.groundAt(latRad),
          },
        },
        groundAt: (latRad: number) => fakes.groundAt(latRad),
        update() {},
        credits: [],
        osm: {
          stats: () => ({}),
          coverage: () => {
            fakes.coverageCalls++;
            return { waiting: 0, failed: 0 };
          },
          mapLoad: () => ({
            waiting: 3,
            failed: 1,
            givenUp: 0,
            ceilingWaitS: 12.5,
          }),
        },
        dispose() {},
      };
    },
  };
});

vi.mock("./editor3d-stations.js", async () => {
  const THREE = await import("three");
  return {
    DEFAULT_CODE_SIZE_M: 0.2,
    createStationsLayer: () => ({
      group: new THREE.Group(),
      setTour() {},
      stationObjects: () => (fakes.admits ? [] : null),
      pointOf: () => null,
      radiusOf: () => null,
      itemPointOf: () => null,
      codePointOf: () => null,
      setHidden() {},
      setGrowth() {},
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
async function openAt(
  heightM: number,
  extra: Partial<Editor3dDeps> = {},
): Promise<Editor3dView> {
  tourAt(heightM);
  open = await openGlobeEditor(
    { ...deps(), ...extra },
    { ...readGlobeSwitch(""), hidePx: 4, crowdPx: 16 },
  );
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
  fakes.grade = 0;
  fakes.groundEndsNorthM = null;
  fakes.inputScene = null;
  fakes.coverageCalls = 0;
  fakes.viewOptions = null;
  fakes.zoomOutLimit = null;
  fakes.draws = [];
  fakes.dustMesh = null;
  fakes.terrainInput = null;
  fakes.reliefShare = 1;
  fakes.reliefMount = null;
  fakes.admits = false;
  fakes.settled = true;
  fakes.airOptions = null;
  fakes.airSteps = [];
  fakes.cloudsOn = [];
});
afterEach(() => {
  vi.restoreAllMocks();
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

  // Why: the editor lands at eye height looking a little down, and the
  // library keeps it there. The cap that keeps the camera over the ground
  // scaled the WHOLE move by the room left under it, which at eye height
  // is none, so "+", a double click on the ground and the phone's double
  // tap did nothing there. Only the move's downward part is capped: the
  // camera walks forward at eye height. The bound above (never under eye
  // height) passed a move of nothing, so this pins the progress. Swept
  // over -3, -5 and -10 degrees, by the button and by the double click.
  it.each([
    [-3, "button"],
    [-5, "button"],
    [-10, "button"],
    [-3, "click"],
    [-5, "click"],
    [-10, "click"],
  ] as const)(
    "walks forward from eye height looking %s deg down (%s)",
    async (pitchDeg, how) => {
      fakes.groundM = 200;
      await openAt(0);
      const camera = fakes.view?.camera;
      const zoomTowards = fakes.inputScene?.zoomTowards;
      if (camera === undefined || zoomTowards === undefined)
        throw new Error("no camera or zoom");
      placeCamera(GLOBE_EDITOR_LOOK.eyeM, pitchDeg, 200);
      const before = camera.position.clone();
      const heightBefore = heightOfWorld(before);
      // The ground straight ahead (the screen's middle; jsdom's canvas is
      // 1 px, so 0.5 is its middle).
      const groundAheadM = GLOBE_EDITOR_LOOK.eyeM / Math.sin(-pitchDeg * DEG);
      const act = {
        button: () => open?.zoom(1),
        click: () => {
          zoomTowards({ x: 0.5, y: 0.5 });
        },
      }[how];
      const stepM = {
        button: 0.35 * Math.max(GLOBE_EDITOR_LOOK.backM, groundAheadM),
        click: 0.35 * groundAheadM,
      }[how];
      act();
      const move = camera.position.clone().sub(before);
      const rise = heightOfWorld(camera.position) - heightBefore;
      const level = Math.sqrt(Math.max(0, move.lengthSq() - rise * rise));
      expect(level / (stepM * Math.cos(pitchDeg * DEG))).toBeCloseTo(1, 1);
      expect(heightOfWorld(camera.position) - 200).toBeGreaterThanOrEqual(
        GLOBE_EDITOR_LOOK.eyeM - 1e-3,
      );
    },
  );

  // Why: the cap measured the room left over the ground under the step's
  // START only, so on ground rising ahead a step from eye height (at least
  // 10.5 m by the button) ended under eye height from about a 6 % grade and
  // under the ground itself on a 30 % one. The ground at the step's end
  // counts too: the camera ends eye height over the higher of the two.
  // Swept over grades from falling 30 % to rising 40 %, at the landed pitch
  // and at -10 deg, by the button and by the double click; each step still
  // walks north. On ground level or rising ahead the higher ground is
  // the end's, so the camera ends exactly eye height over it: a lift
  // larger than needed fails as well as one too small.
  const LANDED_PITCH_DEG =
    -Math.atan2(GLOBE_EDITOR_LOOK.eyeM, GLOBE_EDITOR_LOOK.backM) / DEG;
  it.each(
    [-0.3, 0, 0.06, 0.1, 0.2, 0.3, 0.4].flatMap((grade) =>
      [LANDED_PITCH_DEG, -10].flatMap((pitchDeg) =>
        (["button", "click"] as const).map(
          (how) => [grade, pitchDeg, how] as const,
        ),
      ),
    ),
  )(
    "stays eye height over a %s grade from eye height at %s deg (%s)",
    async (grade, pitchDeg, how) => {
      fakes.groundM = 200;
      fakes.grade = grade;
      await openAt(0);
      const camera = fakes.view?.camera;
      const zoomTowards = fakes.inputScene?.zoomTowards;
      if (camera === undefined || zoomTowards === undefined)
        throw new Error("no camera or zoom");
      placeCamera(GLOBE_EDITOR_LOOK.eyeM, pitchDeg, 200);
      if (how === "button") open?.zoom(1);
      else zoomTowards({ x: 0.5, y: 0.5 });
      const place = cameraPlace();
      const groundEndM = fakes.groundAt(place.lat * DEG);
      if (groundEndM === null) throw new Error("no ground");
      const overEndM = heightOfWorld(camera.position) - groundEndM;
      // Exactly eye height where the end's ground is the higher one.
      const upToM =
        grade >= 0 ? GLOBE_EDITOR_LOOK.eyeM + 1e-2 : Number.POSITIVE_INFINITY;
      expect(overEndM).toBeGreaterThanOrEqual(GLOBE_EDITOR_LOOK.eyeM - 1e-3);
      expect(overEndM).toBeLessThan(upToM);
      expect((place.lat - MUNICH.lat) * 111_200).toBeGreaterThan(0.3);
    },
  );

  // Why: the floor is the higher of the grounds under the step's start
  // and under its end, either alone where the other is not loaded. With
  // heights loaded under the start only, the start's ground is the floor:
  // the camera ends eye height over it, neither dropped to the tour's
  // drawn height (taking the end's ground alone, with the tour as the
  // stand-in) nor lifted further. Swept over the landed pitch and -10
  // deg, by the button and by the double click.
  it.each(
    [LANDED_PITCH_DEG, -10].flatMap((pitchDeg) =>
      (["button", "click"] as const).map((how) => [pitchDeg, how] as const),
    ),
  )(
    "stays eye height over the start's ground with none under the end at %s deg (%s)",
    async (pitchDeg, how) => {
      fakes.groundM = 200;
      fakes.groundEndsNorthM = 0.1;
      await openAt(0);
      const camera = fakes.view?.camera;
      const zoomTowards = fakes.inputScene?.zoomTowards;
      if (camera === undefined || zoomTowards === undefined)
        throw new Error("no camera or zoom");
      placeCamera(GLOBE_EDITOR_LOOK.eyeM, pitchDeg, 200);
      if (how === "button") open?.zoom(1);
      else zoomTowards({ x: 0.5, y: 0.5 });
      const place = cameraPlace();
      expect(fakes.groundAt(place.lat * DEG)).toBeNull();
      expect(
        Math.abs(heightOfWorld(camera.position) - 200 - GLOBE_EDITOR_LOOK.eyeM),
      ).toBeLessThan(1e-2);
    },
  );

  // Why: with no heights loaded under the camera a double click aims at
  // the ellipsoid, so near a tour on a hill one click took the camera
  // hundreds of metres under the real ground there. With no ground loaded
  // the tour's own drawn height stands in for it. Swept over tours at 515
  // and 2500 m, looking 10 and 45 degrees down.
  it.each([
    [515, -10],
    [515, -45],
    [2500, -10],
    [2500, -45],
  ])(
    "keeps a double click eye height over a tour at %s m with no ground loaded (%s deg)",
    async (heightM, pitchDeg) => {
      fakes.groundM = null;
      await openAt(heightM);
      const camera = fakes.view?.camera;
      const zoomTowards = fakes.inputScene?.zoomTowards;
      if (camera === undefined || zoomTowards === undefined)
        throw new Error("no camera or zoom");
      placeCamera(heightM + GLOBE_EDITOR_LOOK.eyeM, pitchDeg, null);
      const before = camera.position.clone();
      zoomTowards({ x: 0.5, y: 0.5 });
      expect(camera.position.distanceTo(before)).toBeGreaterThan(1);
      expect(heightOfWorld(camera.position) - heightM).toBeGreaterThanOrEqual(
        GLOBE_EDITOR_LOOK.eyeM - 1e-3,
      );
    },
  );

  // Why: the tour's drawn height stands in for missing ground only near
  // the tour. 50 km from a tour at 2500 m, a step with no ground loaded
  // lifted the camera from 300 m to 2500 m; there no ground means no
  // lift. Swept over the button and the double click, 10 and 45 degrees
  // down.
  it.each([
    [-10, "button"],
    [-45, "button"],
    [-10, "click"],
    [-45, "click"],
  ] as const)(
    "does not lift a camera far from the tour with no ground loaded (%s deg, %s)",
    async (pitchDeg, how) => {
      fakes.groundM = null;
      await openAt(2500);
      const camera = fakes.view?.camera;
      const zoomTowards = fakes.inputScene?.zoomTowards;
      if (camera === undefined || zoomTowards === undefined)
        throw new Error("no camera or zoom");
      placeCamera(300, pitchDeg, null, 50_000);
      if (how === "button") open?.zoom(1);
      else zoomTowards({ x: 0.5, y: 0.5 });
      expect(heightOfWorld(camera.position)).toBeLessThan(300 + 1e-3);
    },
  );

  // Why: the stand-in's reach was computed once from the tour at open,
  // so a station added 50 km away later still read as "far from the tour"
  // there and a step with no ground loaded could sink under its height.
  // The reach follows the tour as it is edited. Swept over the button and
  // the double click.
  it.each(["button", "click"] as const)(
    "lifts over a station added 50 km away after the open (%s)",
    async (how) => {
      fakes.groundM = null;
      tourAt(2500);
      let listener: () => void = () => undefined;
      let doc: object = {};
      const store = {
        getState: () => ({
          tourDocument: doc,
          editorView: { selected: null, modelFocus: null, modelPick: null },
        }),
        subscribe: (l: () => void) => {
          listener = l;
          return () => undefined;
        },
        dispatch: () => undefined,
      } as unknown as Editor3dDeps["store"];
      open = await openGlobeEditor(
        { ...deps(), store },
        { ...readGlobeSwitch(""), hidePx: 4, crowdPx: 16 },
      );
      const camera = fakes.view?.camera;
      const zoomTowards = fakes.inputScene?.zoomTowards;
      if (camera === undefined || zoomTowards === undefined)
        throw new Error("no camera or zoom");
      fakes.manifest = {
        stations: [
          { id: "s1", geo: { ...MUNICH, alt: 2500 + N }, foundRadiusM: 5 },
          {
            id: "far",
            geo: {
              lat: MUNICH.lat - 50_000 / 111_200,
              lon: MUNICH.lon,
              alt: 2500 + N,
            },
            foundRadiusM: 5,
          },
        ],
      };
      doc = {};
      listener();
      placeCamera(300, -10, null, 50_000);
      if (how === "button") open?.zoom(1);
      else zoomTowards({ x: 0.5, y: 0.5 });
      expect(heightOfWorld(camera.position)).toBeGreaterThanOrEqual(
        2500 + GLOBE_EDITOR_LOOK.eyeM - 1e-3,
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

  /** One frame of the view at `now` (ms), as its loop runs it. */
  const frameAt = (now: number) => {
    fakes.seams?.driveCamera?.();
    fakes.seams?.update?.(now);
  };

  // Why: the editor's relief was plain beige on the plain imagery, under a
  // globe whose surface the relief never blended with, so the ground
  // changed colour and look where the relief took over. It is drawn as the
  // globe lab's is: the globe's own imagery (an overlay of its own) and
  // the globe's template, in a view whose surface compiles the band.
  it("draws the relief with the globe's imagery and look", async () => {
    await openAt(0);
    expect(fakes.viewOptions?.band).toBe(true);
    expect(fakes.terrainInput?.imagery).toBe(fakes.imagery);
    expect(fakes.terrainInput?.template).toBeDefined();
    expect(fakes.terrainInput?.template).toBe(
      (fakes.view?.globe as { template?: unknown }).template,
    );
  });

  // Why: the editor swapped the whole ground at 25 km (the globe's
  // surface hidden, the relief shown), so the picture jumped as the camera
  // passed it, while the globe lab hands the ground over across a band of
  // heights, the globe's surface filling every pixel the relief has not
  // loaded. The editor hands it over through the same mount, with the
  // fill, so it draws as the lab does; the carrier the page reports (and
  // picks on) is the one holding most of the ground.
  it("hands the ground over through the globe's relief mount, with the fill", async () => {
    await openAt(0);
    expect(fakes.viewOptions?.stencil).toBe(true);
    // A fill mount needs a view made with the fill: without it the globe's
    // surface keeps discarding by the carrier share, leaving holes where
    // the relief has no tile yet.
    expect(fakes.viewOptions?.fill).toBe(true);
    const mount = fakes.reliefMount;
    if (mount === null) throw new Error("no relief mount");
    expect(mount.options.fill).toBe(true);
    expect(mount.options.globe).toBe(fakes.view?.globe);
    // The relief handed over is the one drawn under the globe's group.
    const reliefTiles = (
      mount.options.relief as { tiles: { group: THREE.Object3D } }
    ).tiles;
    expect(reliefTiles.group.parent).toBe(fakes.view?.globe.group);
    placeCamera(500_000, -10, null);
    frameAt(16);
    expect(mount.altitudesM.at(-1)).toBeCloseTo(500_000, -1);
    expect(open?.stats().globe?.carrier).toBe("relief");
    fakes.reliefShare = 0;
    frameAt(32);
    expect(open?.stats().globe?.carrier).toBe("globe");
  });

  // Why: the same 25 km swap no longer exists, so a hold just above it
  // must not change the carrier; the mount alone decides it.
  it.each([0.4, 0.5, 0.6])(
    "reports the relief as the carrier from half the ground on (share %s)",
    async (share) => {
      await openAt(0);
      fakes.reliefShare = share;
      placeCamera(30_000, -10, null);
      frameAt(16);
      expect(open?.stats().globe?.carrier).toBe(
        share >= 0.5 ? "relief" : "globe",
      );
    },
  );

  // Why: the editor draws the lab's heavy 3D clouds, on by default with
  // a switch; the air carries them, and the View menu's
  // switch reaches them through the view.
  it("mounts the heavy clouds with the air and switches them", async () => {
    const view = await openAt(0);
    expect(typeof fakes.airOptions?.clouds).toBe("function");
    expect(fakes.cloudsOn).toEqual([]);
    view.setClouds?.(false);
    view.setClouds?.(true);
    expect(fakes.cloudsOn).toEqual([false, true]);
  });

  // Why: the cloud shell takes the clouds as the relief takes the ground,
  // as in the lab: the air asks the relief mount for the shell's share at
  // the flat layer's share it planned.
  it("gives the air's clouds the relief mount's share", async () => {
    await openAt(0);
    fakes.reliefShare = 0.75;
    placeCamera(300, -10, DRAWN_M);
    frameAt(16);
    const frame = fakes.airSteps.at(-1);
    expect(frame?.shareClouds?.(0.3)).toBe(0.75);
    expect(fakes.reliefMount?.cloudFlats.at(-1)).toBe(0.3);
  });

  // Why: the approach now starts where the globe lab's intro zooms out to;
  // controls without the lab's limit would pull a takeover there in to
  // their own default at once, and would not let the creator zoom out to
  // where the flight began.
  it("lets the controls zoom out as far as the lab's, never nearer than the start", async () => {
    const view = await openAt(0, { approach: {} });
    const limitM = fakes.zoomOutLimit?.() ?? 0;
    const globe = view.stats().globe as {
      startCentreM: number;
      centreM: number;
    };
    expect(limitM).toBeGreaterThanOrEqual(50_000_000);
    expect(limitM).toBeGreaterThanOrEqual(globe.startCentreM);
    expect(globe.centreM).toBeLessThanOrEqual(limitM);
    expect(globe.centreM).toBeGreaterThan(49_000_000);
  });

  // Why: the streaks are drawn twice a frame, behind the Earth (before the
  // scene) and a share over it, before the air: the globe lab's order,
  // which keeps the air's haze over them; the interface is not drawn after
  // the air from this high (above the cloud deck it stays in the scene's
  // pass, see the next test). Off for dust=0, the speed still
  // measured; a teleport (an arrow step) restarts their speed, so a jump
  // never flashes them.
  for (const { dust, label, shown, draws } of [
    {
      dust: 1,
      label: "behind and over the Earth, before the air",
      shown: true,
      draws: ["dust 0.75", "dust 0.25", "air"],
    },
    {
      dust: 0,
      label: "nowhere for dust=0",
      shown: false,
      draws: ["air"],
    },
  ]) {
    it(`draws the speed streaks ${label}`, async () => {
      let now = 1_000;
      vi.spyOn(performance, "now").mockImplementation(() => now);
      tourAt(0);
      open = await openGlobeEditor(deps(), { ...readGlobeSwitch(""), dust });
      const seams = fakes.seams;
      if (seams === null) throw new Error("no seams");
      const dive = (altitudeKm: number) => {
        fakes.view?.placeView({
          lat: MUNICH.lat,
          lng: MUNICH.lon,
          altitudeKm,
          headingDeg: 0,
          pitchDeg: -89,
        });
        seams.beforeScene?.();
      };
      dive(20_000);
      now += 16;
      dive(19_000);
      seams.afterScene?.();
      const state = open.stats().globe as {
        dust: { shown: boolean; speedMps: number };
      };
      expect(state.dust.speedMps).toBeGreaterThan(1e6);
      expect(state.dust.shown).toBe(shown);
      expect(fakes.draws).toEqual(draws);
      open.northUp();
      now += 16;
      seams.beforeScene?.();
      expect(
        (open.stats().globe as { dust: { speedMps: number } }).dust.speedMps,
      ).toBe(0);
    });
  }

  // Why: below the cloud deck the interface (the tour's billboards, rings
  // and poles) is drawn last, after the air, so the clouds' shadow
  // composited there does not darken it; above the deck it stays in the
  // scene's pass, as the cloud composites write no depth and it would show
  // through the clouds. And the status bar's draw calls are the whole
  // frame's, every pass summed, not the last pass's.
  it("draws the interface after the air below the cloud deck only, and counts the whole frame's draw calls", async () => {
    const view = await openGlobeEditor(deps(), {
      ...readGlobeSwitch(""),
      dust: 0,
    });
    open = view;
    const seams = fakes.seams;
    if (seams === null) throw new Error("no seams");
    const frameAt = (altitudeKm: number) => {
      fakes.view?.placeView({
        lat: MUNICH.lat,
        lng: MUNICH.lon,
        altitudeKm,
        headingDeg: 0,
        pitchDeg: -89,
      });
      fakes.draws = [];
      seams.update?.(1_000);
      seams.beforeScene?.();
      // The view core's own scene pass (the fake logs every draw of the
      // view's scene as "interface"; the air's fake draws nothing).
      const scene = fakes.view?.scene;
      if (scene) fakes.view?.renderer.render(scene, fakes.view.camera);
      seams.afterScene?.();
      return fakes.draws.filter((d) => d === "interface").length;
    };
    // Below the deck: the scene's pass and the interface pass, both counted.
    expect(frameAt(1)).toBe(2);
    expect(view.readout().drawCalls).toBe(2);
    expect(frameAt(2.5)).toBe(2);
    // Above it: the scene's pass alone.
    expect(frameAt(5)).toBe(1);
    expect(view.readout().drawCalls).toBe(1);
  });

  // Why: the clouds and the air read the scene's depth as standard depth
  // (far at 1); reversed depth left them reading the near plane as the
  // farthest, and measured no better on the default depth buffer.
  it("draws with standard depth", async () => {
    await openAt(0);
    expect(fakes.viewOptions?.reversedDepth).not.toBe(true);
  });

  // Why: the streaks' pass holds a geometry and a material on the GPU; the
  // editor's dispose (its undo list) must free them, or every globe opened
  // and closed leaks them.
  it("frees the speed streaks' geometry and material with the view", async () => {
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    tourAt(0);
    const view = await openGlobeEditor(deps(), {
      ...readGlobeSwitch(""),
      dust: 1,
    });
    const seams = fakes.seams;
    if (seams === null) throw new Error("no seams");
    for (const altitudeKm of [20_000, 19_000]) {
      fakes.view?.placeView({
        lat: MUNICH.lat,
        lng: MUNICH.lon,
        altitudeKm,
        headingDeg: 0,
        pitchDeg: -89,
      });
      seams.beforeScene?.();
      now += 16;
    }
    const mesh = fakes.dustMesh;
    if (mesh === null) throw new Error("the streaks never drew");
    const freed: string[] = [];
    mesh.geometry.addEventListener("dispose", () => freed.push("geometry"));
    (mesh.material as THREE.Material).addEventListener("dispose", () =>
      freed.push("material"),
    );
    view.dispose();
    open = null;
    expect(freed.sort()).toEqual(["geometry", "material"]);
  });

  it("takes the relief mount down with the view", async () => {
    const view = await openAt(0);
    view.dispose();
    open = null;
    expect(fakes.reliefMount?.disposed).toBe(true);
  });

  // Why: the flight's clock started when the view was made, before its
  // first drawn frame (the box is laid out, the first frame compiles), so
  // a slow start ate the flight's opening and could land the camera on its
  // first frame. It starts at the first drawn frame.
  it("starts the approach's clock at its first drawn frame", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    await openAt(0, { approach: { durationMs: 1_000 } });
    now = 5_000;
    frameAt(now);
    expect(fakes.view?.camera).toBeDefined();
    const flyingAt = (t: number) => {
      now = t;
      frameAt(t);
      return open?.stats().flying;
    };
    expect(flyingAt(5_016)).toBe(true);
    let t = 5_016;
    for (; t < 5_900; t += 1000 / 60) flyingAt(t);
    expect(flyingAt(5_900)).toBe(true);
    // The stand-in's stations never upload, so the flight waits for them
    // until its safety cap (60 s on the flight's clock, which the asked
    // length speeds up) and lands a few seconds after its first frame. Had its clock
    // started at mount it would have landed before 5,900.
    for (; t < 11_000 && open?.stats().flying === true; t += 1000 / 60) {
      flyingAt(t);
    }
    expect(open?.stats().flying).toBe(false);
  });

  // Why: the approach is paced by what loads at the tour: its stations'
  // first uploads, the relief's ground at the tour, and nothing of the
  // relief loading. Every wiring test above lands only through the safety
  // cap (the stand-in's stations never upload), so a broken pacing passed
  // them all. Here all of it comes in at a set time: the flight must land
  // after that and well before the cap, and with any one part missing only
  // by the cap. A wiring that read nothing (always in) lands before the
  // load; one that read the wrong thing (never in) lands only by the cap.
  describe("paced by what loads at the tour", () => {
    /** Flies the approach at 60 Hz; `inAt` (page ms) is when the ground
     *  at the tour comes in. Returns when it landed (page ms). */
    const landingAt = async (
      inAt: number,
      part: "all" | "ground" | "settled" | "stations",
    ) => {
      let now = 0;
      vi.spyOn(performance, "now").mockImplementation(() => now);
      fakes.admits = part !== "stations";
      fakes.settled = part !== "settled";
      fakes.groundM = null;
      await openAt(0, { approach: { durationMs: 1_000 } });
      for (now = 0; now < 20_000; now += 1000 / 60) {
        if (now >= inAt && part !== "ground") fakes.groundM = DRAWN_M;
        frameAt(now);
        if (now > 0 && open?.stats().flying === false) break;
      }
      expect(open?.stats().flying).toBe(false);
      open?.dispose();
      open = null;
      vi.restoreAllMocks();
      return now;
    };

    it("lands after the tour is in, well before the safety cap", async () => {
      const capped = await landingAt(200, "ground");
      for (const inAt of [200, 500]) {
        const landed = await landingAt(inAt, "all");
        expect(landed).toBeGreaterThan(inAt);
        expect(landed).toBeLessThan(capped * 0.7);
      }
    });

    it.each(["ground", "settled", "stations"] as const)(
      "lands only by the safety cap without the %s",
      async (part) => {
        const landed = await landingAt(200, "all");
        expect(await landingAt(200, part)).toBeGreaterThan(landed / 0.7);
      },
    );
  });

  // Why: the page unfolds its rail when the approach's bar goes after a
  // landing (not after a takeover); the view tells it once, after the
  // bar's hold, never during the flight, and says how it ended.
  it("tells the page once when the approach's bar goes, and how it ended", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const ended = vi.fn();
    await openAt(0, { approach: { durationMs: 1_000, ended } });
    for (now = 0; now < 900; now += 1000 / 60) frameAt(now);
    expect(ended).not.toHaveBeenCalled();
    for (; now < 20_000 && open?.stats().flying !== false;) {
      now += 1000 / 60;
      frameAt(now);
    }
    for (const end = now + 1_000; now < end; now += 1000 / 60) frameAt(now);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledWith("landed");
  });

  // Why: the globe view's credits are one button whose overlay lists
  // every source and GIBS's acknowledgement in full (the sources' terms),
  // and closing the view empties the box for the next one.
  it("puts the credits behind one button, with GIBS's acknowledgement", async () => {
    const credits = document.createElement("div");
    const view = await openAt(0, { credits });
    const button = credits.querySelector("button");
    expect(button?.textContent).toBe("Credits");
    const panel = credits.querySelector<HTMLElement>(".view3d-credits-panel");
    expect(panel?.hidden).toBe(true);
    expect(panel?.textContent).toContain(GIBS_ACKNOWLEDGEMENT);
    view.dispose();
    open = null;
    expect(credits.childElementCount).toBe(0);
  });

  // Why: the approach's detail line read the map's coverage (which walks
  // its tiles) and the relief's load counts each few frames. The line is
  // gone (the box says only "Loading tour"), so the frames of an approach
  // read none of it; a leftover read would be cost for nothing.
  it("reads no load counts during the approach", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    await openAt(0, { approach: { durationMs: 1_000 } });
    fakes.coverageCalls = 0;
    for (now = 0; now < 2_100; now += 1000 / 60) frameAt(now);
    expect(fakes.coverageCalls).toBe(0);
  });

  // Why: a check that waits for the relief to carry the ground must be
  // able to tell a relief still loading (slowly, on a software-drawn
  // runner) from one that stalled, and see what the hand-over waits for:
  // the band's share and target, whether the relief's view is settled,
  // its load progress and its tiles queued, downloading and parsing (a
  // relief tile parses until its street map's texture is in); and its
  // cache against the device's budget, which a check at a phone's width
  // holds it to.
  it("reports what the relief's hand-over waits for", async () => {
    await openAt(0);
    fakes.settled = false;
    fakes.reliefShare = 0;
    const relief = (open?.stats().globe as { relief: unknown }).relief;
    expect(relief).toEqual({
      share: 0,
      target: 0,
      settled: false,
      loadProgress: 0.75,
      queued: 4,
      downloading: 2,
      parsing: 1,
      loaded: 40,
      failed: 0,
      cacheBytes: 5_000_000,
      cacheMaxBytes: 64_000_000,
    });
  });

  // Why: the link's osmGain is the A/B switch of the street map's
  // darkening; the view must hand it to the relief's map as it is.
  it("hands the link's street-map gain to the relief's map", async () => {
    tourAt(0);
    open = await openGlobeEditor(deps(), {
      ...readGlobeSwitch(""),
      osmGain: 0.45,
      osmGainMode: "compress",
    });
    expect(fakes.terrainInput?.osmGain).toBe(0.45);
    expect(fakes.terrainInput?.osmGainMode).toBe("compress");
  });

  // Why: the shell shows the street map's loading state; the view hands
  // the overlay's typed reading through its stats unchanged, so the shell
  // reads one field instead of the diagnostics' counters.
  it("hands the street map's load through its stats", async () => {
    await openAt(0);
    expect(open?.stats().mapLoad).toEqual({
      waiting: 3,
      failed: 1,
      givenUp: 0,
      ceilingWaitS: 12.5,
    });
  });

  // Why: the page learns the recorded walk only once its captures are
  // replayed, often after the stations popped in, and learns it again
  // when they are replayed anew. The view read it once: a walk that came
  // late appeared whole in one frame, and a changed walk was never drawn.
  // It is re-read when the page's array changes (by identity, so an
  // unchanged walk is not rebuilt each frame) and a late one draws itself
  // from when it came.
  it("re-reads the walk when it changes and draws a late walk as it arrives", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    let walkNow: { lat: number; lon: number; alt: number }[] | null = null;
    const capturesOf = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        lat: MUNICH.lat + i * 1e-4,
        lon: MUNICH.lon,
        alt: N,
      }));
    await openAt(0, {
      approach: { durationMs: 1_000 },
      walk: () => walkNow,
    });
    // Until it lands (the stand-in's stations never upload: by the
    // flight's safety cap), then a beat for the bar.
    for (now = 0; now < 20_000 && open?.stats().flying !== false;) {
      now += 1000 / 60;
      frameAt(now);
    }
    for (const end = now + 1_000; now < end; now += 1000 / 60) frameAt(now);
    const marks = () =>
      open?.stats().globe?.marks as
        { walkPoints: number; walkDrawn: number } | undefined;
    expect(open?.stats().flying).toBe(false);
    expect(marks()?.walkPoints).toBe(0);
    walkNow = capturesOf(3);
    frameAt(now);
    expect(marks()?.walkPoints).toBe(3);
    expect(marks()?.walkDrawn).toBeLessThan(3);
    const cameAt = now;
    for (; now < cameAt + 3_000; now += 1000 / 60) frameAt(now);
    expect(marks()?.walkDrawn).toBe(3);
    // The same array again: nothing is rebuilt, the walk stays whole.
    frameAt(now + 16);
    expect(marks()?.walkDrawn).toBe(3);
    walkNow = capturesOf(4);
    frameAt(now + 32);
    expect(marks()?.walkPoints).toBe(4);
  });

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
