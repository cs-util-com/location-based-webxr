# `geo-event.ts`

**Purpose:** the pure half of the `GeoEvent` port — deterministic timed spawn
points on the heat map (§6, DEC-R6-14). Ported from
`GpsPlusSlamCs/Algorithms/GeoEvent.cs`.

## Public API

- `nextEventTime(now, { overlapMinutes })` — the next quarter-hour boundary.
- `eventCandidates({ bbox, globalSeed, eventTime, count })` — seeded positions.
- `climbToLocalMaximum({ start, heatAt, neighbours, steps })` — `{ cell, left,
heat }`.
- `bestPickForTile({ bbox, globalSeed, eventTime, toCell, heatAt, neighbours,
steps, batches? })` — the best position in one tile, or `undefined`.
- `newGeoEventFor({ user, tiles, ... })` — `{ eventTime, picks }`, one pick per
  tile that had a valid position, NEAREST TO THE USER FIRST.
- `QUARTER_HOUR_MS`.

Everything takes its inputs injected — no H3, no affordance index, no knowledge
of how far the heat reaches. That is what makes all of it testable in CI, and
what let it be written before the wide-heat work exists.

## Invariants & assumptions

- **Determinism is the feature.** Same seed and time give the same positions,
  forever. The seed is quantised to MINUTES exactly as the C# does — without
  that, a client whose clock is a second out computes a different position,
  which is the same failure as no determinism at all and much harder to notice.
- **Latitude and longitude are drawn from separately salted hashes.** One hash
  for both would lay every candidate on a diagonal.
- **`left: true` means "no answer", not "a weak answer".** A climb that stops
  where its own neighbourhood reaches unscored ground may simply have run out of
  map. An unfetched cell scores as the _identity_ — a plausible low number — so
  treating "no data" as "cold" places every event on the rim of whatever was
  loaded, with nothing reporting it (DEC-R6-14f).
- **Unscored neighbours are skipped during the climb, not fatal.** The first
  version abandoned on any unscored neighbour, which sounds cautious and is
  useless: the scored field is finite, so any climb near its boundary gave up
  immediately.
- **The climb compares NEIGHBOURHOOD heat**, as `GetHeatForTilePlusNeighbours`
  does — it walks towards a broad warm area rather than an isolated spike.
- **It is bounded by `steps`**, because it runs in the worker and an
  ever-rising field would otherwise walk until the process died.

## Deliberate divergences from the C#

- **Determinism is within TypeScript only** (DEC-R6-14e). The C# seeds
  `new Random((int)(globalSeed + nr + unixMinutes))` — .NET's subtractive
  generator, not reproducible in JS without porting a runtime's internals, and
  changed by .NET between versions. Positions will **not** match the C#.
- **The `heat > 9` quality gate IS ported, translated** (round 9, DEC-R9-3). An
  earlier note here said it was not, on the grounds that "the C# heat map summed
  counts where this one multiplies rule factors". **That is wrong**:
  `HeatMapTile.Heat` is documented _"Starts at 1 as the neutral multiplication
  identity element"_ and accumulates with `Heat *= elemHeat` — the same product
  over the same rule table. So `> 9` is not a tuned number: it is 9 cells x an
  identity of 1, i.e. "strictly above an entirely baseline neighbourhood". H3
  gives 7 cells, so the same rule is `> 7`, and `bestPickForTile` derives it from
  `neighbours()` rather than hard-coding it — which is also correct at H3s twelve
  pentagons, where a cell has five neighbours. The corpus measurement showing ~45 %
  of ground passing is what a deliberately permissive gate does; rejecting
  unmapped and vetoed ground is its job, and finding the good spot is the climbs.

## Known limit

Hill-climbing cannot cross flat ground. A field of mostly-identical scores gives
it nothing to follow, and the measured corpus distribution has a large mass at
and below the identity — so the quality of the spawn choice depends on the heat
map having broad gradients, which is worth checking on real data before relying
on it.

## Which tiles the caller offers

`newGeoEventFor` takes the tile list rather than deriving it, and that is a
deliberate divergence. The C# always uses the centre tile plus its three nearest
neighbours; under DEC-R9-4 fetch-on-demand that could mean four Overpass fetches
and minutes of waiting. The worker starts with the CENTRE tile alone — whose data
is already loaded, because the user is standing in it — and can widen later
without touching this function.

A tile with no valid position is SKIPPED. The C# throws for the centre tile and
logs a warning for a neighbour; a tile that is all water genuinely has no event,
and an exception would take the other tiles down with it.

## Tests

`geo-event.test.ts` — the four quarter-hour branches, determinism across seed,
time and minute-quantisation, candidate spread and containment, and the climb's
uphill / flat / bounded / left-the-field behaviours.
