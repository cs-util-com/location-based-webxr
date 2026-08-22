# `mesh/host-grid.ts`

## Purpose

A uniform grid over host-candidate bounding boxes, so `annotatePoiHosts` asks
each marker only about the candidates that could contain it instead of about all
of them.

## Public API

- `interface CandidateBounds` — `minX`, `maxX`, `minY`, `maxY`, ENU metres. This
  is exactly the shape `footprintAnchor` already returns, so the caller passes
  what it has rather than deriving anything new.
- `buildHostGrid(bounds: readonly CandidateBounds[]): HostGrid`
- `HostGrid.candidatesAt(point): readonly number[]` — indices into the original
  `bounds` array, **ascending**.

## Invariants & assumptions

- **ASCENDING ORDER IS THE CONTRACT, and it is the hard part rather than the
  fast part.** `annotatePoiHosts` orders candidates buildings-first and its
  caller takes the first enabled host — a café inside a building that stands on a
  landuse plate belongs to the building. Two things preserve it:
  - candidates are inserted in index order, so each cell's list is already
    ascending;
  - the per-level lists are **merged** (k-way, by repeated minimum), never
    concatenated. Concatenating would place a coarse-level plate after a
    fine-level building that follows it in candidate order, silently changing
    which host wins.
- **MULTI-LEVEL, and the single-level version was built first and MEASURED to be
  wrong.** OSM footprint size is unbounded, so one pitch cannot serve both a 12 m
  house and a 400 m relation. The first design held oversized candidates out in a
  flat list checked against every marker — and that reintroduced the quadratic:
  1 candidate overflowed at one copy of the fixture and 9 did at nine copies, so
  `markers × overflow` went from 60 pairs to **4 860**, which was **72 % of all
  remaining pairs**. The pair-growth guard in `poi-hosts-cost.test.ts` caught it
  at 25.7× for 9× the input, against a 12× bound.
  - Three levels, 16× pitch apart. A candidate that floods a level at 64 cells
    covers at most 4 one level up, so two promotions cover anything short of
    continental geometry: at the measured ~13 m fine pitch the coarsest level is
    ~3.4 km and 64 of those cells is ~27 km.
  - The flat list survives only as a backstop for geometry too large for even the
    coarsest level. Nothing in the corpus reaches it.
- **No false negatives, by construction.** If a point lies inside a candidate's
  bounds then the point's cell overlaps those bounds, so that candidate is in the
  cell's list. The grid returns a SUPERSET; the caller's existing
  `withinFootprintBounds` check still removes the false positives, so the
  annotated output is identical to the exhaustive scan's.
- **The build is bounded at `64 × candidates` writes** however pathological the
  geometry is, because a candidate is promoted to a coarser level rather than
  flooding a fine one. Without any such rule a single Thames-sized footprint
  would be written into hundreds of thousands of cells and the index would cost
  more than the scan it replaces.
- **An empty footprint yields an INVERTED box** (`min > max`), which is skipped
  entirely — not indexed, not overflowed. That matches the existing reading: a
  footprint with no vertices contains nothing, and `withinFootprintBounds`
  already rejects every point against it. Letting one reach the grid would
  produce a negative cell span.
- **The finest pitch comes from the candidates, not from a constant** — the mean
  box extent, floored at `MIN_PITCH_M` (8 m). The mean rather than the median
  because it needs no sort on a mesh-path call, and because the outliers that
  would drag a mean upward are promoted to a coarser level rather than distorting
  this one. Measured on `london-westminster`: pitch ~13 m, median footprint
  occupying **1** cell and the 99th percentile **18**.
- **`candidatesAt` returns a SHARED SCRATCH ARRAY when more than one list has to
  be merged**, valid only until the next call. One allocation per marker is
  precisely the cost this index exists to remove. The single caller reads it
  within one loop iteration; anything else must copy. When exactly one list is
  non-empty — the common case — that list is returned directly and no merge runs.
- **Cell keys are integers, not strings.** `col * STRIDE + row` with an offset
  that keeps ENU's negative half out of the sign bit. A template-literal key
  would add a string hash to a lookup that happens once per marker per level.

## Examples

```ts
const bounds = candidates.map((c) => footprintAnchor(c.footprint));
const grid = buildHostGrid(bounds);
for (const i of grid.candidatesAt(marker.position)) {
  // candidates[i] may contain the marker; still check the real predicate
}
```

## Measured

Devbox-win11 (Win 11 Pro, 11th Gen Intel i7-1185G7 @ 3.00 GHz, Node 24.14.1),
`poi-hosts.bench.ts` over the replicated `london-westminster` fixture:

- k=2, 240 markers × 4 768 candidates (1 144 320 pairs) — **10.45 → 2.94 ms**
- k=4, 960 markers × 19 072 candidates (18 309 120 pairs) — **197.15 → 13.42 ms**
- in the demo's whole mesh build, the stage went **205.4 → 18.3 ms**, from
  17.3 % of the build to 1.7 %

**The point is the change of SHAPE, not the ratio at one scale.** 16× the pairs
cost **18.9×** before and **4.56×** after. In counts, which are machine-
independent and are what the gate asserts: the cross product at 9 copies of the
fixture is 5 331 420 pairs, of which the index reaches **1 754** — and at 1 copy
it reaches 160, so 9× the input costs **11×** the pairs rather than 81×.

## Tests

`host-grid.test.ts` covers the properties the caller depends on: ascending order
including across a level merge, no false negatives against an exhaustive scan,
oversized candidates reaching a query whose own cell is empty, inverted boxes
never being indexed, negative coordinates (half of every ENU frame), and an
empty candidate list.

`host-grid.property.test.ts` generates boxes spanning four orders of magnitude —
so both sides of the promotion threshold are reached without the test naming it
— and asserts the three contract properties over arbitrary inputs: never drops a
candidate the exhaustive scan finds, always ascending, never returns an index
twice.

The end-to-end equivalence — that `annotatePoiHosts` produces the same hosts
with the grid as without — is pinned in `poi-hosts-cost.test.ts`, which also
replaces the old `pairsConsidered === markers × candidates` assertion with the
pruning guard that assertion made impossible.
