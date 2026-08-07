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
