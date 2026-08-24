# `terrain-upgrade-sink.ts`

## Purpose

Connects the DEM race's late, better heights to the post lattice, and reports a
change only when the lattice actually took them.

## Public API

- `createTerrainUpgradeSink(field, onChanged)` → the callback to hand to
  `createDemProvider`'s `onUpgrade`. **Returns `replacePosts`' verdict**, so
  the provider withholds its `servedBy` claim on a refusal (PR #332 review).
  - `field` — anything with `replacePosts(positions, heights): boolean`. Narrowed
    to that one method so tests need no terrain field.
  - `onChanged` — called **only** when `replacePosts` returned `true`. In the
    worker this bumps `terrainStamp`.

## Invariants & assumptions

- **`replacePosts`'s return value is load-bearing.** It refuses a batch that
  would leave the current window standing on two different DEMs at once. A
  refusal must not be reported as a change: the page rebuilds its mesh whenever
  the terrain stamp moves, so bumping on a refusal buys a full rebuild that
  produces a pixel-identical result — on every walk, invisibly.
- **The sink is synchronous and does not throw.** It runs inside the provider's
  upgrade continuation, where a rejection would surface as an unhandled promise
  rejection in a worker, i.e. nowhere a user or a test would see it.

## Why this is a module rather than three lines in `demo-worker.ts`

It began as three lines there. Nothing in the demo's test suite imports the
worker script — it is a side-effect module that installs an `onmessage` handler
— so a version of those lines that did **nothing at all** passed every test in
the repo. That was established by mutation, not suspected: replacing the body
with a no-op left 16 of 16 related tests green.

Each layer's own tests prove only its own half. `racing-provider.test.ts` proves
the provider calls `onUpgrade`; `terrain-field.upgrade.test.ts` proves
`replacePosts` changes sampled heights. Neither proves the two are wired
together, and that wiring is the feature. This module is the smallest thing that
can hold the assertion.

## Example

```ts
let applyUpgrade: ((p, h) => void) | undefined;
const dem = createDemProvider({
  store,
  decodePng,
  onUpgrade: (positions, heights) => applyUpgrade?.(positions, heights),
});
const terrainField = createTerrainField({ provider: dem });
applyUpgrade = createTerrainUpgradeSink(terrainField, () => {
  terrainStamp += 1;
});
```

The late binding is unavoidable rather than untidy: the provider must exist
before the field can be given it, and the sink must call back into that field.

## Tests

- `terrain-upgrade-sink.test.ts` — the batch reaches the lattice, and a change
  is reported only on acceptance.
