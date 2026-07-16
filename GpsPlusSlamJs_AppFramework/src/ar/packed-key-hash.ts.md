# PackedKeyHash — flat open-addressed map for packed cell keys

## Purpose

Typed-array replacement for `Map<number, number>` / `Set<number>` in the occupancy-mesher hot loops (2026-07-17 perf loop, iteration 2). Profiling the production-default `'smooth'` surface-nets build showed ~65% of its time in Map/Set operations keyed by packed cell keys; together with the smooth builder's ordinal/incremental-key rewrite this table took the production re-mesh (`runMeshRequest`, 100k-cell corpus regime) from 331 to 101 ms (−69.5%) with byte-identical output (numbers in `occupancy-mesher.ts.md` §'smooth').

## Public API

- **`new PackedKeyHash(expectedEntries)`** — sizing hint; starts at the next power of two ≥ 2× the hint (min 16) and grows transparently (rehash at ~2/3 load). Growth is **correctness**, not tuning: a full open-addressed table would probe forever, and vertex-heavy inputs (checkerboard-sparse grids) can exceed any static sizing.
- **`set(key, value)`** — insert/overwrite. `value` must be an integer ≥ 0; a negative value throws `RangeError` (it would be indistinguishable from a miss).
- **`get(key): number`** — the stored value, or **-1 when absent** (the hot-loop-friendly miss signal; no `undefined` checks).
- **`has(key): boolean`**, **`size: number`**.
- No `delete` — mesher tables are built once per mesh and dropped.

## Invariants & assumptions

- **Keys** are non-negative finite numbers ≤ 2^53 (packed cell keys per `cell-key.ts` are ≤ ~2^51). `-1` is the internal empty sentinel, so negative keys are unsupported by contract. Key 0 (= `packCellKey(-65536, -65536, -65536)`) is valid and distinct from absence.
- **Hashing**: the 51-bit key is split lo³²/hi²¹ and mixed with a FULL-AVALANCHE finalizer (murmur3 fmix32 over `lo ⊕ imul(hi, φ)`); linear probing over power-of-two capacity. A single multiplicative mix is NOT enough: packed keys along one axis differ by exactly 2^17 (y) or 2^34 (x), which left the index's low bits constant — a y-varying wall (or x-varying row) collapsed into ONE probe chain and lookups degenerated to O(n). Caught by the growth unit test timing out in CI; the single-axis-walk test pins all three stride structures permanently.
- Not a general-purpose map: no iteration, no delete, values Int32 only.

## Examples

```ts
const h = new PackedKeyHash(cells.length);
cells.forEach((c, i) => h.set(packCellKey(c[0], c[1], c[2]), i));
const ordinal = h.get(neighborKey); // -1 = not occupied
```

## Tests

- `packed-key-hash.test.ts` — unit contracts (miss = -1, overwrite, key 0, growth past the hint without spinning, negative-value throw), the single-axis stride-structure walks (x/y/z walls must not cluster — the vitest timeout is the canary), and a fast-check property asserting exact `Map<number, number>` equivalence over random packed-key workloads including the growth path.
- Downstream: `occupancy-mesher-smooth-oracle.property.test.ts` pins that the smooth builder on this hash produces byte-identical meshes to the frozen Map/Set reference implementation.
