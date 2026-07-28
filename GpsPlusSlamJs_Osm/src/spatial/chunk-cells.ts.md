# `spatial/chunk-cells.ts`

## Purpose

Enumerates the affordance cells belonging to a set of score chunks.

## Public API

- `cellsOfChunks(chunks): string[]`

## Invariants & assumptions

- **`cellToChildren` is an INDEX partition, not a geometric one.** Every res-13
  cell belongs to exactly one res-11 parent, which is what makes "enumerate each
  chunk's children once" correct and duplicate-free — and that is the _only_
  claim being made. It is not a statement that those children lie geometrically
  inside the parent: hexagons cannot tile hexagons, so children near a boundary
  spill out and neighbours spill in (~6 % of positions, always by one grid step).
- Consequently, coverage is computed per cell against real geometry, never by
  assuming a cell inherits its parent's features.
- The count is `49 × chunks` in the common case but **not guaranteed** — the 12
  pentagons per resolution have 6 children. Size records from the returned
  length, never from a hardcoded 49.

## Examples

```ts
const cells = cellsOfChunks(scoreWorkingSet(chunk)); // 931 res-13 cells
```

## Tests

`chunk-cost.test.ts` — working-set size (19 chunks, 931 cells) and the 126×
ratio against a whole fetch tile that motivates `restrictTo`.
