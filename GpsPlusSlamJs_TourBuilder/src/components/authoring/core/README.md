# authoring/core — pure editing logic

Framework-free, browser-API-free — no `File`/`AudioContext`/DOM. Everything
here is deterministic given its inputs; the browser-facing glue lives in
`view/`.

## `id.ts`

```ts
nextId(prefix: string, existingIds: readonly string[]): string
```

Stateless: the next `prefix-N` not already present in `existingIds`, derived
from the highest existing numeric suffix (not the first free gap). No
`nanoid` dependency exists anywhere in the workspace (plan AU5); a session
that already has entries (e.g. resumed from a replay) never collides,
because ids are computed fresh from current state rather than a hidden
mutable counter.

## `breadcrumb-sampler.ts`

```ts
export const MIN_BREADCRUMB_DISTANCE_M = 3;
shouldSampleBreadcrumbPoint(last: TourCoord | null, next: TourCoord, minDistanceM?): boolean
```

The only thing standing between noisy device GPS (1–2 m jitter, TASK.md
§2.5.2) and a breadcrumb trail with a point recorded on every tick. Distance
is always measured from the last _sampled_ point, never accumulated across
small moves and never from the last raw fix. Reuses the framework's own
tested `approxDistanceMetres` (`gps-plus-slam-app-framework/geo`) rather than
writing new haversine/equirectangular math — a legitimate, narrow authoring-
time exception to "no geo math outside proximity/scene logic" (plan AU2):
nothing has been anchored yet at author time, a raw GPS fix _is_ the data
being captured.

## `breadcrumb-gate.ts`

```ts
MAX_FIX_ACCURACY_M = 20; MAX_WALK_SPEED_MPS = 5; MAX_JUMP_WITHOUT_TIMESTAMP_M = 20;
REANCHOR_FIX_COUNT = 3; REANCHOR_RADIUS_M = 5;
interface FixInfo { accuracy?: number; timestamp?: number }
createBreadcrumbGate(): { consider(coord, fix?): boolean; reanchor(coord, fix?): void }
```

Decides whether a live fix is believable enough to record, on top of the
sampler's minimum spacing (which it reuses). The sampler alone only compares
each fix with the last _recorded_ one, so a device whose fix jumps A → B → A → B
(stationary desktop, indoors) records every jump and stacks breadcrumbs on the
same spots. `consider` rejects a fix when

- its `accuracy` is worse than `MAX_FIX_ACCURACY_M` (such a fix does not count
  toward the rejected streak below either), or
- the move from the last recorded point implies more than `MAX_WALK_SPEED_MPS`
  (from timestamps; without them, a plain `MAX_JUMP_WITHOUT_TIMESTAMP_M` cap).

Recovery, so a real jump (tunnel, GPS dropout, a bad first point) does not kill
the trail: `reanchor(coord)` trusts a position outright (the session calls it
for a waypoint dropped at the live fix — never for a map click or drag, which
can be anywhere), and `REANCHOR_FIX_COUNT` rejected fixes in a row that all
lie within `REANCHOR_RADIUS_M` of each other become the new anchor. A fix back
near the anchor, or an accepted one, clears that streak, so A/B/A/B jitter
never heals. All thresholds are tunable; the values are first guesses pending
field data.

## `asset-attachment.ts`

```ts
type AssetSlot = "model" | "sprite" | "audio";
buildAssetEntry(id: AssetId, slot: AssetSlot, file: File): AssetEntry
```

Maps a slot to its `AssetType` and delegates the filename to packaging's
(component 5) `assetFilename` — no second, drifting filename convention.

## `export-tour.ts`

```ts
buildValidatedExport(state: { authoring: AuthoringSliceState }): Tour
```

`selectExportedTour` + `validateTour` in one step, so a draft can never
export something the schema itself would reject.

## Tests

`id.test.ts`, `breadcrumb-sampler.test.ts`, `breadcrumb-gate.test.ts`,
`asset-attachment.test.ts`,
`export-tour.test.ts` — pure unit tests, no framework, no DOM.
