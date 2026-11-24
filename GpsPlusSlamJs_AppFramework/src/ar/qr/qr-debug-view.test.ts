/**
 * QR debug view — unit tests.
 *
 * Why this matters: the axis + cube are the shared "is the QR glued?" overlay.
 * They must start hidden, appear glued to the pose at the measured size on
 * update, persist (not auto-clear) so they don't flicker between detections, and
 * tear down cleanly. Runs against a real THREE.Group (no WebGL needed for
 * transforms).
 */

import { describe, it, expect } from 'vitest';
import { Group, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { Pose } from './qr-pose.js';
import { createQrDebugView } from './qr-debug-view.js';

const pose: Pose = { position: [1, 2, -3], rotation: [0, 0, 0, 1] };

/** The axis + cube hang off an internal WEBXR_TO_NUE basis node, not `parent`. */
function objectsOf(parent: Group): { axis: Object3D; cube: Object3D } {
  const basis = parent.children[0]!;
  return { axis: basis.children[0]!, cube: basis.children[1]! };
}

describe('createQrDebugView', () => {
  it('adds two hidden objects (axis + cube) under a basis node', () => {
    const parent = new Group();
    createQrDebugView(parent);
    // One internal basis node under the parent; axis + cube under that.
    expect(parent.children).toHaveLength(1);
    const { axis, cube } = objectsOf(parent);
    expect(axis.visible).toBe(false);
    expect(cube.visible).toBe(false);
  });

  /**
   * Why this test matters (scene-frame bug, Nth recurrence):
   * The QR pose is in RAW WebXR space (depth-unprojected), but `parent`
   * (arWorldGroup) local space is NUE. The objects must ride the SAME
   * `WEBXR_TO_NUE` basis the camera does, or they're East/North axis-swapped
   * and never line up with the camera/QR on a real device. A raw-WebXR point
   * [1,0,0] (East) must end up at NUE world [0,0,1] (East), via WEBXR_TO_NUE
   * (NUE_X=-WebXR_Z, NUE_Y=WebXR_Y, NUE_Z=WebXR_X).
   */
  it('places objects through the WEBXR_TO_NUE basis (rides the camera frame)', () => {
    const parent = new Group(); // arWorldGroup: identity, NUE local space
    const view = createQrDebugView(parent);
    view.update({ position: [1, 0, 0], rotation: [0, 0, 0, 1] }, 0.2);
    parent.updateMatrixWorld(true);

    const { axis } = objectsOf(parent);
    const world = new Vector3();
    axis.getWorldPosition(world);
    expect(world.x).toBeCloseTo(0, 6);
    expect(world.y).toBeCloseTo(0, 6);
    expect(world.z).toBeCloseTo(1, 6);
  });

  it('reveals + glues the objects to the pose at the measured size on update', () => {
    const parent = new Group();
    const view = createQrDebugView(parent);
    view.update(pose, 0.2);
    const { axis, cube } = objectsOf(parent);
    expect(axis.visible).toBe(true);
    expect(cube.visible).toBe(true);
    // Local pose under the basis node (the raw-WebXR coordinates).
    expect(cube.position.x).toBeCloseTo(1, 6);
    expect(cube.position.y).toBeCloseTo(2, 6);
    // In-plane span equals the measured size (depth is the thin slab dimension).
    expect(cube.scale.x).toBeCloseTo(0.2, 6);
    expect(cube.scale.y).toBeCloseTo(0.2, 6);
    expect(cube.scale.z).toBeLessThan(0.2);
  });

  it('shows the axis (pose only) but hides the cube when the size is unknown', () => {
    // Regression: a QR can lock before its depth size converges (sizeM null).
    // The axis must still appear so the user sees the detection is glued; the
    // cube waits for a measured size rather than drawing a NaN-scaled box.
    const parent = new Group();
    const view = createQrDebugView(parent);
    view.update(pose, null);
    const { axis, cube } = objectsOf(parent);
    expect(axis.visible).toBe(true);
    expect(axis.position.x).toBeCloseTo(1, 6);
    expect(cube.visible).toBe(false);
    // The cube must not have been scaled to a NaN/garbage size.
    expect(Number.isNaN(cube.scale.x)).toBe(false);
  });

  it('reveals the cube once a measured size arrives after an unknown-size update', () => {
    const parent = new Group();
    const view = createQrDebugView(parent);
    view.update(pose, null); // size not measured yet → axis only
    view.update(pose, 0.2); // size arrives → cube appears
    const { cube } = objectsOf(parent);
    expect(cube.visible).toBe(true);
    expect(cube.scale.x).toBeCloseTo(0.2, 6);
  });

  it('onPlaced fires after each written object, with the capture time, and only when one is given', () => {
    // Why this test matters: each update rewrites the raw pose from scratch,
    // so an app correcting AR content must re-date both objects after every
    // write; a call before the write, or one for the hidden cube, would
    // correct a pose that is about to be overwritten.
    const parent = new Group();
    const placed: Array<[Object3D, number, Vector3]> = [];
    const view = createQrDebugView(parent, {
      onPlaced: (object, capturedAt) =>
        placed.push([object, capturedAt, object.position.clone()]),
    });
    const { axis, cube } = objectsOf(parent);
    view.update(pose, null, 1000);
    expect(placed.map(([o, t]) => [o, t])).toEqual([[axis, 1000]]);
    expect(placed[0]![2].toArray()).toEqual([1, 2, -3]);
    view.update(pose, 0.2, 2000);
    expect(placed.slice(1).map(([o, t]) => [o, t])).toEqual([
      [axis, 2000],
      [cube, 2000],
    ]);
    // The cube is reported after its slab offset was applied.
    expect(placed[2]![2].z).toBeCloseTo(-3 - 0.005, 9);
    view.update(pose, 0.2);
    expect(placed).toHaveLength(3);
  });

  it('clear() hides without detaching; dispose() detaches', () => {
    const parent = new Group();
    const view = createQrDebugView(parent);
    view.update(pose, 0.2);
    view.clear();
    const { axis, cube } = objectsOf(parent);
    expect(axis.visible).toBe(false);
    expect(cube.visible).toBe(false);
    expect(parent.children).toHaveLength(1); // basis node still attached (no flicker)
    view.dispose();
    expect(parent.children).toHaveLength(0); // basis node (and its objects) removed
  });
});
