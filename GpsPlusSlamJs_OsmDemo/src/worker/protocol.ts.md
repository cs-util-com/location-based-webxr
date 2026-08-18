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
- `TransferableMesh` — built geometry plus the status-line counters.
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
- `WorkerReply` — `{ id, ok: true, value } | { id, ok: false, message }`.
- `isWorkerReply(value)`, `isWorkerEnvelope(value)` — guards for the two
  `message` handlers.

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
- **`CALL_KINDS` is `satisfies WorkerCallKind[]`.** Without that, adding a kind
  to `WorkerCalls` and forgetting the guard produces a request the worker
  silently ignores — i.e. a promise that never settles, not a type error.
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
