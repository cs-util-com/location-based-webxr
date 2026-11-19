/**
 * Tests for the sun shadow's three.js half (AR sun shadow plan
 * 2026-09-23-2343, M2), without a GPU.
 *
 * Why this file matters: the phone's cost lives in WHEN the shadow map is
 * re-rendered. `autoUpdate` must stay off and `needsUpdate` must be set only
 * when the rig's rule says so, or the map renders every frame; and the light
 * must be left as it was found, or switching the prototype off leaves a
 * shadow-casting light behind.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { createSunShadow, enableSunShadows } from './sun-shadow.js';
import {
  SUN_SHADOW,
  sunShadowPose,
  type ShadowUpdateState,
  type Vec3,
} from './sun-shadow-rig.js';

const DEG = Math.PI / 180;
const sunNue = (azDeg: number, elDeg: number): Vec3 => [
  Math.cos(elDeg * DEG) * Math.cos(azDeg * DEG),
  Math.sin(elDeg * DEG),
  Math.cos(elDeg * DEG) * Math.sin(azDeg * DEG),
];

const state = (elDeg = 30): ShadowUpdateState => ({
  sunDir: sunNue(200, elDeg),
  centre: [4, 0, -2],
  halfWidthM: SUN_SHADOW.halfWidthM,
  casterGeneration: 'g1:1',
  casterOffsetM: 0,
});

describe('createSunShadow', () => {
  it('makes the light a manual shadow caster with the map size', () => {
    const light = new THREE.DirectionalLight();
    createSunShadow({ light, mapSize: 2048 });
    expect(light.castShadow).toBe(true);
    expect(light.shadow.autoUpdate).toBe(false);
    expect(light.shadow.mapSize.toArray()).toEqual([2048, 2048]);
  });

  it('refuses a map size that is not a positive integer', () => {
    const light = new THREE.DirectionalLight();
    for (const mapSize of [0, -1, 1.5, Number.NaN]) {
      expect(() => createSunShadow({ light, mapSize })).toThrow(RangeError);
    }
  });

  // The cost rule: one render for the first state, none for the same state,
  // one again once the sun moved past the threshold.
  it('requests a map render only when the rig says so', () => {
    const light = new THREE.DirectionalLight();
    const shadow = createSunShadow({ light });
    expect(shadow.update(state())).toBe(true);
    expect(light.shadow.needsUpdate).toBe(true);
    light.shadow.needsUpdate = false; // three clears it after rendering
    expect(shadow.update(state())).toBe(false);
    expect(light.shadow.needsUpdate).toBe(false);
    expect(shadow.update(state(30.2))).toBe(true);
    expect(shadow.renders).toBe(2);
  });

  it('places the light and its camera at the rig pose', () => {
    const light = new THREE.DirectionalLight();
    const shadow = createSunShadow({ light });
    shadow.update(state());
    const pose = sunShadowPose({
      sunDir: state().sunDir,
      centre: state().centre,
    });
    expect(light.position.toArray().map((v) => +v.toFixed(9))).toEqual(
      pose.position.map((v) => +v.toFixed(9))
    );
    expect(light.target.position.toArray()).toEqual([...pose.target]);
    const cam = light.shadow.camera;
    expect([
      cam.left,
      cam.right,
      cam.top,
      cam.bottom,
      cam.near,
      cam.far,
    ]).toEqual([
      pose.bounds.left,
      pose.bounds.right,
      pose.bounds.top,
      pose.bounds.bottom,
      pose.bounds.near,
      pose.bounds.far,
    ]);
    // About one ground texel of normal bias.
    expect(light.shadow.normalBias).toBeCloseTo(
      (2 * SUN_SHADOW.halfWidthM) / SUN_SHADOW.mapSize,
      12
    );
  });

  it('restores the light on dispose and stops updating', () => {
    const light = new THREE.DirectionalLight();
    light.shadow.normalBias = 0.02;
    const sizeBefore = light.shadow.mapSize.toArray();
    const shadow = createSunShadow({ light, mapSize: 2048 });
    shadow.update(state());
    shadow.dispose();
    expect(light.castShadow).toBe(false);
    expect(light.shadow.autoUpdate).toBe(true);
    expect(light.shadow.normalBias).toBe(0.02);
    expect(light.shadow.mapSize.toArray()).toEqual(sizeBefore);
    expect(shadow.update(state(40))).toBe(false);
    shadow.dispose(); // idempotent
  });
});

describe('enableSunShadows', () => {
  it('turns on PCF shadow maps', () => {
    const renderer = {
      shadowMap: { enabled: false, type: THREE.BasicShadowMap },
    } as unknown as THREE.WebGLRenderer;
    enableSunShadows(renderer);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
  });
});

describe('createSunShadow (M2 review fixes)', () => {
  // WHY (finding 1): three builds the shadow camera from the light's
  // position WHEN the map renders, possibly frames after update(). A caller
  // that aims the light elsewhere in between (the look-dev page aims it at
  // 1 km) rendered an empty map; every update() puts it back at the pose.
  it('puts the light back at the rendered pose on every call', () => {
    const light = new THREE.DirectionalLight();
    const shadow = createSunShadow({ light });
    shadow.update(state());
    const at = light.position.toArray();
    light.position.set(0, 1000, 0);
    light.target.position.set(9, 9, 9);
    expect(shadow.update(state())).toBe(false);
    expect(light.position.toArray()).toEqual(at);
    expect(light.target.position.toArray()).toEqual([...state().centre]);
  });

  // WHY (finding 9): a per-frame caller reuses scratch arrays; storing them
  // by reference made the rule compare the state with itself forever.
  it('stores a copy of the rendered state', () => {
    const light = new THREE.DirectionalLight();
    const shadow = createSunShadow({ light });
    const scratch = {
      ...state(),
      sunDir: [...state().sunDir] as [number, number, number],
    };
    shadow.update(scratch);
    const moved = sunNue(200, 31);
    scratch.sunDir[0] = moved[0];
    scratch.sunDir[1] = moved[1];
    scratch.sunDir[2] = moved[2];
    expect(shadow.update(scratch)).toBe(true);
  });

  // WHY (finding 7): M3 hands over the scene's fixed light; switching the
  // prototype off must leave it where it was, not aimed at the sun.
  it('restores the position, the target and the camera bounds on dispose', () => {
    const light = new THREE.DirectionalLight();
    light.position.set(0, 10, 5);
    const cam = light.shadow.camera;
    const bounds = [
      cam.left,
      cam.right,
      cam.top,
      cam.bottom,
      cam.near,
      cam.far,
    ];
    const shadow = createSunShadow({ light });
    shadow.update(state());
    shadow.dispose();
    expect(light.position.toArray()).toEqual([0, 10, 5]);
    expect(light.target.position.toArray()).toEqual([0, 0, 0]);
    expect([
      cam.left,
      cam.right,
      cam.top,
      cam.bottom,
      cam.near,
      cam.far,
    ]).toEqual(bounds);
  });

  // WHY (finding 10): three reallocates a map only when there is none, so a
  // new size on a light with an old map kept the old texture.
  it('drops a stale map, and works again after a dispose', () => {
    const light = new THREE.DirectionalLight();
    light.shadow.map = new THREE.WebGLRenderTarget(4, 4);
    const first = createSunShadow({ light, mapSize: 2048 });
    expect(light.shadow.map).toBeNull();
    first.update(state());
    first.dispose();
    const second = createSunShadow({ light });
    expect(second.update(state())).toBe(true);
    expect(light.castShadow).toBe(true);
  });

  // WHY (finding 11): one texel of the camera's own width, not a restated
  // formula.
  it('biases by one texel of the camera width', () => {
    const light = new THREE.DirectionalLight();
    createSunShadow({ light, mapSize: 1024 }).update(state());
    const cam = light.shadow.camera;
    expect(light.shadow.normalBias).toBeCloseTo(
      (cam.right - cam.left) / 1024,
      12
    );
  });
});

// A cached city shadow: the map renders rarely, the light follows the sun in
// between, the fit (distance, far plane) changes with the view, and a hidden
// view frees the map's memory.
describe('createSunShadow (cached map)', () => {
  it('pins the depth bias to 0 and restores it on dispose', () => {
    const light = new THREE.DirectionalLight();
    light.shadow.bias = -0.002;
    const shadow = createSunShadow({ light });
    expect(light.shadow.bias).toBe(0);
    shadow.dispose();
    expect(light.shadow.bias).toBe(-0.002);
  });

  it('takes the distance and the far plane per call', () => {
    const light = new THREE.DirectionalLight();
    const shadow = createSunShadow({ light, distanceM: 100 });
    shadow.update(state(), { distanceM: 700, farM: 900 });
    expect(light.shadow.camera.far).toBe(900);
    const target = new THREE.Vector3(4, 0, -2);
    expect(light.position.distanceTo(target)).toBeCloseTo(700, 9);
    // Without a per-call value the option still applies.
    shadow.update(state(50));
    expect(light.position.distanceTo(target)).toBeCloseTo(100, 9);
    expect(light.shadow.camera.far).toBe(100 + SUN_SHADOW.halfWidthM);
  });

  // Between renders the shading must follow the current sun while the map
  // keeps its rendered pose; the default keeps the old behaviour.
  it('keeps the light on the current sun between renders when asked to', () => {
    const light = new THREE.DirectionalLight();
    const shadow = createSunShadow({
      light,
      lightFollowsSun: true,
      thresholds: { sunDeg: 5 },
    });
    shadow.update(state(30));
    light.shadow.needsUpdate = false;
    const moved = state(32);
    expect(shadow.update(moved)).toBe(false);
    expect(light.shadow.needsUpdate).toBe(false);
    const dir = light.position.clone().sub(light.target.position).normalize();
    expect(dir.toArray()[1]).toBeCloseTo(moved.sunDir[1], 9);
    expect(light.target.position.toArray()).toEqual([4, 0, -2]);
    expect(light.position.distanceTo(light.target.position)).toBeCloseTo(
      SUN_SHADOW.halfWidthM + SUN_SHADOW.marginM,
      9
    );

    const fixed = new THREE.DirectionalLight();
    const still = createSunShadow({ light: fixed, thresholds: { sunDeg: 5 } });
    still.update(state(30));
    const before = fixed.position.toArray();
    still.update(state(32));
    expect(fixed.position.toArray()).toEqual(before);
  });

  it('answers wouldUpdate without rendering or moving anything', () => {
    const light = new THREE.DirectionalLight();
    const shadow = createSunShadow({ light });
    expect(shadow.wouldUpdate(state())).toBe(true);
    expect(shadow.renders).toBe(0);
    expect(light.shadow.needsUpdate).toBe(false);
    shadow.update(state());
    expect(shadow.wouldUpdate(state())).toBe(false);
    expect(shadow.wouldUpdate(state(60))).toBe(true);
    shadow.dispose();
    expect(shadow.wouldUpdate(state(60))).toBe(false);
  });

  it('releases the map and renders a new one on the next update', () => {
    const light = new THREE.DirectionalLight();
    const shadow = createSunShadow({ light });
    shadow.update(state());
    const map = new THREE.WebGLRenderTarget(4, 4);
    let disposed = 0;
    map.dispose = () => {
      disposed += 1;
    };
    light.shadow.map = map;
    shadow.release();
    expect(disposed).toBe(1);
    expect(light.shadow.map).toBeNull();
    expect(light.castShadow).toBe(true);
    light.shadow.needsUpdate = false;
    expect(shadow.update(state())).toBe(true);
    expect(light.shadow.needsUpdate).toBe(true);
    expect(shadow.renders).toBe(2);
  });
});
