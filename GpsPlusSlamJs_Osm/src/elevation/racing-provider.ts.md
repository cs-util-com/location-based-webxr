# `racing-provider.ts`

## Purpose

Asks two DEM sources at once, publishes the first answer that actually carries
heights, and swaps the better source's heights in when they land.

## Public API

- `racingProvider(preferred, fast, options?): RacingElevationProvider`
  - `preferred` — the source worth waiting for (higher resolution).
  - `fast` — the source worth showing immediately.
  - `options.sourceId` — overrides the composed id, default
    `` `${preferred.sourceId}|${fast.sourceId}` ``.
  - **THROWS at construction when the two arms share a `sourceId`.** The arms are
    told apart by that id alone (`won.id === preferred.sourceId`), so identical
    ids make a FAST win look like a preferred win: it takes the `preferredWins`
    branch, never calls `trackUpgrade()`, and the preferred source's better
    heights are fetched, resolved and **discarded**. The stats are wrong the same
    way, and all of it is silent.
    - **Not hypothetical.** `TerrariumProvider` defaults `sourceId` to
      `"terrarium"`, so the natural two-arm construction gives both the same id —
      and that is what shipped until 2026-08-19, when `dem-provider.ts` started
      naming them `mapterhorn` / `aws-open-data`. That fix is downstream; nothing
      here stopped the next caller repeating it, and neither this file's tests
      nor the property spec had ever constructed a same-id pair.
    - Checked once at construction rather than per call: the ids are known there,
      and a throw at wiring time is findable in a way a silently disabled upgrade
      path is not. Found by a PR review bot on #329.
  - `options.onUpgrade(positions, heights)` — called when `preferred` lands
    after `fast` already published. **Late binding is expected**: the worker
    builds the provider before the terrain field that consumes the upgrade, so
    this is normally a closure over a `let` assigned afterwards.
- The returned provider adds, beyond `ElevationProvider`:
  - `stats: RacingProviderStats` — `servedBy` (the `sourceId` whose heights are
    current, or `"none"`), `upgrades`, `preferredWins`, `fastWins`,
    `emptyBatches`.
  - `upgradesPending: number` — upgrades asked for and not yet delivered.
  - `awaitUpgrades(): Promise<void>` — resolves once the upgrades pending **at
    the moment of the call** have been delivered. Resolves immediately when
    there are none.

## Invariants & assumptions

- **The published heights are one source's answer verbatim, never a blend.**
  This is why `consensusProvider` is the wrong tool here: a median of two
  samples is their average, so it would smooth a LiDAR height into a coarse
  global one and throw away exactly the advantage the race exists to keep.
  Pinned by a property test.
- **An empty answer does not win the race.** A source resolving instantly with
  all `undefined` has reported "no coverage", not an answer. Letting it win
  publishes a hole, which `terrain-field.ts` mean-fills into a plausible,
  permanent, wrong height.
- **Both arms are dispatched before either is awaited.** Awaiting one first
  hangs the whole batch whenever that arm never settles — a real defect the
  tests caught in the first draft, where a stuck fast source would have stalled
  a load the preferred source had already answered.
- **Missing data never throws; an abort always does.** Same argument as
  `consensusProvider`: swallowing an abort would make a cancelled load
  indistinguishable from a DEM hole, and those want opposite handling.
- **`awaitUpgrades` snapshots.** An upgrade registered while it waits belongs to
  a later batch; joining it would let a steady stream of loads hold one RPC open
  indefinitely.
- **The upgrade only ever moves toward `preferred`, and only with usable data.**
  Pinned by a property test, because an upgrade that fires with holes would
  silently make the field worse while every "did it upgrade?" assertion stayed
  green.

## Why the stats type is not `FallbackProviderStats`

`FallbackProviderStats` counts `primaryAnswered` against `fallbackAnswered`, and
the AR overlay renders their ratio. That partition is only meaningful because
`fallbackProvider` guarantees the two sources answer **disjoint** sets of
positions. Under a race both sources answer every position, so the ratio stops
being arithmetically defined — reporting it anyway would be a confident wrong
number rather than a missing one. `servedBy` is what remains true and is what a
person in the field actually wants to know.

## Example

```ts
let applyUpgrade: ((p: readonly LatLng[], h: Heights) => void) | undefined;

const dem = racingProvider(mapterhorn, awsTerrarium, {
  onUpgrade: (positions, heights) => applyUpgrade?.(positions, heights),
});

const field = createTerrainField({ provider: dem });
applyUpgrade = (positions, heights) => field.replacePosts(positions, heights);

const heights = await dem.elevationAt(posts); // resolves on whichever is first
if (dem.upgradesPending > 0) await dem.awaitUpgrades(); // then the good ones
```

## Tests

- `racing-provider.test.ts` — arrival orders, the empty-answer rule, the upgrade
  and its two non-firing cases, failure and abort, and `servedBy`.
- `racing-provider.property.test.ts` — no blending, output length, never
  throwing for missing data, and the upgrade's direction.
