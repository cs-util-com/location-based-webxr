/**
 * Smooth-mesher ORACLE property test.
 *
 * Why this test matters (2026-07-17 perf loop, iteration 2): the 'smooth'
 * surface-nets builder was rewritten onto `PackedKeyHash` (ordinal-indexed
 * occupied table, eagerly resolved centroids, incremental corner keys) for a
 * ~31% build-time cut. That rewrite must be a PURE refactor: for every input
 * the emitted positions/indices must be BYTE-IDENTICAL to the pre-rewrite
 * implementation, frozen here verbatim on the original Map/Set building
 * blocks. Vertex order, index order and every float bit are compared — mesh
 * topology bugs (wrong weld, flipped winding, missed crossing) cannot hide
 * behind an "approximately equal" assertion.
 *
 * If a future change is SUPPOSED to alter smooth output, update the oracle
 * deliberately in the same commit and call the behavior change out — never
 * loosen the byte-equality.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { Vector3 } from 'gps-plus-slam-js';
import { meshOccupiedCells } from './occupancy-mesher';
import type { GridCell } from './bresenham3d';
// The mesher aliases the SCALAR packer as its cellKey — mirror that here.
import { packCellKey as cellKey } from './cell-key';

const SINGLE_CORNER_NUDGE_K = 0.5;
const GREEDY_DIRS: readonly { d: 0 | 1 | 2; u: 0 | 1 | 2; v: 0 | 1 | 2 }[] = [
  { d: 0, u: 1, v: 2 },
  { d: 1, u: 2, v: 0 },
  { d: 2, u: 0, v: 1 },
];

function isFiniteVector3(v: Vector3): boolean {
  return (
    Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])
  );
}

/**
 * FROZEN pre-rewrite 'smooth' builder (verbatim copy of `buildSmooth` at
 * webxr commit f638f06, on the original Map/Set/lazy-memo structure) plus the
 * `meshOccupiedCells` dedupe preamble it relied on.
 */
function referenceSmooth(
  cells: readonly GridCell[],
  cellSizeM: number,
  getCellPoint: ((cell: GridCell) => Vector3 | null) | undefined
): { positions: Float32Array; indices: Uint32Array } {
  const occupied = new Set<number>();
  const uniqueCells: GridCell[] = [];
  for (const cell of cells) {
    const key = cellKey(cell[0], cell[1], cell[2]);
    if (occupied.has(key)) {
      continue;
    }
    occupied.add(key);
    uniqueCells.push(cell);
  }
  const positions: number[] = [];
  const indices: number[] = [];

  const pointCache = new Map<number, readonly [number, number, number]>();
  const scratch: [number, number, number] = [0, 0, 0];
  const cellPoint = (
    ckey: number,
    x: number,
    y: number,
    z: number
  ): readonly [number, number, number] => {
    const hit = pointCache.get(ckey);
    if (hit !== undefined) {
      return hit;
    }
    let p: readonly [number, number, number] = [
      x * cellSizeM,
      y * cellSizeM,
      z * cellSizeM,
    ];
    if (getCellPoint) {
      scratch[0] = x;
      scratch[1] = y;
      scratch[2] = z;
      const cp = getCellPoint(scratch);
      if (cp && isFiniteVector3(cp)) {
        p = [cp[0], cp[1], cp[2]];
      }
    }
    pointCache.set(ckey, p);
    return p;
  };

  const vertexIndex = new Map<number, number>();
  const dualVertex = (bx: number, by: number, bz: number): number => {
    const dkey = cellKey(bx, by, bz);
    const existing = vertexIndex.get(dkey);
    if (existing !== undefined) {
      return existing;
    }
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let n = 0;
    let odx = 0;
    let ody = 0;
    let odz = 0;
    for (let dx = 0; dx <= 1; dx++) {
      for (let dy = 0; dy <= 1; dy++) {
        for (let dz = 0; dz <= 1; dz++) {
          const cx = bx + dx;
          const cy = by + dy;
          const cz = bz + dz;
          const ckey = cellKey(cx, cy, cz);
          if (!occupied.has(ckey)) {
            continue;
          }
          const p = cellPoint(ckey, cx, cy, cz);
          sx += p[0];
          sy += p[1];
          sz += p[2];
          n += 1;
          odx = dx;
          ody = dy;
          odz = dz;
        }
      }
    }
    let px = sx / n;
    let py = sy / n;
    let pz = sz / n;
    if (n === 1) {
      const nudge = cellSizeM * SINGLE_CORNER_NUDGE_K;
      px += (0.5 - odx) * nudge;
      py += (0.5 - ody) * nudge;
      pz += (0.5 - odz) * nudge;
    }
    const idx = positions.length / 3;
    positions.push(px, py, pz);
    vertexIndex.set(dkey, idx);
    return idx;
  };

  const dualBase: [number, number, number] = [0, 0, 0];
  const c: [number, number, number] = [0, 0, 0];
  for (const cell of uniqueCells) {
    c[0] = cell[0];
    c[1] = cell[1];
    c[2] = cell[2];
    for (const { d, u, v } of GREEDY_DIRS) {
      for (let sgn = 1; sgn >= -1; sgn -= 2) {
        const nbd = c[d] + sgn;
        dualBase[d] = nbd;
        dualBase[u] = c[u];
        dualBase[v] = c[v];
        if (occupied.has(cellKey(dualBase[0], dualBase[1], dualBase[2]))) {
          continue;
        }
        const baseD = sgn > 0 ? c[d] : c[d] - 1;
        const bu0 = c[u] - 1;
        const bv0 = c[v] - 1;
        dualBase[d] = baseD;
        dualBase[u] = bu0;
        dualBase[v] = bv0;
        const iA = dualVertex(dualBase[0], dualBase[1], dualBase[2]);
        dualBase[u] = bu0 + 1;
        const iB = dualVertex(dualBase[0], dualBase[1], dualBase[2]);
        dualBase[v] = bv0 + 1;
        const iC = dualVertex(dualBase[0], dualBase[1], dualBase[2]);
        dualBase[u] = bu0;
        const iD = dualVertex(dualBase[0], dualBase[1], dualBase[2]);
        if (sgn > 0) {
          indices.push(iA, iB, iC, iA, iC, iD);
        } else {
          indices.push(iA, iD, iC, iA, iC, iB);
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

/** Cells clustered in a small box so crossings/welds/thin features are dense. */
const arbCoord = fc.integer({ min: -6, max: 6 });
const arbCell = fc.tuple(arbCoord, arbCoord, arbCoord);

describe('smooth mesher matches the frozen pre-rewrite oracle byte-for-byte', () => {
  it('positions and indices are identical for random cell sets and centroid providers', () => {
    fc.assert(
      fc.property(
        // Duplicates allowed on purpose — the dedupe preamble is part of the contract.
        fc.array(arbCell, { minLength: 1, maxLength: 120 }),
        // Centroid provider variants: none / partial / with non-finite poison.
        fc.constantFrom<'none' | 'offset' | 'sparse' | 'poison'>(
          'none',
          'offset',
          'sparse',
          'poison'
        ),
        fc.double({ min: 0.05, max: 0.3, noNaN: true }),
        (cells, providerKind, cellSizeM) => {
          const provider =
            providerKind === 'none'
              ? undefined
              : (cell: GridCell): Vector3 | null => {
                  // Deterministic pseudo-random per cell, mirroring real
                  // centroids (within half a cell of the center).
                  const seed =
                    Math.sin(cell[0] * 12.9898 + cell[1] * 78.233 + cell[2]) *
                    43758.5453;
                  const f = seed - Math.floor(seed);
                  if (providerKind === 'sparse' && f < 0.4) {
                    return null; // unknown cell → geometric fallback
                  }
                  if (providerKind === 'poison' && f < 0.15) {
                    return [Number.NaN, 0, 0]; // must fall back, not poison
                  }
                  if (providerKind === 'poison' && f < 0.3) {
                    // Non-NaN non-finite: the wire format packs these VALUES
                    // (only null becomes NaN), so the centroids fast path must
                    // apply the full finite-triple check, not a NaN-only one.
                    return [Number.POSITIVE_INFINITY, 0, 0];
                  }
                  return [
                    (cell[0] + (f - 0.5) * 0.8) * cellSizeM,
                    (cell[1] + (f - 0.5) * 0.6) * cellSizeM,
                    (cell[2] + (f - 0.5) * 0.4) * cellSizeM,
                  ];
                };

          const actual = meshOccupiedCells(cells, cellSizeM, {
            mode: 'smooth',
            getCellPoint: provider,
          });
          const expected = referenceSmooth(cells, cellSizeM, provider);

          expect(actual.positions).toEqual(expected.positions);
          expect(actual.indices).toEqual(expected.indices);

          // The mesh-worker fast path: the SAME provider data shipped as the
          // wire-format centroids array (input-order aligned, NaN triple for
          // null — mirroring packMeshRequest) must produce byte-identical
          // geometry, and `includeAabbs: false` must only empty the AABB list.
          const centroids = new Float64Array(cells.length * 3);
          for (let i = 0; i < cells.length; i++) {
            const cp = provider ? provider(cells[i]!) : null;
            centroids[i * 3] = cp ? cp[0] : NaN;
            centroids[i * 3 + 1] = cp ? cp[1] : NaN;
            centroids[i * 3 + 2] = cp ? cp[2] : NaN;
          }
          const viaCentroids = meshOccupiedCells(cells, cellSizeM, {
            mode: 'smooth',
            centroids,
            includeAabbs: false,
          });
          expect(viaCentroids.positions).toEqual(expected.positions);
          expect(viaCentroids.indices).toEqual(expected.indices);
          expect(viaCentroids.aabbs).toEqual([]);
          expect(actual.aabbs.length).toBeGreaterThan(0);
        }
      )
    );
  });
});
