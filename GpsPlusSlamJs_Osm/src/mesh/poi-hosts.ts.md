# `mesh/poi-hosts.ts` — where a marker goes when its thing is already drawn

## Purpose

The rule behind DEC-S1 and DEC-S2: a POI whose feature is already on screen as
geometry either **moves onto it** (a symbol over a building's roof) or **gives
way to it** (an area that describes itself). Everything else stays at its node.

## Public API

- `resolvePoiPlacement(marker, enabledLayers): PoiPlacement` — the whole rule.
- `PoiPlacement` — `{at:"node"}` | `{at:"host", host, liftM, scale}` |
  `{at:"suppressed", host}`.
- `PoiHostAnchor`, `HostableMarker`, `PoiHostLayer`.
- `hostMatches(kind, host)`, `hostScale(spanM)`, `footprintAnchor(footprint)`,
  `HOST_CLEARANCE_M`.
- `annotatePoiHosts(markers, candidates, stats?)` — the worker-side pass. The
  optional `stats: PoiHostStats` is an out-parameter for the cost guard; it
  counts `pairsConsidered` and `containsPointCalls` and is `undefined` in
  production.
- `footprintAnchor` returns `{x, y, spanM, minX, maxX, minY, maxY}`. The four
  bounds are the broad-phase box; an **empty footprint yields an inverted box**
  (`min = +Infinity`, `max = -Infinity`) so it rejects every point.

## Cost — read this before changing the loop

**This function was 65-79 % of the demo's whole mesh build, and the mistake that
put it there is worth not repeating.**

- **The work is `markers × candidates`.** Candidates are every building volume
  and every plate; markers are every POI node. Both grow with the number of tiles
  a session has loaded, and **tiles are never evicted**, so the pass is quadratic
  in session length rather than in map area.
- **Measured:** wiring this function in (`f83224c7`, 2026-08-06) took the mesh
  build from 5 109 ms to 47 977 ms on a fixed 95 887-feature corpus. In the app it
  showed up as a 17 s wait per click for a session that had visited two cities.
- **The rule this replaced had a bounding-box pre-filter and its docstring said
  why** — _"Round 5 measured what the naive shape costs on this data: a
  `parts × outlines × vertices` scan was 0.8-4.6 s per build at res-7 scale"_ —
  and that warning was deleted along with `poi-building-overlap.ts`. This section
  exists so it cannot be lost twice.
- **What is in place now:** a bounding-box reject before `containsPoint` (which
  has no short-circuit of its own), and `hostMatches` hoisted out of the pair
  loop. Ray casts dropped 977 427 → 216 at nine copies of `london-westminster`
  and are now linear in the working set. **Safe by construction:** a point
  outside a ring's bounding box cannot be inside the ring, so the reject can only
  skip work, never drop a host.
- **~~What is NOT fixed~~ — FIXED 2026-08-22, by the first of the two options
  this bullet named.** It used to read: _"the loop still visits every pair, so
  the shape is still O(markers × candidates) … making it linear needs either a
  broad-phase index over candidates or clipping the mesh input to the rendered
  extent"_ (see
  `GpsPlusSlamJs_Docs/docs/2026-08-15-1051-osm-demo-mesh-cost-plan.md`
  §4.1b/§4.2). `host-grid.ts` is that index.
  - **Pairs reached at nine copies: 5 331 420 → 1 754**, and 9× the input now
    costs **11×** the pairs rather than 81×.
  - **The stage went 205.4 → 18.3 ms** in the demo's whole mesh build, from
    17.3 % of it to 1.7 %. Isolated, `poi-hosts.bench.ts` reads
    197.15 → 13.42 ms at k=4.
  - **Output is unchanged and that is asserted, not argued.** The grid returns a
    SUPERSET in ascending candidate order, so all three filters below it and the
    resulting host order are exactly as they were; `poi-hosts-cost.test.ts`
    carries a differential against an exhaustive scan.
- **The guard is `poi-hosts-cost.test.ts`** and it asserts _counts_, not
  milliseconds — it runs the same site at 1 and 9 copies and fails if ray casts,
  or now pairs, grow faster than ~12× for 9× the input. A wall-clock threshold
  was rejected because `chunk-cost`'s 100 ms ceiling flaked at 104 ms under the
  nine-package cascade.
  - **That guard earned its keep during this very change.** The first version of
    the index held oversized candidates in a flat list checked by every marker,
    which reintroduced the quadratic with a smaller constant — 72 % of the
    remaining pairs at nine copies. The pair-growth assertion failed at 25.7×
    against its 12× bound, and the multi-level grid is the answer to it.
  - It also required **replacing** the old
    `pairsConsidered === markers × candidates` assertion, which pinned the shape
    of the algorithm rather than any behaviour. Its own docstring had called that
    "documenting the cross product rather than bounding it".

## Invariants & assumptions

- **A PURE FUNCTION OVER PRE-RESOLVED HOSTS, and the shape is forced by the
  pipeline rather than chosen.** Two facts, both read from the code rather than
  assumed:
  - **A layer toggle does not re-run the worker.** `main.ts` rebuilds three.js
    objects from the cached payload so that toggling is cheap, so a rule needing
    the layer set cannot live in the worker — it would read a stale one.
  - **Plates are clipped to the rendered extent and built after the markers.**
    "The way exists" and "the plate is drawn" are different claims; a pool near
    the tile edge is clipped away entirely. Matching against features rather
    than drawn geometry would delete the marker and draw nothing.
- **`enabledLayers` is what the caller is DRAWING.** A host on a disabled layer
  is not a host. Suppressing against geometry nobody can see is the data loss
  DEC-S1 exists to prevent, and it is live rather than theoretical: `plates` is
  off by default (DEC-R7b-5), so the naive rule would make every swimming pool
  invisible under the shipped settings.
- **The kind rule is ASYMMETRIC, and that is DEC-S7.** Strict membership for the
  four AREA kinds, where a wrong match **deletes** a marker; any building for
  symbol kinds, where a wrong match only **moves** one onto a roof. The
  aggressive rule is used exactly where being wrong is cheap — and the strict
  reading alone would miss the case the feature exists for, a restaurant node
  inside a way tagged only `building=yes`, which is most of real OSM.
- **A building never suppresses.** A grey box does not say "restaurant"; the
  symbol above it is the only thing that does. Only self-describing areas —
  pool, pitch, parking, parking space — replace their marker.
- **Anchors are ENU, x east and y NORTH, never scene coordinates.** The
  `+y north → -z` reflection belongs to `poiMarkerPosition` in the demo. A `z`
  here would be a second, disagreeing convention on the same wire, and getting
  it wrong renders a symbol 50 m south of its building, labelled correctly —
  a data error to look at, a frame error in fact.
- **The symbol grows over a large host, clamped 1×–3×** (DEC-S6). A 0.9 m symbol
  on a 60 m hospital roof is invisible from the orbit camera; an unclamped scale
  puts a ten-metre knife and fork on a stadium. **The bounds are a guess and the
  most likely thing to look wrong first** — cheap to change, worth looking at
  specifically in the first review.
- **`footprintAnchor` uses the VERTEX mean, not the area centroid**, with a
  stated bias: a curved frontage traced with many points pulls the anchor toward
  the dense side. It stays on the roof for any convex-ish building, and for the
  L-shape where it is worst the true area centroid can fall **outside** the
  polygon — so neither is right and the cheap one is honest about it.
- **Degenerate inputs return the safe answer, never `NaN`.** A zero-span host
  scales to 1 and an empty footprint anchors at the origin, because one `NaN` in
  a transform removes the object from the scene with nothing reported.

## Examples

```ts
const placement = resolvePoiPlacement(marker, new Set(["buildings"]));
if (placement.at === "host") {
  // draw `model.symbol` at (host.x, host.topM + placement.liftM, host.y),
  // scaled by placement.scale
}
```

## Tests

`poi-hosts.test.ts` — 15 examples, weighted toward the inverse cases because
those are where a marker disappears:

- No host at all, and an empty host list, both stay at the node — the common
  case by far, and the one this rule must be invisible to.
- A café moves onto its building; a pool gives way to its plate.
- **The same pool KEEPS its marker when `plates` is off** — the assertion
  DEC-S1 exists for.
- A plate does not host a café; a building does not host a pool. Both directions
  of the asymmetry.
- Several hosts: the first enabled one wins, and disabling it falls through to
  the next rather than giving up.
- `hostScale` clamped at both ends and safe on degenerate spans.
- `footprintAnchor`'s middle, its empty case, and its stated vertex-mean bias.

`poi-hosts-cost.test.ts` — how the pass GROWS, at 1 copy of the site against 9,
in counts rather than milliseconds. It pins that ray casts and pairs both grow
~9× rather than ~81×, that pairs reached stay under 1 % of the cross product,
and — the assertion that made the 2026-08-22 index safe to ship — that the
annotated output is identical to an exhaustive scan's, hosts and order alike.

`poi-hosts.bench.ts` — the cost itself, at two scales, because the constant is
tiny and the exponent was two. A single-scale number is how the 2026-08-21
investigation got this function's weight wrong by ~20×.

`host-grid.test.ts` and `host-grid.property.test.ts` cover the index underneath
— see `host-grid.ts.md`.
