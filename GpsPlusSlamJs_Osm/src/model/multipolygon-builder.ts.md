# `model/multipolygon-builder.ts`

## Purpose

Stitches multipolygon relation member ways into closed rings, and assigns holes
to the outer rings that contain them.

## Public API

- `stitchRings(segments)` → `{ ok: true, rings } | { ok: false, unclosed }`.
- `isClosedRing(positions)` → boolean.
- `isPointInRing(point, ring)` → boolean (ray casting).
- `groupRingsIntoPolygons(outerRings, innerRings)` → `Ring[][]`, each entry
  being outer-ring-first followed by its holes.
- `signedRingArea(ring)` → shoelace area **in squared degrees**.
- `Ring` — `readonly LatLng[]`, first position equals last.

## Invariants & assumptions

- **Ported from `OsmExtensions.CombineToClosedArea`, generalised twice:**
  - _Any number of rings._ The reference stitches everything into one ring and
    throws if that fails; a real multipolygon can have several outer rings, each
    split across several ways.
  - _Per-segment reversal._ The reference reverses its accumulated result when
    orientation flips, which only survives a single flip. Reversing the incoming
    segment instead handles arbitrarily many, and is why the property test can
    randomly reverse every segment.
- **Chains grow at both ends.** Attaching only at the tail fails when the seed
  segment happens to sit in the middle of a chain.
- **Failure is returned, never thrown**, and carries the partial chains — that
  is what makes a broken relation debuggable rather than merely invalid.
- **Endpoint matching is exact** (see `positionsEqual` in `osm-feature.ts`).
- **`isPointInRing` works in raw degrees.** Correct here because containment is
  purely topological — no distance or area is computed — so the degree
  anisotropy that matters elsewhere (plan §4.5) is irrelevant. **The
  antimeridian is not handled**; a multipolygon spanning it would need splitting
  first, and none exist at the scales this package works at.
- **`signedRingArea` is in squared degrees and is only ever compared
  ring-to-ring** (smallest-containing-ring selection). It is not a real-world
  area and must never be reported as one — squared degrees vary with latitude.
- **A hole contained by nothing is dropped**, not attached to an arbitrary outer
  ring. Silently punching a hole in the wrong building is worse than ignoring a
  malformed member.
- **Nested holes attach to the smallest containing ring**, so a shed inside a
  courtyard inside a block belongs to the courtyard.

## Complexity

`stitchRings` is **linear in the total number of points**, and was made so on
2026-07-31. It previously carried two quadratic terms, and the note that used
to stand here — "real relations have tens of members, not thousands ... if a
pathological relation ever shows up, the fix is an endpoint hash map" — had the
right diagnosis and the wrong frequency. Profiling `buildFeatureIndex` found
`attach` to be the largest own-code frame in the whole profile: the
`building-block` fixture is one ordinary Cologne city block and contains a
316-member, 26 778-point boundary relation, and `beach` a 217-member one. Any
city bbox clipping an administrative boundary gets one.

The two terms, and what replaced each:

- **The pool rescan.** `growChain` walked the whole pool after every attach.
  Replaced by `indexEndpoints`, a `Map` from endpoint key to the pool indices
  of the segments touching it, so a candidate is a hash lookup.
  - The lookup returns the **lowest live index**, which is what makes the
    rewrite output-equivalent: the old scan walked in index order and took the
    first segment matching any of `attach`'s four cases, so preferring (say)
    tail matches globally would pick differently wherever more than one
    segment fits.
  - Dead entries are skipped with a FRONT CURSOR, not compacted (PR #237).
    Buckets are built in ascending pool order and only shrink from the front, so
    the lowest live index is just the first survivor — no min-scan. Compaction
    re-walked every LIVE entry on every call, and `growChain` queries both chain
    ends each iteration including the one that loses.
    - **Justified by the worst case, not by the fixtures.** Measured in
      isolation over 20 000 calls on an all-live bucket: 8 entries 2.20 → 0.22 ms,
      64 entries 5.02 → 0.11 ms, 512 entries 26.61 → 0.12 ms — flat instead of
      linear. On the captured fixtures it is a wash, because a well-formed ring
      gives every endpoint a bucket of 2; the case it protects is a branching
      fan, which the differential generator produces and real data occasionally
      does.
    - Equivalence re-checked after the change: the same 40 000-case differential
      run against the pre-rewrite implementation, zero differences.
  - `endpointKey` returns `undefined` for NaN, because `positionsEqual` is
    `===` and `NaN !== NaN` — stringifying would give every NaN endpoint the
    same key and fabricate joins. Infinity stays keyed: `Infinity === Infinity`,
    and the old scan did join on it.
- **A segment that cannot attach is returned to the pool, not dropped** (PR #237).
  The fall-through in `attach` is unreachable by construction, but dropping the
  segment made a hypothetical key/`positionsEqual` disagreement invisible — a
  ring quietly missing a piece. Returned to the pool it becomes a seed, so it
  surfaces through the existing `unclosed` failure channel instead.
- **The chain copy.** `attach` rebuilt `[...chain, ...segment]` on every join,
  copying the whole accumulated chain — so the last attaches of a 26 778-point
  relation each copied ~26 000 points. Replaced by `Chain`, held open at both
  ends (`head` stores the points preceding the seed, reversed), so both ends
  grow by `push` and nothing is copied until `materialise`.

Measured on devbox-win11, medians:

- `stitchRings`, building-block (315 segments, 26 778 points): 33.5 → 1.11 ms.
- `stitchRings`, beach (217 segments, 20 135 points): 12.6 → 0.66 ms.
- Synthetic, shuffled, 64 points per segment, 50 / 200 / 800 segments:
  0.39 / 5.3 / 137 ms → 0.12 / 0.45 / 2.54 ms.
- Through `buildFeatureIndex`, the ranked hot path: building-block
  112.6 → 88.7 ms (−21 %), beach 20.6 → 9.2 ms (−55 %). `park` and
  `street-corner` are unchanged within noise, because neither holds a large
  relation.

## Examples

```ts
const stitched = stitchRings(outerWayGeometries);
if (!stitched.ok) {
  return fail(
    "unclosable-ring",
    relation,
    `${stitched.unclosed.length} open chains`,
  );
}
const polygons = groupRingsIntoPolygons(stitched.rings, innerRings);
```

## Tests

- `multipolygon-builder.property.test.ts` — a ring is cut into pieces, shuffled
  and randomly reversed, then must always stitch back into exactly one closed
  ring; order-independence; disjoint rings never merge; a missing segment
  reports failure; point-in-ring translation invariance; hole assignment by
  containment and by smallest-containing-ring; area sign/magnitude behaviour.
- `multipolygon-builder.test.ts` — the cases the property generators cannot
  reach, all added with the 2026-07-31 rewrite because they are where a
  faster candidate lookup could silently diverge: the lowest-index tie-break
  when two segments could attach at the same end; tail-attach winning over
  head-attach within one segment; an already-closed segment being absorbed into
  an open chain; NaN endpoints never joining; correctness at 1600 segments; and
  a wall-clock budget that the previous quadratic implementation could not meet
  (1063 ms against a 500 ms budget, versus 5.5 ms now).
  - The budget is deliberately **absolute, not a ratio**. The first attempt
    compared 200 against 800 segments and expected ~4×; it measured 17×,
    because at 200 segments the work is a few hundred microseconds and
    dividing two noisy sub-millisecond numbers measures the noise.
- Equivalence of the rewrite was additionally checked by a one-off differential
  run against the previous implementation — 40 000 generated cases covering
  branching fans, duplicate segments, closed/open mixes, unclosable chains and
  NaN/`-0`/Infinity coordinates — with zero output differences. Not checked in:
  it needs a second copy of the algorithm, and the cases worth keeping were
  lifted into `multipolygon-builder.test.ts`.
- Example coverage of the stitcher through `osm-geometry.test.ts`.
