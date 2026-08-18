# `mesh/triangulate.ts`

## Purpose

Hole-aware ear-clipping triangulation of a footprint, in the ENU frame.

## Public API

- `triangulate(rings): TriangulationResult` — `{ vertices, indices, forcedEars }`
- `dropClosingPoint(ring): EnuPoint[]`
- `triangulatedArea(result): number`

## Invariants & assumptions

- **Ours, not `earcut`** — production takes no runtime dependency but `h3-js`.
  `earcut` is a devDependency ORACLE (plan §4.2.1): a differential test compares
  total area on generated convex polygons and on a footprint with a hole. That
  harness is what found the winding inversion described in `enu.ts.md`.
- **Holes are bridged into the outer ring, rightmost-first.** The ordering is
  load-bearing: bridging a left-hand hole first can lay its bridge across a
  right-hand one, giving a self-intersecting ring whose triangles overlap —
  which renders as flicker rather than as an error.
- **The bridge vertex is found NEAREST-FIRST, stopping at the first visible
  candidate** (2026-08-09 perf loop). This is the file's one performance-shaped
  decision and it is worth stating, because the obvious formulation is quadratic
  for a non-obvious reason: walking the ring in order and re-testing visibility
  whenever something closer appears never tightens its distance bound until a
  candidate turns out to be _visible_, so until then every candidate pays a full
  `crossesRing` scan of the ring's edges.
  - Measured on `relation/28934` in the `london-westminster` extract — the Royal
    Parks landuse relation, 1 031 outer points and 33 holes after clipping to the
    demo's 4.8 km extent, 3 759 points and 58 holes before it. Old: 8 812
    `crossesRing` calls, **5.2 million segment-intersection tests**, 41.7 ms of
    the 42.5 ms the whole triangulation took. New: **33 calls — one per hole** —
    and 0.96 ms.
  - Devbox-win11 medians. `triangulate` on the unclipped relation **686.3 →
    116.6 ms (−83 %)**; on `sylt-westerland`'s 30-hole relation **7.29 → 1.98 ms
    (−73 %)**. Through `buildAreaPlates` over the whole `london-westminster`
    extract, **50.4 → 14.9 ms (−70 %)**, which is **98.7 → 62.1 ms (−37 %)** for
    the demo worker's entire mesh build.
  - **The answer is identical, not merely equivalent.** Both forms return the
    minimum-distance visible vertex with ties broken by ring order. Verified by
    two one-off differentials against the previous implementation, neither
    checked in (both need a second copy of the algorithm; the case worth keeping
    was lifted into `triangulate.test.ts`):
    - end to end, **every polygon in the corpus** — four fixtures and eight site
      extracts, clipped and unclipped, **7 141 polygons** — comparing the
      triangle indices and `forcedEars` of the BUILT package. Zero differences.
    - the bridging step alone, on the 157 holed polygons of that corpus plus
      20 000 generated discs with 1–6 holes, a quarter of them
      coordinate-quantised to force duplicate and collinear points. Zero
      differences in the bridged ring.
  - **Worst-case complexity is unchanged** — O(ring²) per hole when every
    candidate nearer than the answer is blocked. What changed is that the worst
    case is now reached only by input that genuinely has that many blocked
    candidates, instead of by every input.
  - The docstring this replaced justified the quadratic as "fine: holes are rare,
    and a building with a courtyard has tens of vertices, not thousands". Holes
    are rare in BUILDINGS; landuse and natural relations routinely have dozens.
    That is the same `relation/72022`-shaped assumption that made ring stitching
    and ear clipping quadratic — a third code path reached by the same class of
    data. See
    [`2026-08-09-0714-osm-hole-bridging-plan.md`](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-09-0714-osm-hole-bridging-plan.md).
- **Winding is normalised**: outer counter-clockwise, holes clockwise. Real OSM
  rings arrive both ways.
- **A progress guard forces an ear after two fruitless passes.**
  Non-termination is the failure mode that costs most here — this package
  already lost a run to a coverage call that never finished. `forcedEars > 0`
  reports that the input was degenerate, rather than hiding it.
- **Collinear triples are rejected as ears** (`<= 0`, not `< 0`), because a
  zero-area triangle renders as nothing and breaks normal computation.
- Input that cannot form a triangle returns an empty result rather than
  throwing. A hole too small to be a ring is dropped, not allowed to corrupt the
  outline.
- Output is index triples into the returned vertex list, so the caller owns the
  vertex buffer and no coordinates are copied.

## Examples

```ts
const cap = triangulate([outerRing, courtyardRing]);
```

## Tests

`triangulate.test.ts` — area conservation for convex and concave footprints,
winding independence, closed-ring input, one and two holes, degenerate input,
the progress guard on collinear runs and on a fully degenerate ring, and two
differential tests against `earcut`.

- **Many holes** — a disc with 120 triangular holes, the size class the
  generators (which stop at two holes) cannot reach. Two assertions: area equals
  outer minus holes, which is the only thing that separates the three ways
  multi-hole bridging fails (a skipped bridge leaves the hole filled, a bridge
  laid across another hole overshoots, a bridge to the wrong vertex drops
  geometry — all three look normal in a triangle count); and a wall-clock budget.
  - The budget is **absolute, not a ratio**, and its sizing is a genuine trade
    rather than a formality: 200 ms against 11.9 ms real cost and 334.8 ms for
    the previous implementation, both measured in that test on devbox-win11. The
    gap is ~28x, so headroom against cascade load and decisiveness against the
    regression pull in opposite directions; the comment in the test records what
    the number does and does not guarantee.

`triangulate.bench.ts` — hole bridging on the most-holed polygon of two site
extracts, chosen by count rather than hand-picked so it keeps tracking the worst
real case if the corpus is recaptured. Separate from `plates.bench.ts`, which
benches the ear-clipping quadratic in ring SIZE — a different cost, bounded by
the plate clip, where this one is bounded by nothing.
