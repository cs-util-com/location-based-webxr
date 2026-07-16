# cell-key.ts

## Purpose

The single packed-cell-key implementation shared by every module that keys integer grid
cells: `occupancy-grid.ts` (Map of cell records + carve walks), `occupancy-mesher.ts`
(neighbour tests + vertex welds) and `occlusion-mesh-worker.ts` (parallel-array centroid
lookup). Packs three integer coordinates into one safe-integer Map/Set key — three 17-bit
fields — replacing the per-lookup string keys that dominated the hot loops. Consolidated
2026-07-04 (code-health plan step 3): the same algebra was previously hand-rolled three
times with two different envelopes, and the review-log's aliasing / envelope-mismatch
findings lived in the gaps between the copies.

## Public API

- `packCellKey(x, y, z): number` — scalar pack (hot loops need no tuple).
- `cellKey(cell: GridCell): number` — tuple convenience over `packCellKey`. Re-exported by
  `occupancy-grid.ts` (its public API since Step 3.1 of the 2026-07-03 fps plan).
- `unpackCellKey(key): GridCell` / `unpackCellCoord(key, axis)` — exact inverse over the
  full envelope; the per-axis form avoids the tuple allocation on hot paths.
- `cellCoordsInKeyRange(cell, limit = CELL_KEY_LIMIT): boolean` — the aliasing guard callers
  apply before keying untrusted coordinates.
- `CELL_KEY_LIMIT = 65 535` — full-field envelope (direct cell keys; ≈ ±9.8 km at 0.15 m).
- `HALF_LATTICE_CELL_KEY_LIMIT = 32 767` — mesher tier: the meshers also key DERIVED
  coordinates (neighbours `±1`, dual bases `−1`, corner-fit half-lattice `2·coord ± 1`),
  which must stay inside the same field, hence the 2× headroom (≈ ±4.9 km).
- `CELL_KEY_STRIDE_X` / `CELL_KEY_STRIDE_Y` (2026-07-17 perf loop) — per-axis key strides
  (the z stride is 1): stepping one cell along an axis moves the packed key by a constant,
  so hot walks (the occupancy grid's fused carve, the smooth mesher's dual-cell corners)
  maintain keys incrementally instead of repacking per cell. DERIVED from `packCellKey`
  itself so they can never drift from the encoding.

## Invariants & assumptions

- **Integer coordinates only.** Fractional coordinates break the derived-key algebra
  (callers guard: the mesher's `isPackableCell` uses `Number.isInteger`, the grid keys only
  quantized cells).
- **Aliasing outside the envelope.** `packCellKey(0, 65537, z) === packCellKey(1, −65535, z)`
  — beyond a caller's envelope the encoding wraps into the neighbouring field. Callers MUST
  range-check untrusted coordinates (`cellCoordsInKeyRange`) or an out-of-envelope cell
  reads/deletes an unrelated record (the PR #144/#145/#147 findings).
- Keys stay `< 2^53` (safe integers) over the full envelope — pinned by test.
- `2·HALF_LATTICE_CELL_KEY_LIMIT + 1 ≤ CELL_KEY_LIMIT` — the tier relationship that makes
  every mesher-derived key collision-free — is pinned by test, so the two constants cannot
  drift apart silently again.

## Examples

```ts
import { packCellKey, unpackCellKey, cellCoordsInKeyRange } from './cell-key';

if (cellCoordsInKeyRange(cell)) {
  map.set(packCellKey(cell[0], cell[1], cell[2]), record);
}
const [x, y, z] = unpackCellKey(key);
```

## Tests

- `cell-key.test.ts` — pack↔unpack exact-inverse property over the full envelope,
  safe-integer bounds, the documented alias example, the tier-headroom relationship, range
  checks, tuple/scalar parity.
- Consumer suites pin byte-identical behaviour end-to-end: `occupancy-grid.test.ts` /
  `.property.test.ts` (incl. the key-range envelope hardening block), the mesher suites,
  and `occlusion-mesh-worker.test.ts` (round-trip parity).

## Related

- [occupancy-grid.ts.md](occupancy-grid.ts.md) §Memory & keying — the grid-side envelope
  guards; [occupancy-mesher.ts.md](occupancy-mesher.ts.md) §Invariants — the mesher-tier
  skip; [occlusion-mesh-worker.ts.md](occlusion-mesh-worker.ts.md).
