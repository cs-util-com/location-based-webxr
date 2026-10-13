import { describe, expect, it } from 'vitest';
import { Matrix4, Object3D, Vector3 } from 'three';

import {
  createReticleMesh,
  updateReticle,
  updateReticleAtSurface,
} from './hit-test-reticle.js';
import { WEBXR_TO_NUE } from '../ar/webxr-nue-basis.js';

/**
 * Why these tests matter: the reticle view-model is the small piece of the
 * hit-test glue most likely to be ported incorrectly. We pin the invariants the
 * per-frame XR plumbing relies on every frame:
 *   1. a hit pose makes the reticle visible AND is converted from the WebXR
 *      reference space into the reticle's NUE parent frame via the WEBXR_TO_NUE
 *      basis change (the on-device "drifts to the side" regression), and
 *   2. the absence of a hit hides the reticle (otherwise a stale reticle would
 *      stick to the last surface).
 */
describe('createReticleMesh', () => {
  it('starts hidden with manual matrix updates (so the hit pose is not clobbered)', () => {
    const reticle = createReticleMesh();
    expect(reticle.visible).toBe(false);
    expect(reticle.matrixAutoUpdate).toBe(false);
  });
});

describe('updateReticle', () => {
  it('applies the WebXR→NUE basis change to the hit pose and shows the reticle', () => {
    const reticle = new Object3D();
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;

    // A pose translated to WebXR (1, 2, 3): column-major identity with the
    // translation in the last column's first three rows (elements 12,13,14).
    const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1];
    updateReticle(reticle, pose);

    // WEBXR_TO_NUE maps (x, y, z)_WebXR → (-z, y, x)_NUE, so the stored LOCAL
    // (arWorldGroup-frame) translation is (-3, 2, 1). The Up axis is preserved
    // (2) but East/North are NOT swapped — exactly the fix for the reticle
    // sliding sideways when WebXR coords were misread as NUE.
    expect(reticle.visible).toBe(true);
    expect(reticle.matrix.elements[12]).toBeCloseTo(-3, 6);
    expect(reticle.matrix.elements[13]).toBeCloseTo(2, 6);
    expect(reticle.matrix.elements[14]).toBeCloseTo(1, 6);
  });

  it('hides the reticle when there is no hit (null)', () => {
    const reticle = new Object3D();
    reticle.visible = true;
    updateReticle(reticle, null);
    expect(reticle.visible).toBe(false);
  });

  it('accepts a Float32Array pose matrix (XRPose.transform.matrix shape)', () => {
    const reticle = new Object3D();
    reticle.matrixAutoUpdate = false;
    // WebXR translation (5, 6, 7) → NUE (-7, 6, 5).
    const pose = new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1,
    ]);
    updateReticle(reticle, pose);
    expect(reticle.visible).toBe(true);
    expect(reticle.matrix.elements[12]).toBeCloseTo(-7, 6);
    expect(reticle.matrix.elements[14]).toBeCloseTo(5, 6);
  });

  // The core on-device regression. The reticle lives under arWorldGroup (NUE),
  // but its world pose must match the transform chain the camera rides:
  //   camera_world = arWorldGroup.matrix · WEBXR_TO_NUE · camera_local
  // so the reticle's world pose must be arWorldGroup.matrix · WEBXR_TO_NUE ·
  // hitPose. A pure-East WebXR offset (+X) must therefore land on the NUE East
  // axis (+Z), NOT the North axis (+X) — the swap that pushed the reticle off
  // screen-centre while the Up axis still looked right.
  it('keeps the reticle in the camera frame: a WebXR +X (East) hit maps to NUE +Z (East)', () => {
    const arWorldGroup = new Object3D();
    arWorldGroup.matrixAutoUpdate = false;
    // Identity alignment isolates the basis change from any GPS rotation.
    arWorldGroup.matrix.identity();

    const reticle = new Object3D();
    reticle.matrixAutoUpdate = false;
    arWorldGroup.add(reticle);

    // A hit pose 1 m along WebXR +X (East), level with the origin.
    const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1];
    updateReticle(reticle, pose);

    // Compose the world matrix the way three.js would during render.
    const reticleWorld = new Matrix4().multiplyMatrices(
      arWorldGroup.matrix,
      reticle.matrix
    );
    const worldPosition = new Vector3().setFromMatrixPosition(reticleWorld);

    // Expected: arWorldGroup(identity) · WEBXR_TO_NUE · (1,0,0) = (0, 0, 1).
    const expected = new Vector3(1, 0, 0).applyMatrix4(WEBXR_TO_NUE);
    expect(reticle.visible).toBe(true);
    expect(worldPosition.x).toBeCloseTo(expected.x, 6); // North ≈ 0
    expect(worldPosition.y).toBeCloseTo(expected.y, 6); // Up ≈ 0
    expect(worldPosition.z).toBeCloseTo(expected.z, 6); // East ≈ 1
    expect(worldPosition.z).toBeCloseTo(1, 6);
    expect(worldPosition.x).toBeCloseTo(0, 6);
  });

  // Regression: with matrixAutoUpdate=false the manual `reticle.matrix` write
  // must also mark `matrixWorldNeedsUpdate`, or three.js's normal render-time
  // `updateMatrixWorld(force=false)` keeps a STALE `matrixWorld` whenever the
  // parent didn't change that frame (arWorldGroup is static between ~1 Hz GPS
  // alignment updates). The reticle would then render frozen at its previous
  // surface even though `updateReticle` fed it a new pose every frame. The
  // earlier tests miss this because they compose the world matrix by hand
  // instead of going through three.js's matrix-world traversal.
  it('keeps reticle.matrixWorld fresh under render-time updateMatrixWorld with a static parent', () => {
    const arWorldGroup = new Object3D();
    arWorldGroup.matrixAutoUpdate = false;
    arWorldGroup.matrix.identity();

    const reticle = createReticleMesh();
    arWorldGroup.add(reticle);

    // Frame 1: a hit 5 m along WebXR +Y (Up), then the normal render traversal.
    updateReticle(reticle, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 5, 0, 1]);
    arWorldGroup.updateMatrixWorld(); // force=false, like the renderer

    // Frame 2: the surface moves; parent stays static (no GPS update this frame).
    updateReticle(reticle, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 9, 0, 1]);
    arWorldGroup.updateMatrixWorld(); // force=false again

    // matrixWorld must reflect the SECOND pose (NUE Up = +Y), not the stale first.
    const world = new Vector3().setFromMatrixPosition(reticle.matrixWorld);
    expect(world.y).toBeCloseTo(9, 6);
  });
});

describe('updateReticleAtSurface (Tour Viewer polish round M5c: the cursor on a mesh)', () => {
  // Why: the mesh cursor puts the ring on a point of the occluder mesh -
  // given in WORLD coordinates with the surface's normal - while the ring
  // hangs under the alignment-carrying world group. The ring must land on
  // the point and lie flat to the surface (its up axis along the normal),
  // whatever the group's own transform.
  const up = (o: Object3D) =>
    new Vector3(0, 1, 0).transformDirection(o.matrixWorld).normalize();

  it('puts the ring at the world point, flat to the surface, under an identity group', () => {
    const parent = new Object3D();
    const ring = createReticleMesh();
    parent.add(ring);
    const normal = new Vector3(0, 0, 1);
    updateReticleAtSurface(ring, new Vector3(1, 2, 3), normal);
    parent.updateMatrixWorld(true);
    expect(ring.visible).toBe(true);
    expect(
      ring.getWorldPosition(new Vector3()).distanceTo(new Vector3(1, 2, 3))
    ).toBeLessThan(1e-9);
    expect(up(ring).distanceTo(normal)).toBeLessThan(1e-9);
  });

  it('honours a moved and turned group (the GPS alignment)', () => {
    const parent = new Object3D();
    parent.position.set(10, -2, 5);
    parent.rotation.set(0.3, 1.1, -0.2);
    parent.updateMatrixWorld(true);
    const ring = createReticleMesh();
    parent.add(ring);
    const point = new Vector3(4, 1, -6);
    const normal = new Vector3(1, 1, 0).normalize();
    updateReticleAtSurface(ring, point, normal);
    parent.updateMatrixWorld(true);
    expect(ring.getWorldPosition(new Vector3()).distanceTo(point)).toBeLessThan(
      1e-9
    );
    expect(up(ring).distanceTo(normal)).toBeLessThan(1e-9);
  });

  it('hides nothing and keeps the hit-test path working afterwards', () => {
    const parent = new Object3D();
    const ring = createReticleMesh();
    parent.add(ring);
    updateReticleAtSurface(ring, new Vector3(0, 0, 0), new Vector3(0, 1, 0));
    updateReticle(ring, null);
    expect(ring.visible).toBe(false);
  });
});
