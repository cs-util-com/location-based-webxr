/**
 * Occupancy mesher — deterministic large-scene perf/memory harness (F3).
 *
 * Why this test matters (2026-06-30 occluder-tuning session, Finding 3): the
 * maintainer asked to *validate with performance tests* that meshing a
 * hundreds-of-metres grid does not blow up triangle/memory budgets, and to
 * bench the mesher strategies side-by-side "at scale" to decide which is
 * sensible long-term. The only prior large-grid measurement was the LOCAL-ONLY
 * real-zip probe (`occupancy-mesh-recording.integration.test.ts`, skipped in
 * CI). This harness is the CI-safe, deterministic counterpart: it builds a
 * known solid box slab of ~20k cells via {@link buildSyntheticSurfaceGrid} and
 * asserts DETERMINISTIC STRUCTURAL budgets (exact triangle/vertex/byte counts,
 * watertightness, linear bytes-per-cell), keeping wall-clock as an informational
 * (non-gating) probe — CI timing is machine-dependent.
 *
 * The cell COUNT is the scale proxy, not the physical extent: ~20k surface
 * cells is representative of a long walk's accumulated surfaces regardless of
 * the slab's metric size. Grid bounding/eviction is explicitly out of scope this
 * round (locked decision F3); this harness measures the *mesher*, not the grid's
 * unbounded growth.
 *
 * STRATEGY BENCH: `STRATEGIES` lists every selectable mesher mode. F2 ('smooth')
 * and F2b ('corner-fit') append here so all strategies are perf/quality-compared
 * in one run — the "which approach is most sensible at scale" bench the
 * maintainer asked for.
 */

import { describe, it, expect } from 'vitest';
import {
  meshOccupiedCells,
  type MeshOccupiedCellsOptions,
  type OccupancyMeshResult,
} from './occupancy-mesher';
import { buildSyntheticSurfaceGrid } from '../test-utils/synthetic-occupancy-grid';
import type { OccupancyGrid } from './occupancy-grid';

/**
 * The selectable mesher strategies, as a function of the grid (so the
 * centroid-consuming modes can bind `getCellPoint`). All four are benched
 * side-by-side; the per-face and greedy budgets stay the deterministic gate.
 */
const STRATEGIES: ReadonlyArray<{
  name: string;
  opts: (grid: OccupancyGrid) => MeshOccupiedCellsOptions | undefined;
}> = [
  { name: 'per-face', opts: () => undefined },
  { name: 'greedy', opts: () => ({ mode: 'greedy' }) },
  {
    name: 'smooth',
    opts: (grid) => ({
      mode: 'smooth',
      getCellPoint: (cell) => grid.getCellPoint(cell),
    }),
  },
  {
    name: 'corner-fit',
    opts: (grid) => ({
      mode: 'corner-fit',
      getCellPoint: (cell) => grid.getCellPoint(cell),
    }),
  },
];

/**
 * Even-edge-cover check (the watertight / closed-surface Z/2 invariant): every
 * edge of a closed triangle surface is shared by an even number of triangles.
 * Reconstructs edges from indices (topology-agnostic) and quantizes vertices to
 * the half-cell lattice the cube vertices live on. Returns the count of
 * odd-covered edges — 0 ⇔ watertight.
 */
function oddEdgeCount(
  positions: Float32Array,
  indices: Uint32Array,
  cellSizeM: number
): number {
  const half = cellSizeM / 2;
  const vkey = (vi: number): string => {
    const o = vi * 3;
    return `${Math.round(positions[o]! / half)},${Math.round(
      positions[o + 1]! / half
    )},${Math.round(positions[o + 2]! / half)}`;
  };
  const edges = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    for (const [u, v] of [
      [tri[0]!, tri[1]!],
      [tri[1]!, tri[2]!],
      [tri[2]!, tri[0]!],
    ] as const) {
      const ku = vkey(u);
      const kv = vkey(v);
      const e = ku < kv ? `${ku}|${kv}` : `${kv}|${ku}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  let odd = 0;
  for (const n of edges.values()) if (n % 2 !== 0) odd++;
  return odd;
}

const triangleCount = (m: OccupancyMeshResult): number => m.indices.length / 3;
const vertexCount = (m: OccupancyMeshResult): number => m.positions.length / 3;
const byteSize = (m: OccupancyMeshResult): number =>
  m.positions.byteLength + m.indices.byteLength;
const maxIndex = (indices: ArrayLike<number>): number => {
  let max = 0;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i]! > max) max = indices[i]!;
  }
  return max;
};

describe('occupancy mesher — deterministic large-scene perf/memory harness', () => {
  /**
   * Tiny hand-verifiable box first: a 2×1×2 solid slab has 4 cells and, by the
   * surface-area formula 2·(A·B + B·C + C·A) = 2·(2+2+4) = 16 faces ⇒ 32
   * triangles. Pins the helper's exactness before trusting it at scale.
   */
  it('builds an exact, watertight solid box (helper sanity)', () => {
    const { grid, cellCount, expectedPerFaceTriangles, cellSizeM } =
      buildSyntheticSurfaceGrid({ cellsX: 2, cellsZ: 2, thickness: 1 });
    expect(cellCount).toBe(4);
    expect(expectedPerFaceTriangles).toBe(32);
    expect(grid.size).toBe(4);

    const cells = grid.getOccupiedCells(5); // the 2026-06-30 minConfidence floor
    expect(cells.length).toBe(4);

    const perFace = meshOccupiedCells(cells, cellSizeM);
    expect(triangleCount(perFace)).toBe(expectedPerFaceTriangles);
    expect(perFace.aabbs.length).toBe(4);
    expect(oddEdgeCount(perFace.positions, perFace.indices, cellSizeM)).toBe(0);
  });

  /**
   * The centroid the cube mesher discards (and F2/F2b consume) is present and
   * correct: every observation for a cell lands at centre + the fixed sub-cell
   * offset, so getCellPoint() = centre + offset, ≠ centre, within cellSize/2.
   */
  it('exposes a known sub-cell centroid per cell (F2/F2b input)', () => {
    const { grid, cellSizeM, centroidOffsetM } = buildSyntheticSurfaceGrid({
      cellsX: 3,
      cellsZ: 3,
      thickness: 1,
    });
    // kBase = -(A + C + 16) = -22 for a 3×3 slab; cell (0,0,-22) exists.
    const cell = [0, 0, -22] as const;
    const centroid = grid.getCellPoint(cell);
    const centre = grid.getCellCenter(cell);
    expect(centroid).not.toBeNull();
    for (let a = 0; a < 3; a++) {
      // centroid hugs centre + offset…
      expect(centroid![a]).toBeCloseTo(centre[a] + centroidOffsetM[a]!, 6);
      // …and is a genuine sub-cell displacement (within cellSize/2, non-zero).
      expect(Math.abs(centroid![a] - centre[a])).toBeLessThan(cellSizeM / 2);
    }
    expect(centroidOffsetM.some((o) => o !== 0)).toBe(true);
  });

  /**
   * Large scale: ~20k surface cells. Deterministic structural budgets are the
   * gate; wall-clock is logged only. The strategy bench prints all modes'
   * numbers together so the maintainer can compare "at scale".
   */
  it(
    'meshes ~20k cells within deterministic triangle/memory budgets, all strategies benched',
    // 60 s: the harness needs ~28 s alone on a dev machine and vitest runs test
    // FILES in parallel, so full-suite load reliably pushed it past the old
    // 30 s limit (the budgets asserted below are deterministic counts, not
    // wall-clock — a generous timeout does not weaken the gate).
    { timeout: 60_000 },
    () => {
      const CELLS_PER_SIDE = 140; // 140×140×1 = 19,600 cells (≈ a long walk's surfaces)
      const { grid, cellCount, expectedPerFaceTriangles, cellSizeM } =
        buildSyntheticSurfaceGrid({
          cellsX: CELLS_PER_SIDE,
          cellsZ: CELLS_PER_SIDE,
          thickness: 1,
        });
      expect(grid.size).toBe(cellCount);

      const cells = grid.getOccupiedCells(5);
      expect(cells.length).toBe(cellCount);

      const bench = STRATEGIES.map(({ name, opts }) => {
        const t0 = performance.now();
        const mesh = meshOccupiedCells(cells, cellSizeM, opts(grid));
        const ms = performance.now() - t0;
        return { name, mesh, ms };
      });

      const perFace = bench.find((b) => b.name === 'per-face')!.mesh;
      const greedy = bench.find((b) => b.name === 'greedy')!.mesh;

      // --- Deterministic structural budgets (the gate) ---
      // Exact per-face triangles for the known solid box.
      expect(triangleCount(perFace)).toBe(expectedPerFaceTriangles);
      // Exact byte sizes follow from the count (4 verts/face, 6 indices/face).
      const faces = expectedPerFaceTriangles / 2;
      expect(perFace.positions.byteLength).toBe(faces * 4 * 3 * 4);
      expect(perFace.indices.byteLength).toBe(faces * 6 * 4);
      // One AABB per cell, every strategy; finite positions; in-range indices.
      for (const { mesh } of bench) {
        expect(mesh.aabbs.length).toBe(cellCount);
        expect(mesh.positions.every((p) => Number.isFinite(p))).toBe(true);
        const verts = vertexCount(mesh);
        // One computed maximum, not one `expect` per index (about 700k per
        // mesh, most of this test's time; gate-speed plan 2026-10-04, G3):
        // for non-negative integer indices it is the same claim.
        expect(maxIndex(mesh.indices)).toBeLessThan(verts);
      }
      // The 32-bit index regime this test is the only cover for: the per-face
      // mesh's highest index does not fit a 16-bit index buffer.
      expect(maxIndex(perFace.indices)).toBeGreaterThan(0xffff);
      // Per-face surface is watertight (closed box).
      expect(oddEdgeCount(perFace.positions, perFace.indices, cellSizeM)).toBe(
        0
      );
      // Greedy never adds triangles and stays non-empty.
      expect(triangleCount(greedy)).toBeGreaterThan(0);
      expect(triangleCount(greedy)).toBeLessThanOrEqual(triangleCount(perFace));
      // Smooth (dual-contouring surface nets) covers the full boundary — one
      // quad per crossing == one per exposed cube face — so at scale its triangle
      // count equals per-face, but with a much smaller (welded) vertex buffer.
      const smooth = bench.find((b) => b.name === 'smooth')!.mesh;
      expect(triangleCount(smooth)).toBe(triangleCount(perFace));
      expect(vertexCount(smooth)).toBeLessThan(vertexCount(perFace));
      // Corner-fit keeps the per-face topology (F2b "same face set") so its
      // triangle count equals per-face exactly — only the vertices are displaced
      // (and welded, so its vertex buffer is smaller).
      const cornerFit = bench.find((b) => b.name === 'corner-fit')!.mesh;
      expect(triangleCount(cornerFit)).toBe(triangleCount(perFace));
      expect(vertexCount(cornerFit)).toBeLessThan(vertexCount(perFace));
      // Absolute memory cap — catches a catastrophic blow-up at this scale.
      expect(byteSize(perFace)).toBeLessThan(8 * 1024 * 1024);

      // --- Strategy bench (informational; the maintainer's "compare at scale") ---
      console.info(
        '[occupancy-mesh F3 harness]',
        JSON.stringify(
          {
            cells: cellCount,
            cellSizeM,
            strategies: bench.map((b) => ({
              name: b.name,
              triangles: triangleCount(b.mesh),
              vertices: vertexCount(b.mesh),
              kib: +(byteSize(b.mesh) / 1024).toFixed(1),
              meshMs: +b.ms.toFixed(1),
            })),
            greedyReduction: +(
              triangleCount(perFace) / Math.max(1, triangleCount(greedy))
            ).toFixed(1),
          },
          null,
          0
        )
      );
    }
  );

  /**
   * Memory grows LINEARLY with explored surface, not catastrophically — the
   * core long-walk worry. For a one-cell sheet every cell contributes ~2 faces
   * regardless of scale, so bytes-per-cell stays ~constant across a 4× scale-up.
   * (A quadratic blow-up would make the larger grid's bytes/cell explode.)
   */
  it(
    'keeps per-face bytes-per-cell ~constant across a 4× scale-up (linear, not catastrophic)',
    { timeout: 30_000 },
    () => {
      const measure = (side: number): number => {
        const { grid, cellCount, cellSizeM } = buildSyntheticSurfaceGrid({
          cellsX: side,
          cellsZ: side,
          thickness: 1,
        });
        const mesh = meshOccupiedCells(grid.getOccupiedCells(5), cellSizeM);
        return byteSize(mesh) / cellCount;
      };
      const small = measure(70); // 4,900 cells
      const large = measure(140); // 19,600 cells (4×)
      // Within 20% — flat, not growing with scale.
      expect(large).toBeLessThan(small * 1.2);
      expect(large).toBeGreaterThan(small * 0.8);
    }
  );
});
