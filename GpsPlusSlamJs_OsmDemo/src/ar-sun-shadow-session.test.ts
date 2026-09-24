/**
 * Tests for the AR sun shadow session (plan 2026-09-23-2343, M3c).
 *
 * Why this file matters: no e2e can enter AR (the OsmDemo e2e rejects
 * `requestSession`), so the session's decisions are proven here with a fake
 * scene: when the shadow is on (and why not, for the HUD), that the plane and
 * the pole sit on the DEM in the content root's demo frame, that the light
 * is the scene's named sun light driven from the real sun, that switching off
 * gives the fixed light back, and that nothing is left behind on dispose.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { SCENE_NODE } from "gps-plus-slam-app-framework/ar/scene-node-names";
import { SUN_SHADOW } from "gps-plus-slam-app-framework/visualization/sun-shadow-rig";

import {
  describeArSunShadow,
  startArSunShadow,
  type ArShadowView,
  type ArSunShadowFrame,
} from "./ar-sun-shadow-session";

/** Cologne, 21 June 2026, 12:00 UTC: the sun near 62°. */
const NOON_MS = Date.UTC(2026, 5, 21, 12, 0, 0);
/** The same place at midnight UTC: below the horizon. */
const NIGHT_MS = Date.UTC(2026, 5, 21, 0, 0, 0);
const COLOGNE = { lat: 50.94, lon: 6.96 };

function setup(nowMs = NOON_MS) {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.name = SCENE_NODE.SUN_LIGHT;
  sun.position.set(0, 10, 5);
  scene.add(sun);
  const renderer = {
    shadowMap: { enabled: false, type: THREE.BasicShadowMap },
  } as unknown as THREE.WebGLRenderer;
  const props: THREE.Object3D[] = [];
  let generation = 0;
  const view = {
    setArShadowCasting: vi.fn(() => {
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
  let time = nowMs;
  const session = startArSunShadow({
    scene,
    renderer,
    view,
    origin: COLOGNE,
    geometricOffset: { north: 100, east: -50 },
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
  };
}

const ready: ArSunShadowFrame = {
  dtS: 1 / 60,
  userEnu: { x: 10, y: 20 },
  forwardEnu: { x: 0, y: 1 },
  demAtUserM: 42,
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
    const renderer = { shadowMap: {} } as unknown as THREE.WebGLRenderer;
    expect(() =>
      startArSunShadow({
        scene: new THREE.Scene(),
        renderer,
        view: {} as ArShadowView,
        origin: COLOGNE,
        geometricOffset: { north: 0, east: 0 },
      }),
    ).toThrow(/sun light/);
  });
});

describe("the session's frame", () => {
  // WHY: the HUD must say WHY there is no shadow; each gate in order.
  it("waits for a position, then for the floor, and is off at night", () => {
    const { session, sun } = setup();
    expect(session.frame({ ...ready, userEnu: null }).state).toBe(
      "waiting-for-position",
    );
    expect(session.frame({ ...ready, demAtUserM: undefined }).state).toBe(
      "waiting-for-position",
    );
    expect(session.frame({ ...ready, floorEngaged: false }).state).toBe(
      "waiting-for-floor",
    );
    expect(sun.castShadow).toBe(false);
    const night = setup(NIGHT_MS);
    const status = night.session.frame(ready);
    expect(status.state).toBe("sun-low");
    expect(status.sunElevationDeg).toBeLessThan(0);
  });

  // The frames: the plane on the DEM under the user and the pole 3 m ahead,
  // both in the content root's demo frame (x east, y up, -z north); the rig
  // centre in the scene's NUE frame (anchor ENU + the geometric offset, the
  // DEM + the composed offset).
  it("puts the plane under the user and the pole ahead, and drives the named light", () => {
    const { session, sun, plane, pole } = setup();
    const status = session.frame(ready);
    expect(status.state).toBe("on");
    expect(status.sunElevationDeg).toBeGreaterThan(55);
    expect(plane.visible).toBe(true);
    expect(plane.position.toArray()).toEqual([10, 42, -20]);
    expect(pole.visible).toBe(true);
    expect(pole.position.toArray()).toEqual([10, 42, -23]);
    expect(sun.castShadow).toBe(true);
    expect(sun.target.position.toArray()).toEqual([
      20 + 100,
      42 + 1.5,
      10 - 50,
    ]);
    // The light stands along the sun, D = R + margin away.
    const D = SUN_SHADOW.halfWidthM + SUN_SHADOW.marginM;
    expect(sun.position.distanceTo(sun.target.position)).toBeCloseTo(D, 6);
    expect(sun.position.y).toBeGreaterThan(sun.target.position.y);
    expect(status.renders).toBe(1);
    // The same frame again renders no new map, and the pole stays put.
    expect(session.frame({ ...ready, userEnu: { x: 11, y: 21 } }).renders).toBe(
      1,
    );
    expect(pole.position.toArray()).toEqual([10, 42, -23]);
  });

  // WHY: while the shadow is off the scene's fixed shading light must be
  // exactly as it was, and coming back renders a fresh map.
  it("gives the fixed light back when the floor releases, and comes back", () => {
    const { session, sun } = setup();
    session.frame(ready);
    session.frame({ ...ready, floorEngaged: false });
    expect(sun.castShadow).toBe(false);
    expect(sun.position.toArray()).toEqual([0, 10, 5]);
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
});

describe("the map frame", () => {
  // WHY: the prototype exists to learn what ONE shadow map costs, and the
  // percentiles cannot say which frame was slow. The map renders after the
  // callbacks, so its cost is the NEXT frame's dt; a frame that drew no map
  // must not overwrite it.
  it("reports the dt of the frame after a map was scheduled", () => {
    const { session } = setup();
    expect(
      session.frame({ ...ready, dtS: 0.016 }).lastMapFrameMs,
    ).toBeUndefined();
    expect(session.frame({ ...ready, dtS: 0.05 }).lastMapFrameMs).toBeCloseTo(
      50,
      9,
    );
    expect(session.frame({ ...ready, dtS: 0.016 }).lastMapFrameMs).toBeCloseTo(
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
