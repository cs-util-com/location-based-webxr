# `worker/shell-rand.ts`

## Purpose

A stable per-feature random in `[0, 1)`, used as the phase offset for the AR
shell shader so buildings breathe out of sync.

## Public API

- `shellRandFor(mesh) → number` — deterministic for the same geometry. Returns
  `0` for empty geometry.

## Invariants & assumptions

- **Stable across rebuilds, which is the whole reason it exists.** The obvious
  source is the feature's index in the batch, and it is wrong: the batch is
  rebuilt whenever a tile lands or the position changes, and the order is not
  stable. An index-derived phase would re-shuffle mid-session, so the entire city
  would visibly re-randomise its breathing at an arbitrary moment.
- **Hashes the first vertex.** Geometry is the one thing about a building that
  does not change between rebuilds. It needs no feature key, which matters
  because the drawn set mixes buildings and barriers and only some carry one.
- **Neighbours must separate.** A hash that is smooth in position gives adjacent
  buildings near-identical phases, so a street pulses as one unit and the
  desynchronisation buys nothing. Positions are quantised to centimetres and run
  through an avalanche step for that reason; pinned by a test.
- **Never NaN.** Such a mesh is dropped before it reaches a chunk, but a NaN in a
  vertex attribute takes the whole draw call with it.

## Tests

`shell-rand.test.ts` — stability, range, neighbour separation, spread across 200
inputs, and the empty-geometry case.
