# bench-mnn.ts

## Purpose

Mutual nearest neighbour matching of descriptor sets: the matcher for methods without their own (SIFT, XFeat).

## Public API

- `mutualNearestFloat(a, nA, b, nB, dim, minSimilarity = -Infinity)`: float descriptors compared by dot product (cosine for normalized ones); a pair is kept when each is the other's best and the similarity reaches the floor.
- `mutualNearestBytes(a, nA, b, nB, dim)`: uint8 descriptors compared by squared L2.
- Both return flat pairs `[ia, ib, ...]` as `Int32Array`; both throw `RangeError` when a buffer is shorter than `n * dim`.

## Invariants

- Brute force, O(nA * nB * dim): this is a benchmark of the plain approach, timed as such.

## Tests

`bench-mnn.test.ts`, including a symmetry property (swapping A and B swaps the pairs).
