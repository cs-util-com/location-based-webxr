# gps-plus-slam-osm

OpenStreetMap → H3 affordance index.

Fetches raw OSM data for the area around a user, indexes it per H3 cell, and
scores each cell against a **pluggable affordance rule table** — machine-readable
answers to "can you walk here / play here / safely spawn a virtual object here".

This package is **pure data**. It has no dependency on Three.js, on
`gps-plus-slam-app-framework`, or on `gps-plus-slam-js`. Persistence, Web
Workers and rendering are all injected or done by the consumer.

> **Status: under construction.** See
> [the implementation plan](../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-28-0624-osm-h3-affordance-index-plan.md)
> for the full design, the iteration order, and what is deliberately not built
> yet.

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

The package takes this seriously — aggressive permanent caching, large (res-8)
fetch tiles, single-in-flight-request-per-tile deduplication, bounded
concurrency, exponential backoff and server rotation are all built in. But if
you ship this to a meaningful number of users, **self-host an Overpass instance**
and pass it via the `OsmDataSource` seam. That seam exists precisely so this is
a configuration change rather than a rewrite.

## Installation

```bash
pnpm add gps-plus-slam-osm h3-js
```

`h3-js` is a **peer dependency** (`>=4.2.0`) so that your application and this
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
