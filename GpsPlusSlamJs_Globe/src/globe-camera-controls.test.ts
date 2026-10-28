/**
 * Why this test matters: the controls moved out of the globe lab as a pure
 * refactor (the owner: afterwards the globe must look and behave exactly
 * as before), so what the lab's `cameraControls` did is this module's
 * contract: the planes come from the drawn ground (or, in first person,
 * the nearest item) and change the projection only when they change; the
 * intro keeps the controls' up direction in step; a press calls `onTake`;
 * `busy` reads every sign of a gesture or a glide; `release` drops them
 * all; `pickFrom` swaps the controls' scene only when it changes.
 */

import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import type { GlobeControls } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import { clipPlanes } from "./globe-camera.js";
import { createGlobeCameraControls } from "./globe-camera-controls.js";
import { GLOBE_EYE, eyeClipPlanes } from "./globe-eye-camera.js";

/** A stand-in for the library's controls, recording what is asked of it. */
function fakeControls() {
  const calls: string[] = [];
  const listeners = new Map<string, () => void>();
  const fake = {
    calls,
    listeners,
    enableDamping: false,
    enabled: true,
    adjustHeight: true,
    up: new THREE.Vector3(),
    cameraRadius: 5,
    minDistance: 10,
    state: 0,
    zoomDelta: 0,
    globeInertiaFactor: 0,
    globeInertia: new THREE.Quaternion(0, 0, 1, 0),
    pointers: 0,
    pointerTracker: { getPointerCount: () => fake.pointers },
    setEllipsoid: (e: unknown, g: unknown) => {
      calls.push(`ellipsoid ${e === WGS84_ELLIPSOID} ${g !== null}`);
    },
    addEventListener: (type: string, fn: () => void) => {
      listeners.set(type, fn);
    },
    update: () => calls.push("update"),
    getCameraUpDirection: (v: THREE.Vector3) => {
      calls.push("up");
      v.set(0, 0, 1);
    },
    setScene: () => calls.push("setScene"),
  };
  return fake;
}

/** A camera 20,000 km out over the equator, in a frame without a move. */
function setup(options: Parameters<typeof createGlobeCameraControls>[4]) {
  const fake = fakeControls();
  const camera = new THREE.PerspectiveCamera(50, 2, 1, 2);
  camera.position.set(6_378_137 + 20_000_000, 0, 0);
  const group = new THREE.Group();
  const scene = new THREE.Scene();
  let projections = 0;
  const update = camera.updateProjectionMatrix.bind(camera);
  camera.updateProjectionMatrix = () => {
    projections += 1;
    update();
  };
  const controls = createGlobeCameraControls(
    scene,
    camera,
    {} as HTMLElement,
    { tiles: { ellipsoid: WGS84_ELLIPSOID, group } },
    { ...options, createControls: () => fake as unknown as GlobeControls },
  );
  return {
    fake,
    camera,
    group,
    scene,
    controls,
    projections: () => projections,
  };
}

describe("createGlobeCameraControls", () => {
  it("sets the controls up on the globe and calls onTake on a press", () => {
    let taken = 0;
    const { fake } = setup({ onTake: () => (taken += 1) });
    expect(fake.calls).toEqual(["ellipsoid true true"]);
    expect(fake.enableDamping).toBe(true);
    // Not first person: the library's own camera radius stays.
    expect(fake.cameraRadius).toBe(5);
    fake.listeners.get("start")?.();
    expect(taken).toBe(1);
  });

  it("refuses a missing onTake", () => {
    expect(() => setup({ onTake: undefined as unknown as () => void })).toThrow(
      TypeError,
    );
  });

  // Why: the planes are the drawn ground's; a projection update every
  // frame would cost, one missed would clip the ground.
  it("fits the planes from the relief, changing the projection only on a change", () => {
    let relief = { clearanceM: 1000, peakM: 8850 };
    const { camera, controls, projections } = setup({
      onTake: () => {},
      reliefPlanes: () => relief,
    });
    controls.fitPlanes();
    const want = clipPlanes(WGS84_ELLIPSOID, camera.position.clone(), relief);
    expect([camera.near, camera.far]).toEqual([want.near, want.far]);
    expect(projections()).toBe(1);
    controls.fitPlanes();
    expect(projections()).toBe(1);
    relief = { clearanceM: 10, peakM: 8850 };
    controls.fitPlanes();
    expect(projections()).toBe(2);
  });

  it("reads the camera in the globe's frame", () => {
    const { camera, group, controls } = setup({ onTake: () => {} });
    group.position.set(-6_378_137, 0, 0);
    group.updateMatrixWorld(true);
    camera.position.set(20_000_000, 0, 0);
    controls.fitPlanes();
    const want = clipPlanes(
      WGS84_ELLIPSOID,
      new THREE.Vector3(6_378_137 + 20_000_000, 0, 0),
    );
    expect(camera.far).toBeCloseTo(want.far, 3);
  });

  it("fits first person's planes from the nearest item", () => {
    const sphere = new THREE.Sphere(new THREE.Vector3(), 1);
    const { fake, camera, controls } = setup({
      onTake: () => {},
      eyeItems: () => [sphere],
    });
    expect(fake.cameraRadius).toBe(GLOBE_EYE.controls.cameraRadius);
    sphere.center.copy(camera.position).add(new THREE.Vector3(0, 0, 3));
    controls.fitPlanes();
    const want = eyeClipPlanes(WGS84_ELLIPSOID, camera.position.clone(), {
      nearestItemM: 2,
    });
    expect([camera.near, camera.far]).toEqual([want.near, want.far]);
  });

  it("follows the intro: the planes and the up direction", () => {
    const { fake, camera, controls } = setup({ onTake: () => {} });
    controls.followIntro();
    expect(fake.calls.slice(1)).toEqual(["up"]);
    expect(fake.up.toArray()).toEqual([0, 0, 1]);
    expect(camera.near).toBeGreaterThan(1);
  });

  it("updates the controls, then the planes", () => {
    const { fake, camera, controls } = setup({ onTake: () => {} });
    controls.update();
    expect(fake.calls.slice(1)).toEqual(["update"]);
    expect(camera.near).toBeGreaterThan(1);
  });

  it("swaps the controls' scene only when it changes", () => {
    const { fake, scene, controls } = setup({ onTake: () => {} });
    controls.pickFrom(scene);
    const other = new THREE.Group();
    controls.pickFrom(other);
    controls.pickFrom(other);
    expect(fake.calls.filter((c) => c === "setScene")).toHaveLength(1);
  });

  // Why: a frame move releases the controls; releasing them mid-gesture
  // would end the user's drag, so every sign of one must read as busy.
  it("is busy in a gesture or a glide, and release drops them", () => {
    const { fake, controls } = setup({ onTake: () => {} });
    expect(controls.busy()).toBe(false);
    fake.pointers = 1;
    expect(controls.busy()).toBe(true);
    fake.pointers = 0;
    fake.state = 2;
    expect(controls.busy()).toBe(true);
    fake.state = 0;
    fake.globeInertiaFactor = 0.5;
    expect(controls.busy()).toBe(true);
    fake.zoomDelta = 3;
    controls.release();
    expect(fake.globeInertiaFactor).toBe(0);
    expect(fake.zoomDelta).toBe(0);
    expect(fake.globeInertia.equals(new THREE.Quaternion())).toBe(true);
    expect(fake.enabled).toBe(true);
    expect(controls.busy()).toBe(false);
    (
      fake as unknown as { _inertiaNeedsUpdate: () => boolean }
    )._inertiaNeedsUpdate = () => true;
    expect(controls.busy()).toBe(true);
  });

  it("switches the library's height adjustment", () => {
    const { fake, controls } = setup({ onTake: () => {} });
    controls.setAdjustHeight(false);
    expect(fake.adjustHeight).toBe(false);
  });
});
