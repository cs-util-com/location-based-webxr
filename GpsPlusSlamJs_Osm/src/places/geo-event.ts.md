# `geo-event.ts`

**Purpose:** the pure half of the `GeoEvent` port — deterministic timed spawn
points on the heat map (§6, DEC-R6-14). Ported from
`GpsPlusSlamCs/Algorithms/GeoEvent.cs`.

## Public API

- `nextEventTime(now, { overlapMinutes })` — the next quarter-hour boundary.
  - `overlapMinutes` defaults to **5** and is applied BEFORE the rounding, so
    asking at exactly 10:15 returns **10:30**, not 10:15. The "an exact boundary
    maps to itself" property holds only at `overlapMinutes: 0`.
  - The overlap models "I am arriving now, do not send me to a spawn that is
    about to move". A user PICKING a time is not arriving, so a picker must pass
    `overlapMinutes: 0` or it will show a slot 15–20 minutes after the one that
    was asked for.
- `eventCandidates({ bbox, globalSeed, eventTime, count })` — seeded positions.
- `climbToLocalMaximum({ start, heatAt, neighbours, steps })` — `{ cell, left,
heat }`.
- `bestPickForTile({ bbox, globalSeed, eventTime, toCell, toLatLng, heatAt,
neighbours, steps, threshold?, batches? })` — the best position in one tile,
  or `undefined`.
  - `toLatLng` inverts `toCell`; it is what lets a pick report WHERE THE EVENT
    IS rather than the seed the climb started from.
  - `threshold` is the per-cell bar, from the rule table's `__threshold__` for
    the category. Defaults to the multiplicative identity.
- `newGeoEventFor({ user, tiles, ... })` — `{ eventTime, picks, tilesSearched }`,
  one pick per tile that had a valid position, NEAREST TO THE USER FIRST.
  - `tilesSearched` is how many tiles were LOOKED AT, which is not
    `picks.length`: a tile that is all water is searched and yields nothing.
    Under DEC-R9-15 two devices can search different numbers, so the UI needs
    this to say "you have less loaded" rather than looking broken.
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
  - **So the winner is very often NOT the highest-scoring cell in sight, and
    this reads as a bug on the map.** It was reported as one from a live
    session: the marker sat on a cell whose tooltip said `battleArea = 1` with
    visibly higher-scoring cells directly beside it. Being SURROUNDED by
    strength beats being strong — a weak cell inside a warm cluster outranks a
    strong cell on that cluster's edge, because the edge cell's own
    neighbourhood reaches outward into the cold. Measured on the reported shape
    (a ring of 1.37 around a single 1, on a flat field of 1): the centre sums
    **11.96** against the ring's **10.85**, and the centre wins.
  - **The same property is what makes the quality gate mean anything.** The gate
    is `heat > neighbours(cell).length * threshold` — a sum over the
    neighbourhood — so one very high cell surrounded by identity ground FAILS
    it: a `4` among `0.5`s scores 8 against a gate of 9. An event is meant to
    land somewhere playable, not on one lucky hexagon.
  - **Nothing in the 2D map draws this metric**, which is why it is unverifiable
    from the picture: every cell is painted by its OWN score, and the marker's
    tooltip reports `heat`, which is already the neighbourhood sum but is not
    labelled as such. Both facts are pinned by
    "the winner is the warmest NEIGHBOURHOOD, not the warmest cell" in
    `geo-event.test.ts`.
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
  identity of 1, i.e. "strictly above an entirely baseline neighbourhood".

  The rule is now `heat > neighbours(cell).length * threshold`, derived rather
  than hard-coded — correct at H3's twelve pentagons too, where a cell has five
  neighbours. TWO CORRECTIONS LANDED 2026-08-05 and this paragraph used to state
  the pre-correction version:
  - **It said `> 7` while the code computed `neighbours().length + 1` = 8.**
    `gridDisk(cell, 1)` returns seven cells INCLUDING the centre and the sum is
    over exactly those seven, so the `+ 1` — written as though `neighbours()`
    excluded self — made the gate ~14 % stricter than this file claimed. Code
    and docstring disagreed for a round.
  - **The identity was hard-coded.** `threshold` now comes from the rule table's
    `__threshold__`, the same constant the MAP uses to call a cell usable
    ground. The shipped table declares none, so both are 1 and the two used to
    agree by coincidence rather than by construction.

  The corpus measurement showing ~45–51 % of ground passing is what a
  deliberately permissive gate does; rejecting unmapped and vetoed ground is its
  job, and finding the good spot is the climb's.

  **The gate assumes a SELF-INCLUSIVE `neighbours()`, and nothing enforces it.**
  `climbToLocalMaximum` sums `heatAt(cell)` plus each `around` while skipping
  `around === cell`, so it tolerates either convention — n cells for a
  self-inclusive one, n + 1 for a self-exclusive one — while the gate divides by
  `neighbours().length` as though the first were guaranteed. Correct for
  `gridDisk`; off by one cell for any injected `neighbours()` that excludes
  self, which is exactly what the old `+ 1` was written for.

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

## `candidate` vs `position` — the distinction to get right

A `BestPick` carries **two** coordinates and they are not interchangeable:

- `candidate` — the raw seeded point the climb STARTED from. The C# names this
  `RawStartEventPos`. It is kept only so a caller can draw what the climb did.
- `position` — the centre of `cell`, where the climb SETTLED. **This is where
  the event is**, and it is the C#'s
  `geohasher.ToLatLong(bestPick.ExactGeoHash)` (`GeoEvent.cs:87`).

Anything user-facing — a marker, a distance, a direction — must read
`position`. Both defects this caused have been fixed and are pinned by tests:
the demo's map drew its winner marker at `candidate` while its tooltip quoted
`cell`'s heat, and `newGeoEventFor` ordered picks by `candidate` where the C#
orders by the settled position (`GeoEvent.cs:107`), so "nearest event" could
name the wrong tile.

`position` is REPORTED rather than left for each caller to derive from `cell`,
because two callers deriving it separately is exactly how they drifted apart.
`toLatLng` is injected alongside `toCell`, keeping the module free of H3.

## Tests

`geo-event.test.ts` — the four quarter-hour branches, determinism across seed,
time and minute-quantisation, candidate spread and containment, and the climb's
uphill / flat / bounded / left-the-field behaviours.

It also pins **why a low-scoring cell can win**, from a live report that read as
a bug: the fixture is the reported screenshot (a ring of 1.37 around a single 1)
and the centre is asserted to be both the weakest cell of the nine and the
climb's answer. Its counterweight asserts that a lone spike fails the gate, so
the two together say what the neighbourhood metric buys and what it costs. The
counterweight uses `steps: 0` deliberately — written with a real climb first, it
measured the wrong cell, because from an isolated spike the climb walks OUT to
the surrounding field, whose neighbourhood is warmer than the pit the spike sits
in.

For `newGeoEventFor` it also pins ordering by the SETTLED position (mutating
the sort key back to `candidate` fails exactly that test) and the longitude
cosine at 51° N, where the correction flips the order. Note that the ordering
tests use a position-PRESERVING `toCell`/`toLatLng` pair: an earlier
`toCell: () => "0,0"` collapsed every tile onto one cell, which was invisible
while the sort key was `candidate` and made the sort a no-op the moment it
became `position`. A constant `toCell` cannot test ordering at all.

## `rankedPeaks` — the exhaustive alternative to climbing (DEC-A5)

`climbToLocalMaximum` **samples**: it drops candidates at random and walks each a
little way uphill, so it finds a peak only when a candidate lands on one.
Measured over a field with a single obvious maximum, the event landed on it
**0 times out of 24**.

Two attempts to widen the sampling were refuted on one invariant — **anything
that searches more of the tile must score more of the tile** — and the arithmetic
then pointed somewhere unexpected: a res-8 event tile holds only **343 res-11
chunks**, _fewer_ than a climb with useful reach needs (a 5-step res-11 climb
needs ~684 against a 488-chunk cache cap). Once all 343 are scored there is
nothing left to search for — the answer can be read off. Measured at **364 ms**
over 2 259 real features, which is a lower bound because no fixture holds a full
tile.

- **Separation is the difficulty, not the ranking.** The top cells of any real
  field are neighbours of each other — one hill yields its summit and the six
  cells around it — so a naive "top N" returns one place N times. Each pick
  excludes its own neighbourhood from those that follow.
- **Why N and not just the maximum**, which is the non-obvious half. Event
  positions **rotate every quarter hour** and must be identical across clients
  sharing a seed. Returning the single global maximum would make the event
  **static forever** — a regression against documented behaviour, dressed as a
  fix. The shortlist keeps the best ground always in the running while which of
  the good places wins still rotates.
- **Ties break by cell id**, so two areas of identical heat order the same way on
  every client. A result depending on `Map` iteration order would differ between
  clients that must agree.
- **`undefined` heat is skipped, not read as cold** — the `cellState`
  distinction between "nothing here" and "nobody looked".

**Not yet wired.** `demo-pipeline.ts` still uses `bestPickForTile`; the outcome
test that stays red until it is wired is `geo-event-search-shape.test.ts`
("lands on the peak far more often than chance", currently 0/24).
