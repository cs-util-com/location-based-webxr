/**
 * Occupancy Grid Tests.
 *
 * Why this test matters:
 * OccupancyGrid is the TS port of the Unity PointCloudData voxel grid —
 * the persisted depth-sample stream is folded into occupied 15 cm cells
 * with free-space carving. These tests pin the port's deliberate
 * deviations from Unity: per-cell observation counts (instead of render
 * buffer indices), skipping carving when camera and point share a cell
 * (instead of Unity's carve-then-re-add), and the round-consistent
 * getCellCenter formula (NOT Unity's +half-cell offset).
 */

import { describe, it, expect } from 'vitest';
import { mat4 } from 'gl-matrix';
import type { Matrix4, Vector3 } from 'gps-plus-slam-js';
import type { DepthSample } from '../types/ar-types';
import {
  OccupancyGrid,
  DEFAULT_OCCUPANCY_CELL_SIZE_M,
  DEFAULT_OCCUPANCY_MIN_OBSERVATIONS,
} from './occupancy-grid';

const PROJECTION: Matrix4 = Array.from(
  mat4.perspective(mat4.create(), Math.PI / 3, 16 / 9, 0.1, 1000)
) as unknown as Matrix4;

/**
 * Build a DepthSample with an identity-rotation camera, so a center-screen
 * point at depth d unprojects to cameraPos + (0, 0, -d).
 */
function makeSample(
  cameraPos: Vector3,
  depths: number[],
  options?: { withMatrix?: boolean }
): DepthSample {
  const withMatrix = options?.withMatrix ?? true;
  return {
    timestamp: 0,
    cameraPos,
    cameraRot: [0, 0, 0, 1],
    points: depths.map((depthM) => ({ screenX: 0.5, screenY: 0.5, depthM })),
    ...(withMatrix ? { projectionMatrix: PROJECTION } : {}),
  };
}

/**
 * Build a single-cell sample (center-screen point) carrying an optional
 * per-point color — the Iter-8 RGB voxel-coloring shape.
 */
function makeColoredSample(
  cameraPos: Vector3,
  depthM: number,
  rgb?: readonly [number, number, number]
): DepthSample {
  return {
    timestamp: 0,
    cameraPos,
    cameraRot: [0, 0, 0, 1],
    points: [{ screenX: 0.5, screenY: 0.5, depthM, ...(rgb ? { rgb } : {}) }],
    projectionMatrix: PROJECTION,
  };
}

describe('OccupancyGrid', () => {
  describe('construction', () => {
    it('defaults to 15 cm cells and carve stop distance 2 (Unity parity)', () => {
      const grid = new OccupancyGrid();
      expect(grid.cellSizeM).toBeCloseTo(0.15);
      expect(grid.carveStopCells).toBe(2);
      expect(grid.size).toBe(0);
    });

    it('rejects invalid configuration', () => {
      expect(() => new OccupancyGrid({ cellSizeM: 0 })).toThrow(RangeError);
      expect(() => new OccupancyGrid({ cellSizeM: NaN })).toThrow(RangeError);
      expect(() => new OccupancyGrid({ carveStopCells: -1 })).toThrow(
        RangeError
      );
      expect(() => new OccupancyGrid({ carveStopCells: 1.5 })).toThrow(
        RangeError
      );
    });
  });

  describe('cell colors (Iter 8 RGB voxel coloring)', () => {
    /**
     * Why these tests matter:
     * The per-cell running-average color is what the cube visualizer
     * renders; the contract has two subtle parts a naive implementation
     * gets wrong: (1) color-less observations (rgb option off, old
     * recordings) must increment the OBSERVATION count without diluting
     * the color average toward black; (2) the average must be a true
     * per-channel mean of however many colored observations arrived.
     */
    it('returns null for unknown cells and for cells observed without color', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      expect(grid.getCellColor([0, 0, -5])).toBeNull();
      grid.addSample(makeColoredSample([0, 0, 0], 5)); // no rgb
      expect(grid.getCellColor([0, 0, -5])).toBeNull();
    });

    it('stores a single colored observation verbatim', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeColoredSample([0, 0, 0], 5, [120, 45, 200]));
      expect(grid.getCellColor([0, 0, -5])).toEqual([120, 45, 200]);
    });

    it('averages repeated colored observations per channel (rounded)', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeColoredSample([0, 0, 0], 5, [100, 0, 10]));
      grid.addSample(makeColoredSample([0, 0, 0], 5, [200, 100, 15]));
      expect(grid.getCellColor([0, 0, -5])).toEqual([150, 50, 13]); // 12.5 → 13
    });

    it('color-less observations do not dilute the average', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeColoredSample([0, 0, 0], 5, [100, 100, 100]));
      grid.addSample(makeColoredSample([0, 0, 0], 5)); // observed, no rgb
      expect(grid.getCellColor([0, 0, -5])).toEqual([100, 100, 100]);
      // …while the observation count still advanced to 2
      expect(grid.getOccupiedCells(2)).toContainEqual([0, 0, -5]);
    });

    it('ignores non-finite color channels defensively (bad persisted data)', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(
        makeColoredSample([0, 0, 0], 5, [NaN, 10, 10] as unknown as readonly [
          number,
          number,
          number,
        ])
      );
      expect(grid.getCellColor([0, 0, -5])).toBeNull();
    });

    it('clear() drops colors with the cells', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeColoredSample([0, 0, 0], 5, [1, 2, 3]));
      grid.clear();
      expect(grid.getCellColor([0, 0, -5])).toBeNull();
    });
  });

  describe('cell points (exact surface points — follow-up Item A)', () => {
    /**
     * Why these tests matter:
     * `getCellPoint` is what the COLMAP `points3D` export and the debug cubes
     * draw, instead of the 15 cm-lattice `getCellCenter`. The contract: it is
     * the running-average of the EXACT unprojected points that fell in the
     * cell (hugging the real surface), it differs from the cell center, and it
     * always stays inside the cell (|point − center| ≤ cellSizeM/2 per axis).
     */
    it('returns null for an unknown cell', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      expect(grid.getCellPoint([0, 0, -5])).toBeNull();
    });

    it('returns the exact unprojected point, NOT the cell center', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      // depth 5.3 at center screen → exact point [0,0,-5.3]; it quantizes to
      // cell [0,0,-5] whose center is [0,0,-5].
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      const cell: Vector3 = [0, 0, -5];
      expect(grid.getCellCenter(cell)).toEqual([0, 0, -5]);
      const point = grid.getCellPoint(cell)!;
      expect(point[0]).toBeCloseTo(0, 6);
      expect(point[1]).toBeCloseTo(0, 6);
      expect(point[2]).toBeCloseTo(-5.3, 6); // exact, not the -5 center
      // …and it lies inside the cell.
      expect(
        Math.abs(point[2] - grid.getCellCenter(cell)[2])
      ).toBeLessThanOrEqual(grid.cellSizeM / 2);
    });

    it('averages the exact points of repeated observations in a cell', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      // 5.2 and 5.4 both quantize to cell [0,0,-5]; centroid z = -5.3.
      grid.addSample(makeSample([0, 0, 0], [5.2]));
      grid.addSample(makeSample([0, 0, 0], [5.4]));
      const point = grid.getCellPoint([0, 0, -5])!;
      expect(point[2]).toBeCloseTo(-5.3, 6);
    });

    it('carving that deletes a cell resets its retained point', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 0 });
      // Observe a cell at -5, then see a surface BEYOND it (-8) so the ray
      // passes through the -5 cell and carves it away as free space.
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      expect(grid.getCellPoint([0, 0, -5])).not.toBeNull();
      grid.addSample(makeSample([0, 0, 0], [8.0])); // ray passes through -5 cell
      expect(grid.getCellPoint([0, 0, -5])).toBeNull();
    });

    it('clear() drops retained points with the cells', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      grid.clear();
      expect(grid.getCellPoint([0, 0, -5])).toBeNull();
    });
  });

  describe('addSample', () => {
    it('adds an occupied cell per unprojected point and returns the count', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      // Two points on diverging rays (different screen positions), landing
      // in two distinct cells. (Same-ray points within a sample no longer
      // carve each other — see the point-order-independence test below.)
      const sample: DepthSample = {
        timestamp: 0,
        cameraPos: [0, 0, 0],
        cameraRot: [0, 0, 0, 1],
        points: [
          { screenX: 0.5, screenY: 0.5, depthM: 5 },
          { screenX: 0.9, screenY: 0.5, depthM: 8 },
        ],
        projectionMatrix: PROJECTION,
      };
      const added = grid.addSample(sample);
      expect(added).toBe(2);
      expect(grid.size).toBe(2);
      expect(grid.getOccupiedCells()).toContainEqual([0, 0, -5]);
    });

    it('skips all points of samples without a projectionMatrix (old recordings)', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      const added = grid.addSample(
        makeSample([0, 0, 0], [5], { withMatrix: false })
      );
      expect(added).toBe(0);
      expect(grid.size).toBe(0);
    });

    it('skips invalid depth points (zero, negative, non-finite)', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      const added = grid.addSample(makeSample([0, 0, 0], [0, -2, NaN, 4]));
      expect(added).toBe(1);
      expect(grid.getOccupiedCells()).toEqual([[0, 0, -4]]);
    });

    it('skips samples with a non-finite camera position', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      const added = grid.addSample(makeSample([NaN, 0, 0], [5]));
      expect(added).toBe(0);
      expect(grid.size).toBe(0);
    });

    it('counts repeated observations of the same cell', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      grid.addSample(makeSample([0, 0, 0], [5]));
      expect(grid.size).toBe(1);
      expect(grid.getOccupiedCells(2)).toEqual([[0, 0, -5]]);
    });

    it('does not carve the observed cell on re-observation (carve stop distance)', () => {
      // Unity parity: the carve ray stops carveStopCells dominant-axis
      // steps before the endpoint, so the endpoint's count accumulates
      // instead of being reset by carve-then-re-add.
      const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 2 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      grid.addSample(makeSample([0, 0, 0], [5]));
      expect(grid.getOccupiedCells(2)).toHaveLength(1);
    });

    it('keeps the cell when camera and point share it (deliberate Unity deviation)', () => {
      // Unity would carve the shared cell and immediately re-add it,
      // resetting per-cell state; the TS port skips carving instead (§2
      // edge case in the port plan).
      const grid = new OccupancyGrid({ cellSizeM: 10 });
      grid.addSample(makeSample([0, 0, 0], [2]));
      grid.addSample(makeSample([0, 0, 0], [2]));
      expect(grid.size).toBe(1);
      expect(grid.getOccupiedCells(2)).toHaveLength(1);
    });

    it('carves a previously observed cell when the scene is later seen through', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 2 });
      // Surface at 5 m, then the surface disappears and a wall at 10 m
      // becomes visible along the same ray: the 5 m cell must be carved.
      grid.addSample(makeSample([0, 0, 0], [5]));
      expect(grid.getOccupiedCells()).toContainEqual([0, 0, -5]);
      grid.addSample(makeSample([0, 0, 0], [10]));
      expect(grid.getOccupiedCells()).not.toContainEqual([0, 0, -5]);
      expect(grid.getOccupiedCells()).toContainEqual([0, 0, -10]);
    });

    it('is independent of point order within a sample (endpoints survive same-sample carving)', () => {
      // Two points on the SAME center-screen ray at 5 and 10 cells, in one
      // sample. With a single carve+increment pass the outcome depends on
      // iteration order: if the near point is incremented before the far
      // point's ray is carved, the far ray erases the near endpoint.
      // Carving runs as a first pass so neither order can erase the other's
      // endpoint — both survive. (Deeper-carves-nearer still applies ACROSS
      // samples, see the test above.)
      const near: Vector3 = [0, 0, -5];
      const far: Vector3 = [0, 0, -10];

      const nearFirst = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 2 });
      nearFirst.addSample(makeSample([0, 0, 0], [5, 10]));

      const farFirst = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 2 });
      farFirst.addSample(makeSample([0, 0, 0], [10, 5]));

      for (const grid of [nearFirst, farFirst]) {
        expect(grid.getOccupiedCells()).toContainEqual(near);
        expect(grid.getOccupiedCells()).toContainEqual(far);
      }
    });
  });

  describe('confidence-guarded carving (carveConfidenceThreshold)', () => {
    // Why these tests matter: the 2026-07-16 synthetic-scene investigation
    // proved that plain carving erodes ESTABLISHED silhouette cells under a
    // perfect sensor (H1b churn) and that noisy/bled endpoints can sweep
    // through confirmed surfaces. The guard stops a carve ray at the first
    // cell whose observation count has reached the threshold — an
    // established surface (and anything behind it) can no longer be erased
    // by a single deeper reading. Default OFF (undefined) preserves the
    // exact legacy behaviour.

    it('default: a deeper reading erases nearer established cells (legacy baseline)', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 2 });
      for (let i = 0; i < 3; i++) grid.addSample(makeSample([0, 0, 0], [5]));
      grid.addSample(makeSample([0, 0, 0], [10]));
      expect(grid.getOccupiedCells()).not.toContainEqual([0, 0, -5]);
    });

    it('stops the carve at an established cell and protects everything behind it', () => {
      const grid = new OccupancyGrid({
        cellSizeM: 1,
        carveStopCells: 2,
        carveConfidenceThreshold: 3,
      });
      // Establish the 5 m cell (count 3 = threshold)…
      for (let i = 0; i < 3; i++) grid.addSample(makeSample([0, 0, 0], [5]));
      // …and one observation of a 7 m cell behind it (the guarded carve of
      // the 7 m ray stops AT the 5 m cell; the endpoint increment still runs).
      grid.addSample(makeSample([0, 0, 0], [7]));
      expect(grid.getOccupiedCells()).toContainEqual([0, 0, -5]);
      expect(grid.getOccupiedCells()).toContainEqual([0, 0, -7]);
      // A deeper reading to 10 m must erase NEITHER the established 5 m cell
      // (guard) NOR the 7 m cell behind it (trace stopped).
      grid.addSample(makeSample([0, 0, 0], [10]));
      expect(grid.getOccupiedCells()).toContainEqual([0, 0, -5]);
      expect(grid.getOccupiedCells()).toContainEqual([0, 0, -7]);
      expect(grid.getOccupiedCells()).toContainEqual([0, 0, -10]);
    });

    it('still carves cells below the threshold', () => {
      const grid = new OccupancyGrid({
        cellSizeM: 1,
        carveStopCells: 2,
        carveConfidenceThreshold: 3,
      });
      // Only 2 observations — not established, a deeper reading erases it.
      grid.addSample(makeSample([0, 0, 0], [5]));
      grid.addSample(makeSample([0, 0, 0], [5]));
      grid.addSample(makeSample([0, 0, 0], [10]));
      expect(grid.getOccupiedCells()).not.toContainEqual([0, 0, -5]);
      expect(grid.getOccupiedCells()).toContainEqual([0, 0, -10]);
    });

    it('exposes the threshold for runtime feature detection', () => {
      // Consumers in the closed-source Investigation repo probe this field
      // to decide whether the installed framework supports the guard (see
      // lessons-learned: types see source, runtime sees the published dist).
      const guarded = new OccupancyGrid({ carveConfidenceThreshold: 5 });
      expect(guarded.carveConfidenceThreshold).toBe(5);
      const legacy = new OccupancyGrid();
      expect(legacy.carveConfidenceThreshold).toBeUndefined();
      expect(Object.hasOwn(legacy, 'carveConfidenceThreshold')).toBe(true);
    });

    it('rejects a non-positive or non-integer threshold', () => {
      expect(() => new OccupancyGrid({ carveConfidenceThreshold: 0 })).toThrow(
        RangeError
      );
      expect(() => new OccupancyGrid({ carveConfidenceThreshold: -3 })).toThrow(
        RangeError
      );
      expect(
        () => new OccupancyGrid({ carveConfidenceThreshold: 2.5 })
      ).toThrow(RangeError);
    });
  });

  describe('getOccupiedCells / getCellCenter', () => {
    it('filters by minimum observation count', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      grid.addSample(makeSample([0, 0, 0], [5]));
      // Second cell from a sideways-shifted camera (separate ray)
      grid.addSample(makeSample([10, 0, 0], [8]));
      expect(grid.getOccupiedCells()).toHaveLength(2);
      expect(grid.getOccupiedCells(2)).toEqual([[0, 0, -5]]);
    });

    it('returns the round-consistent cell center (cell · cellSizeM)', () => {
      // Deliberately NOT Unity's CellToWorldPos (+cellSize/2), which is
      // off by half a cell under round-quantization (§2 of the port plan).
      const grid = new OccupancyGrid({ cellSizeM: 0.5 });
      expect(grid.getCellCenter([2, -4, 0])).toEqual([1, -2, 0]);
    });
  });

  describe('raycast', () => {
    // A large carve stop keeps carving out of the way: these tests need
    // two occupied cells on one straight test ray, which depth samples on
    // that same ray would otherwise carve away.
    function gridWithCellsAt5And8(): OccupancyGrid {
      const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 10 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      grid.addSample(makeSample([0, 0, 0], [8]));
      return grid;
    }

    it('returns the center of the first occupied cell along the ray', () => {
      const hit = gridWithCellsAt5And8().raycast([0, 0, 0], [0, 0, -20]);
      expect(hit).toEqual([0, 0, -5]);
    });

    it('returns null when no occupied cell is on the ray', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      expect(grid.raycast([10, 10, 10], [10, 10, -20])).toBeNull();
      expect(grid.raycast([0, 0, 0], [NaN, 0, -20])).toBeNull();
    });

    it('respects a minimum observation count', () => {
      const grid = gridWithCellsAt5And8();
      grid.addSample(makeSample([0, 0, 0], [8]));
      expect(grid.raycast([0, 0, 0], [0, 0, -20], 2)).toEqual([0, 0, -8]);
    });
  });

  describe('key-range envelope hardening (PR #144/#145/#147 reviews)', () => {
    // Why these tests matter: the packed numeric cell key is only collision-free
    // within ±65 535 per axis (±9.83 km at the 0.15 m default). Beyond that the
    // base-2^17 encoding ALIASES — e.g. key([0, 65537, z]) === key([1, −65535, z])
    // and key([0, 65536, z]) === key([1, 0, z]) — so an unguarded out-of-envelope
    // lookup would return an unrelated cell's data (wrong-but-plausible, worse
    // than null) and an out-of-envelope carve walk would DELETE unrelated
    // in-range records. Stored keys were already guarded (addSample endpoint
    // check); these pin the same envelope on the public lookups and the
    // camera-side carve.

    it('getCellPoint/getCellColor return null for an out-of-envelope cell even when its packed key aliases an occupied cell', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      // Occupy [1, −65535, −2] (in range; −65535 is the envelope edge).
      grid.addSample(makeColoredSample([1, -65535, 0], 2, [10, 20, 30]));
      expect(grid.getCellPoint([1, -65535, -2])).not.toBeNull();
      expect(grid.getCellColor([1, -65535, -2])).not.toBeNull();
      // [0, 65537, −2] is out of envelope and packs to the SAME key.
      expect(grid.getCellPoint([0, 65537, -2])).toBeNull();
      expect(grid.getCellColor([0, 65537, -2])).toBeNull();
    });

    it('raycast returns null instead of an aliased hit when an endpoint cell is out of envelope', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([1, -65535, 0], [2])); // occupies [1, −65535, −2]
      // The ray's cells [0, 65537, z] alias [1, −65535, z] — without the guard
      // this "hits" and reports a bogus far-away center.
      expect(grid.raycast([0, 65537, 3], [0, 65537, -20])).toBeNull();
    });

    it('an out-of-envelope camera cell does not carve aliased in-range cells', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      // Occupy [1, −65535, −5] (in range; the alias target of [0, 65537, −5]).
      grid.addSample(makeSample([1, -65535, 0], [5]));
      expect(grid.getCellPoint([1, -65535, -5])).not.toBeNull();
      // A camera ~65 540 cells up, looking straight DOWN (−Z rotated onto −Y),
      // observing a point 10 cells below: the carve walk from the
      // out-of-envelope camera cell [0, 65540, −5] passes [0, 65537, −5], whose
      // packed key aliases [1, −65535, −5] — an unguarded carve deletes it.
      const downLooking: DepthSample = {
        timestamp: 0,
        cameraPos: [0, 65540, -5],
        cameraRot: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
        points: [{ screenX: 0.5, screenY: 0.5, depthM: 10 }],
        projectionMatrix: PROJECTION,
      };
      grid.addSample(downLooking);
      // The unrelated in-range cell must survive the far sample.
      expect(grid.getCellPoint([1, -65535, -5])).not.toBeNull();
    });
  });

  describe('clear', () => {
    it('empties the grid', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      expect(grid.size).toBe(1);
      grid.clear();
      expect(grid.size).toBe(0);
      expect(grid.getOccupiedCells()).toEqual([]);
    });
  });

  /**
   * Why this matters: a long session re-observes already-mapped surfaces for
   * minutes. `getRevision()` lets consumers (cube refresh / occluder re-mesh)
   * skip their O(cells) re-derive when the occupied set can no longer change —
   * the dominant idle-time saving. It must bump while a cell could still cross
   * some `minConfidence` threshold (count ≤ 10), then go quiet.
   */
  describe('getRevision — settled-scene skip signal', () => {
    it('starts at 0', () => {
      expect(new OccupancyGrid().getRevision()).toBe(0);
    });

    it('bumps while count ≤ 10 (possible threshold crossings), then stays put', () => {
      const grid = new OccupancyGrid();
      expect(grid.getRevision()).toBe(0);

      // 1st observation creates the cell (count 1) → bump.
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      const r1 = grid.getRevision();
      expect(r1).toBeGreaterThan(0);

      // Observations 2..10 raise the count through 10 — each a possible
      // threshold crossing → each bumps.
      for (let i = 0; i < 9; i++) grid.addSample(makeSample([0, 0, 0], [5.3]));
      const r10 = grid.getRevision();
      expect(r10).toBe(r1 + 9);

      // The 11th pushes count past 10; from here re-observing the SETTLED cell
      // can change no consumer's occupied set → no more bumps.
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      expect(grid.getRevision()).toBe(r10);
    });

    it('bumps on clear when non-empty (and not when already empty)', () => {
      const grid = new OccupancyGrid();
      expect(grid.getRevision()).toBe(0);
      grid.clear(); // empty → no-op
      expect(grid.getRevision()).toBe(0);

      grid.addSample(makeSample([0, 0, 0], [5.3]));
      const r = grid.getRevision();
      grid.clear();
      expect(grid.getRevision()).toBe(r + 1);
    });
  });

  describe('getOccupiedCells snapshot memoization (Step 1.2, 2026-07-03 fps plan)', () => {
    // Why these tests matter: with cubes + occluder both on, every throttled
    // refresh triggers TWO identical full-grid walks with the same
    // minConfidence floor. Memoizing the last (revision, minObservations) →
    // array halves that scan+alloc cost with zero interface churn — but the
    // cache must never serve a stale set after a mutation, and must not be
    // used for floors the revision counter does not track (> 10).

    it('returns the identical array for a repeated same-floor call on an unchanged grid', () => {
      const grid = new OccupancyGrid();
      grid.addSample(makeSample([0, 0, 0], [5.3, 4.2]));
      const first = grid.getOccupiedCells(1);
      const second = grid.getOccupiedCells(1);
      expect(second).toBe(first); // same instance — the second walk was skipped
    });

    it('does not serve the cache across different minObservations floors', () => {
      const grid = new OccupancyGrid();
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      const atOne = grid.getOccupiedCells(1);
      const atTwo = grid.getOccupiedCells(2);
      expect(atTwo).not.toBe(atOne);
      expect(atOne).toHaveLength(1);
      expect(atTwo).toHaveLength(1); // the cell has 2 observations
      expect(grid.getOccupiedCells(3)).toHaveLength(0);
    });

    it('invalidates on every occupied-set mutation (add, carve, clear)', () => {
      const grid = new OccupancyGrid();
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      const first = grid.getOccupiedCells(1);
      expect(first).toHaveLength(1);

      // Add: a new endpoint cell must appear.
      grid.addSample(makeSample([0, 0, 0], [2.0]));
      const afterAdd = grid.getOccupiedCells(1);
      expect(afterAdd).not.toBe(first);
      expect(afterAdd).toHaveLength(2);

      // Carve: a deeper ray through the 2 m cell deletes it (carve runs
      // before increment, and the endpoint protection only covers the new
      // endpoint) — the snapshot must reflect the removal.
      grid.addSample(makeSample([0, 0, 0], [8.0]));
      const afterCarve = grid.getOccupiedCells(1);
      expect(afterCarve).not.toBe(afterAdd);

      // Clear: empty snapshot.
      grid.clear();
      expect(grid.getOccupiedCells(1)).toHaveLength(0);
    });

    it('getOccupiedCellsFlat matches the tuple API and returns a FRESH array every call (Step 1.3)', () => {
      // Why this test matters: the flat snapshot feeds packMeshRequest, which
      // TRANSFERS its buffer to the mesh worker (detaching it). Serving a
      // cached/shared array would detach the grid's own state — so unlike
      // getOccupiedCells, every call must mint a new Int32Array. Content-wise
      // it must be exactly the tuple snapshot, flattened, both when the tuple
      // memo is warm (post-cubes-refresh order) and cold.
      const grid = new OccupancyGrid();
      grid.addSample(makeSample([0, 0, 0], [5.3, 4.2, 2.0]));

      // Cold: no tuple walk has happened at this floor yet.
      const flatCold = grid.getOccupiedCellsFlat(1);
      const tuples = grid.getOccupiedCells(1);
      expect(Array.from(flatCold)).toEqual(tuples.flat());

      // Warm: the tuple memo is populated now; flat must agree and be fresh.
      const flatWarm = grid.getOccupiedCellsFlat(1);
      expect(Array.from(flatWarm)).toEqual(tuples.flat());
      expect(flatWarm).not.toBe(flatCold);

      // Floor filtering matches the tuple API.
      expect(Array.from(grid.getOccupiedCellsFlat(2))).toEqual(
        grid.getOccupiedCells(2).flat()
      );
      expect(grid.getOccupiedCellsFlat(99)).toHaveLength(0);
    });

    it('does not memoize floors above the revision-tracked maximum (10)', () => {
      // Once a cell's count passes 10, further observations no longer bump
      // the revision — so a floor > 10 keyed on the revision could go stale.
      // Such floors are simply never cached.
      const grid = new OccupancyGrid();
      for (let i = 0; i < 11; i++) {
        grid.addSample(makeSample([0, 0, 0], [5.3]));
      }
      // Count is 11 < 12: not occupied at floor 12.
      expect(grid.getOccupiedCells(12)).toHaveLength(0);
      // One more settled observation (no revision bump) pushes count to 12.
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      // A revision-keyed cache would still say "empty"; the uncached walk
      // must see the crossing.
      expect(grid.getOccupiedCells(12)).toHaveLength(1);
    });
  });

  describe('viewer-local window via the chunk index (Step 2, 2026-07-03 fps plan)', () => {
    // Why these tests matter: getOccupiedCellsWithin is what bounds the
    // cubes/occluder refresh cost by the local neighbourhood instead of the
    // whole session — its result must be EXACTLY the brute-force
    // radius-filter of getOccupiedCells (the property test hammers this),
    // it must track carving (the chunk index must never serve deleted
    // cells), and clear() must reset the index.

    /** Brute-force reference: meter-space center-distance filter. */
    function bruteForceWithin(
      grid: OccupancyGrid,
      center: readonly [number, number, number],
      radiusM: number,
      minObservations = 1
    ) {
      return grid.getOccupiedCells(minObservations).filter((cell) => {
        const c = grid.getCellCenter(cell);
        const dx = c[0] - center[0];
        const dy = c[1] - center[1];
        const dz = c[2] - center[2];
        return dx * dx + dy * dy + dz * dz <= radiusM * radiusM;
      });
    }

    it('returns exactly the cells whose centers lie within the radius', () => {
      // carveStopCells 20 disables carving between these collinear samples
      // (both rays run along -z from the origin; a default carve would erase
      // the near cell when the deep sample lands).
      const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 20 });
      // Cells at z = -2 and z = -9 (depths 2 and 9 from the origin).
      grid.addSample(makeSample([0, 0, 0], [2]));
      grid.addSample(makeSample([0, 0, 0], [9]));
      expect(grid.getOccupiedCells()).toHaveLength(2);

      const near = grid.getOccupiedCellsWithin([0, 0, 0], 5);
      expect(near).toEqual([[0, 0, -2]]);
      // The window is a pure filter — the unbounded API is untouched.
      expect(grid.getOccupiedCells()).toHaveLength(2);
      // A window around the far cell sees only it.
      expect(grid.getOccupiedCellsWithin([0, 0, -9], 3)).toEqual([[0, 0, -9]]);
    });

    it('respects the minObservations floor', () => {
      // carveStopCells 5: the depth-4 ray must not carve the z=-2 cell.
      const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 5 });
      grid.addSample(makeSample([0, 0, 0], [2]));
      grid.addSample(makeSample([0, 0, 0], [2]));
      grid.addSample(makeSample([0, 0, 0], [4]));
      expect(grid.getOccupiedCellsWithin([0, 0, 0], 10, 2)).toEqual([
        [0, 0, -2],
      ]);
    });

    it('never serves a carved cell (the chunk index tracks deletions)', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 2 });
      grid.addSample(makeSample([0, 0, 0], [3]));
      expect(grid.getOccupiedCellsWithin([0, 0, -3], 1)).toHaveLength(1);
      // A deeper ray carves the z=-3 cell away (3 ≥ carveStopCells before 9).
      grid.addSample(makeSample([0, 0, 0], [9]));
      expect(grid.getOccupiedCellsWithin([0, 0, -3], 1)).toHaveLength(0);
      expect(bruteForceWithin(grid, [0, 0, -3], 1)).toHaveLength(0);
    });

    it('clear() empties the window and the flat variant matches the tuple one', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [2, 5]));
      const tuples = grid.getOccupiedCellsWithin([0, 0, 0], 100);
      const flat = grid.getOccupiedCellsWithinFlat([0, 0, 0], 100);
      expect(Array.from(flat)).toEqual(tuples.flat());
      grid.clear();
      expect(grid.getOccupiedCellsWithin([0, 0, 0], 100)).toHaveLength(0);
      expect(grid.getOccupiedCellsWithinFlat([0, 0, 0], 100)).toHaveLength(0);
    });

    it('rejects invalid radii and degrades non-finite centers to an empty result', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [2]));
      // Programmer error: a windowed query with no window is a bug upstream.
      expect(() => grid.getOccupiedCellsWithin([0, 0, 0], 0)).toThrow(
        RangeError
      );
      expect(() => grid.getOccupiedCellsWithin([0, 0, 0], -1)).toThrow(
        RangeError
      );
      expect(() => grid.getOccupiedCellsWithin([0, 0, 0], NaN)).toThrow(
        RangeError
      );
      // Sensor glitch: a NaN camera position yields nothing rather than
      // throwing mid-session (mirrors raycast's non-finite policy).
      expect(grid.getOccupiedCellsWithin([NaN, 0, 0], 5)).toHaveLength(0);
    });

    it('bumps a per-chunk revision on mutations inside that chunk only', () => {
      // Why: the per-chunk dirty counters are the bookkeeping a later
      // dirty-chunk remesh needs (worker plan Phase-2 sketch) — landing them
      // with the index makes that a consumer-side change only.
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      // Two observations far apart land in different 16³ chunks.
      grid.addSample(makeSample([0, 0, 0], [2])); // cell [0,0,-2] → chunk [0,0,-1]
      grid.addSample(makeSample([0, 0, 0], [40])); // cell [0,0,-40] → chunk [0,0,-3]
      const nearChunk: [number, number, number] = [0, 0, -1];
      const farChunk: [number, number, number] = [0, 0, -3];
      const near1 = grid.getChunkRevision(nearChunk);
      const far1 = grid.getChunkRevision(farChunk);
      expect(near1).toBeGreaterThan(0);
      expect(far1).toBeGreaterThan(0);

      // Re-observing the near cell bumps ONLY the near chunk.
      grid.addSample(makeSample([0, 0, 0], [2]));
      expect(grid.getChunkRevision(nearChunk)).toBeGreaterThan(near1);
      expect(grid.getChunkRevision(farChunk)).toBe(far1);

      // An untouched chunk reports 0.
      expect(grid.getChunkRevision([50, 50, 50])).toBe(0);
    });
  });

  describe('recommended reconstruction defaults', () => {
    /**
     * Why this test matters: these two constants are the single framework-level
     * source of truth the Recorder AND the PhysicsDemo inherit for voxel size +
     * noise floor (2026-07-15 FAST-reconstruction tuning). Pinning the values
     * guards an accidental drift, and constructing a grid with the cell-size
     * proves it is a valid (in-range, non-throwing) grid parameter — the app
     * defaults can never ship a value the grid rejects.
     */
    it('pin the FAST-reconstruction voxel size (18 cm) and noise floor (3)', () => {
      // 2026-07-16 sweep: speed comes from the 18 cm voxel; the noise floor stays
      // at 3 because floaters (phantom colliders) are set by the floor, not the
      // voxel size (mc 3 ≈ 1.9% vs mc 2 ≈ 3.5%).
      expect(DEFAULT_OCCUPANCY_CELL_SIZE_M).toBe(0.18);
      expect(DEFAULT_OCCUPANCY_MIN_OBSERVATIONS).toBe(3);
    });

    it('the recommended cell size constructs a valid grid', () => {
      const grid = new OccupancyGrid({
        cellSizeM: DEFAULT_OCCUPANCY_CELL_SIZE_M,
      });
      expect(grid.cellSizeM).toBe(0.18);
    });
  });
});
