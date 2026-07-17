/**
 * @vitest-environment jsdom
 *
 * Tests for `OccupancyCubesVisualizer` (occupancy-grid port plan Iter 5;
 * AR-space reparenting fix Iter 7).
 *
 * Why this test matters:
 * The cubes are the only on-device feedback for whether the whole
 * depth→unprojection→grid pipeline produces geometry in the right place.
 * The instanced mesh must mirror the grid's occupied cells exactly while
 * under the cap, fall back to a deterministic (injected-RNG) random
 * subset above it, and release GPU resources on dispose. Crucially the
 * cells are raw-WebXR coordinates, so each cube's WORLD pose must ride
 * the same `alignment × WEBXR_TO_NUE` chain as the camera — asserted
 * here with a non-trivial alignment per the lessons-learned rule that
 * identity fixtures hide missing basis changes.
 */

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  OccupancyCubesVisualizer,
  type OccupancyGridSource,
} from './occupancy-cubes-visualizer';
import type { GridCell } from '../ar/bresenham3d';
import { WEBXR_TO_NUE } from '../ar/webxr-nue-basis';

function makeGridSource(
  cells: GridCell[],
  cellSizeM = 0.15,
  getCellColor: OccupancyGridSource['getCellColor'] = () => null,
  getCellPoint?: OccupancyGridSource['getCellPoint']
): OccupancyGridSource & { getOccupiedCells: ReturnType<typeof vi.fn> } {
  return {
    getOccupiedCells: vi.fn(() => cells),
    getCellCenter: (cell: GridCell) =>
      [cell[0] * cellSizeM, cell[1] * cellSizeM, cell[2] * cellSizeM] as const,
    getCellColor,
    // Optional: when absent, the visualizer falls back to getCellCenter — the
    // legacy behavior the other tests still assert.
    ...(getCellPoint ? { getCellPoint } : {}),
  };
}

function findMesh(parent: THREE.Object3D): THREE.InstancedMesh {
  const mesh = parent.getObjectByName('occupancy-cubes');
  if (!(mesh instanceof THREE.InstancedMesh)) {
    throw new Error('occupancy-cubes InstancedMesh not under parent');
  }
  // instanceof narrows to InstancedMesh<any, any, any>; pin the default
  // generics so the return type is lint-safe.
  return mesh as THREE.InstancedMesh;
}

describe('OccupancyCubesVisualizer', () => {
  it('adds an empty instanced mesh to the AR-space node on construction', () => {
    const arSpaceNode = new THREE.Group();
    const visualizer = new OccupancyCubesVisualizer(arSpaceNode);
    const mesh = findMesh(arSpaceNode);
    expect(mesh.parent).toBe(arSpaceNode);
    expect(mesh.count).toBe(0);
    expect(visualizer.getCount()).toBe(0);
    visualizer.dispose();
  });

  it('setVisible toggles the mesh visibility live without clearing it', () => {
    // The mesh-view controller flips this to hide/show cubes without a re-mesh.
    const arSpaceNode = new THREE.Group();
    const visualizer = new OccupancyCubesVisualizer(arSpaceNode);
    const mesh = findMesh(arSpaceNode);
    expect(mesh.visible).toBe(true);
    visualizer.setVisible(false);
    expect(mesh.visible).toBe(false);
    visualizer.setVisible(true);
    expect(mesh.visible).toBe(true);
    visualizer.dispose();
  });

  it('carries the WebXR→NUE basis change as the mesh local matrix', () => {
    // The grid's cells are raw WebXR while the AR-space node (arWorldGroup)
    // is AR-odometry NUE — the mesh must hold the same static basis change
    // the camera gets from basisChangeNode, or East/North end up swapped
    // (the hit-test-reticle bug all over again).
    const arSpaceNode = new THREE.Group();
    const visualizer = new OccupancyCubesVisualizer(arSpaceNode);
    const mesh = findMesh(arSpaceNode);
    expect(mesh.matrixAutoUpdate).toBe(false);
    expect(mesh.matrix.toArray()).toEqual(WEBXR_TO_NUE.toArray());
    visualizer.dispose();
  });

  it('draws one cube per occupied cell at the cell center, scaled to the debug cube size (0.025 m)', () => {
    const arSpaceNode = new THREE.Group();
    const visualizer = new OccupancyCubesVisualizer(arSpaceNode);
    const grid = makeGridSource(
      [
        [0, 0, -10],
        [2, 1, -4],
      ],
      0.5
    );

    visualizer.refresh(grid);
    const mesh = findMesh(arSpaceNode);
    expect(mesh.count).toBe(2);

    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    mesh.getMatrixAt(1, matrix);
    matrix.decompose(pos, quat, scale);
    expect(pos.toArray()).toEqual([1, 0.5, -2]); // cell · cellSizeM, raw WebXR
    // debug size, NOT cellSizeM (float32 instance buffer → closeTo)
    for (const s of scale.toArray()) {
      expect(s).toBeCloseTo(0.025);
    }

    visualizer.dispose();
  });

  it('draws the cube at the exact per-cell point when the grid provides one (Item A)', () => {
    // With getCellPoint present, the cube sits at the real surface point, NOT
    // the lattice center (cell [0,0,-1] · 0.5 would be [0,0,-0.5]).
    const arSpaceNode = new THREE.Group();
    const visualizer = new OccupancyCubesVisualizer(arSpaceNode);
    const exact = [0.07, -0.03, -0.42] as const;
    visualizer.refresh(
      makeGridSource(
        [[0, 0, -1]],
        0.5,
        () => null,
        () => exact
      )
    );
    const mesh = findMesh(arSpaceNode);
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    mesh.getMatrixAt(0, matrix);
    pos.setFromMatrixPosition(matrix);
    expect(pos.x).toBeCloseTo(0.07);
    expect(pos.y).toBeCloseTo(-0.03);
    expect(pos.z).toBeCloseTo(-0.42);
    visualizer.dispose();
  });

  it('honors a custom cubeSizeM', () => {
    const arSpaceNode = new THREE.Group();
    const visualizer = new OccupancyCubesVisualizer(arSpaceNode, {
      cubeSizeM: 0.05,
    });
    visualizer.refresh(makeGridSource([[0, 0, -1]]));
    const mesh = findMesh(arSpaceNode);
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    mesh.getMatrixAt(0, matrix);
    scale.setFromMatrixScale(matrix);
    for (const s of scale.toArray()) {
      expect(s).toBeCloseTo(0.05); // float32 instance buffer → closeTo
    }
    visualizer.dispose();
  });

  it('cube world pose rides alignment × WEBXR_TO_NUE — the same chain as the camera', () => {
    // Non-trivial alignment fixture (lessons-learned: identity/axis-aligned
    // fixtures hide missing or doubled basis transforms), asserted on the
    // WORLD pose, not local coordinates.
    const scene = new THREE.Scene();
    const arWorldGroup = new THREE.Group();
    arWorldGroup.matrixAutoUpdate = false;
    const alignment = new THREE.Matrix4()
      .makeRotationY(Math.PI / 3)
      .setPosition(10, -2, 5);
    arWorldGroup.matrix.copy(alignment);
    scene.add(arWorldGroup);

    const visualizer = new OccupancyCubesVisualizer(arWorldGroup);
    visualizer.refresh(makeGridSource([[2, 1, -4]], 0.5)); // center (1, 0.5, -2) raw WebXR
    scene.updateMatrixWorld(true);

    const mesh = findMesh(arWorldGroup);
    const instance = new THREE.Matrix4();
    mesh.getMatrixAt(0, instance);
    const world = new THREE.Vector3().setFromMatrixPosition(
      instance.premultiply(mesh.matrixWorld)
    );

    // Hand-converted NUE center: NUE_X = -WebXR_Z = 2, NUE_Y = 0.5,
    // NUE_Z = WebXR_X = 1 — then the alignment maps it into GPS world.
    const expected = new THREE.Vector3(2, 0.5, 1).applyMatrix4(alignment);
    expect(world.x).toBeCloseTo(expected.x);
    expect(world.y).toBeCloseTo(expected.y);
    expect(world.z).toBeCloseTo(expected.z);

    visualizer.dispose();
  });

  it('forwards minObservations to the grid query', () => {
    const scene = new THREE.Scene();
    const visualizer = new OccupancyCubesVisualizer(scene, {
      minObservations: 3,
    });
    const grid = makeGridSource([]);
    visualizer.refresh(grid);
    expect(grid.getOccupiedCells).toHaveBeenCalledWith(3);
    visualizer.dispose();
  });

  it('draws a deterministic random subset when over the instance cap', () => {
    const scene = new THREE.Scene();
    // rng() === 0 always picks the next remaining element → first N cells
    const visualizer = new OccupancyCubesVisualizer(scene, {
      maxInstances: 2,
      rng: () => 0,
    });
    const grid = makeGridSource([
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ]);

    visualizer.refresh(grid);
    const mesh = findMesh(scene);
    expect(mesh.count).toBe(2);

    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    mesh.getMatrixAt(0, matrix);
    pos.setFromMatrixPosition(matrix);
    expect(pos.x).toBeCloseTo(1 * 0.15);
    mesh.getMatrixAt(1, matrix);
    pos.setFromMatrixPosition(matrix);
    expect(pos.x).toBeCloseTo(2 * 0.15);

    visualizer.dispose();
  });

  it('draws the cells nearest the viewer when over the cap and a pose is supplied (Issue B1)', () => {
    // The defining B1 behavior: over cap, spend the budget on the local
    // neighbourhood instead of a room-wide random scatter. Two near cells
    // sit ~0.15 m from the eye; two far cells sit ~15 m away. With cap 2 and
    // the eye at the origin, only the near pair must survive.
    const scene = new THREE.Scene();
    const visualizer = new OccupancyCubesVisualizer(scene, { maxInstances: 2 });
    const near1: GridCell = [1, 0, 0];
    const near2: GridCell = [0, 1, 0];
    const far1: GridCell = [100, 0, 0];
    const far2: GridCell = [0, 0, 100];
    // Far cells listed first to prove ordering, not input position, decides.
    const grid = makeGridSource([far1, near1, far2, near2], 0.15);

    visualizer.refresh(grid, { cameraPos: [0, 0, 0] });
    const mesh = findMesh(scene);
    expect(mesh.count).toBe(2);

    // Both drawn cubes belong to the near cluster (|pos| ≈ 0.15 m), so every
    // far cell was dropped.
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      pos.setFromMatrixPosition(matrix);
      expect(pos.length()).toBeLessThan(1);
    }
    visualizer.dispose();
  });

  it('drops cells beyond the over-cap radius even when the cap has room (Step 1.1, 2026-07-03 fps plan)', () => {
    // Why this test matters: the radius pre-filter is what bounds the
    // over-cap refresh cost by the viewer's neighbourhood instead of the
    // whole session. Cells beyond overCapRadiusM must vanish BY DESIGN even
    // when the instance budget could fit them — otherwise the sort would
    // still walk every cell ever seen.
    const scene = new THREE.Scene();
    const visualizer = new OccupancyCubesVisualizer(scene, {
      maxInstances: 3,
      overCapRadiusM: 10,
    });
    const near1: GridCell = [1, 0, 0]; // 0.15 m
    const near2: GridCell = [0, 1, 0]; // 0.15 m
    // 100 · 0.15 m = 15 m > 10 m radius; the 4-cell grid is over the cap of 3.
    const far1: GridCell = [100, 0, 0];
    const far2: GridCell = [0, 0, 100];
    const grid = makeGridSource([far1, near1, far2, near2], 0.15);

    visualizer.refresh(grid, { cameraPos: [0, 0, 0] });
    // Capacity 3, but only the 2 within-radius cells are drawn.
    expect(visualizer.getCount()).toBe(2);
    visualizer.dispose();
  });

  it('a non-positive overCapRadiusM opts out of the radius bound (legacy nearest-N)', () => {
    const scene = new THREE.Scene();
    const visualizer = new OccupancyCubesVisualizer(scene, {
      maxInstances: 3,
      overCapRadiusM: 0,
    });
    const cells: GridCell[] = [
      [1, 0, 0],
      [0, 1, 0],
      [100, 0, 0],
      [0, 0, 100],
    ];
    visualizer.refresh(makeGridSource(cells, 0.15), { cameraPos: [0, 0, 0] });
    // Unbounded: the cap (3) is filled even though two cells are ~15 m away.
    expect(visualizer.getCount()).toBe(3);
    visualizer.dispose();
  });

  it('snapshots via the grid windowed query when available (Step 2 chunk index)', () => {
    // Why this test matters: with getOccupiedCellsWithin the refresh cost is
    // bounded by the neighbourhood via the chunk index — the O(N) full-grid
    // walk (getOccupiedCells) must not run at all when the grid offers the
    // windowed query and a finite pose exists.
    const scene = new THREE.Scene();
    const visualizer = new OccupancyCubesVisualizer(scene, {
      minObservations: 3,
      overCapRadiusM: 12,
    });
    const near: GridCell = [1, 0, 0];
    const base = makeGridSource([near], 0.15);
    const getOccupiedCellsWithin = vi.fn(() => [near]);
    const grid = { ...base, getOccupiedCellsWithin };

    visualizer.refresh(grid, { cameraPos: [0, 0, 0] });

    expect(getOccupiedCellsWithin).toHaveBeenCalledWith([0, 0, 0], 12, 3);
    expect(base.getOccupiedCells).not.toHaveBeenCalled();
    expect(visualizer.getCount()).toBe(1);
    visualizer.dispose();
  });

  it('falls back to the full snapshot without a pose or with the radius opted out', () => {
    const scene = new THREE.Scene();
    const cells: GridCell[] = [[1, 0, 0]];
    // No pose: the windowed query has no center to window around.
    const noPoseViz = new OccupancyCubesVisualizer(scene, {
      overCapRadiusM: 12,
    });
    const base1 = makeGridSource(cells, 0.15);
    const windowed1 = vi.fn(() => cells);
    noPoseViz.refresh({ ...base1, getOccupiedCellsWithin: windowed1 });
    expect(windowed1).not.toHaveBeenCalled();
    expect(base1.getOccupiedCells).toHaveBeenCalledTimes(1);
    noPoseViz.dispose();

    // Radius 0 (legacy unbounded): windowing is explicitly off.
    const unboundedViz = new OccupancyCubesVisualizer(scene, {
      overCapRadiusM: 0,
    });
    const base2 = makeGridSource(cells, 0.15);
    const windowed2 = vi.fn(() => cells);
    unboundedViz.refresh(
      { ...base2, getOccupiedCellsWithin: windowed2 },
      { cameraPos: [0, 0, 0] }
    );
    expect(windowed2).not.toHaveBeenCalled();
    expect(base2.getOccupiedCells).toHaveBeenCalledTimes(1);
    unboundedViz.dispose();
  });

  it('ignores the pose and draws every cell while under the cap', () => {
    // Locality only kicks in over the cap; under it, a supplied pose must not
    // change the "draw everything" behavior.
    const scene = new THREE.Scene();
    const visualizer = new OccupancyCubesVisualizer(scene);
    visualizer.refresh(
      makeGridSource([
        [0, 0, -1],
        [5, 0, 0],
      ]),
      {
        cameraPos: [0, 0, 0],
      }
    );
    expect(visualizer.getCount()).toBe(2);
    visualizer.dispose();
  });

  it('falls back to the random subset when the viewer pose is non-finite (Issue B1 guard)', () => {
    // A tracking glitch can hand us a NaN pose. Ranking by NaN would silently
    // produce garbage, so a non-finite pose must fall back to the legacy
    // injected-RNG random subset (rng() === 0 → the first N cells).
    const scene = new THREE.Scene();
    const visualizer = new OccupancyCubesVisualizer(scene, {
      maxInstances: 2,
      rng: () => 0,
    });
    const grid = makeGridSource([
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ]);

    visualizer.refresh(grid, { cameraPos: [Number.NaN, 0, 0] });
    const mesh = findMesh(scene);
    expect(mesh.count).toBe(2);

    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    mesh.getMatrixAt(0, matrix);
    pos.setFromMatrixPosition(matrix);
    expect(pos.x).toBeCloseTo(1 * 0.15);
    mesh.getMatrixAt(1, matrix);
    pos.setFromMatrixPosition(matrix);
    expect(pos.x).toBeCloseTo(2 * 0.15);

    visualizer.dispose();
  });

  /**
   * Why this test matters (port plan Iter 8 — RGB voxel coloring):
   * When the grid carries a per-cell camera color, the cube must show it;
   * cells without color (rgb option off, pre-Iter-8 recordings) must keep
   * the height ramp. A regression here silently renders every voxel with
   * the fallback, which looks plausible and would only be caught on-device.
   */
  it('uses the grid cell color when available, height ramp otherwise', () => {
    const arSpaceNode = new THREE.Group();
    const visualizer = new OccupancyCubesVisualizer(arSpaceNode);
    const colored: GridCell = [0, 0, -1];
    const uncolored: GridCell = [0, -10, 0]; // low → blue-ish ramp
    visualizer.refresh(
      makeGridSource([colored, uncolored], 0.15, (cell) =>
        cell === colored ? ([51, 102, 255] as const) : null
      )
    );
    const mesh = findMesh(arSpaceNode);

    const rgb = new THREE.Color();
    mesh.getColorAt(0, rgb);
    expect(rgb.r).toBeCloseTo(51 / 255, 2);
    expect(rgb.g).toBeCloseTo(102 / 255, 2);
    expect(rgb.b).toBeCloseTo(1, 2);

    const fallback = new THREE.Color();
    mesh.getColorAt(1, fallback);
    expect(fallback.b).toBeGreaterThan(fallback.r); // height ramp, not rgb

    visualizer.dispose();
  });

  it('assigns per-instance height-based colors', () => {
    const scene = new THREE.Scene();
    const visualizer = new OccupancyCubesVisualizer(scene);
    visualizer.refresh(
      makeGridSource([
        [0, -10, 0],
        [0, 30, 0],
      ])
    );
    const mesh = findMesh(scene);
    expect(mesh.instanceColor).not.toBeNull();

    const low = new THREE.Color();
    const high = new THREE.Color();
    mesh.getColorAt(0, low);
    mesh.getColorAt(1, high);
    // Low cells are blue-ish, high cells red-ish
    expect(low.b).toBeGreaterThan(low.r);
    expect(high.r).toBeGreaterThan(high.b);

    visualizer.dispose();
  });

  it('clear hides all cubes but keeps the mesh for the next refresh', () => {
    const scene = new THREE.Scene();
    const visualizer = new OccupancyCubesVisualizer(scene);
    visualizer.refresh(makeGridSource([[0, 0, -1]]));
    expect(visualizer.getCount()).toBe(1);

    visualizer.clear();
    expect(visualizer.getCount()).toBe(0);
    expect(scene.getObjectByName('occupancy-cubes')).toBeDefined();

    visualizer.refresh(makeGridSource([[0, 0, -2]]));
    expect(visualizer.getCount()).toBe(1);
    visualizer.dispose();
  });

  it('dispose removes the mesh from the scene and releases GPU resources', () => {
    const scene = new THREE.Scene();
    const visualizer = new OccupancyCubesVisualizer(scene);
    const mesh = findMesh(scene);
    const meshDispose = vi.spyOn(mesh, 'dispose');
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose');
    const materialDispose = vi.spyOn(
      mesh.material as THREE.Material,
      'dispose'
    );

    visualizer.dispose();
    expect(scene.getObjectByName('occupancy-cubes')).toBeUndefined();
    expect(meshDispose).toHaveBeenCalled();
    expect(geometryDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();

    // refresh after dispose is a safe no-op
    expect(() =>
      visualizer.refresh(makeGridSource([[0, 0, -1]]))
    ).not.toThrow();
  });
});
