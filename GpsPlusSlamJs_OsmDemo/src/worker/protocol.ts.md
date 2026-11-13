# `worker/protocol.ts`

## Purpose

The main-thread ↔ worker contract, expressed as data: one request union, one reply
union, and two runtime guards. No behaviour.

## Public API

- `WorkerCalls` — the map from call kind to `{ request, result }`. **The single
  source of truth**: `WorkerCallKind` is `keyof WorkerCalls`, the client's `call`
  is generic over it, and the worker's `handle` switches on it. Adding a call
  means editing exactly this one type plus the two places the compiler then
  points at.
- `TransferableMesh` — built geometry plus the status-line counters. Since
  objects M2a it carries `cosmeticTrees` (the woods layer's invented trees,
  plain placements, structured-cloned like `trees`); since objects M5
  `furniture` (`City.furniture`, mapped lamps and bollards, plain placements).
- `UpdateResult`, `TerrainResult` — the two compound results.
  - `TerrainResult.demSourceId` — the worker provider's own `sourceId`
    (`mapterhorn+terrarium`), reported **on the result rather than shared as a
    constant** so the label the AR readout renders can only describe the
    provider that actually sampled the field. Composed, never per-sample —
    see `dem-provider.ts.md`.
  - `TerrainResult.demStats` — a snapshot of the composed provider's
    session-cumulative serving counters (`FallbackProviderStats`: positions
    the primary answered, the fallback filled, and neither). The three raw
    counts rather than a derived percentage: a pct would invent a rounding
    and a 0/0 corner and hide the denominator. Optional, so a fake or an
    older worker degrades to the composed-id-only HUD label.
- `WorkerEnvelope` — what the main thread posts, including `{ kind: 'abort',
target }`.
- `WorkerReply` - `{ id, ok: true, value } | { id, ok: false, message, failedBuild? }`;
  `failedBuild` (`MeshBuildChoices`) is set only for a failed city build.
- `MeshBuildChoices` - what the user chose to build (`colourScheme`,
  `inventedRoofs`, `markings`, all required; each later build switch adds its field). `isMeshBuildChoices(value)` guards it and refuses a reply missing any.
- `MeshBuildError` - the error class that carries `failedBuild` in the worker
  and out of the RPC client; `failedBuildOf(error)` reads it back.
- `isWorkerReply(value)`, `isWorkerEnvelope(value)` — guards for the two
  `message` handlers.
- `WorkerNotice` - `{ notice: "downloadStarted" }`, the worker's one
  unsolicited message: a tile fetch someone waits on went past the OPFS cache.
  Never posted for a cache hit or a ring warm. It has no `id`, so
  `isWorkerReply` rejects it; `isWorkerNotice(value)` guards it and rejects
  anything carrying an `id`, so a reply with a stray `notice` field is never
  swallowed. The page's loading overlay names a download only after one
  (`loading-announcer.ts`). It is the protocol's one push and exists only for
  live wait state that cannot ride a reply; the terrain flows still answer on
  replies (`meshOutdated`, the `terrainUpgrade` call), because a result the page
  must apply belongs on the call that asked for it.

## Invariants & assumptions

- **Everything here must survive `structuredClone`.** No class instances, no
  functions, no getters. This is a **runtime** contract TypeScript cannot check:
  the failure is either `DataCloneError` or — worse — a value that arrives
  silently stripped of its methods and looks correct until one is called.
  - The sharpest case is `Heightfield`, whose `heightAt` is a method. It does
    **not** cross; `HeightfieldData` does, and `heightfieldFrom` rebuilds the
    sampler. Anything else growing a method has the same problem.
- **Trees cross as `TreePlacement` (ENU), not as scene coordinates.** The ENU→
  scene reflection (`+y` north becomes `-z` north) is a real trap, but
  the package's `packInstances` applies it and is unit-tested where it lives.
  Moving the conversion here would drag it into a module that must not import
  `three`.
- **`CALL_KINDS` is built from a `Record<WorkerCallKind, true>`.** Without
  that, adding a kind to `WorkerCalls` and forgetting the guard produces a
  request the worker silently ignores — i.e. a promise that never settles, not
  a type error. It was a `satisfies WorkerCallKind[]` list until 2026-10-06,
  which checks only that each entry is a kind, not that every kind is there:
  `terrainUpgrade` was missing, so every DEM upgrade was dropped and
  `terrain-cycle.ts`'s upgrade waited forever.
- **Replies are a discriminated result, never a thrown error.** An exception in a
  worker rejects nothing on the main thread. A failure not turned into a message
  is a hung demo, which is strictly worse than a reported one.
- **Three calls run in the worker because their state cannot cross, not because
  they are slow**: `geoEvent` (the affordance index is private inside the
  pipeline and the hill climb reads it through synchronous callbacks),
  `explain` (the provenance map), and `planRoute` (`ObstacleIndex` exposes
  `obstaclesIn` as a **method** and holds `Map`s). Only the finished answer
  crosses in each case.
  - `planRoute` additionally runs **synchronously**, so it delays the next
    `update` — i.e. the publish. The expansion cap in `agent-route.ts` is
    therefore a publish-latency bound as well as a click-freeze bound, and an
    `abort` cannot preempt a route in flight because the search never yields to
    check the signal. A second click queues behind the first; `latest-only.ts`
    keeps the superseded REPLY from being applied, and the worker still pays for
    both searches.
  - `planRoute`'s `frameOrigin` is **required**, unlike the optional one on
    `update`, `terrain` and `cellMesh`. Those default to their own position so a
    caller predating the fixed origin is unchanged; nothing predates this call,
    and a route planned in a frame the scene is not drawn in puts the polyline
    where the agent is not.

## Examples

```ts
// Adding a call: edit WorkerCalls, then follow the two compile errors.
readonly regions: {
  readonly request: { readonly category: string };
  readonly result: readonly Region[];
};
```

## Tests

`worker-round-trip.test.ts` — the clone contract, using `toStrictEqual`
throughout (`toEqual` ignores object **type**, so a class instance compares equal
to the plain object it clones into, passing for exactly the value that fails).
`rpc-client.test.ts` covers the guards' behaviour on foreign messages.
`protocol.test.ts` checks that `isWorkerEnvelope` accepts every call kind (its
list is a `Record` over the union too, so it cannot fall behind) and rejects
unknown kinds, a missing id and a malformed abort.

## `groundTint` (colour schemes plan 2026-11-10-0841 S3)

`TransferableMesh.groundTint?: GroundTint` - the land-use tint over the build
window. Cloneable (a typed array, numbers, the palette as an array of plain
objects); COPIED rather than
transferred (about 2 MB at most), see `demo-worker.ts`.

## `colourScheme` (colour schemes plan 2026-11-10-0841 section 4.4)

- Request: `update.request.colourScheme?` - the scheme's NAME; omitted is the
  default. The worker refuses a name outside the table as that scheme's build
  failure.
- Reply: `TransferableMesh.colourScheme?` - the scheme the mesh was built in;
  the page's ground, plates and trim follow it, and the dropdown's switch ends
  on it.

## `buildKey` / `drawnBuildKey`

- Reply: `TransferableMesh.buildKey` - the full build's identity
  (`meshBuildKey` in `mesh-planner.ts`).
- Request: `update.request.drawnBuildKey?` - the key of the full mesh the page
  draws, absent when it draws none. The worker builds in full whenever this
  pass's key differs, so a dropped reply never leaves the page on an older
  build while the worker believes it current.

## `groundTint`

- Request: `update.request.groundTint?` - whether the full build includes the
  land-use ground tint; omitted means `true`. The page sends `false` while AR
  runs (AR draws no ground plane). It is a build choice, so it is in the build
  key and a change rebuilds.

## `markings`

- Request: `update.request.markings?` - whether the full build paints zebra
  crossings and draws the mapped pedestrian areas; omitted means `true`; part
  of the build key.
- Reply: `TransferableMesh.markings?` echoes it (absent means `true`).
- `MeshBuildChoices.markings` names it in every failed build.

## `inventedRoofs`

- Request: `update.request.inventedRoofs?` and `planRoute.request.inventedRoofs?`
  - whether buildings without a mapped roof shape get a planned roof; omitted
    means `true`.
- Reply: `TransferableMesh.inventedRoofs?` echoes the choice the mesh was built
  with (absent means `true`), so the page's switch ends on the durable build.
- `MeshBuildChoices.inventedRoofs` names it in every failed build, the unknown-scheme refusal included (resolved there as the build would: absent is on).
- `TransferableMesh.inventedRoofCount` - how many volumes carry an invented
  pitched roof (`roofIsInvented`), for the status line.
