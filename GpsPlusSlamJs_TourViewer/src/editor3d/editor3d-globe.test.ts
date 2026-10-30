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
  };
  controls: null | { release: { mock: { calls: unknown[] } } };
}

const fakes = vi.hoisted((): Fakes => ({
  log: [],
  manifest: null,
  gesture: null,
  busy: false,
  seams: null,
  view: null,
  controls: null,
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
      dispose() {},
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
      },
      groundAt: () => 500,
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
  createSceneInput: () => ({
    gesture: () => fakes.gesture,
    frame() {},
    cancel() {},
    dispose() {},
  }),
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
    expect(view.centre().lat).toBeCloseTo(at.lat, 6);
    expect(view.centre().lon).toBeCloseTo(at.lon, 6);
    fakes.view?.setFrameTarget({ lat: 47.3, lng: 11.4 });
    expect(view.centre().lat).toBeCloseTo(at.lat, 6);
    expect(view.centre().lon).toBeCloseTo(at.lon, 6);
  });

  // Why: the page writes these heights into the tour file, whose heights
  // are ellipsoidal; the drawn ground is N lower.
  it("gives the page's ground heights with the geoid's N added", async () => {
    const view = await openAt(0);
    expect(view.centre().alt).toBeCloseTo(DRAWN_M + N, 6);
    expect(view.groundAt(MUNICH)).toBeCloseTo(DRAWN_M + N, 6);
  });

  // Why: measured from the frame's origin on the ellipsoid, a tour on a
  // hill would be zoomed and distanced from a point hundreds of metres
  // under it. Swept over tour heights 0 (where both agree), 515 and 2500 m.
  it.each([0, 515, 2500])(
    "measures the zoom and the distance to the tour's centre at %s m",
    async (heightM) => {
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

  // Why: a frame drawn while the view is being freed draws with freed
  // parts; and the loss dispose forces must not reach the page as a lost
  // context.
  it("stops the loop first and drops the lost-context listener before forcing the loss", async () => {
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
    expect(fakes.log.indexOf("listener-off")).toBeGreaterThanOrEqual(0);
    expect(fakes.log.indexOf("listener-off")).toBeLessThan(
      fakes.log.indexOf("force-context-loss"),
    );
  });
});
