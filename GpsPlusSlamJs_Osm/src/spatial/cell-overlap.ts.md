# `spatial/cell-overlap.ts`

## Purpose

The cells whose hexagon overlaps a single ring, computed directly instead of
through h3's polygon API — the fast path underneath `coverCells`.

## Public API

- `overlappingCells(ring, resolution): string[] | undefined`
  - `ring` — `x = lng, y = lat` degrees, treated as closed, winding-agnostic.
    The same convention as [`point-in-ring.ts`](./point-in-ring.ts.md) and
    [`segment-crossing.ts`](./segment-crossing.ts.md), whose predicates it uses
    rather than restating.
  - returns the covered cells, or **`undefined` meaning "ask h3 instead"**.
  - **`undefined` is never "no cells".** An empty array is a real answer; the
    two are deliberately different values, because a caller that treated a
    decline as an empty cover would silently delete an obstacle.

## Why it exists

`polygonToCellsExperimental` costs **~0.5–0.8 ms per call regardless of what it
returns**, and the obstacle sweep makes 3 397 such calls over the site corpus for
2 829 ms. The cost is the call, not the geometry:

- a 1×20 m quad returning 7 cells at res 13 costs 675 µs; **at res 7, returning
  one cell, the same call still costs 296 µs**
- all four `POLYGON_TO_CELLS_FLAGS` cost the same, so it is not the overlapping
  semantics
- it is the experimental entry point itself — `containmentCenter` through it
  costs 600 µs against **71 µs** for the stable `polygonToCells` that returns
  identical output

Two cheaper ideas were measured and rejected before this one:

- **Batch several rings into one call** — structurally unavailable. h3-js takes
  `[outer, ...holes]`, one polygon per call; there is no multipolygon input.
  (The comment that used to sit on `nav/obstacles.ts`'s `indexUnderCells` was
  right about this, and it is recorded here so the idea is not re-attempted.)
- **Stable `polygonToCells` plus a boundary supercover** — ruled out: it misses
  cells h3 reports (524 over the corpus, i.e. wall that stops blocking), and the
  stable call _throws_ on 57 % of real rings.

## Invariants & assumptions

- **Three witnesses, all required.** A cell overlaps a ring when a cell-boundary
  vertex is inside the ring, **or** a ring vertex is inside the cell, **or** an
  edge of each cross. Each is the only witness for a case the others miss — the
  second is what covers a ring smaller than a cell, which at res 13 (~39 m²) is
  most barrier segments.
- **Correctness does not depend on the candidate disk being big enough.** The
  radius is estimated from the ring's extent in grid steps, but the cover then
  checks whether any cell at the disk's OUTER edge was hit and declines if so. A
  ring is connected, so it cannot reach past the disk without crossing that outer
  edge — an untripped guard means nothing was left outside.
  - This is not theoretical caution. Sizing the disk by distance alone was the
    first attempt and it under-reached on large rings, losing 23 cells across the
    corpus while looking correct on small ones. With the guard the cover is exact
    with **no radius cap at all**; the cap that remains is purely about cost.
- **`MAX_CANDIDATE_CELLS = 397`** is a cost knob, not a correctness one. Each
  candidate costs ~5 µs against h3's ~0.8 ms, so the two break even near 160;
  397 is the exact size of a radius-11 disk (`3k(k+1)+1`), written that way so it
  reads as a whole disk rather than a round number. It declines 27 rings of
  3 397 — the largest building outlines, where h3 is the better tool.
- **Single ring only.** `coverCells` restricts the fast path by ring COUNT rather
  than letting it try and give up, because h3 subtracts holes and this has no
  equivalent: a cell buried inside a courtyard would be covered when it must not
  be. Restricting by count makes that impossible rather than merely untested.
- Declines on fewer than three points and on any non-finite coordinate. Real
  Overpass output contains both, and a `NaN` would otherwise reach the candidate
  disk and produce an empty cover that looks legitimate.
- Planar predicates on lat/lng are correct here for the same reason
  `point-in-ring.ts` gives: crossing parity and containment are invariant under
  the affine map from degrees to local metres, at the scale of one cell.
- **Cell boundaries are MEMOISED across calls**, because the same cell is asked
  for many times per sweep and re-deriving it is the single largest remaining
  cost. Measured over the site corpus, `buildObstacleIndex` calls
  `cellToBoundary` **2.4× to 11.1× more often than it has distinct cells** —
  `london-westminster` makes 53 746 calls for 4 824 cells — because neighbouring
  rings share candidates: the per-segment quads of one wall, adjacent buildings.
  - A cell id encodes its own resolution, so the id alone is a complete key.
  - **The cached arrays are shared and read-only by convention.** `overlaps` is
    the only reader and only reads; a second reader that mutated one would
    corrupt every later lookup silently, which is why the module says so instead
    of relying on it staying true.
  - Bounded at 65 536 cells and **cleared wholesale** rather than evicted one at
    a time. A working set is a few thousand distinct cells, so what the bound
    guards is a long session walking across a city; a wholesale clear costs one
    cold sweep and needs no recency bookkeeping, where an LRU would be more
    machinery than the thing it protects.

## Measured

Devbox-win11 (Win 11 Pro, Node 24.14.1, pnpm 11.11.0), over the rings the
obstacle sweep actually covers:

- **99.2 % of 3 397 rings take the fast path**; the rest fall back to h3.
- **Zero differences from h3, in either direction**, on all of them — and on a
  further **40 000 generated rings** driven through `coverCells` itself, and on
  every geometry of the whole corpus at res 13 (10 856 of them) plus all 12
  obstacle indexes, hashed before and after and compared.
- **~4× faster** on the rings it takes. Through `buildObstacleIndex`, the corpus
  goes **2 829 → 933 ms (−67 %)** and `london-westminster` **825 → 245 ms (−70 %)**.
- **Memoising cell boundaries takes it further, to 453 ms over the corpus and
  122.6 ms on `london-westminster`** — **−51 %** on top of the above, and **−84 %
  / −85 %** against where each started. Bench means for the same change:
  `london-westminster` 339.4 → 154.0 ms, `cologne-cathedral` 182.1 → 96.9,
  `berlin-alexanderplatz` 92.7 → 68.1.

Those offline sweeps are where the equivalence evidence lives. The in-repo
property test deliberately runs only 50 cases, because 200 put it over the 5 s
per-test timeout under the root cascade's parallel load — see its own comment.

## Examples

```ts
const cells = overlappingCells(
  [
    { x: -0.12, y: 51.5 },
    { x: -0.1199, y: 51.5 },
    { x: -0.1199, y: 51.5002 },
    { x: -0.12, y: 51.5002 },
  ],
  AFFORDANCE_RES,
);
if (cells === undefined) {
  // not "no cells" — ask h3, as `coverCells` does
}
```

## Tests

`cell-overlap.test.ts` — a **differential against h3 itself**, which is the only
sensible oracle: the module's entire contract is to give the same answer more
cheaply, so a hand-written expectation would be a weaker restatement of what h3
already defines. Covers a barrier-sized quad, a building-sized rectangle, a
polygon smaller than one cell, a concave L, both windings, four resolutions, high
latitude and the antimeridian, and a 200-case property run over arbitrary small
rings. Failures report _missing_ and _extra_ cells separately, because those mean
opposite things — a missed cell is wall that stops blocking, an extra one is a
phantom obstacle.

Declining is tested for the decline itself, never for a best effort: too few
points, a non-finite coordinate, and a ring too large to be worth covering.

The memo has two tests of its own, both aimed at the case where a broken cache
stays invisible: **two overlapping rings that SHARE candidate cells** (so the
second is served largely from cache, with some fresh cells, and then the first is
re-covered entirely from cache), and **the same ring covered repeatedly**.
Repetition is what the memo optimises, so repetition is where a mutated or
mis-keyed entry would show.

The wiring is covered by `cell-coverage.test.ts`, and the pinned corpus coverage
counts in `h3-feature-index` and `affordance-index` are what prove the fast path
changed nothing downstream.
