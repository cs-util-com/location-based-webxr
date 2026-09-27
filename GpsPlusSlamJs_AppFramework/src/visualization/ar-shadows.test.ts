/**
 * The AR shadows orchestrator's contract (W4 AR shadows plan
 * 2026-09-26-0549, M1 contract for the M3 module; DEC-W4-1/2, programme
 * DEC-PRG-6).
 *
 * Why this file matters: reception is AUTOMATIC. The occlusion mesh receives
 * whenever the renderer's shadow map is on and a light casts, with no
 * per-app opt-in, so the rule itself is the feature and it is pinned here in
 * every direction: on when it should be, off when it should be, off WITHOUT
 * a shader recompile (a visible hitch in AR), and never darkening twice when
 * the flat fallback plane is also present. The PhysicsDemo facts are pinned
 * too: the mesh is recreated on a mesh-mode change, the balls move every
 * frame, and the light is world-fixed. No GPU: a stub renderer carries only
 * the `shadowMap` settings the rule reads.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  AR_SHADOWS,
  createArShadows,
  shadowReception,
  type ArShadowsRenderer,
} from './ar-shadows.js';
import { OcclusionMesh } from './occlusion-mesh.js';
import { createShadowPlane } from './shadow-receiver.js';

const RECEIVER_NAME = 'occupancy-occluder-shadow-receiver';
const FLOOR: [number, number, number][] = [];
for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) FLOOR.push([x, 0, z]);

function renderer(
  enabled = true,
  type: THREE.ShadowMapType = THREE.PCFShadowMap
): ArShadowsRenderer {
  return { shadowMap: { enabled, type } };
}

/** The framework's SUN_LIGHT as ar-scene-hierarchy.ts builds it. */
function sunLight(): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(0xffffff, 0.8);
  light.position.set(0, 10, 5);
  return light;
}

function receiverOf(parent: THREE.Object3D): THREE.Mesh | undefined {
  return parent.children.find((c) => c.name === RECEIVER_NAME) as
    THREE.Mesh | undefined;
}

const FRAME = { centre: [0, 0, 0] as const, casterCount: 0 };

describe('shadowReception: the automatic rule', () => {
  it('is active with the shadow map on and a light that casts', () => {
    const light = sunLight();
    light.castShadow = true;
    expect(shadowReception(renderer(), [light])).toEqual({ active: true });
  });

  // Each way the rule must say no, with the reason a HUD can show.
  it('names why it is inactive', () => {
    const light = sunLight();
    light.castShadow = true;
    expect(shadowReception(renderer(false), [light])).toEqual({
      active: false,
      reason: 'shadow-map-off',
    });
    const notCasting = sunLight();
    expect(shadowReception(renderer(), [notCasting])).toEqual({
      active: false,
      reason: 'no-casting-light',
    });
    // The session off switch: castShadow stays (no recompile), intensity 0.
    const dimmed = sunLight();
    dimmed.castShadow = true;
    dimmed.shadow.intensity = 0;
    expect(shadowReception(renderer(), [dimmed]).active).toBe(false);
    // A hidden light is dropped by three's light collection entirely.
    const hidden = sunLight();
    hidden.castShadow = true;
    hidden.visible = false;
    expect(shadowReception(renderer(), [hidden]).active).toBe(false);
    expect(shadowReception(renderer(), [])).toEqual({
      active: false,
      reason: 'no-casting-light',
    });
  });

  // three's shadow pass draws RECEIVERS into a VSM map (`receiveShadow &&
  // type === VSMShadowMap`, WebGLShadowMap.renderObject): the mesh would then
  // shadow itself across the whole room. The rule refuses VSM outright.
  it('refuses a VSM shadow map, where receivers also cast', () => {
    const light = sunLight();
    light.castShadow = true;
    expect(
      shadowReception(renderer(true, THREE.VSMShadowMap), [light])
    ).toEqual({
      active: false,
      reason: 'vsm-unsupported',
    });
  });

  it('is active when SOME light casts', () => {
    const idle = sunLight();
    const casting = sunLight();
    casting.castShadow = true;
    expect(shadowReception(renderer(), [idle, casting]).active).toBe(true);
  });
});

describe('createArShadows: reception follows the rule', () => {
  // DEC-PRG-6: nothing but an enabled shadow map and a casting light is
  // needed. The orchestrator makes its light cast, so with the map on the
  // current occluder receives from the first update.
  it('puts the receiver on the current occluder when active', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    const light = sunLight();
    const shadows = createArShadows({
      renderer: renderer(),
      light,
      getOccluder: () => occluder,
    });
    expect(light.castShadow).toBe(true);
    shadows.update(FRAME);
    expect(shadows.isActive()).toBe(true);
    const skin = receiverOf(parent);
    expect(skin).toBeDefined();
    expect((skin!.material as THREE.ShadowMaterial).opacity).toBeCloseTo(
      AR_SHADOWS.opacity,
      12
    );
    shadows.dispose();
    occluder.dispose();
  });

  it('adds no receiver while the renderer has shadow maps off', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    const shadows = createArShadows({
      renderer: renderer(false),
      light: sunLight(),
      getOccluder: () => occluder,
    });
    shadows.update(FRAME);
    expect(shadows.isActive()).toBe(false);
    expect(receiverOf(parent)).toBeUndefined();
    expect(shadows.receiverOptions()).toBeUndefined();
    shadows.dispose();
    occluder.dispose();
  });

  // PhysicsDemo recreates the occluder on a mesh-mode change. The new one is
  // built with `receiverOptions()` (construction option) and the next update
  // reconciles anyway: exactly one receiver, on the new mesh.
  it('follows a recreated occluder', () => {
    const parent = new THREE.Group();
    let occluder = new OcclusionMesh(parent);
    const shadows = createArShadows({
      renderer: renderer(),
      light: sunLight(),
      getOccluder: () => occluder,
    });
    shadows.update(FRAME);
    const options = shadows.receiverOptions();
    expect(options).toBeDefined();

    occluder.dispose();
    occluder = new OcclusionMesh(parent, {
      mode: 'greedy',
      ...(options ? { shadowReceiver: options } : {}),
    });
    expect(receiverOf(parent)).toBeDefined(); // before any update
    shadows.update(FRAME);
    const receivers = parent.children.filter((c) => c.name === RECEIVER_NAME);
    expect(receivers).toHaveLength(1);
    expect((receivers[0] as THREE.Mesh).geometry).toBe(
      occluder.getMesh().geometry
    );
    shadows.dispose();
    occluder.dispose();
  });

  it('tolerates having no occluder yet', () => {
    const shadows = createArShadows({
      renderer: renderer(),
      light: sunLight(),
      getOccluder: () => null,
    });
    expect(() => shadows.update(FRAME)).not.toThrow();
    shadows.dispose();
  });
});

describe('createArShadows: the session off switch', () => {
  // Review §6: off is `shadow.intensity = 0` plus a hidden receiver, never
  // `castShadow = false` (which changes the light hash and recompiles every
  // lit material). The receiver's material survives and is reused.
  it('switches off and on without touching castShadow or the material', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    const light = sunLight();
    const shadows = createArShadows({
      renderer: renderer(),
      light,
      getOccluder: () => occluder,
    });
    shadows.update(FRAME);
    const material = receiverOf(parent)!.material as THREE.ShadowMaterial;
    const version = material.version;

    shadows.setEnabled(false);
    expect(light.castShadow).toBe(true);
    expect(light.shadow.intensity).toBe(0);
    expect(receiverOf(parent)).toBeUndefined();
    expect(shadows.isActive()).toBe(false);

    shadows.setEnabled(true);
    expect(light.shadow.intensity).toBe(1);
    const back = receiverOf(parent)!.material as THREE.ShadowMaterial;
    expect(back).toBe(material);
    expect(back.version).toBe(version);
    shadows.dispose();
    occluder.dispose();
  });

  // Off must also stop paying for the map: with moving casters the map
  // would otherwise still render every frame, into a shadow nobody draws.
  it('stops the per-frame map while off, and re-renders once on', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    const light = sunLight();
    const shadows = createArShadows({
      renderer: renderer(),
      light,
      getOccluder: () => occluder,
      dynamicCasters: true,
    });
    shadows.update({ ...FRAME, casterCount: 3 });
    expect(light.shadow.autoUpdate).toBe(true);
    shadows.setEnabled(false);
    expect(light.shadow.autoUpdate).toBe(false); // at once, not next frame
    shadows.update({ ...FRAME, casterCount: 3 });
    expect(light.shadow.autoUpdate).toBe(false);
    light.shadow.needsUpdate = false;
    shadows.setEnabled(true);
    shadows.update({ ...FRAME, casterCount: 3 });
    expect(light.shadow.autoUpdate).toBe(true);
    shadows.dispose();
    occluder.dispose();
  });

  // An app that dimmed its own shadow (intensity 0.6) gets 0.6 back, not 1.
  it('restores the intensity it found', () => {
    const light = sunLight();
    light.shadow.intensity = 0.6;
    const shadows = createArShadows({
      renderer: renderer(),
      light,
      getOccluder: () => null,
    });
    shadows.setEnabled(false);
    shadows.setEnabled(true);
    expect(light.shadow.intensity).toBe(0.6);
    shadows.dispose();
  });
});

describe('createArShadows: the shadow map cost', () => {
  // The PhysicsDemo's status line reports it (first-visit report on r753,
  // 2026-09-27): whether the rig asked for the map at all, and how often.
  // It counts the rig's pose renders, not the per-frame dynamic ones.
  it('counts the map renders the rig requested', () => {
    const light = sunLight();
    const shadows = createArShadows({
      renderer: renderer(),
      light,
      getOccluder: () => null,
    });
    expect(shadows.mapRenders()).toBe(0);
    shadows.update(FRAME);
    expect(shadows.mapRenders()).toBe(1);
    shadows.update(FRAME);
    expect(shadows.mapRenders()).toBe(1);
    shadows.dispose();
  });

  // Plan §2: a remesh never re-renders the map (the mesh only receives).
  it('does not re-render the map for a remesh', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    const light = sunLight();
    const shadows = createArShadows({
      renderer: renderer(),
      light,
      getOccluder: () => occluder,
    });
    shadows.update(FRAME);
    light.shadow.needsUpdate = false; // three clears it after rendering
    occluder.update(FLOOR, 0.16);
    shadows.update(FRAME);
    expect(light.shadow.needsUpdate).toBe(false);
    expect(light.shadow.autoUpdate).toBe(false);
    shadows.dispose();
    occluder.dispose();
  });

  // PhysicsDemo's balls move every frame: the map renders every frame while
  // any ball exists (autoUpdate), and stops once the last one is gone, with
  // one final render so its shadow does not linger.
  it('renders every frame only while moving casters exist', () => {
    const light = sunLight();
    const shadows = createArShadows({
      renderer: renderer(),
      light,
      getOccluder: () => null,
      dynamicCasters: true,
    });
    shadows.update({ ...FRAME, casterCount: 0 });
    expect(light.shadow.autoUpdate).toBe(false);
    shadows.update({ ...FRAME, casterCount: 1 });
    expect(light.shadow.autoUpdate).toBe(true);
    light.shadow.needsUpdate = false;
    shadows.update({ ...FRAME, casterCount: 0 });
    expect(light.shadow.autoUpdate).toBe(false);
    expect(light.shadow.needsUpdate).toBe(true);
    shadows.dispose();
  });

  // Without dynamic casters the rig's rule decides, and a change in the
  // caster SET is one of its triggers.
  it('re-renders a static map when the caster count changes', () => {
    const light = sunLight();
    const shadows = createArShadows({
      renderer: renderer(),
      light,
      getOccluder: () => null,
    });
    shadows.update({ ...FRAME, casterCount: 1 });
    light.shadow.needsUpdate = false;
    shadows.update({ ...FRAME, casterCount: 1 });
    expect(light.shadow.needsUpdate).toBe(false);
    shadows.update({ ...FRAME, casterCount: 2 });
    expect(light.shadow.needsUpdate).toBe(true);
    shadows.dispose();
  });

  it('uses the indoor half width and map size by default', () => {
    const light = sunLight();
    const shadows = createArShadows({
      renderer: renderer(),
      light,
      getOccluder: () => null,
    });
    shadows.update(FRAME);
    const cam = light.shadow.camera;
    expect(cam.right - cam.left).toBeCloseTo(2 * AR_SHADOWS.halfWidthM, 9);
    expect(light.shadow.mapSize.x).toBe(AR_SHADOWS.mapSize);
    shadows.dispose();
  });
});

describe('createArShadows: the world-fixed light', () => {
  // Review §6: the light keeps the direction it was found with; the shadow
  // square follows the user, the direction never does (a camera-following
  // light swims and re-renders the map on every head turn).
  it('keeps the found direction while the square follows the user', () => {
    const light = sunLight();
    const found = light.position.clone().sub(light.target.position).normalize();
    const shadows = createArShadows({
      renderer: renderer(),
      light,
      getOccluder: () => null,
    });
    for (const centre of [
      [0, 0, 0],
      [3, 0, -2],
      [-7, 0.5, 4],
    ] as const) {
      shadows.update({ centre, casterCount: 0 });
      const dir = light.position.clone().sub(light.target.position).normalize();
      expect(dir.distanceTo(found)).toBeLessThan(1e-9);
      expect(light.target.position.toArray()).toEqual([...centre]);
    }
    shadows.dispose();
  });

  it('refuses a light at or below the horizon', () => {
    const light = new THREE.DirectionalLight();
    light.position.set(1, 0, 0);
    expect(() =>
      createArShadows({ renderer: renderer(), light, getOccluder: () => null })
    ).toThrow(RangeError);
  });
});

describe('createArShadows: the fallback plane', () => {
  // Plan §2: the mesh receives when it has triangles, otherwise the flat
  // plane; never both, which would darken twice.
  it('shows the plane only while the mesh is empty', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    const plane = createShadowPlane(5, AR_SHADOWS.opacity);
    const shadows = createArShadows({
      renderer: renderer(),
      light: sunLight(),
      getOccluder: () => occluder,
      fallbackPlane: plane,
    });
    shadows.update(FRAME);
    expect(plane.visible).toBe(true);
    occluder.update(FLOOR, 0.16);
    shadows.update(FRAME);
    expect(plane.visible).toBe(false);
    expect(receiverOf(parent)).toBeDefined();
    occluder.clear();
    shadows.update(FRAME);
    expect(plane.visible).toBe(true);
    shadows.setEnabled(false);
    expect(plane.visible).toBe(false);
    shadows.dispose();
    occluder.dispose();
  });
});

describe('createArShadows: dispose', () => {
  it('restores the light and removes the receiver', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    const light = sunLight();
    const position = light.position.clone();
    const shadows = createArShadows({
      renderer: renderer(),
      light,
      getOccluder: () => occluder,
    });
    shadows.update({ centre: [2, 0, 2], casterCount: 1 });
    shadows.setEnabled(false);
    shadows.dispose();
    expect(light.castShadow).toBe(false);
    expect(light.shadow.intensity).toBe(1);
    expect(light.position.toArray()).toEqual(position.toArray());
    expect(receiverOf(parent)).toBeUndefined();
    // Idempotent, and inert afterwards.
    shadows.dispose();
    shadows.update(FRAME);
    expect(receiverOf(parent)).toBeUndefined();
    occluder.dispose();
  });
});
