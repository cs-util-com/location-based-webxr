# Overpass fixtures

Real Overpass responses, captured **2026-07-28**. They make every downstream
test (indexing, scoring, regions) run against genuine OSM data offline and
deterministically, so CI never depends on donated infrastructure being up.

Regenerate with:

```bash
pnpm run capture:fixtures              # all four
pnpm run capture:fixtures beach        # one, by slug
```

Each `<slug>.json` carries its own provenance: `tile`, `bbox`, the exact
`query`, `capturedAt`, `capturedFrom`, `rawBytes`, `elementCount`,
`s3dbCensus`, and `regenerateWith`.

## Why these are res-10 tiles, not full res-7 fetch tiles

**The original reason is withdrawn. The current reason is repo weight.**

These fixtures were captured on 2026-07-28 under the belief that public Overpass
instances were saturated and that a full-size tile could not be fetched at all.
That belief was wrong: it came from a key **regex** query
(`nwr[~"^(k1|k2|…)$"~"."]`), which makes Overpass evaluate a regex against every
key of every element in the bbox. A **union of exact-key statements** over the
same 32 keys returns a whole res-7 tile at all. See
`GpsPlusSlamJs_Docs/docs/2026-07-28-1040-overpass-remeasurement-findings.md`.

That run also reported 21,847 elements and 28.31 MB, and **both figures are
retracted** (2026-08-09, N2/W2 — see `src/spatial/resolutions.ts` `FETCH_RES`).
The current figure is **~21 MB, and ~15–90 s**, under the areal-only query
form adopted 2026-08-03.

Everything that reading produced is withdrawn: that instances are globally
saturated, that a self-hosted instance is required, and that latency is an
immovable constraint. `FETCH_RES` is now **7** (owner decision — over-fetch
rather than under-fetch, one request per move instead of seven), and the
production query in `src/source/overpass-query.ts` is the union form.

So a full-size capture is now possible, and what stops it is size: a res-7 tile
is ~21 MB, the merge tests want a **second overlapping one**, and this corpus is
4.8 MB today. That decision (gzip the fixtures / regenerate on demand / check in
raw) is open — see the plan's §10.

**DECIDED 2026-08-04, and the answer is "none of those three".** The corpus stays
checked in and uncompressed, every payload is **minified** (`.prettierignore`
keeps the format stage from re-expanding it), and a **2 MiB ceiling per tracked
file** is now enforced by `tests/repo-config/max-file-size.test.js`. A ~21 MB
res-7 capture is therefore uncommittable, and **no full-size fixture will be
taken** — the six-site corpus covers the "one city only" risk better anyway, at
four countries instead of one.

Each rejected option failed on a measurement, not on taste:

- **Gzip** — git already zlib-compresses every blob, so gzipping buys ~20 %, not
  the ~8x that comparing against working-tree bytes suggests. Gzipped blobs also
  stop delta-compressing, making the corpus _heavier_ after a single re-capture.
- **Regenerate on demand** — costs the offline determinism this corpus exists
  for, and OSM edits daily, so every count-pinned test starts drifting.
- **Check in raw at ~21 MB** — what the ceiling now forbids.

The number that had been driving the whole discussion was also the wrong one:
this corpus is **~1.7 MiB in git**, not the 4.8 MB of working-tree bytes quoted
above.

**These four stay the everyday corpus regardless**: small, fast in CI, and real
OSM data with real tag distributions, real multipolygons and real long-tail
tags, which is what fixtures are for. What they cannot give is true element
counts, true parse time, or an S3DB census at a scale where one unusual block
does not move every ratio — so quote their absolute numbers as "measured at res
10 at X", never as typical.

> **Before re-capturing, read the capture script.** `scripts/capture-fixtures.mjs`
> still builds the **regex** query and still keeps its own copy of the key list
> rather than importing `OVERPASS_SELECT_KEYS`. Run as-is against a res-7 tile it
> will 504, and the failure will look like a server problem rather than a query
> problem — which is exactly how a day was lost the first time.
>
> **And check what it wrote against what you expected it to write.**
> `scripts/capture-non-areal.mjs` predicted "a few hundred kB" in its own header
> and produced **24.9 MB**, which the format stage then committed as **41.4 MB
> across 1 128 493 lines** — two thirds of one pull request's entire diff, and
> nothing went red for a week. Both halves of that were avoidable by looking:
> the estimate was in the file, and so was the result.

## The query is key-filtered, and why that is safe

These captures were taken with a key **regex**
(`nwr[~"^(highway|surface|...)$"~"."]`). At res 10 that completes; at any real
fetch-tile size it does not — the regex, not the key list, is what 504s. The
shipped production query in `src/source/overpass-query.ts` is therefore a
**union of exact-key statements** over the same 32 keys, one union block with
one trailing `out`, which returns each element exactly once.

**The 32-key list is the only Overpass filter in this repo that has ever fetched
real data.** The plan's §5.1 once printed a 24-key subset of it and the "67.7 %
of rule-table rows" figure was computed for a 23-key list — both narrower than
what ships. Measured against the shipped 32 keys: **75.2 %** of the rule table's
467 scoring rules are reachable, and **zero elements dropped by the filter across
all four fixtures would have scored anything but the identity**, because the
uncovered keys co-occur with covered ones on the same element
(`src/rules/key-filter-coverage.test.ts` reports both). **Widening is free
scoring signal; narrowing is a silent hole that reads as "nothing is mapped
here".**

**Still open:** the capture script keeps its own copy of the list instead of
importing `OVERPASS_SELECT_KEYS`, so the two can drift, and it still emits the
regex form.

**This does not cost the scoring model its long tail.** The filter selects which
_elements_ are returned; `out geom` then returns **all tags** of every matched
element. A building matched on `building` still arrives with its
`wheelchair=yes`; a path matched on `highway` still arrives with its
`surface=sand` and `smoothness=good`. What is lost is only elements carrying
**none** of the listed keys.

## The four fixtures

- **`park`** — Cologne Volksgarten, mixed landuse.
  - 85 elements (25 nodes, 58 ways, 2 relations), 0.08 MB.
  - 21 buildings, no `building:part`, no pitched roofs, no `height`.
- **`street-corner`** — Cologne Neumarkt: roads, footways, crossings.
  - 227 elements (123 nodes, 102 ways, 2 relations), 0.60 MB.
  - Contains `way/467190239`, the Eifelwasserleitung Roman aqueduct — **1179
    positions in one way**, a useful stress case for cell coverage.
- **`beach`** — Sylt, Westerland.
  - **1 element, 0.99 MB.** That element is `relation/9051063` — the entire
    **North Sea**. A res-10 tile on the coast intersects its bounding box, so the
    whole multipolygon comes back.
  - This is the most valuable accident in the set: it proves a **single relation
    can dominate a tile's payload**, and it will recur on every coastal tile.
    Any assumption that payload scales with tile area is wrong near coastlines,
    administrative boundaries or large forests.
  - **Caveat:** it therefore does **not** contain the `surface=sand` +
    `natural=beach` pair the plan wanted as the C# oracle. That oracle is
    covered by explicit unit tests in the scoring iteration instead, which is
    where it belongs — an oracle needs exact known inputs, not whatever a real
    tile happens to hold.
- **`building-block`** — Cologne Altstadt, dense block.
  - 242 elements (114 nodes, 124 ways, 4 relations), 1.70 MB.
  - **This is the S3DB census that gates the plan's §8.**

## S3DB census — the §8 gate, retired

> **The gate was retired, not triggered** (owner decision, plan §2.2). The
> numbers below did come in low, and the 3D work — roofs and the straight
> skeleton included — **stays in the plan** regardless: low current tag coverage
> is an argument about how much of today's map benefits, not about whether the
> capability is worth building, and a renderer with no pitched-roof path cannot
> start using the data when mappers add it. What the census does decide is the
> **ordering** of the 3D iterations: `building:part` + `min_height` first (24 %,
> best quality/effort ratio), flat extrusion next, cheap roof shapes after,
> straight skeleton last. See plan §8 and Iteration 9+.

The plan originally made this a decision gate: _"If the third and fourth counts
are near zero in the areas we actually target, the entire roof-geometry pipeline
in §8 is dead weight."_

- **`building-block`** (Cologne Altstadt — one of the best-mapped areas in
  Germany, i.e. close to a best case):
  - buildings: **51**
  - `building:part`: **12** (24%)
  - `roof:shape` present and not `flat`: **6** (12%)
  - `height` present: **8** (16%)
- **`park`**: 21 buildings, 0 parts, 0 pitched roofs, 0 heights.
- **`street-corner`**: 36 buildings, 0 parts, 0 pitched roofs, 2 heights.
- **`beach`**: no buildings at all.

**Reading:** the roof-geometry pipeline applies to roughly **12 % of buildings
even in a best case**, and to **0 %** in two of the four areas. This document
originally concluded from that the straight-skeleton work for gabled/hipped roofs
(§8.3's hardest algorithm, and the one with the GPL-licence trap) is not
justified — **that recommendation was overruled**; see the box above. The
licence discipline around `straight-skeleton` v3 is therefore a live constraint,
not a hypothetical one.

Two caveats on the numbers themselves, both arguing for re-running the census at
the real fetch-tile resolution: it is measured over **0.015 km² and ~50
buildings**, small enough that one unusual block moves every ratio; and Cologne
Altstadt is close to a German best case, so it bounds the good end rather than
describing the average.

`building:part` at 24 % confirms the plan's other claim: honouring
`building:part` and `min_height` is where the quality/effort ratio is best, and
it is worth doing from day one.

## The six-site corpus (`sites/`)

**Separate from the four fixtures above, and captured differently.** Added
2026-07-31 for round 4 (DEC-R4-1/R4-2): the demo had been looked at in exactly
one place for three rounds, which is the condition that let a fix ship for a
defect that was not the reported one.

- **The sites come from `src/places/sites.ts`**, which the demo's location picker
  also reads — one table, so the places a human can reach are the places the
  suite covers. Capture with `pnpm run capture:sites [id ...]`.
- **Res 9 (~348 m across), per site.** Res 10 was tried first and is too small
  for the purpose: Berlin returned 5 buildings, Manhattan 10, and Sylt a single
  coastline way.
- **Non-areal relations are dropped**, and the count is recorded in each
  extract's `droppedNonArealRelations`. This is the only reason the corpus fits
  in the repo: the unfiltered res-9 Cologne capture is ~35 MB, of which 97 % is
  international train-route relations passing Köln Hbf, printed in full by
  `out geom`. `toGeometry` turns a non-areal relation into no geometry at all,
  so nothing any consumer could have used is lost. Filtered, all six sites total
  4.5 MB.
- **`capture-fixtures.mjs` imports the site table directly** via Node's type
  stripping, so there is no second copy of the coordinates and no dependency on
  a built `dist`. Its areal-relation list is pinned to the package's own
  predicate by `src/source/capture-script-query.test.ts`.

What the corpus found on its first run: `roof:shape=pyramidal` with no tagged
roof height produced a ZERO-height roof — a flat cap over the full footprint.
That is the Cologne Cathedral finding (R3-1/R4-7) that three rounds of reading
the source did not settle. See `src/mesh/building-heights.ts`.

## `sites/cologne-cathedral.non-areal.json` — the companion, not a site

**A twelfth file that is not a fixture and must not be read as one.** Captured
2026-08-03 by `scripts/capture-non-areal.mjs`, it holds the **85 relations the
Cologne site extract DROPPED**, so `plain` is reconstructible offline as
`fixture + this` and the `areal-only` query switch could be tested as a
differential rather than argued about. Its only consumer is
`src/score/areal-only-differential.test.ts`, and the answer it produced was
**zero disagreement across 86 172 cell-category pairs** — structurally, because
`buildFeatureIndex` rejects all 85 as `unsupported-relation-type` before scoring.

- **It is deliberately incomplete: every relation's `members` array is EMPTIED.**
  `out geom` prints each member's full coordinate list, and 83 of the 85 are
  route relations (81 `route`, 2 `suspended:route`; the other 2 are `building`),
  several spanning hundreds of km — 77 381 members and 590 061 positions, none of
  which any consumer reads, because `relationToGeometry` checks `isArealRelation`
  before it ever calls `memberGeometries`. The count kept is `membersOmitted`, so
  the file states what it dropped instead of pretending to be a full capture.
- **The arrays are emptied, never removed.** `parseRelation` skips a relation
  whose `members` is not an array — which would take the differential's element
  count to zero and make its `unsupported-relation-type` loop pass over nothing,
  proving the opposite of what it claims. `areal-only-differential.test.ts` pins
  both halves.
- **50 kB, down from 41.4 MB as first committed** (497x). It is not a site, has
  no `s3dbCensus` and no `captureRes`, and `loadAllFixtures` must never pick it
  up — it lives in `sites/` only because it belongs to the Cologne extract.
- Re-capture with `node scripts/capture-non-areal.mjs cologne-cathedral`. It hits
  donated public infrastructure, so it is a script and never a gate.
