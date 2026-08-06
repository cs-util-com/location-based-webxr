# `src/worker/mesh-planner.ts`

## Purpose

Answers one question per scoring pass: **does this pass have to rebuild the
city, or may it send only the region slabs?** (W6, finding R3-3.)

## Public API

- `createMeshPlanner(): MeshPlanner`
  - `needsFullBuild(inputs: MeshInputs): boolean` — and it **records the inputs
    as the new baseline whenever it answers `true`**, so two identical calls
    answer `true` then `false`.
- `MeshInputs` — `position`, `loadedTileCount`, `terrainStamp`.

## Invariants & assumptions

- **These three inputs are exactly what the geometry is a function of.**
  - `position`, because the mesh is built in an ENU frame anchored there, so
    every vertex moves when the user does;
  - `loadedTileCount`, because the feature set only grows by loading another
    fetch tile;
  - `terrainStamp`, because every builder samples heights from the held field.
- **A widening ring changes none of them, and neither does a category change.**
  The first is the item: three passes per click used to mean three full builds
  of a 2.8 km city. The second is a bonus the input-keyed design gives for free —
  switching category rebuilt everything for a recolouring the main thread does
  anyway.
- **A count for the tiles and a stamp for the terrain, not the things
  themselves.** Both are "has this been replaced?" questions; deep-comparing
  megabytes of features and a 55 000-post field every pass would cost more than
  the rebuild it avoids. Tiles are only ever added, so a count is faithful rather
  than a proxy; the terrain is replaced wholesale, so a monotonic stamp is.
- **The bias is towards rebuilding.** Anything the planner cannot prove unchanged
  counts as changed. A needless rebuild costs milliseconds; a skipped one leaves
  the city drawn for the previous position under the current position's cells.
- **Only the LAST build is remembered.** Returning to a previous position
  rebuilds, deliberately: a history of every position visited would be a leak,
  and one extra rebuild is cheaper than the bookkeeping.

## Examples

```ts
const planner = createMeshPlanner();

const full = planner.needsFullBuild({
  position: snapshot.position,
  loadedTileCount: pipeline.loadedTileCount(),
  terrainStamp,
});
return full
  ? { kind: "full", mesh: buildMesh(features, snapshot.position, regions) }
  : { kind: "regions", regions: buildRegionSlabs(regions, options) };
```

## Tests

`mesh-planner.test.ts`. One test per input the geometry depends on, because the
decision can be wrong in two directions with very different costs: too eager
gives back the whole saving, too rare draws the previous position's city. The
category-change test is the one that documents the unlooked-for win, and the
"rebuilds again after returning" test pins the deliberate choice to remember only
the last build.

**"The saving §1.2 claims, as a number" is a MEASUREMENT that happens to be a
regression guard.** The claim — a step no longer re-extrudes the city — shipped
as an assertion because nobody could time it: the e2e stubs the network, so its
fixture city is small and a full build there is cheap. But the saving is a
**rate**, not a duration, and the rate is what this module decides, so it
measures deterministically with no clock:

- 600 m walked in 20 m steps — 7 full builds instead of 30 (77 % fewer)
- 1 km walked in 20 m steps — 10 instead of 50 (80 % fewer)
- 1 km walked in 50 m steps — 10 instead of 20 (50 % fewer)

**Rebuilds are bounded by the DISTANCE travelled — about one per 110 m — not by
the NUMBER of position changes.** Against the 2 881 ms full build recorded from a
real run in `demo-worker.ts`, a 1 km walk avoids ~115 s of worker time. The
paired counterweight asserts the walked positions really are distinct, so the
measurement cannot pass for a planner that stopped consulting position at all.

The reply SHAPE this feeds (`MeshUpdate`, a discriminated `full` | `regions`) is
covered on the main-thread side by `refresh-cycle.test.ts` — that a
regions-only pass merges into the held mesh rather than blanking the buildings.
