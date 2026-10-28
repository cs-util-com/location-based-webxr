/**
 * Why this test matters: the view core moved out of the globe lab as a pure
 * refactor (the owner: afterwards everything must look and perform exactly
 * as before), so what the lab's frame did, in its order, is now this
 * module's contract:
 * - one frame fits the drawing buffer only when the canvas size changed,
 *   steps the sun and the clouds by the clock, lets the page drive the
 *   camera and update its layers, then clears, draws the sky pass (the
 *   page's air after it), and draws the scene between the page's two draw
 *   seams; a paused frame does nothing between its start and its end;
 * - the clear colour is magenta only for `holeColor`, and no sky pass is
 *   drawn without `sky`;
 * - the world frame moves under the camera without moving the view (the
 *   camera's ECEF pose is the same before and after), only when the
 *   target changes, and never while a gesture runs;
 * - a placed view stands at its altitude and looks along its heading and
 *   pitch, and refuses a pose that is not finite;
 * - the clouds' drift is summed per frame (a pinned clock with no drift
 *   stands still, a clock change re-seeds it).
 */

import * as THREE from "three";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { GlobeSurfaceLoader } from "./globe-map-loader.js";
import {
  createGlobeView,
  viewPoseEcef,
  type GlobeViewSeams,
  type GlobeViewSettings,
} from "./globe-view.js";

const DEG = Math.PI / 180;

/** Node has no image loader: a blank texture per map, never finished. */
const stubLoader: GlobeSurfaceLoader = {
  loadTexture: () => new THREE.Texture(),
};

/** A renderer that records what the frame asks of it. */
function fakeRenderer(log: string[]) {
  let ratio = 1;
  return {
    toneMapping: THREE.NoToneMapping as THREE.ToneMapping,
    autoClear: true,
    setSize: (w: number, h: number) => log.push(`size ${w}x${h}`),
    setClearColor: (c: number) => log.push(`clearColor ${c.toString(16)}`),
    clear: () => log.push("clear"),
    render: (scene: THREE.Object3D) =>
      log.push(`render ${scene.userData.role ?? scene.type}`),
    getPixelRatio: () => ratio,
    setPixelRatio: (r: number) => {
      ratio = r;
    },
  };
}

const SETTINGS: GlobeViewSettings = {
  fovY: 50,
  worldFrame: 1,
  sky: 1,
  space: 0.1,
  holeColor: 0,
  cloudDrift: 0,
  cloudDriftFarKm: 2000,
  cloudWindMps: 10,
};

/** A view over a fake canvas and renderer, its settings and a clock. */
function makeView(
  overrides: Partial<GlobeViewSettings> = {},
  seams: GlobeViewSeams | ((log: string[]) => GlobeViewSeams) = {},
) {
  const log: string[] = [];
  const canvas = { clientWidth: 800, clientHeight: 400 };
  const settings = { ...SETTINGS, ...overrides };
  let mono = 1000;
  const view = createGlobeView({
    canvas: canvas as unknown as HTMLCanvasElement,
    fovYDeg: settings.fovY,
    settings: () => settings,
    solarPosition: () => ({ elevationRad: 0.3, azimuthRad: 1.2 }),
    mapLoader: stubLoader,
    createRenderer: () => fakeRenderer(log) as unknown as THREE.WebGLRenderer,
    monoNow: () => mono,
    seams: typeof seams === "function" ? seams(log) : seams,
  });
  view.scene.userData.role = "scene";
  view.sky.scene.userData.role = "sky";
  view.startClock({ startMs: Date.UTC(2026, 9, 5, 11), scale: 0 });
  // Out in space over Bern (the camera at the Earth's centre has no view).
  view.placeView({
    lat: 46.9,
    lng: 7.4,
    altitudeKm: 20_000,
    headingDeg: 0,
    pitchDeg: -89,
  });
  return {
    view,
    log,
    canvas,
    settings,
    advance: (ms: number) => {
      mono += ms;
    },
  };
}

describe("createGlobeView: the frame", () => {
  // Why: the frame's order is the look. The page's air (the ground sky)
  // is drawn over the sky pass and under the Earth; the speed dust before
  // and after the scene; the volumes and the atmosphere after it. A seam
  // run in another place draws the same parts in another order.
  it("runs the seams and the passes in the lab's order", () => {
    const { view, log } = makeView({}, (log) => {
      const seam = (name: string) => () => {
        log.push(name);
      };
      return {
        frameStart: seam("frameStart"),
        driveCamera: seam("driveCamera"),
        update: seam("update"),
        afterSky: seam("afterSky"),
        beforeScene: seam("beforeScene"),
        afterScene: seam("afterScene"),
        frameEnd: seam("frameEnd"),
      };
    });
    view.frame();
    expect(log).toEqual([
      "frameStart",
      "size 800x400",
      "driveCamera",
      "update",
      "clearColor 0",
      "clear",
      "render sky",
      "afterSky",
      "beforeScene",
      "render scene",
      "afterScene",
      "frameEnd",
    ]);
  });

  // Why: a paused frame (the recorder's refresh calibration) must do no
  // work at all, or the display's intervals measure the page.
  it("does nothing between start and end while paused", () => {
    const calls: string[] = [];
    const { view, log } = makeView(
      {},
      {
        frameStart: () => calls.push("start"),
        paused: () => true,
        driveCamera: () => calls.push("drive"),
        frameEnd: () => calls.push("end"),
      },
    );
    view.frame();
    expect(calls).toEqual(["start", "end"]);
    expect(log).toEqual([]);
  });

  // Why: resizing the drawing buffer every frame reallocates it; the lab
  // fits it only when the canvas size changes, or when a setting (the
  // field of view, the pixel ratio) asks for a refit.
  it("fits the buffer and the camera only when the size changes or a refit is asked", () => {
    const { view, log, canvas } = makeView();
    view.frame();
    view.frame();
    expect(log.filter((l) => l.startsWith("size"))).toEqual(["size 800x400"]);
    expect(view.camera.aspect).toBe(2);
    const fitWide = view.fitDistance();
    canvas.clientHeight = 1600;
    view.frame();
    expect(view.camera.aspect).toBe(0.5);
    // A portrait canvas fits the globe to its narrower width: the fit
    // distance grows.
    expect(view.fitDistance()).toBeGreaterThan(fitWide);
    view.refit();
    view.frame();
    expect(log.filter((l) => l.startsWith("size"))).toEqual([
      "size 800x400",
      "size 800x1600",
      "size 800x1600",
    ]);
  });

  // Why: the hole colour is how the smokes see an unclipped hole; the sky
  // pass and the page's air over it are off together with `sky=0`.
  it("clears magenta for holeColor and draws no sky pass without sky", () => {
    const seen: string[] = [];
    const { view, log } = makeView(
      { holeColor: 1, sky: 0 },
      { afterSky: () => seen.push("afterSky") },
    );
    view.frame();
    expect(log).toContain("clearColor ff00ff");
    expect(log).not.toContain("render sky");
    expect(seen).toEqual([]);
  });

  it("counts the frame's instant and steps the sun by the clock", () => {
    const { view } = makeView();
    view.frame();
    const s = view.state();
    expect(s.frameAt).toBe(1000);
    // The fake sun: 0.3 rad high, so the light is not at its default.
    expect(view.globe.sun.position.length()).toBeGreaterThan(0);
    expect(Number.isFinite(s.siderealAngleRad)).toBe(true);
  });
});

describe("createGlobeView: the clouds' drift", () => {
  // Why: a pinned link with `cloudDrift=0` must hold the clouds still,
  // or two screenshots of one view differ.
  it("holds the clouds still with no drift", () => {
    const { view, advance } = makeView({ cloudDrift: 0 });
    view.frame();
    const first = view.globe.surfaceUniforms.uCloudLonOffset.value;
    advance(5000);
    view.frame();
    expect(view.globe.surfaceUniforms.uCloudLonOffset.value).toBe(first);
    expect(view.state().cloudDriftRate).toBe(0);
  });

  // Why: the drift is summed per frame at the altitude's rate (a product
  // of rate and time would jump the clouds at every change of height); a
  // pinned clock still drifts in real time.
  it("sums the drift per frame and re-seeds it on request", () => {
    const { view, advance, settings } = makeView({ cloudDrift: 0.01 });
    view.frame();
    const a = view.globe.surfaceUniforms.uCloudLonOffset.value;
    advance(1000);
    view.frame();
    const b = view.globe.surfaceUniforms.uCloudLonOffset.value;
    expect(b).toBeGreaterThan(a);
    const rate = view.state().cloudDriftRate;
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThanOrEqual(settings.cloudDrift);
    // A second at that rate, in radians.
    expect(b - a).toBeCloseTo(rate * DEG, 9);
    view.resetCloudDrift();
    view.frame();
    expect(view.globe.surfaceUniforms.uCloudLonOffset.value).not.toBe(b);
  });
});

describe("createGlobeView: the world frame", () => {
  const ecefOf = (view: ReturnType<typeof makeView>["view"]) => {
    const p = view.ecefCamera();
    return { position: p.position.toArray(), quaternion: p.quaternion };
  };

  // Why: every pose is written and read through the frame; a frame move
  // that moved the view would jump the camera at every recentre.
  it("moves the frame under the camera, the view unchanged", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -80, max: 80, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: 0.5, max: 2000, noNaN: true }),
        (lat, lng, altitudeKm) => {
          const { view } = makeView();
          view.placeView({
            lat,
            lng,
            altitudeKm,
            headingDeg: 30,
            pitchDeg: -20,
          });
          const before = ecefOf(view);
          view.setFrameTarget({ lat: lat + 0.5, lng: lng - 0.5 });
          const after = ecefOf(view);
          for (let i = 0; i < 3; i++) {
            expect(after.position[i]).toBeCloseTo(before.position[i]!, 0);
          }
          expect(after.quaternion.angleTo(before.quaternion)).toBeLessThan(
            1e-6,
          );
        },
      ),
      { numRuns: 25 },
    );
  });

  it("tells the page about a change of target only when it changes", () => {
    const changes: unknown[] = [];
    const { view } = makeView({}, { frameChanged: (t) => changes.push(t) });
    view.setFrameTarget({ lat: 46.9, lng: 7.4 });
    view.setFrameTarget({ lat: 46.9, lng: 7.4 });
    view.setFrameTarget(null);
    expect(changes).toEqual([{ lat: 46.9, lng: 7.4 }, null]);
    expect(view.frameTarget()).toBeNull();
  });

  it("keeps ECEF when the world frame is off", () => {
    const { view } = makeView({ worldFrame: 0 });
    view.setFrameTarget({ lat: 46.9, lng: 7.4 });
    expect(view.frameTarget()).toBeNull();
    expect(view.globe.group.matrix.equals(new THREE.Matrix4())).toBe(true);
  });

  // Why: a frame move releases the controls, which ended the owner's drags
  // a second in (r785); the recentre waits while a gesture runs.
  it("recentres under a camera flown far from the origin, never under a gesture", () => {
    let busy = true;
    const { view } = makeView({}, { gestureBusy: () => busy });
    view.placeView({
      lat: 46.9,
      lng: 7.4,
      altitudeKm: 2,
      headingDeg: 0,
      pitchDeg: -10,
    });
    // The camera flies 300 km east with the frame left behind.
    const far = viewPoseEcef(view.globe.tiles.ellipsoid, {
      lat: 46.9,
      lng: 11.4,
      altitudeKm: 2,
      headingDeg: 0,
      pitchDeg: -10,
    });
    view.placeCameraEcef(far.position, far.quaternion);
    view.recentreFrame();
    expect(view.state().frameRecentres).toBe(0);
    busy = false;
    view.recentreFrame();
    expect(view.state().frameRecentres).toBe(1);
    expect(view.frameTarget()!.lng).toBeCloseTo(11.4, 3);
  });
});

describe("viewPoseEcef", () => {
  // Why: the Debug export's pose is how a smoke stands where the owner
  // stood; a heading or pitch read the other way round points elsewhere.
  it("stands at the altitude and looks along the heading and pitch", () => {
    const { view } = makeView();
    const ellipsoid = view.globe.tiles.ellipsoid;
    const pose = viewPoseEcef(ellipsoid, {
      lat: 10,
      lng: 20,
      altitudeKm: 3,
      headingDeg: 90,
      pitchDeg: 0,
    });
    expect(ellipsoid.getPositionElevation(pose.position)).toBeCloseTo(3000, 3);
    const east = new THREE.Vector3();
    const north = new THREE.Vector3();
    const up = new THREE.Vector3();
    ellipsoid.getEastNorthUpAxes(10 * DEG, 20 * DEG, east, north, up);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      pose.quaternion,
    );
    expect(forward.dot(east)).toBeCloseTo(1, 9);
    const down = viewPoseEcef(ellipsoid, {
      lat: 10,
      lng: 20,
      altitudeKm: 3,
      headingDeg: 0,
      pitchDeg: -30,
    });
    const f2 = new THREE.Vector3(0, 0, -1).applyQuaternion(down.quaternion);
    expect(Math.asin(f2.dot(up)) / DEG).toBeCloseTo(-30, 6);
    expect(f2.dot(north)).toBeGreaterThan(0);
  });

  it("refuses a pose that is not finite", () => {
    const { view } = makeView();
    expect(() =>
      viewPoseEcef(view.globe.tiles.ellipsoid, {
        lat: Number.NaN,
        lng: 0,
        altitudeKm: 1,
        headingDeg: 0,
        pitchDeg: 0,
      }),
    ).toThrow(RangeError);
  });
});
