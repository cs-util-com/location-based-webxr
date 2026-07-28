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

## Why these are res-10 tiles, not res-8 fetch tiles

> **The measurement below is provisional and is being re-run.** Owner review,
> 2026-07-28: every number came from **one IP in one session** that ran this
> capture script and its variants repeatedly. Overpass rate-limits per client IP
> with a slot system, and an **exhausted slot allocation presents to the client
> as queueing** — which is precisely the symptom the "public instances are
> saturated" reading rests on. `/api/status` reports which of the two it is, for
> our IP, directly, and it was never queried. Plan Iteration 2.5 re-measures
> (`/api/status`, then this table at a quiet hour from a different network) and
> owns the fix.
>
> Two conclusions this section originally drew are **withdrawn**: that public
> instances are globally saturated, and that capturing res-8 tiles needs a
> self-hosted instance. There will be **no server infrastructure** (owner
> decision); if the constraint survives re-measurement, the fetch _policy_
> changes shape instead — fewer, larger requests, i.e. `FETCH_RES` 8 → 7. See
> plan §5.1, §5.1.1 and §5.3.1.

**The plan assumed fixtures would be whole res-8 fetch tiles. They are not**, for
the reason below. Measured against public Overpass instances on 2026-07-28
(Cologne Volksgarten, one res-8 tile):

- `nwr[~"."~"."]` — the plan's §5.1 query — **504 Gateway Timeout** after 101 s.
- `nwr;` (no tag filter at all) — **504** after 106 s.
- Regex over the 61 keys the rule table declares — **504** after 124 s.
- Regex over a curated 23-key list — **OK**, 2.90 MB, 3157 elements, but 96 s.

The observation read as decisive at the time is that a res-**10** tile (49×
smaller, 0.015 km²) returning 60 KB still took **75 s**, and a res-9 tile timed
out — so response time is dominated by **queueing**, not by our query or the
area. **That much still holds; whose queue it was does not.** Queue wait is
independent of query size, so the res-10 control is equally consistent with "our
IP was in the penalty queue" and does not discriminate between the two
hypotheses.

So fixtures are captured at res 10: small, but real OSM data with real tag
distributions, real multipolygons and real long-tail tags — which is what
fixtures are for. **Re-capture at the real fetch-tile resolution** once plan
Iteration 2.5 has re-measured and settled the fetch policy (res 8, or res 7 if
§5.1.1 wins).

The payload extrapolation does hold, and confirms the plan's estimate: park at
res 10 is 85 elements / 0.08 MB; × 49 ≈ 4165 elements / 3.9 MB, against the
3157 elements / 2.90 MB actually measured at res 8. The plan's "low single-digit
MB for a res-8 tile" was right.

## The query is key-filtered, and why that is safe

These captures use a key filter (`nwr[~"^(highway|surface|...)$"~"."]`) rather
than the plan's unfiltered regex, because the unfiltered form does not complete.

**`SELECT_KEYS` in `scripts/capture-fixtures.mjs` is the only Overpass query in
this repo that has ever fetched real data, and it has 32 keys.** The plan's §5.1
printed a 24-key subset of it, and the "67.7 % of rule-table rows" figure quoted
in the planning docs was computed for a 23-key list — so both are narrower than
what actually works and neither describes the shipped filter. Plan Iteration 2.5
moves this constant into `src/source/overpass-query.ts` and has the capture
script import it, so production and capture cannot drift apart again; Iteration 3
then widens it from the rule-table snapshot. **Widening is free scoring signal;
narrowing is a silent hole that reads as "nothing is mapped here".**

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
