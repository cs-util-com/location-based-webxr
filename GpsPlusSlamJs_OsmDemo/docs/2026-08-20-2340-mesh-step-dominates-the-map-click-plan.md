# The mesh step is 76 % of a 12.4 s map click — investigation plan

Owner report (`GpsPlusSlamJs_Docs/openTodos.md`), verbatim numbers:

```
click ring 2: 12400 ms total · mesh 9468 ms (76 %) · queue 2448 ms (20 %)
· boundary 186 ms (2 %) · score 150 ms (1 %) · derive 103 ms (1 %) · draw 45 ms
· fetch 0 ms · parse 0 ms · merge 0 ms · terrain-wait 0 ms · residual 0 ms
· tiles 0 fetched/0 net/0 cache/3 held
```

The question asked: **what is the mesh step, is it needed, can it be sped up,
and can it be made non-blocking for the heat-map tile and area computation?**

Related: [rebuild.bench.ts](../src/rebuild.bench.ts) (existing figures),
[demo-worker.ts.md](../src/worker/demo-worker.ts.md),
[mesh-planner.ts.md](../src/worker/mesh-planner.ts.md).

## What is already known, before any new measurement

**The name is misleading, and that matters for the owner's question.** `meshMs`
does **not** time `buildCellMesh` — the heat-map affordance overlay. That
function is already benchmarked at **9.9 ms for 2 718 cells**, three orders of
magnitude below the reported 9 468 ms.

`meshMs` wraps `meshUpdateFor` (`demo-worker.ts:807-809`), which on a full build
calls `buildMesh(pipeline.features().values(), …)` — **the whole 3D scene**. Its
sub-builds, in order:

- `buildBuildings`, `buildBarriers`, `buildTrees`, `buildRoads`
- `buildRegionSlabs`, `buildAreaPlates` (the last with a `TERRAIN_EXTENT_M` clip)
- POI host candidates, `annotatePoiHosts`, `dropHostedDuplicates`, POI assembly

**So the honest first answer to "is it needed for the heat map" is: no.** The
heat map is cell geometry; this is building/road/tree/POI geometry. They are
separable in principle. Whether they are separable *cheaply* is what the
measurement has to establish — the two currently share one worker round-trip and
one publish.

**The 20 % queue figure is a second signal, not noise.** `queueMs` is time the
request spent waiting before the worker started it. On a click where
`fetch/parse/merge` are all 0 ms — everything cached, 3 tiles held — 2 448 ms of
queueing means the worker was busy with something else, most plausibly the
previous ring's mesh. That is consistent with mesh cost being the root of both
lines rather than two independent problems.

## Hypotheses, in the order they will be tested

1. **One sub-build dominates.** Prediction: `buildAreaPlates` or
   `buildBuildings`, because both scale with feature count over the full
   `TERRAIN_EXTENT_M` box rather than the visible ring.
2. **Cost is super-linear in feature count.** If a sub-build contains a
   pairwise step (`annotatePoiHosts` and `dropHostedDuplicates` are the
   candidates — host matching is a spatial join), then ring 2 having ~4× the
   features of ring 1 would cost ~16×, which would explain a 9.5 s outlier that
   nobody sees in a benchmark sized for ring 1.
3. **The full rebuild is being taken when a regions-only pass would do.**
   `meshPlanner.needsFullBuild` decides. If it returns `true` on a plain ring
   widening, the expensive path runs on clicks that do not need it.
4. **The heat map is blocked behind the mesh only by sequencing**, not by data
   dependency — i.e. the publish could hand the cells over before the geometry.

## Method

- Extend `rebuild.bench.ts` with a `buildMesh` benchmark at **ring-2 scale**,
  timing each sub-build separately. Scale is taken from the demo, as the
  existing file already insists, not from convenience.
- Fixtures come from real cached tile payloads, not synthetic uniform grids —
  a synthetic grid would flatten exactly the clustering that a spatial join is
  sensitive to.
- Measure ring 1 vs ring 2 vs ring 3 to get the growth exponent, which is what
  separates hypothesis 1 from hypothesis 2. A single scale cannot.
- Only after the dominant term is identified: judge whether it is reducible,
  cacheable across rings, or movable off the click path.

## What would falsify the framing

If every sub-build comes back in the tens of milliseconds at ring-2 scale, then
the 9 468 ms is **not** in `buildMesh` at all and the timer is wrapping
something else — a `features()` materialisation, an await, or GC pressure from
`const all = [...features]`. That outcome is a real finding and would redirect
the whole investigation, so it is checked first rather than assumed away.

## Explicitly out of scope

No behaviour change to what is rendered. If the only available speedup changes
the visible output, it is measured and parked with evidence for the owner rather
than taken — the standing instruction for this session.

---

## Reconnaissance findings (before any new measurement)

Three things are already settled by reading, and they narrow the plan sharply.

### 1. Hypothesis 3 is dead: the full rebuild IS required on this click

`meshPlanner.needsFullBuild` keys on
`latBucket,lngBucket,loadedTileCount,terrainStamp` with a `POSITION_BUCKET_DEG`
of 0.001 (~110 m). Clicking a **new location** moves the bucket, so a full
rebuild is correct, not wasteful — geometry is clipped to a box around the
position, and reusing it would leave the drawn world where the last click was.
There is no easy win here, and looking for one would have been wasted effort.

### 2. Hypothesis 2 is now the leading candidate, with a named mechanism

`annotatePoiHosts` (`GpsPlusSlamJs_Osm/src/mesh/poi-hosts.ts:368`) is a
**pairwise loop over every (marker, candidate) pair** — thousands of POI markers
against hundreds of building/plate footprints — with a four-float broad phase
but **no spatial index**. Its own comments describe the shape ("a city block is
thousands of markers against hundreds of footprints").

**The existing cost test asserts the quadratic term rather than bounding it:**

```js
expect(nine.stats.pairsConsidered).toBe(nine.markers * nine.candidates);
```

So the full cross product is walked **by design**. What
`poi-hosts-cost.test.ts` actually guards is narrower — that the expensive
**ray-cast** does not grow with the cross product ("9x the input must not cost
81x the work"). The broad phase itself is unguarded and grows as the product.

**And nothing would have caught a 9.5 s cost**: the only wall-clock assertion
there is `expect(nine.ms).toBeLessThan(5_000)`, which the test explicitly labels
"a smoke alarm, NOT a performance budget". A regression could grow the broad
phase by two orders of magnitude and stay green.

This fits the owner's report better than any other candidate: ring 2 covers ~4×
the area of ring 1, which multiplies **both** markers and candidates, so the pair
count grows ~16× while the visible content grows ~4×.

### 3. `pairsConsidered` makes this measurable without a profiler

`PoiHostStats` already counts `pairsConsidered` and `containsPointCalls`. The
measurement can therefore report **pair counts at each ring**, which is a
machine-checkable growth exponent rather than a timing that varies by machine —
and it can be asserted in a test afterwards, which a wall-clock number cannot.

### Revised order of work

1. Measure `pairsConsidered` and per-sub-build time at rings 1/2/3 from a real
   fixture. Confirm or kill the POI-host hypothesis **before** optimising.
2. If confirmed, the fix is a spatial index over candidates (uniform grid keyed
   on the footprint bounds), turning the broad phase from `markers × candidates`
   into `markers × k`. This changes no output, so it stays in scope.
3. Replace the 5 s smoke alarm with a **pair-count** assertion, which is the
   guard that would actually have caught this.
4. Only then look at whether the heat map can be published ahead of the geometry
   — a 16× reduction may make the sequencing question moot, and a structural
   change nobody needs is worse than none.
