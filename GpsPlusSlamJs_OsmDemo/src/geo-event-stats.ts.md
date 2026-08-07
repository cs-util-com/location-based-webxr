# `geo-event-stats.ts`

## Purpose

The shape of a geo-event search's cost, and the one line that reports it.

## Public API

- `GeoEventStats` — plain data, so it crosses the worker boundary:
  - `reachCells`, `tilesFetched` — how much ground the search prepared.
  - `climbsStarted`, `heatLookups` — how much climbing it then did.
  - `chunksPinnedPeak`, `pinnedOverCap` — what it held while doing it.
  - `deriveMs`, `ensureMs`, `climbMs` — where the wall clock went.
- `describeGeoEventStats(stats): string` — one line, phases first.

## Invariants & assumptions

- **Measure before optimising (DEC-G7).** The three explanations offered for
  "5–10 s with the data already cached" predict different profiles, so one
  measurement picks the lever and two cost nothing to reject. A third — "it
  keeps probing after it has enough" — is already disproved on the code alone:
  `newGeoEventFor` makes exactly one pick per tile and `bestPickForTile` returns
  at the first passing batch.
- **`pinnedOverCap` is the prediction, and it is stated up front.**
  `affordance-index.ts` sizes one candidate batch at ~190 chunks and concludes
  that against its 488-chunk cap "that cannot happen" — but a geo-event pins the
  union over up to seven tiles, on the order of ~1300. So it should be non-zero.
  **A zero is the interesting outcome**, because it would mean the reach is much
  smaller than the arithmetic says and the cost is somewhere this does not look.
- **Climbs and lookups are separate numbers, deliberately.** A climb that starts
  on unscored ground returns after ONE lookup; a climb with somewhere to go
  costs `steps × neighbours`. The two differ by two orders of magnitude, and
  only the second explains a wall-clock figure — so collapsing them into "70
  climbs" would hide the entire cost model.
- **Phases lead the line.** `ensure` dominating points at the size of the reach,
  `climb` dominating at the step count or parallelism, and neither dominating
  says the time is somewhere W7 did not instrument — which is a finding, not a
  failure.
- **Timings are rounded to whole milliseconds.** Sub-millisecond precision on a
  number that varies by seconds between runs is noise dressed as detail.

## Examples

```ts
const { event, stats } = await worker.call("geoEvent", { … });
console.info(describeGeoEventStats(stats));
// geo-event: derive 12 ms · ensure 4821 ms · climb 391 ms · 8918 cells ·
// 0 tiles fetched · 70 climbs / 2450 lookups · 1330 pinned · 842 OVER CAP
```

## Tests

`geo-event-stats.test.ts` — the phase ordering, that climbs and lookups stay
separate, that the cap line stays silent when the pinned set fits, and that it
is unmissable when it does not. The counters themselves are asserted where they
are produced, in `demo-pipeline.test.ts`.
