/**
 * Tests for the engine-free pointer-picking helper (2026-07-15 replay-harness
 * Part B).
 *
 * Why this test matters:
 * Desktop replay has no WebXR hit-test, so "click a real reconstructed surface →
 * world point" rests entirely on this helper. The two things that go wrong in
 * practice are (a) the pointer→NDC conversion (Y flip, rect offset, zero-size
 * rects → NaN) and (b) whether a ray through the pointer actually hits the mesh
 * and returns the correct WORLD point. Both are pinned here against a known
 * camera pose and a mesh at a known depth — with a non-origin camera so a missing
 * world transform could not pass.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  pointerToNdc,
  raycastPointer,
  pickWorldPoint,
} from './pointer-picking';

const RECT = { left: 0, top: 0, width: 100, height: 100 };

describe('pointerToNdc', () => {
  it('maps the rect centre to (0, 0)', () => {
    expect(pointerToNdc(50, 50, RECT)).toEqual({ x: 0, y: 0 });
  });

  it('maps top-left to (-1, +1) and bottom-right to (+1, -1) (Y is flipped)', () => {
    expect(pointerToNdc(0, 0, RECT)).toEqual({ x: -1, y: 1 });
    expect(pointerToNdc(100, 100, RECT)).toEqual({ x: 1, y: -1 });
  });

  it('honours a non-zero rect offset', () => {
    // A canvas not at the viewport origin: client (60,60) is the centre of a
    // 100×100 rect starting at (10,10).
    expect(
      pointerToNdc(60, 60, { left: 10, top: 10, width: 100, height: 100 })
    ).toEqual({ x: 0, y: 0 });
  });

  it('returns finite centre coords for a degenerate zero-size rect (no NaN)', () => {
    const ndc = pointerToNdc(5, 5, { left: 0, top: 0, width: 0, height: 0 });
    expect(Number.isNaN(ndc.x)).toBe(false);
    expect(Number.isNaN(ndc.y)).toBe(false);
  });
});

describe('raycastPointer / pickWorldPoint', () => {
  /**
   * A camera at (0, 0, 10) looking down −Z, and a 2×2×2 box centred at the
   * origin. A centre-pointer ray must hit the box's front face at z = +1. The
   * non-origin camera means a dropped world transform would move the hit.
   */
  function scene(): { camera: THREE.PerspectiveCamera; box: THREE.Mesh } {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial()
    );
    box.updateMatrixWorld(true);
    return { camera, box };
  }

  it('hits the mesh front face at the expected world point through the centre', () => {
    const { camera, box } = scene();
    const hit = raycastPointer(camera, { x: 0, y: 0 }, [box]);
    expect(hit).not.toBeNull();
    // Front face of a 2-unit box at the origin is z = +1; centre ray → (0,0,1).
    expect(hit!.point.x).toBeCloseTo(0, 5);
    expect(hit!.point.y).toBeCloseTo(0, 5);
    expect(hit!.point.z).toBeCloseTo(1, 5);
  });

  it('pickWorldPoint returns that same hit point', () => {
    const { camera, box } = scene();
    const point = pickWorldPoint(camera, { x: 0, y: 0 }, [box]);
    expect(point).not.toBeNull();
    expect(point!.z).toBeCloseTo(1, 5);
  });

  it('returns null when the ray misses every target', () => {
    const { camera, box } = scene();
    // A corner ray well outside the small box's silhouette misses it.
    expect(raycastPointer(camera, { x: 0.99, y: 0.99 }, [box])).toBeNull();
    expect(pickWorldPoint(camera, { x: 0.99, y: 0.99 }, [box])).toBeNull();
  });

  it('works against the invisible occlusion-mesh surface (colorWrite:false)', () => {
    // colorWrite:false (depth-only) must NOT stop THREE.Raycaster — the whole
    // Part B premise. Simulate the occluder material and confirm a hit.
    const { camera } = scene();
    const occluder = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial({ colorWrite: false })
    );
    occluder.updateMatrixWorld(true);
    const hit = raycastPointer(camera, { x: 0, y: 0 }, [occluder]);
    expect(hit).not.toBeNull();
    expect(hit!.point.z).toBeCloseTo(1, 5);
  });
});
