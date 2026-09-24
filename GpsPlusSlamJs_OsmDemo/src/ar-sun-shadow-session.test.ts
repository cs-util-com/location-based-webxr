/**
 * Tests for the AR sun shadow session (plan 2026-09-23-2343, M3c and the
 * M3 review fixes in §11.1).
 *
 * Why this file matters: no e2e can enter AR (the OsmDemo e2e rejects
 * `requestSession`), so the session's decisions are proven here with a fake
 * scene: when the shadow is on (and why not, for the HUD), that the plane and
 * the pole sit on the DEM in the content root's demo frame, that the light
 * is the scene's named sun light driven from the real sun, that switching off
 * gives the fixed light back, that a failure never costs the session, and
 * that nothing is left behind on dispose.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { SCENE_NODE } from "gps-plus-slam-app-framework/ar/scene-node-names";
import { SUN_SHADOW } from "gps-plus-slam-app-framework/visualization/sun-shadow-rig";

import {
  describeArSunShadow,
  startArSunShadow,
  tryStartArSunShadow,
  type ArShadowView,
  type ArSunShadowFrame,
} from "./ar-sun-shadow-session";

/** Cologne, 21 June 2026, 12:00 UTC: the sun near 62°, a little west of south. */
const NOON_MS = Date.UTC(2026, 5, 21, 12, 0, 0);
/** The same place at midnight UTC: below the horizon. */
const NIGHT_MS = Date.UTC(2026, 5, 21, 0, 0, 0);
const COLOGNE = { lat: 50.94, lon: 6.96 };

type Enu = { readonly x: number; readonly y: number };
type DemAt = (enu: Enu) => number | undefined;

function fakeScene() {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.name = SCENE_NODE.SUN_LIGHT;
  sun.position.set(0, 10, 5);
  scene.add(sun);
  return { scene, sun };
}

function fakeView() {
  const props: THREE.Object3D[] = [];
  let generation = 0;
  const view = {
    setArShadowCasting: vi.fn((_on: boolean) => {
      generation += 1;
    }),
    addArShadowProps: vi.fn((...o: THREE.Object3D[]) => props.push(...o)),
    removeArShadowProps: vi.fn((...o: THREE.Object3D[]) => {
      for (const x of o) props.splice(props.indexOf(x), 1);
    }),
    get arShadowCasterSignature() {
      return `${generation}:3`;
    },
  } satisfies ArShadowView;
  return { view, props };
}

const fakeRenderer = () =>
  ({
    shadowMap: { enabled: false, type: THREE.BasicShadowMap },
  }) as unknown as THREE.WebGLRenderer;

function setup(options: { nowMs?: number; demAt?: DemAt } = {}) {
  const { scene, sun } = fakeScene();
  const renderer = fakeRenderer();
  const { view, props } = fakeView();
  let time = options.nowMs ?? NOON_MS;
  let demAt: DemAt = options.demAt ?? (() => 42);
  const session = startArSunShadow({
    scene,
    renderer,
    view,
    origin: COLOGNE,
    geometricOffset: { north: 100, east: -50 },
    demAt: (enu) => demAt(enu),
    nowMs: () => time,
  });
  const plane = props.find((o) => o.name === "ar-shadow-plane")!;
  const pole = props.find((o) => o.name === "ar-shadow-pole")!;
  return {
    session,
    sun,
    renderer,
    view,
    props,
    plane,
    pole,
    setTime: (t: number) => (time = t),
    setDem: (f: DemAt) => (demAt = f),
  };
}

const ready: ArSunShadowFrame = {
  dtS: 1 / 60,
  userEnu: { x: 10, y: 20 },
  forwardEnu: { x: 0, y: 1 },
  composedM: 1.5,
  floorEngaged: true,
};

describe("startArSunShadow", () => {
  it("turns shadow maps on, adds the props hidden, and casting on", () => {
    const { renderer, view, plane, pole } = setup();
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(plane.visible).toBe(false);
    expect(pole.visible).toBe(false);
    expect(view.setArShadowCasting).toHaveBeenCalledWith(true);
  });

  it("refuses a scene without the named sun light", () => {
    expect(() =>
      startArSunShadow({
        scene: new THREE.Scene(),
        renderer: fakeRenderer(),
        view: {} as ArShadowView,
        origin: COLOGNE,
        geometricOffset: { north: 0, east: 0 },
        demAt: () => 0,
      }),
    ).toThrow(/sun light/);
  });
});

describe("tryStartArSunShadow", () => {
  // WHY (M3 review L1, L2): a prototype never costs the session, and the
  // field test must read WHY there is no shadow. Before this, a missing
  // floor estimate read "waiting for position" for good, and a missing
  // renderer or fix printed nothing at all.
  it("says why it cannot start, and touches nothing when it cannot", () => {
    const { scene } = fakeScene();
    const renderer = fakeRenderer();
    const { view } = fakeView();
    const base = {
      scene,
      renderer,
      view,
      origin: COLOGNE,
      geometricOffset: { north: 0, east: 0 },
      demAt: (() => 0) as DemAt | undefined,
    };
    expect(tryStartArSunShadow({ ...base, renderer: null })).toEqual({
      unavailable: "no renderer",
    });
    expect(tryStartArSunShadow({ ...base, origin: null })).toEqual({
      unavailable: "no position fix",
    });
    expect(tryStartArSunShadow({ ...base, demAt: undefined })).toEqual({
      unavailable: "auto elevation is off",
    });
    const noLight = tryStartArSunShadow({ ...base, scene: new THREE.Scene() });
    expect(noLight.unavailable).toMatch(/sun light/);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(view.setArShadowCasting).not.toHaveBeenCalled();
    const started = tryStartArSunShadow(base);
    expect(started.unavailable).toBeUndefined();
    expect(started.session).toBeDefined();
    expect(renderer.shadowMap.enabled).toBe(true);
  });
});

describe("the session's frame", () => {
  // WHY: the HUD must say WHY there is no shadow; each gate in order. A
  // non-finite DEM is "no position" too (M3 review M1): the rig would throw
  // on it after the light was already casting.
  it("waits for a position, then for the floor, and is off at night", () => {
    const { session, sun, setDem } = setup();
    expect(session.frame({ ...ready, userEnu: null }).state).toBe(
      "waiting-for-position",
    );
    setDem(() => undefined);
    expect(session.frame(ready).state).toBe("waiting-for-position");
    setDem(() => Number.NaN);
    expect(session.frame(ready).state).toBe("waiting-for-position");
    setDem(() => 42);
    expect(session.frame({ ...ready, floorEngaged: false }).state).toBe(
      "waiting-for-floor",
    );
    expect(sun.castShadow).toBe(false);
    const night = setup({ nowMs: NIGHT_MS });
    const status = night.session.frame(ready);
    expect(status.state).toBe("sun-low");
    expect(status.sunElevationDeg).toBeLessThan(0);
  });

  // The frames: the plane on the DEM under the user and the pole 3 m ahead
  // on the DEM THERE (M3 review M5: on a slope the two differ), both in the
  // content root's demo frame (x east, y up, -z north); the rig centre in
  // the scene's NUE frame (anchor ENU + the geometric offset, the DEM + the
  // composed offset). A diagonal forward pins both pole components.
  it("puts the plane under the user and the pole ahead on its own ground, and drives the named light", () => {
    const slope: DemAt = (enu) => 42 + 0.1 * enu.x;
    const { session, sun, plane, pole } = setup({ demAt: slope });
    const status = session.frame({ ...ready, forwardEnu: { x: 1, y: 1 } });
    expect(status.state).toBe("on");
    expect(status.sunElevationDeg).toBeGreaterThan(55);
    expect(plane.visible).toBe(true);
    expect(plane.position.toArray()).toEqual([10, 43, -20]);
    expect(pole.visible).toBe(true);
    const step = 3 / Math.SQRT2;
    const [px, py, pz] = pole.position.toArray();
    expect(px).toBeCloseTo(10 + step, 9);
    expect(py).toBeCloseTo(42 + 0.1 * (10 + step), 9);
    expect(pz).toBeCloseTo(-(20 + step), 9);
    expect(sun.castShadow).toBe(true);
    expect(sun.target.position.toArray()).toEqual([
      20 + 100,
      43 + 1.5,
      10 - 50,
    ]);
    // The light stands along the sun, D = R + margin away, ABOVE and on the
    // sun's side: at noon UTC in Cologne the sun is south, which in NUE is
    // -x. A light on the wrong side draws a shadow pointing at the sun.
    const D = SUN_SHADOW.halfWidthM + SUN_SHADOW.marginM;
    expect(sun.position.distanceTo(sun.target.position)).toBeCloseTo(D, 6);
    expect(sun.position.y).toBeGreaterThan(sun.target.position.y);
    expect(sun.position.x).toBeLessThan(sun.target.position.x - D / 4);
    expect(status.renders).toBe(1);
    // The same frame again renders no new map, and the pole stays put.
    expect(session.frame({ ...ready, userEnu: { x: 11, y: 21 } }).renders).toBe(
      1,
    );
    expect(pole.position.x).toBeCloseTo(10 + step, 9);
  });

  // WHY: while the shadow is off the scene's fixed shading light must be
  // exactly as it was, the props must not linger, and coming back renders a
  // fresh map.
  it("gives the fixed light back and hides the props when the floor releases, and comes back", () => {
    const { session, sun, plane, pole } = setup();
    session.frame(ready);
    session.frame({ ...ready, floorEngaged: false });
    expect(sun.castShadow).toBe(false);
    expect(sun.position.toArray()).toEqual([0, 10, 5]);
    expect(plane.visible).toBe(false);
    expect(pole.visible).toBe(false);
    const back = session.frame(ready);
    expect(back.state).toBe("on");
    expect(back.renders).toBe(2);
  });

  it("reports the frame times", () => {
    const { session } = setup();
    for (let i = 0; i < 10; i++) session.frame({ ...ready, dtS: 0.016 });
    const status = session.frame({ ...ready, dtS: 0.08 });
    expect(status.frameTimes?.count).toBe(11);
    expect(status.frameTimes?.max).toBeCloseTo(80, 9);
  });

  // WHY (M3 review M1): a throw in the per-frame path used to abort the rest
  // of the AR frame callback every frame (a frozen HUD) and leave the light
  // casting. Now it fails ONCE: the light is given back, the props hide, and
  // the HUD says why, for the rest of the session.
  it("fails once and for good when the rig throws, giving the light back", () => {
    const { session, sun, plane, pole } = setup();
    session.frame(ready);
    const failed = session.frame({ ...ready, composedM: Number.NaN });
    expect(failed.state).toBe("failed");
    expect(failed.error).toMatch(/finite/);
    expect(sun.castShadow).toBe(false);
    expect(sun.position.toArray()).toEqual([0, 10, 5]);
    expect(plane.visible).toBe(false);
    expect(pole.visible).toBe(false);
    expect(session.frame(ready).state).toBe("failed");
    expect(sun.castShadow).toBe(false);
    expect(describeArSunShadow(failed)).toMatch(
      /^shadow: unavailable \(.*finite.*\)$/,
    );
  });
});

describe("the map frame", () => {
  // WHY: the prototype exists to learn what ONE shadow map costs, and the
  // percentiles cannot say which frame was slow. The map renders after the
  // callbacks, so its cost is the NEXT frame's dt; a frame that drew no map
  // must not overwrite it. The FIRST map after each switch-on is skipped
  // (M3 review M2): three recompiles every lit material when a light starts
  // casting, so that frame times the recompile, not the map.
  it("reports the dt of the frame after a map, skipping the first after a switch-on", () => {
    const { session, view } = setup();
    session.frame({ ...ready, dtS: 0.016 }); // switch-on: map 1 (compile)
    expect(
      session.frame({ ...ready, dtS: 0.3 }).lastMapFrameMs,
    ).toBeUndefined();
    view.setArShadowCasting(true); // a caster change: map 2
    session.frame({ ...ready, dtS: 0.016 });
    expect(session.frame({ ...ready, dtS: 0.05 }).lastMapFrameMs).toBeCloseTo(
      50,
      9,
    );
    expect(session.frame({ ...ready, dtS: 0.016 }).lastMapFrameMs).toBeCloseTo(
      50,
      9,
    );
    // Off and on again: the next map is a switch-on again, and skipped.
    session.frame({ ...ready, floorEngaged: false });
    session.frame({ ...ready, dtS: 0.016 });
    expect(session.frame({ ...ready, dtS: 0.4 }).lastMapFrameMs).toBeCloseTo(
      50,
      9,
    );
  });

  it("is shown on the HUD only once measured", () => {
    const base = {
      state: "on" as const,
      sunElevationDeg: 35,
      renders: 1,
      frameTimes: null,
    };
    expect(describeArSunShadow(base)).toBe("shadow on · 1 map · sun 35°");
    expect(describeArSunShadow({ ...base, lastMapFrameMs: 41.6 })).toBe(
      "shadow on · 1 map · sun 35° · map frame 42 ms",
    );
  });
});

describe("dispose", () => {
  it("turns casting off, removes the props and restores the light", () => {
    const { session, sun, view, props } = setup();
    session.frame(ready);
    session.dispose();
    expect(view.setArShadowCasting).toHaveBeenLastCalledWith(false);
    expect(props).toHaveLength(0);
    expect(sun.castShadow).toBe(false);
    expect(sun.position.toArray()).toEqual([0, 10, 5]);
    expect(session.frame(ready).renders).toBe(1);
    session.dispose();
  });
});

describe("describeArSunShadow", () => {
  // WHY: the field test reads the HUD; each state says why, and "on" carries
  // the numbers the prototype measures.
  it("says why there is no shadow, and the cost when there is", () => {
    const frameTimes = { p50: 16.4, p95: 18.2, max: 81, count: 300 };
    expect(
      describeArSunShadow({
        state: "on",
        sunElevationDeg: 34.6,
        renders: 3,
        frameTimes,
      }),
    ).toBe("shadow on · 3 maps · sun 35° · frame p50 16 p95 18 max 81 ms");
    expect(
      describeArSunShadow({
        state: "waiting-for-floor",
        sunElevationDeg: 30,
        renders: 0,
        frameTimes: null,
      }),
    ).toBe("shadow: waiting for floor");
    expect(
      describeArSunShadow({
        state: "sun-low",
        sunElevationDeg: 4.2,
        renders: 0,
        frameTimes: null,
      }),
    ).toBe("shadow: sun below 10° · sun 4°");
    expect(
      describeArSunShadow({
        state: "waiting-for-position",
        sunElevationDeg: undefined,
        renders: 0,
        frameTimes: null,
      }),
    ).toBe("shadow: waiting for position");
  });
});
