/**
 * OcclusionMesh as a shadow RECEIVER (W4 AR shadows plan 2026-09-26-0549,
 * M1; the API of §2 as amended by the §6 triage).
 *
 * Why this file matters: in AR the reconstructed room is the only thing a
 * virtual object's shadow can fall on. The receiver is one more skin that
 * shares the occluder's geometry and draws `ShadowMaterial` darkening over
 * the camera image. Everything that can go wrong here is silent on a desktop
 * and only visible on a phone: a receiver left on a disposed geometry after a
 * remesh, a receiver that keeps painting while the occluder is hidden, a mesh
 * that starts casting and covers the whole room in acne, or a receiver lost
 * when PhysicsDemo recreates the occluder on a mesh-mode change. Each of
 * those is pinned below, without a GPU.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { WEBXR_TO_NUE } from '../ar/webxr-nue-basis.js';
import { OcclusionMesh, OCCLUDER_DEBUG_STYLES } from './occlusion-mesh.js';
import {
  SHADOW_RECEIVER_DEPTH_OFFSET,
  createShadowPlane,
} from './shadow-receiver.js';

const RECEIVER_NAME = 'occupancy-occluder-shadow-receiver';
const CELL_SIZE = 0.16;

function receiver(parent: THREE.Object3D): THREE.Mesh | undefined {
  const found = parent.children.filter((c) => c.name === RECEIVER_NAME);
  // Never more than one: two receivers would darken twice.
  expect(found.length).toBeLessThanOrEqual(1);
  return found[0] as THREE.Mesh | undefined;
}

function shadowMaterial(mesh: THREE.Mesh): THREE.ShadowMaterial {
  expect(mesh.material).toBeInstanceOf(THREE.ShadowMaterial);
  return mesh.material as THREE.ShadowMaterial;
}

/** A 3x3 floor slab: enough cells for a non-empty surface. */
const FLOOR: [number, number, number][] = [];
for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) FLOOR.push([x, 0, z]);

describe('OcclusionMesh shadow receiver: construction', () => {
  // Without the option nothing changes: the default occluder stays exactly
  // what every existing consumer gets today.
  it('adds no receiver unless asked', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    expect(receiver(parent)).toBeUndefined();
    occluder.dispose();
  });

  // The receiver is the promoted createShadowPlane recipe on the occluder's
  // own geometry: ShadowMaterial, transparent, no depth write, no fog, the
  // same negative polygon offset, receives and never casts. Comparing with
  // the plane's material, flag by flag, is the DEC-H3 guard: one recipe.
  it('builds the receiver from the construction option with the plane recipe', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent, {
      shadowReceiver: { opacity: 0.42 },
    });
    const skin = receiver(parent);
    expect(skin).toBeDefined();
    const material = shadowMaterial(skin!);
    const plane = shadowMaterial(createShadowPlane(5, 0.42));
    expect(material.opacity).toBe(0.42);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(false);
    expect(material.polygonOffset).toBe(true);
    expect(material.polygonOffsetFactor).toBe(SHADOW_RECEIVER_DEPTH_OFFSET);
    expect(material.polygonOffsetUnits).toBe(SHADOW_RECEIVER_DEPTH_OFFSET);
    for (const key of [
      'transparent',
      'depthWrite',
      'fog',
      'polygonOffset',
      'polygonOffsetFactor',
      'polygonOffsetUnits',
    ] as const) {
      expect(material[key]).toBe(plane[key]);
    }
    expect(skin!.receiveShadow).toBe(true);
    expect(skin!.castShadow).toBe(false);
    occluder.dispose();
  });

  // It is a skin like the debug skins: same geometry object (never a copy),
  // same raw-WebXR to NUE basis, never frustum-culled (the surface spans the
  // room), and drawn in the transparent pass AFTER the debug skins, so a
  // shadow also darkens the visible debug surface.
  it('shares the geometry, basis and culling of the occluder', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent, {
      shadowReceiver: { opacity: 0.42 },
    });
    occluder.setDebugStyle('depth-shaded-wireframe');
    occluder.update(FLOOR, CELL_SIZE);
    const skin = receiver(parent)!;
    expect(skin.geometry).toBe(occluder.getMesh().geometry);
    expect(skin.matrixAutoUpdate).toBe(false);
    expect(skin.matrix.elements).toEqual(WEBXR_TO_NUE.elements);
    expect(skin.frustumCulled).toBe(false);
    const debugOrders = parent.children
      .filter((c) => c !== skin && c !== occluder.getMesh())
      .map((c) => c.renderOrder);
    expect(debugOrders.length).toBe(2);
    expect(skin.renderOrder).toBeGreaterThan(Math.max(...debugOrders));
    occluder.dispose();
  });

  it('honours a custom depth offset', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent, {
      shadowReceiver: { opacity: 0.3, depthOffset: -4 },
    });
    const material = shadowMaterial(receiver(parent)!);
    expect(material.polygonOffsetFactor).toBe(-4);
    expect(material.polygonOffsetUnits).toBe(-4);
    occluder.dispose();
  });

  // A positive offset pushes the receiver BEHIND the occluder's own depth,
  // so it would fail the depth test everywhere: no shadow at all, silently.
  it('refuses an opacity outside [0, 1] or a depth offset that is positive', () => {
    const parent = new THREE.Group();
    for (const bad of [
      { opacity: -0.1 },
      { opacity: 1.1 },
      { opacity: Number.NaN },
      { opacity: 0.4, depthOffset: 1 },
      { opacity: 0.4, depthOffset: Number.NaN },
    ]) {
      expect(() => new OcclusionMesh(parent, { shadowReceiver: bad })).toThrow(
        RangeError
      );
      const occluder = new OcclusionMesh(parent);
      expect(() => occluder.setShadowReceiver(bad)).toThrow(RangeError);
      occluder.dispose();
    }
    // A refused option leaves nothing behind: validation runs before the
    // constructor attaches anything, so no orphaned occluder is left either.
    expect(receiver(parent)).toBeUndefined();
    expect(parent.children).toHaveLength(0);
  });
});

describe('OcclusionMesh shadow receiver: casting', () => {
  // three's shadow pass draws every visible mesh with castShadow, whatever
  // its colorWrite (research §1). The occluder casting would put its own
  // shadow on the receiver across the whole room (acne, the ridge of M2's
  // A3). Asserted directly, as the review asked, on every node the occluder
  // adds, in every debug style, with and without a receiver.
  it('never casts from any node it owns, in any style', () => {
    for (const style of OCCLUDER_DEBUG_STYLES) {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent, {
        shadowReceiver: { opacity: 0.42 },
      });
      occluder.setDebugStyle(style);
      occluder.update(FLOOR, CELL_SIZE);
      expect(parent.children.length).toBeGreaterThan(0);
      for (const node of parent.children) {
        expect(node.castShadow).toBe(false);
      }
      occluder.dispose();
    }
  });

  // The occluder itself only writes depth; it must not receive either, or a
  // future material change would make it draw a second shadow.
  it('keeps the depth-only occluder out of both shadow roles', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent, {
      shadowReceiver: { opacity: 0.42 },
    });
    expect(occluder.getMesh().castShadow).toBe(false);
    expect(occluder.getMesh().receiveShadow).toBe(false);
    occluder.dispose();
  });
});

/** Whether the shared geometry is non-empty and has a normal per vertex. */
function hasNormalPerVertex(occluder: OcclusionMesh): boolean {
  const geometry = occluder.getMesh().geometry;
  if (!geometry.hasAttribute('position')) return false;
  const vertices = geometry.getAttribute('position').count;
  return (
    vertices > 0 &&
    geometry.hasAttribute('normal') &&
    geometry.getAttribute('normal').count === vertices
  );
}

describe('OcclusionMesh shadow receiver: normals in every skin', () => {
  // The owner's phone test on r749 (2026-09-27): shadows showed with the
  // shaded skins and vanished with "Wireframe" and "Off". three compiles the
  // receiver's program ONCE, with or without HAS_NORMAL depending on
  // whether the geometry it first draws has normals, and does not recompile
  // when a later remesh drops them. Only the shaded skins computed normals,
  // so a receiver compiled under a shaded skin (a mesh-mode change rebuilds
  // the occluder under the current skin) read a missing normal as (0, 0, 0)
  // after a switch to Wireframe or Off: its normalized world normal is NaN,
  // so are its shadow coordinates, and no shadow is drawn. The replay probe
  // measures it (replay-shadows.spec.js); this pins the cause, GPU-free:
  // while a receiver is attached, the geometry has normals in EVERY style.
  it('keeps normals on the geometry after a remesh, in every style', () => {
    for (const style of OCCLUDER_DEBUG_STYLES) {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent, {
        shadowReceiver: { opacity: 0.42 },
      });
      occluder.setDebugStyle(style);
      occluder.update(FLOOR, CELL_SIZE);
      expect(hasNormalPerVertex(occluder)).toBe(true);
      occluder.applyMeshData(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
        new Uint32Array([0, 1, 2])
      );
      expect(hasNormalPerVertex(occluder)).toBe(true);
      occluder.dispose();
    }
  });

  // The owner's sequence: a shaded skin, then Off, then the next remesh.
  it('keeps them across a switch from a shaded skin to Off and Wireframe', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent, {
      shadowReceiver: { opacity: 0.42 },
    });
    occluder.setDebugStyle('depth-shaded-wireframe');
    occluder.update(FLOOR, CELL_SIZE);
    for (const style of ['off', 'wireframe'] as const) {
      occluder.setDebugStyle(style);
      occluder.update(FLOOR, CELL_SIZE);
      expect(hasNormalPerVertex(occluder)).toBe(true);
    }
    occluder.dispose();
  });

  // A receiver switched on over a normal-free geometry (the shadow switch
  // back on after remeshes under Off) must not draw it without normals.
  it('adds normals to the current geometry when a receiver is switched on', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    occluder.update(FLOOR, CELL_SIZE);
    expect(occluder.getMesh().geometry.getAttribute('normal')).toBeUndefined();
    occluder.setShadowReceiver({ opacity: 0.42 });
    expect(hasNormalPerVertex(occluder)).toBe(true);
    occluder.dispose();
  });

  // The cost stays where it was without a receiver: the invisible and the
  // wireframe styles keep the remesh path normal-free (the recorder's
  // default occluder has no receiver).
  it('adds no normals without a receiver, under Off and Wireframe', () => {
    for (const style of ['off', 'wireframe'] as const) {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.setDebugStyle(style);
      occluder.update(FLOOR, CELL_SIZE);
      expect(
        occluder.getMesh().geometry.getAttribute('normal')
      ).toBeUndefined();
      occluder.dispose();
    }
  });
});

describe('OcclusionMesh shadow receiver: life cycle', () => {
  // A receiver left on the disposed geometry after a remesh would draw a
  // stale (or no) surface: it must follow update, applyMeshData and clear.
  it('follows update, applyMeshData and clear', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent, {
      shadowReceiver: { opacity: 0.42 },
    });
    const skin = receiver(parent)!;

    occluder.update(FLOOR, CELL_SIZE);
    expect(skin.geometry).toBe(occluder.getMesh().geometry);
    expect(occluder.getTriangleCount()).toBeGreaterThan(0);

    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]);
    occluder.applyMeshData(positions, new Uint32Array([0, 1, 2]));
    expect(skin.geometry).toBe(occluder.getMesh().geometry);

    occluder.clear();
    expect(skin.geometry).toBe(occluder.getMesh().geometry);
    expect(receiver(parent)).toBe(skin); // the node survives a clear
    occluder.dispose();
  });

  // A hidden occluder writes no depth; a receiver still drawing then would
  // paint shadows over virtual content and camera alike, unanchored.
  it('hides and shows with setVisible', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent, {
      shadowReceiver: { opacity: 0.42 },
    });
    const skin = receiver(parent)!;
    occluder.setVisible(false);
    expect(skin.visible).toBe(false);
    occluder.setVisible(true);
    expect(skin.visible).toBe(true);
    occluder.dispose();
  });

  // Unlike a debug style (which re-adds its skins visible), a receiver added
  // while the occluder is hidden must come in hidden, for the reason above.
  it('adds a receiver hidden when the occluder is hidden', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    occluder.setVisible(false);
    occluder.setShadowReceiver({ opacity: 0.42 });
    expect(receiver(parent)!.visible).toBe(false);
    occluder.setVisible(true);
    expect(receiver(parent)!.visible).toBe(true);
    occluder.dispose();
  });

  // The session off switch hides the receiver without a recompile (review
  // §6): the ShadowMaterial is cached across null and reused, so switching
  // back on compiles nothing new. `version` is three's needsUpdate counter.
  it('removes the node on null and reuses the cached material after', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent, {
      shadowReceiver: { opacity: 0.42 },
    });
    const first = shadowMaterial(receiver(parent)!);
    const version = first.version;

    occluder.setShadowReceiver(null);
    expect(receiver(parent)).toBeUndefined();

    occluder.setShadowReceiver({ opacity: 0.42 });
    const again = shadowMaterial(receiver(parent)!);
    expect(again).toBe(first);
    expect(again.version).toBe(version);
    occluder.dispose();
  });

  // Changing the opacity is a uniform, not a new material or a second node.
  it('retunes the opacity in place and stays idempotent', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    occluder.setShadowReceiver({ opacity: 0.42 });
    const skin = receiver(parent)!;
    const material = shadowMaterial(skin);
    occluder.setShadowReceiver({ opacity: 0.27 });
    occluder.setShadowReceiver({ opacity: 0.27 });
    expect(receiver(parent)).toBe(skin);
    expect(shadowMaterial(skin)).toBe(material);
    expect(material.opacity).toBe(0.27);
    occluder.dispose();
  });

  // Debug styles and the receiver are independent skins: switching styles
  // (which adds and removes the debug skins) never touches the receiver.
  //
  // Also the evidence behind the r752 field report (2026-09-27: "no shadow
  // until I switched the shader"): a style switch leaves the receiver's
  // node, material AND material version alone, so it cannot rebuild the
  // receiver's program, and a stale program cannot be what a skin change
  // repaired (see the first-load race findings, 2026-09-27).
  it('survives every debug style switch unchanged', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent, {
      shadowReceiver: { opacity: 0.42 },
    });
    occluder.update(FLOOR, CELL_SIZE);
    const skin = receiver(parent)!;
    const material = shadowMaterial(skin);
    const version = material.version;
    for (const style of [...OCCLUDER_DEBUG_STYLES, 'off'] as const) {
      occluder.setDebugStyle(style);
      expect(receiver(parent)).toBe(skin);
      expect(skin.material).toBe(material);
      expect(material.version).toBe(version);
    }
    occluder.dispose();
  });

  it('detaches the receiver and frees its material on dispose', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent, {
      shadowReceiver: { opacity: 0.42 },
    });
    const material = shadowMaterial(receiver(parent)!);
    let disposed = 0;
    material.addEventListener('dispose', () => {
      disposed += 1;
    });
    occluder.dispose();
    expect(receiver(parent)).toBeUndefined();
    expect(disposed).toBe(1);
    // After dispose the setter is a no-op, like every other mutator.
    occluder.setShadowReceiver({ opacity: 0.42 });
    expect(receiver(parent)).toBeUndefined();
    occluder.dispose();
    expect(disposed).toBe(1);
  });

  // The material is released even when the receiver was switched off (null)
  // before dispose: the cache must not leak.
  it('frees a cached receiver material that is currently off', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent, {
      shadowReceiver: { opacity: 0.42 },
    });
    const material = shadowMaterial(receiver(parent)!);
    let disposed = 0;
    material.addEventListener('dispose', () => {
      disposed += 1;
    });
    occluder.setShadowReceiver(null);
    occluder.dispose();
    expect(disposed).toBe(1);
  });
});

describe('OcclusionMesh shadow receiver: PhysicsDemo recreation', () => {
  // PhysicsDemo recreates the occluder on every mesh-mode change
  // (occupancy-view.ts setMeshMode: dispose, construct, remesh). The receiver
  // must come back with the new mesh from the construction option alone, and
  // the old one must be gone: exactly one receiver, on the new geometry.
  it('comes back exactly once when the occluder is recreated', () => {
    const parent = new THREE.Group();
    const options = { shadowReceiver: { opacity: 0.42 } } as const;
    let occluder = new OcclusionMesh(parent, { mode: 'smooth', ...options });
    occluder.update(FLOOR, CELL_SIZE);
    const oldSkin = receiver(parent)!;

    occluder.dispose();
    occluder = new OcclusionMesh(parent, { mode: 'greedy', ...options });
    occluder.update(FLOOR, CELL_SIZE);

    const newSkin = receiver(parent)!;
    expect(newSkin).not.toBe(oldSkin);
    expect(parent.children).not.toContain(oldSkin);
    expect(newSkin.geometry).toBe(occluder.getMesh().geometry);
    expect(newSkin.castShadow).toBe(false);
    occluder.dispose();
  });
});
