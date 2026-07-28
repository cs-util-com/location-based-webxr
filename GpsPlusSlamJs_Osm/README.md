# gps-plus-slam-osm

OpenStreetMap → H3 affordance index.

Fetches raw OSM data for the area around a user, indexes it per H3 cell, and
scores each cell against a **pluggable affordance rule table** — machine-readable
answers to "can you walk here / play here / safely spawn a virtual object here".

This package is **pure data**. It has no dependency on Three.js, on
`gps-plus-slam-app-framework`, or on `gps-plus-slam-js`. Persistence, Web
Workers and rendering are all injected or done by the consumer.

> **Status: the data layer is complete and not yet validated by eye.** Fetching,
> caching, cross-session merging, the rule table, cell coverage, indexing,
> scoring and regions all work end to end against real OSM data. What has _not_
> happened is anyone looking at the output on a map and judging whether the
> affordance vocabulary, the thresholds and the res-13 cell size suit a real
> place. Treat the numbers as arithmetically faithful to the C# reference and
> behaviourally unproven.
>
> See
> [the implementation plan](../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-28-0624-osm-h3-affordance-index-plan.md)
> for the full design and iteration order, and
> [the iterations 2.5–6 summary](../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-28-1240-osm-iterations-2_5-6-summary-and-followups.md)
> for what is still open.

## Attribution — you must display this

OpenStreetMap data is licensed under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/).
**Any application using this package MUST visibly credit OpenStreetMap:**

```
© OpenStreetMap contributors
```

Every `OsmDataSource` exposes an `attribution` string for exactly this purpose,
and it is surfaced on every result. Rendering it is the consuming
application's responsibility — this package cannot do it for you.

If you additionally use the elevation providers, their sources carry their own
attribution requirements; display those alongside.

### A note on derivative databases

ODbL's share-alike provisions apply to "derivative databases". A cached OSM
extract clearly is one; a precomputed affordance index plausibly is one. This
matters the moment an application ships OSM-derived data _inside_ its bundle or
exports it to third parties. This package's design keeps OSM data on the user's
device, which avoids the question — if your application does otherwise, get
proper legal advice before shipping.

## Network usage — read this before deploying

By default this package fetches from the **public Overpass API**, which is
donated infrastructure shared by every OSM-based application in the world. Its
total capacity is roughly 1,000,000 requests/day globally; the informal safe
budget is **<10,000 queries/day** and **<5 GB/day** per consumer.

The package takes this seriously, and the measures are specific rather than
aspirational:

- **Large fetch tiles.** One res-7 cell (2.81 km across, ~5.2 km²) per request
  instead of a seven-tile ring — and the tiles actually needed are _derived_
  from the cells about to be scored, so a move costs 1 request in a tile's
  interior and at most 3 near a vertex.
- **Permanent cache-first storage**, keyed by the fixed H3 cell rather than by
  the query bbox. A walking user produces a slightly different bbox every time,
  so a bbox-keyed cache never hits.
- **A local slot budget.** `/api/status` is parsed and used to _correct_ the
  budget, never as a pre-flight gate — measured, it lags actual consumption
  badly enough to report a full allocation while queries are being 429'd. When
  the budget is spent the client serves cache rather than queueing.
- Single-in-flight-request-per-tile deduplication, bounded concurrency,
  exponential backoff honouring `Retry-After`, and server rotation.

**On self-hosting:** an earlier version of this file recommended it for any
meaningful deployment, on the strength of a measurement that turned out to be
wrong. Public instances handle a full res-7 tile in ~18 s; what had looked like
server saturation was a pathological **key-regex** query form, since replaced by
a union of exact-key statements. Self-hosting remains available through the
`OsmDataSource` seam and is the right answer at large scale — it is no longer
the recommendation at small scale.

Observed limits on the public pool (2026-07-28): **2 concurrent slots,
recovering in ~30 seconds**, refused as HTTP 429. All three pooled hostnames
share one client identity, so rotating between them buys failover, not quota.

## Using it

The whole pipeline, end to end:

```ts
import {
  OverpassSource,
  CachingSource,
  MemoryBlobStore,
  ensureWorkingSetLoaded,
  mergeTiles,
  buildFeatureIndex,
  cellsOfChunks,
  scoreWorkingSet,
  toScoreChunk,
  loadRuleTable,
  scoreCells,
  cellsAboveThreshold,
  thresholdFor,
  connectedComponents,
  buildRegions,
} from "gps-plus-slam-osm";
import { latLngToCell } from "h3-js";
import { SCORE_CHUNK_RES } from "gps-plus-slam-osm";

const store = new MemoryBlobStore(); // or your own OPFS/IndexedDB implementation
const source = new CachingSource(
  new OverpassSource({ userAgent: "my-app/1.0 (+https://example.com)" }),
  store,
);

const { table } = await loadRuleTable({ store });

// 1. Fetch. Derives the 1-3 tiles the scoring working set actually needs.
const position = { lat: 50.9413, lng: 6.9583 };
const { loaded, deferred } = await ensureWorkingSetLoaded(source, position);

// 2. Merge overlapping / differently-aged tiles into one element set.
const merged = mergeTiles(loaded);

// 3. Index only the cells about to be scored — this bound is what keeps it fast.
const chunk = latLngToCell(position.lat, position.lng, SCORE_CHUNK_RES);
const cells = cellsOfChunks(scoreWorkingSet(chunk));
const index = buildFeatureIndex(merged.features.values(), {
  restrictTo: cells,
});

// 4. Score, and aggregate above-threshold cells into regions.
const scored = scoreCells(index, table);
const byCell = new Map(scored.cells.map((c) => [c.cell, c]));
const walkable = buildRegions(
  connectedComponents(
    cellsAboveThreshold(scored, "walkable", thresholdFor(table, "walkable")),
  ),
  "walkable",
  byCell,
);
```

Three things worth knowing before you rely on the output:

- **Scores are unbounded and NOT comparable across categories.** A cell
  overlapped by five mapped features scores far higher than the identical
  physical surface with one feature mapped — a data-completeness artefact, not a
  real signal. Threshold per category; never rank one category against another.
- **`deferred` is not an error.** It names tiles a rate limit postponed. Retry
  them once `source.budget.msUntilAvailable()` has elapsed. A caller that
  ignores it cannot tell "nothing is mapped here" from "not fetched yet".
- **Region ids identify a shape at a moment, not a place forever.** When two
  regions merge as more data loads, both ids change. Do not persist them as
  long-lived keys.

## Installation

```bash
pnpm add gps-plus-slam-osm h3-js
```

`h3-js` is a **peer dependency** (`>=4.2.1` — the version that first shipped `polygonToCellsExperimental`, which cell coverage requires) so that your application and this
package share one copy. Two copies of h3-js would produce two incompatible cell
index universes.

## Development

```bash
pnpm test              # the full gate: format, lint, cycles, typecheck, unit
pnpm run test:unit     # unit tests only (does NOT type-check — not a gate)
pnpm run bench         # comparison-harness benchmarks (not part of the gate)
pnpm run build         # tsdown -> dist/
```

`pnpm run test:unit` alone is **not** sufficient to call work done: vitest
transpiles without type-checking, so `tsc`-only errors pass locally and fail CI.
Run the full `pnpm test`.

## License

Apache-2.0 for the code in this package. The OpenStreetMap **data** it retrieves
is ODbL — see above.
