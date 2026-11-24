/**
 * Tests for `FrameTileVisualizer` — F3.3 of
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).
 *
 * Texture decoding is deliberately not exercised here: the class
 * accepts a pre-built `THREE.Texture` so tests run cleanly under
 * jsdom (no `createImageBitmap`). The decode + broken-frame filter
 * live in `wireFrameTileSubscribers` (F3.4).
 *
 * Coordinate frame (2026-06-13 fix,
 * [2026-06-12-1628-frame-tile-visualizer-frame-check-followup.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-12-1628-frame-tile-visualizer-frame-check-followup.md)):
 * `selectFrameTilesInWebXR` emits **raw WebXR** poses, so the
 * visualizer hangs tiles off a `WEBXR_TO_NUE` basis node under the
 * AR-space node (arWorldGroup) — the camera's `alignment × WEBXR_TO_NUE`
 * chain — NOT the scene root. The world-pose test below asserts this
 * under a *non-trivial* alignment, because (per lessons-learned)
 * identity fixtures hide a missing basis change.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { FrameTileVisualizer } from './frame-tile-visualizer';
import type { ArImageCapture } from 'gps-plus-slam-app-framework/core';
import { WEBXR_TO_NUE } from 'gps-plus-slam-app-framework/ar/webxr-nue-basis';

function makeFrame(overrides: Partial<ArImageCapture> = {}): ArImageCapture {
  return {
    imageFile: overrides.imageFile ?? 'frames/frame-000001.jpg',
    position: overrides.position ?? [1, 2, -3],
    rotation: overrides.rotation ?? [0, 0, 0, 1],
    screenRotation: overrides.screenRotation ?? 0,
    capturedAt: overrides.capturedAt,
    width: overrides.width,
    height: overrides.height,
  };
}

/** The basis node the visualizer parents all tiles under. */
function findBasisNode(parent: THREE.Object3D): THREE.Object3D {
  const node = parent.getObjectByName('frame-tile-basis');
  if (!node) {
    throw new Error('frame-tile-basis node not found under AR-space node');
  }
  return node;
}

function findTile(parent: THREE.Object3D, imageFile: string): THREE.Mesh {
  const mesh = parent.getObjectByName(`frame-tile-${imageFile}`);
  if (!(mesh instanceof THREE.Mesh)) {
    throw new Error(`tile mesh for "${imageFile}" not found`);
  }
  return mesh as THREE.Mesh;
}

describe('FrameTileVisualizer', () => {
  let arSpaceNode: THREE.Group;
  let texture: THREE.Texture;

  beforeEach(() => {
    arSpaceNode = new THREE.Group();
    texture = new THREE.Texture();
  });

  // Why: the AR-space correction dates each tile by its capture time, so
  // the hook must see the tile already in the scene with its raw pose, once
  // per new tile, and with the frame's own capturedAt (undefined for frames
  // recorded without one).
  it('onPlaced reports each new tile once, in the scene, with its capture time', () => {
    const placed: Array<[THREE.Object3D, number | undefined]> = [];
    const viz = new FrameTileVisualizer(arSpaceNode, {
      onPlaced: (tile, capturedAt) => {
        expect(tile.parent).toBe(findBasisNode(arSpaceNode));
        expect(tile.position.toArray()).toEqual([1, 2, -3]);
        placed.push([tile, capturedAt]);
      },
    });
    viz.addTile(makeFrame({ capturedAt: 1234 }), texture);
    viz.addTile(makeFrame({ capturedAt: 1234 }), texture); // same file: no-op
    viz.addTile(makeFrame({ imageFile: 'frames/old.jpg' }), texture);
    expect(placed).toEqual([
      [findTile(arSpaceNode, 'frames/frame-000001.jpg'), 1234],
      [findTile(arSpaceNode, 'frames/old.jpg'), undefined],
    ]);
  });

  // Why: every accepted add2dImage must produce one visible tile, and its
  // LOCAL pose must be the captured raw-WebXR pose verbatim (the basis
  // node, not the tile, carries the WebXR→NUE conversion).
  it('adds one mesh per frame with the captured pose applied verbatim (local)', () => {
    const viz = new FrameTileVisualizer(arSpaceNode);
    viz.addTile(makeFrame({ position: [1, 2, -3] }), texture);

    const mesh = findTile(arSpaceNode, 'frames/frame-000001.jpg');
    expect(mesh.position.toArray()).toEqual([1, 2, -3]);
    expect(mesh.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(mesh.name).toBe('frame-tile-frames/frame-000001.jpg');
    expect(viz.getCount()).toBe(1);
  });

  // Why: this is the bug the fix closes. The selector emits raw WebXR
  // poses; without the basis node under arWorldGroup the tiles are
  // East/North axis-swapped and detached from the alignment matrix.
  it('parents tiles under a WEBXR_TO_NUE basis node on the AR-space node', () => {
    const viz = new FrameTileVisualizer(arSpaceNode);
    const basis = findBasisNode(arSpaceNode);
    expect(basis.matrixAutoUpdate).toBe(false);
    expect(basis.matrix.toArray()).toEqual(WEBXR_TO_NUE.toArray());

    // The tile is a child of the basis node, not of the AR-space node.
    viz.addTile(makeFrame(), texture);
    const mesh = findTile(arSpaceNode, 'frames/frame-000001.jpg');
    expect(mesh.parent).toBe(basis);
    viz.dispose();
  });

  // Why: the decisive regression test. A tile's WORLD pose must ride the
  // same `alignment × WEBXR_TO_NUE × pose` chain as the camera. A
  // non-trivial alignment (rotation + translation) is mandatory — an
  // identity fixture passes even with the old scene-root parenting.
  it('tile world pose rides alignment × WEBXR_TO_NUE — the camera chain', () => {
    const scene = new THREE.Scene();
    const arWorldGroup = new THREE.Group();
    arWorldGroup.matrixAutoUpdate = false;
    const alignment = new THREE.Matrix4()
      .makeRotationY(Math.PI / 3)
      .setPosition(10, -2, 5);
    arWorldGroup.matrix.copy(alignment);
    scene.add(arWorldGroup);

    const viz = new FrameTileVisualizer(arWorldGroup);
    // A non-identity tile rotation so the test also catches a dropped or
    // doubled rotation in the chain.
    const tileRot = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI / 4
    );
    viz.addTile(
      makeFrame({
        imageFile: 'frames/a.jpg',
        position: [1, 0.5, -2], // raw WebXR
        rotation: [tileRot.x, tileRot.y, tileRot.z, tileRot.w],
      }),
      texture
    );
    scene.updateMatrixWorld(true);

    const mesh = findTile(arWorldGroup, 'frames/a.jpg');
    // decompose (not setFromMatrix*) so the tile's uniform scale is factored
    // out of the extracted rotation.
    const world = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    mesh.matrixWorld.decompose(world, worldQuat, new THREE.Vector3());
    // Hand-converted NUE position: NUE_X = -WebXR_Z = 2, NUE_Y = 0.5,
    // NUE_Z = WebXR_X = 1 — then alignment maps it into GPS world.
    const expectedPos = new THREE.Vector3(2, 0.5, 1).applyMatrix4(alignment);
    expect(world.x).toBeCloseTo(expectedPos.x);
    expect(world.y).toBeCloseTo(expectedPos.y);
    expect(world.z).toBeCloseTo(expectedPos.z);

    // World rotation = alignmentQuat × basisQuat × tileRot.
    const expectedQuat = new THREE.Quaternion()
      .setFromRotationMatrix(alignment)
      .multiply(new THREE.Quaternion().setFromRotationMatrix(WEBXR_TO_NUE))
      .multiply(tileRot);
    // Quaternions are sign-ambiguous; compare |dot| ≈ 1.
    expect(Math.abs(worldQuat.dot(expectedQuat))).toBeCloseTo(1);

    viz.dispose();
  });

  // Why: tile size is observable via mesh.scale because the geometry
  // is a unit plane shared across all tiles. Default 10 cm (halved from 20 cm,
  // D7) keeps tiles visible without dominating the scene / reading as a
  // camera "zoom in".
  it('scales the shared unit-plane geometry to the configured size (10 cm default)', () => {
    const viz = new FrameTileVisualizer(arSpaceNode);
    viz.addTile(makeFrame(), texture);
    const mesh = findTile(arSpaceNode, 'frames/frame-000001.jpg');
    expect(mesh.scale.toArray()).toEqual([0.1, 0.1, 0.1]);
  });

  it('honours an explicit sizeMeters option', () => {
    const viz = new FrameTileVisualizer(arSpaceNode, { sizeMeters: 0.5 });
    viz.addTile(makeFrame(), texture);
    const mesh = findTile(arSpaceNode, 'frames/frame-000001.jpg');
    expect(mesh.scale.toArray()).toEqual([0.5, 0.5, 0.5]);
  });

  // Why (Finding 1 / D1 of 2026-06-13-1311-frame-tile-rendering-bugs-user-feedback.md):
  // the raw JPEGs are captured at the camera aspect ratio (non-square), but
  // tiles were rendered on a hardcoded square plane, stretching the texture.
  // With persisted width/height the tile must be scaled non-uniformly so its
  // footprint matches the image shape — the LONGER edge equals sizeMeters so
  // wide frames never balloon.
  it('scales a LANDSCAPE frame so the wide edge = sizeMeters and height shrinks by aspect', () => {
    const viz = new FrameTileVisualizer(arSpaceNode, { sizeMeters: 0.2 });
    // 1920×1080 → aspect 16:9 ≈ 1.7778 (landscape)
    viz.addTile(makeFrame({ width: 1920, height: 1080 }), texture);
    const mesh = findTile(arSpaceNode, 'frames/frame-000001.jpg');
    const [x, y, z] = mesh.scale.toArray();
    expect(x).toBeCloseTo(0.2); // wide edge = sizeMeters
    expect(y).toBeCloseTo(0.2 * (1080 / 1920)); // 0.1125
    expect(z).toBeCloseTo(0.2);
    // The tile footprint reproduces the image aspect ratio.
    expect(x / y).toBeCloseTo(1920 / 1080);
    // Longer edge never exceeds sizeMeters.
    expect(Math.max(x, y)).toBeCloseTo(0.2);
  });

  it('scales a PORTRAIT frame so the tall edge = sizeMeters and width shrinks by aspect', () => {
    const viz = new FrameTileVisualizer(arSpaceNode, { sizeMeters: 0.2 });
    // 1080×1920 → portrait
    viz.addTile(makeFrame({ width: 1080, height: 1920 }), texture);
    const mesh = findTile(arSpaceNode, 'frames/frame-000001.jpg');
    const [x, y] = mesh.scale.toArray();
    expect(y).toBeCloseTo(0.2); // tall edge = sizeMeters
    expect(x).toBeCloseTo(0.2 * (1080 / 1920)); // 0.1125
    expect(y / x).toBeCloseTo(1920 / 1080);
    expect(Math.max(x, y)).toBeCloseTo(0.2);
  });

  // Why: legacy recordings (and any frame missing/with degenerate dimensions)
  // must not crash or distort — they fall back to the original square tile.
  it('falls back to a square tile when width/height are absent or non-positive', () => {
    const viz = new FrameTileVisualizer(arSpaceNode, { sizeMeters: 0.2 });
    viz.addTile(makeFrame({ imageFile: 'frames/legacy.jpg' }), texture); // no dims
    viz.addTile(
      makeFrame({ imageFile: 'frames/zero.jpg', width: 0, height: 1080 }),
      texture
    );
    expect(findTile(arSpaceNode, 'frames/legacy.jpg').scale.toArray()).toEqual([
      0.2, 0.2, 0.2,
    ]);
    expect(findTile(arSpaceNode, 'frames/zero.jpg').scale.toArray()).toEqual([
      0.2, 0.2, 0.2,
    ]);
  });

  // Why (Finding A / DA-1 of 2026-06-14 follow-up): legacy recordings predate the
  // persisted width/height fields, so frame.width/height are undefined. The
  // decoded texture's `.image` (an ImageBitmap in production) still carries the
  // true pixel dimensions — fall back to those so legacy tiles are aspect-correct
  // instead of square. Precedence: persisted → bitmap → square.
  it('falls back to the decoded texture.image dimensions when persisted dims are absent (DA-1)', () => {
    const viz = new FrameTileVisualizer(arSpaceNode, { sizeMeters: 0.2 });
    const bitmapTex = new THREE.Texture();
    // Production: texture.image is an ImageBitmap carrying real width/height.
    (
      bitmapTex as unknown as { image: { width: number; height: number } }
    ).image = { width: 1920, height: 1080 };
    // No persisted dims (legacy frame).
    viz.addTile(
      makeFrame({ imageFile: 'frames/legacy-landscape.jpg' }),
      bitmapTex
    );
    const [x, y, z] = findTile(
      arSpaceNode,
      'frames/legacy-landscape.jpg'
    ).scale.toArray();
    expect(x).toBeCloseTo(0.2); // wide edge = sizeMeters
    expect(y).toBeCloseTo(0.2 * (1080 / 1920)); // 0.1125
    expect(z).toBeCloseTo(0.2);
    expect(x / y).toBeCloseTo(1920 / 1080);
  });

  // Why: persisted dims stay authoritative (DA-1 precedence). When both the
  // persisted frame dims and the texture.image dims exist but disagree, the
  // persisted ones win — they are the recorded capture metadata, and Finding A
  // only fills the legacy gap, it does not replace D1's persisted dimensions.
  it('prefers persisted frame dims over texture.image dims when both exist (DA-1 precedence)', () => {
    const viz = new FrameTileVisualizer(arSpaceNode, { sizeMeters: 0.2 });
    const bitmapTex = new THREE.Texture();
    (
      bitmapTex as unknown as { image: { width: number; height: number } }
    ).image = { width: 1080, height: 1920 }; // portrait bitmap — must be IGNORED
    // Persisted landscape dims must win over the portrait bitmap.
    viz.addTile(
      makeFrame({ imageFile: 'frames/both.jpg', width: 1920, height: 1080 }),
      bitmapTex
    );
    const [x, y] = findTile(arSpaceNode, 'frames/both.jpg').scale.toArray();
    expect(x).toBeCloseTo(0.2); // landscape footprint from the persisted dims
    expect(y).toBeCloseTo(0.2 * (1080 / 1920));
  });

  // Why: defensive — a texture.image with non-positive / partial dimensions
  // (or a bare jsdom stub) must not distort; fall through to the square so a
  // tile can never collapse. Pins the final rung of the precedence chain.
  it('falls back to square when neither persisted nor texture.image dims are usable', () => {
    const viz = new FrameTileVisualizer(arSpaceNode, { sizeMeters: 0.2 });
    const stubTex = new THREE.Texture();
    (stubTex as unknown as { image: { width: number; height: number } }).image =
      { width: 0, height: 1080 }; // non-positive width
    viz.addTile(makeFrame({ imageFile: 'frames/stub.jpg' }), stubTex);
    expect(findTile(arSpaceNode, 'frames/stub.jpg').scale.toArray()).toEqual([
      0.2, 0.2, 0.2,
    ]);
  });

  // Why: the slice is append-only; a duplicate dispatch must not
  // produce a second mesh or leak a second material.
  it('is idempotent on duplicate imageFile keys', () => {
    const viz = new FrameTileVisualizer(arSpaceNode);
    viz.addTile(makeFrame({ imageFile: 'frames/dup.jpg' }), texture);
    viz.addTile(makeFrame({ imageFile: 'frames/dup.jpg' }), texture);
    const basis = findBasisNode(arSpaceNode);
    expect(basis.children).toHaveLength(1);
    expect(viz.getCount()).toBe(1);
  });

  // Why: replay restart clears the slice and the visualizer needs to
  // match — no leftover meshes, materials, or textures — but the basis
  // node must survive so the next attach can keep adding tiles.
  it('clear() removes every tile and disposes per-tile material + texture, keeping the basis node', () => {
    const viz = new FrameTileVisualizer(arSpaceNode);
    const tex = new THREE.Texture();
    viz.addTile(makeFrame(), tex);
    const mesh = findTile(arSpaceNode, 'frames/frame-000001.jpg');
    const material = mesh.material as THREE.MeshBasicMaterial;

    let materialDisposed = false;
    let textureDisposed = false;
    material.addEventListener('dispose', () => {
      materialDisposed = true;
    });
    tex.addEventListener('dispose', () => {
      textureDisposed = true;
    });

    viz.clear();

    const basis = findBasisNode(arSpaceNode);
    expect(basis.children).toHaveLength(0);
    expect(viz.getCount()).toBe(0);
    expect(materialDisposed).toBe(true);
    expect(textureDisposed).toBe(true);

    // The visualizer is reused after a store-swap clear(): a fresh tile
    // must still land under the surviving basis node.
    viz.addTile(makeFrame({ imageFile: 'frames/after-clear.jpg' }), texture);
    expect(viz.getCount()).toBe(1);
    expect(findTile(arSpaceNode, 'frames/after-clear.jpg').parent).toBe(basis);
  });

  // --- maxTiles FIFO cap (Step 4 of the 2026-07-03 long-session fps plan) ---
  // Why these tests matter: each tile is one draw call + one GPU texture,
  // added forever on a long live walk (112–145 frames in the 2026-07-02
  // corpus). The cap must evict OLDEST-first (keep the recent-path
  // breadcrumb), actually release GPU resources, and stay out of the way when
  // 0/omitted (replay wiring relies on that for full-path coverage auditing).

  it('evicts the oldest tile (mesh removed, texture+material disposed) when adding over maxTiles', () => {
    const viz = new FrameTileVisualizer(arSpaceNode, { maxTiles: 2 });
    const tex1 = new THREE.Texture();
    let tex1Disposed = false;
    tex1.addEventListener('dispose', () => {
      tex1Disposed = true;
    });
    viz.addTile(makeFrame({ imageFile: 'frames/f1.jpg' }), tex1);
    const mesh1 = findTile(arSpaceNode, 'frames/f1.jpg');
    const mat1 = mesh1.material as THREE.MeshBasicMaterial;
    let mat1Disposed = false;
    mat1.addEventListener('dispose', () => {
      mat1Disposed = true;
    });
    viz.addTile(makeFrame({ imageFile: 'frames/f2.jpg' }), new THREE.Texture());
    expect(viz.getCount()).toBe(2);

    // Third tile crosses the cap: f1 (the oldest) must go, f2 + f3 stay.
    viz.addTile(makeFrame({ imageFile: 'frames/f3.jpg' }), new THREE.Texture());
    expect(viz.getCount()).toBe(2);
    const basis = findBasisNode(arSpaceNode);
    expect(basis.getObjectByName('frame-tile-frames/f1.jpg')).toBeUndefined();
    expect(basis.getObjectByName('frame-tile-frames/f2.jpg')).toBeDefined();
    expect(basis.getObjectByName('frame-tile-frames/f3.jpg')).toBeDefined();
    expect(tex1Disposed).toBe(true);
    expect(mat1Disposed).toBe(true);

    // FIFO continues: a fourth tile evicts f2.
    viz.addTile(makeFrame({ imageFile: 'frames/f4.jpg' }), new THREE.Texture());
    expect(basis.getObjectByName('frame-tile-frames/f2.jpg')).toBeUndefined();
    expect(viz.getCount()).toBe(2);
  });

  it('maxTiles 0 (or omitted) means unlimited — the replay contract', () => {
    const unlimited = new FrameTileVisualizer(arSpaceNode, { maxTiles: 0 });
    for (let i = 0; i < 10; i++) {
      unlimited.addTile(
        makeFrame({ imageFile: `frames/u${i}.jpg` }),
        new THREE.Texture()
      );
    }
    expect(unlimited.getCount()).toBe(10);
    unlimited.dispose();

    const omitted = new FrameTileVisualizer(arSpaceNode);
    for (let i = 0; i < 10; i++) {
      omitted.addTile(
        makeFrame({ imageFile: `frames/o${i}.jpg` }),
        new THREE.Texture()
      );
    }
    expect(omitted.getCount()).toBe(10);
    omitted.dispose();
  });

  it('a non-finite or negative maxTiles is treated as unlimited (defensive)', () => {
    const viz = new FrameTileVisualizer(arSpaceNode, { maxTiles: -3 });
    for (let i = 0; i < 5; i++) {
      viz.addTile(
        makeFrame({ imageFile: `frames/n${i}.jpg` }),
        new THREE.Texture()
      );
    }
    expect(viz.getCount()).toBe(5);
    viz.dispose();
  });

  // Why (D2 geometry-elimination — 2026-06-13 upside-down report): the user
  // reported tiles render *vertically flipped* while the raw JPEG on disk is
  // upright (not mirrored, not 90°). The leading cause is the
  // `ImageBitmap`/`THREE.Texture` `flipY` gotcha at the DECODE step, but a
  // competing cause is the geometry/basis chain producing a plane whose "up"
  // points down. This test EXONERATES the geometry path so the fix can land at
  // decode with confidence: for an upright capture (identity rotation,
  // screenRotation = 0 — the configuration of the reported frames), the tile's
  // local +Y must map to world +Y through the `WEBXR_TO_NUE` basis chain. If it
  // did NOT (e.g. mapped to -Y), the upside-down would be geometric and a
  // texture-only flip would be wrong. It maps to +Y here, so the remaining flip
  // is purely texture-space. (Headless jsdom cannot rasterise the actual flip —
  // see the parent doc's Finding 2 feasibility caveat — so we assert the
  // transform, not pixels.)
  it('geometry has no vertical flip: an upright capture maps local +Y to world +Y (D2 elimination)', () => {
    const viz = new FrameTileVisualizer(arSpaceNode);
    viz.addTile(
      // Identity rotation + screenRotation 0 = the reported frames' config.
      makeFrame({ rotation: [0, 0, 0, 1], screenRotation: 0 }),
      texture
    );
    arSpaceNode.updateMatrixWorld(true);

    const mesh = findTile(arSpaceNode, 'frames/frame-000001.jpg');
    const worldUp = new THREE.Vector3(0, 1, 0).transformDirection(
      mesh.matrixWorld
    );
    // +Y, not -Y: the plane is upright. The reported flip is therefore in the
    // texture-upload path (decoder), not the geometry — driving Option 2-A.
    expect(worldUp.x).toBeCloseTo(0);
    expect(worldUp.y).toBeCloseTo(1);
    expect(worldUp.z).toBeCloseTo(0);
  });

  // Why: dispose is the end-of-life path; unlike clear() it also detaches
  // the basis node so re-entering AR doesn't leak an empty group on
  // arWorldGroup each cycle.
  it('dispose() clears tiles and detaches the basis node', () => {
    const viz = new FrameTileVisualizer(arSpaceNode);
    viz.addTile(makeFrame(), texture);
    viz.dispose();
    expect(viz.getCount()).toBe(0);
    expect(arSpaceNode.children).toHaveLength(0);
    expect(arSpaceNode.getObjectByName('frame-tile-basis')).toBeUndefined();
  });
});
