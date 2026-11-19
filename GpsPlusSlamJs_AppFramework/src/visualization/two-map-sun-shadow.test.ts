/**
 * Tests for the cached two-map sun shadow's controller, with real three.js
 * objects and no renderer.
 *
 * Why this file matters: the city shadow's cost lives in WHEN each map
 * renders. An orbit that renders a map, or a sun step that renders one map
 * twice, is a hitch on every drag; a far light sorted before the sun takes
 * the sun's shadow away entirely; a depth bias that grows with the far
 * plane, or a camera whose projection matrix lags its bounds, shows as
 * acne or holes only in a browser. Each of those is pinned here.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { nearFadeFar, type CityBox } from './shadow-fit.js';
import type { Vec3 } from './sun-shadow-rig.js';
import type { ShadowTier } from './two-map-shadow-rig.js';
import {
  createTwoMapSunShadow,
  type TwoMapShadowInput,
} from './two-map-sun-shadow.js';

const DEG = Math.PI / 180;
const sunAt = (azDeg: number, elDeg: number): Vec3 => [
  Math.cos(elDeg * DEG) * Math.cos(azDeg * DEG),
  Math.sin(elDeg * DEG),
  Math.cos(elDeg * DEG) * Math.sin(azDeg * DEG),
];

const CITY: CityBox = { centre: [0, 0, 0], halfExtentM: 2000, maxHeightM: 80 };

const input = (over: Partial<TwoMapShadowInput> = {}): TwoMapShadowInput => ({
  sunDir: sunAt(200, 30),
  target: [100, 0, -50],
  cameraDistanceM: 200,
  city: CITY,
  casterGeneration: 'build:1',
  ...over,
});

function rig(tier: ShadowTier = 'high', split = false) {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  scene.add(sun, sun.target);
  const shadow = createTwoMapSunShadow({
    sun,
    parent: scene,
    tier,
    options: { split },
  });
  /** Which maps were asked to render since the last call (three clears it). */
  const consume = (): [boolean, boolean] => {
    const near = sun.shadow.needsUpdate;
    const far = shadow.farLight?.shadow.needsUpdate ?? false;
    sun.shadow.needsUpdate = false;
    if (shadow.farLight) shadow.farLight.shadow.needsUpdate = false;
    return [near, far];
  };
  return { scene, sun, shadow, consume };
}

/** The casting directional lights in three's order (scene traversal). */
function castingLights(scene: THREE.Scene): THREE.DirectionalLight[] {
  const out: THREE.DirectionalLight[] = [];
  scene.traverse((o) => {
    if ((o as THREE.DirectionalLight).isDirectionalLight && o.castShadow) {
      out.push(o as THREE.DirectionalLight);
    }
  });
  return out;
}

describe('createTwoMapSunShadow: when maps render', () => {
  it('renders both maps once for a sun step, and nothing for the same state', () => {
    const { shadow, consume } = rig();
    shadow.update(input());
    expect(consume()).toEqual([true, true]);
    shadow.update(input());
    expect(consume()).toEqual([false, false]);
    shadow.update(input({ sunDir: sunAt(200, 31) }));
    expect(consume()).toEqual([true, true]);
    expect(shadow.renders).toBe(4);
  });

  it('with split frames renders near now and far in the next frame', () => {
    const { shadow, consume } = rig('high', true);
    expect(shadow.update(input()).again).toBe(true);
    expect(consume()).toEqual([true, false]);
    expect(shadow.update(input()).again).toBe(false);
    expect(consume()).toEqual([false, true]);
    shadow.update(input());
    expect(consume()).toEqual([false, false]);
  });

  it('renders nothing for an orbit inside the near square', () => {
    const { shadow, consume } = rig();
    shadow.update(input());
    consume();
    // Orbiting turns the camera around the same target at the same distance.
    for (let i = 0; i < 10; i += 1) {
      shadow.update(input());
      expect(consume()).toEqual([false, false]);
    }
  });

  it('renders only the near map for a pan past the re-centre threshold or a zoom step', () => {
    const { shadow, consume } = rig();
    shadow.update(input());
    consume();
    // R is 240 m at 200 m; the default re-centre is a quarter of R.
    shadow.update(input({ target: [100 + 30, 0, -50] }));
    expect(consume()).toEqual([false, false]);
    shadow.update(input({ target: [100 + 80, 0, -50] }));
    expect(consume()).toEqual([true, false]);
    shadow.update(input({ target: [180, 0, -50], cameraDistanceM: 300 }));
    expect(consume()).toEqual([true, false]);
  });

  it('renders both maps for a caster change', () => {
    const { shadow, consume } = rig();
    shadow.update(input());
    consume();
    shadow.update(input({ casterGeneration: 'build:2' }));
    expect(consume()).toEqual([true, true]);
  });
});

describe('createTwoMapSunShadow: the sun ramp, the floor and the horizon', () => {
  it('requests no map below the floor, keeps the program key, and aims along the sun', () => {
    const { sun, shadow, scene, consume } = rig();
    shadow.update(input());
    consume();
    const before = castingLights(scene).length;
    for (const el of [1.5, 0, -6]) {
      const dir = sunAt(200, el);
      shadow.update(input({ sunDir: dir }));
      expect(consume()).toEqual([false, false]);
      expect(sun.shadow.intensity).toBe(0);
      expect(castingLights(scene)).toHaveLength(before);
      const aim = sun.position.clone().sub(sun.target.position).normalize();
      expect(aim.x).toBeCloseTo(dir[0], 9);
      expect(aim.y).toBeCloseTo(dir[1], 9);
      expect(aim.z).toBeCloseTo(dir[2], 9);
    }
    shadow.update(input({ sunDir: sunAt(200, 5) }));
    expect(sun.shadow.intensity).toBeCloseTo(0.5, 9);
    expect(consume()).toEqual([true, true]);
  });
});

describe('createTwoMapSunShadow: the lights', () => {
  it.each<ShadowTier>(['low', 'phone', 'high'])(
    'makes the sun light 0 and shadow 0 in tier %s',
    (tier) => {
      const { scene, sun, shadow } = rig(tier);
      const lights = castingLights(scene);
      expect(lights[0]).toBe(sun);
      expect(lights).toHaveLength(tier === 'low' ? 1 : 2);
      expect(shadow.farLight === undefined).toBe(tier === 'low');
    }
  );

  it('pins the depth bias to 0 on both lights for any distance', () => {
    const { sun, shadow } = rig();
    for (const maxHeightM of [0, 80, 500]) {
      shadow.update(
        input({
          city: { ...CITY, maxHeightM },
          casterGeneration: `h${maxHeightM}`,
        })
      );
      expect(sun.shadow.bias).toBe(0);
      expect(shadow.farLight?.shadow.bias).toBe(0);
    }
  });

  it("matches each shadow camera's projection matrix to its bounds", () => {
    const { sun, shadow } = rig();
    shadow.update(input());
    for (const light of [sun, shadow.farLight!]) {
      const camera = light.shadow.camera;
      const expected = new THREE.Matrix4().makeOrthographic(
        camera.left,
        camera.right,
        camera.top,
        camera.bottom,
        camera.near,
        camera.far
      );
      expect(camera.projectionMatrix.elements).toEqual(expected.elements);
    }
    // The near far plane starts the fade 0.9 R past the centre.
    const D = sun.position.distanceTo(sun.target.position);
    expect(sun.shadow.camera.far).toBeCloseTo(nearFadeFar(D, 240, 0.9), 6);
    expect(sun.shadow.camera.right).toBe(240);
    expect(shadow.farLight!.shadow.camera.right).toBe(CITY.halfExtentM);
  });

  it('refuses a sun that is not a child of the parent', () => {
    const sun = new THREE.DirectionalLight();
    expect(() =>
      createTwoMapSunShadow({ sun, parent: new THREE.Scene(), tier: 'high' })
    ).toThrow(RangeError);
  });
});

describe('createTwoMapSunShadow: release, restore, tiers and dispose', () => {
  it('release frees both maps and renders nothing until restore, then once', () => {
    const { sun, shadow, consume } = rig();
    shadow.update(input());
    consume();
    const disposed: string[] = [];
    for (const [name, light] of [
      ['near', sun],
      ['far', shadow.farLight!],
    ] as const) {
      const map = new THREE.WebGLRenderTarget(2, 2);
      map.dispose = () => {
        disposed.push(name);
      };
      light.shadow.map = map;
    }
    shadow.release();
    expect(disposed.sort()).toEqual(['far', 'near']);
    expect(sun.shadow.map).toBeNull();
    shadow.update(input({ sunDir: sunAt(200, 40) }));
    expect(consume()).toEqual([false, false]);
    shadow.restore();
    shadow.update(input({ sunDir: sunAt(200, 40) }));
    expect(consume()).toEqual([true, true]);
    shadow.update(input({ sunDir: sunAt(200, 40) }));
    expect(consume()).toEqual([false, false]);
  });

  it('setTier off stops casting and removes the far light; a tier brings them back', () => {
    const { scene, sun, shadow } = rig();
    shadow.setTier('off');
    expect(castingLights(scene)).toHaveLength(0);
    expect(scene.children.some((c) => c.name === 'two-map far shadow')).toBe(
      false
    );
    expect(shadow.update(input())).toEqual({
      near: false,
      far: false,
      again: false,
    });
    shadow.setTier('low');
    expect(castingLights(scene)).toEqual([sun]);
    shadow.update(input());
    expect(sun.shadow.camera.right).toBe(CITY.halfExtentM);
    shadow.setTier('high');
    expect(castingLights(scene)[0]).toBe(sun);
    expect(castingLights(scene)).toHaveLength(2);
  });

  it('dispose restores the sun and stops for good', () => {
    const { scene, sun, shadow } = rig();
    shadow.update(input());
    shadow.dispose();
    expect(sun.castShadow).toBe(false);
    expect(sun.shadow.intensity).toBe(1);
    expect(castingLights(scene)).toHaveLength(0);
    shadow.restore();
    shadow.setTier('high');
    expect(shadow.update(input()).near).toBe(false);
    expect(castingLights(scene)).toHaveLength(0);
  });

  it('refuses a non-finite input', () => {
    const { shadow } = rig();
    expect(() => shadow.update(input({ target: [Number.NaN, 0, 0] }))).toThrow(
      RangeError
    );
    expect(() => shadow.update(input({ cameraDistanceM: 0 }))).toThrow(
      RangeError
    );
  });
});
