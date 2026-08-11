# `worker/demo-worker.ts`

## Purpose

The worker entry point: everything expensive in the demo, off the UI thread. Owns
the data source, the OPFS tile cache, the rule table, the affordance index, the
mesh build, the DEM sampling and `explainCell`.

## Public API

None — it is an entry point, not a module. It registers one `message` listener and
is reached only through `worker/protocol.ts`.

**It is listed in `knip.json` under `GpsPlusSlamJs_OsmDemo.entry`**, because knip's
Vite detection finds `src/main.ts` through `index.html` but does not follow
`new Worker(new URL(...))`. Without that entry the whole file reads as dead code.

## Invariants & assumptions

- **Never import this from a test.** It calls `self.addEventListener` at import
  time, so importing it into a vitest run wires a worker message handler onto the
  main thread. That is why `describeTerrain` lives in `terrain-note.ts` — the
  test needed it and could not reach in here for it.
- **Every request path replies.** An exception in a worker rejects nothing on the
  main thread; a request whose failure is not turned into a message is a promise
  that never settles. Both `then` arms post, and both check `signal.aborted` first
  so a superseded request stays superseded.
- **The heightfield is held here, not passed in per request.** Buildings, trees
  and (later) the ground layers must stand on the _same_ surface, and the surface
  is per-position while the mesh is also rebuilt on a category change. One owner
  means the main thread cannot hand back a stale field — the exact bug
  `terrain-cycle.ts` was written to prevent when both lived on the main thread.
  - A DEM outage stores `undefined`, deliberately, so a later mesh build cannot
    silently stand on the **previous** position's relief.
- **OPFS works here, and is better here.** `navigator.storage.getDirectory()` is
  available in workers, and OPFS offers synchronous access handles only off the
  main thread. The tile cache moved with the fetching rather than staying behind.
- **The merged features never leave.** They are ~21 MB. `explainCell` and the
  mesh build both run here _because_ that is where the features are; answering
  either on the main thread would mean shipping them across.
- **The obstacle index is held here too, and is built LAZILY** — on the first
  `planRoute` request of a feature set, not on the publish path
  (`obstacle-index-cache.ts`, DEC-R11-19 amending DEC-R11-16). The corpus
  measurement put a res-13 sweep at ~1 900–2 700 covered cells and a few hundred
  milliseconds per extract, on extracts smaller than the demo's own working set,
  so building it inside `buildMesh` would slow every publish for a feature most
  sessions never use. It is keyed on `pipeline.loadedTileCount()` rather than on
  the mesh planner's key, because that key also carries `terrainStamp` and
  terrain does not change what blocks an agent.
- **`planRoute` is the one SYNCHRONOUS long handler**, so it delays the next
  `update`. Its expansion cap (`agent-route.ts`) is therefore a publish-latency
  bound as well as a click-freeze bound, and `abort` cannot preempt it — the
  search never yields to check the signal. This is the one place where the
  `inFlight` cancellation below does not actually stop work.
- **`inFlight` maps request id → `AbortController`**, which is what makes `abort`
  stop real work rather than just discard a reply.
  - **The signal has to go INTO the work, not only be checked after it.** Both
    long paths now do: `pipeline.update(..., signal)` and
    `terrainField.ensureAround(..., signal)`. Terrain was the outlier until #270
    — the `signal.aborted` check after it meant nothing stale was ever applied,
    but it could only run once the whole DEM batch had been pulled, so every
    superseded load was paid for in full. An unsignalled call is worse than
    merely uncancellable there: `InFlightRequests` marks it `pinned`, which pins
    the request for every other joiner too. **A post-hoc check is a correctness
    guard, never a cost one.**
- **This is the first consumer to exercise `gps-plus-slam-osm`'s worker-safety.**
  The package documents the claim in six places and shapes its public types around
  it; nothing had ever tested it. Treat it as newly verified rather than
  long-established.

## Examples

Not called directly. The shape of one handler:

```ts
case "explain": {
  const scored = pipeline.scoreFor(cell);          // provenance map, not geometry
  if (scored === undefined) return undefined;
  const covering = Object.keys(scored.contributors[category] ?? {}) /* … */;
  return explainCell(cell, covering, table, category);
}
```

## Tests

No direct unit test — see the import warning above. It is covered by the e2e
suite, all 24 tests of which now run through it (notably the OPFS cache-hit test,
the terrain test and the details-panel test, which exercise the three non-trivial
handlers). `worker-round-trip.test.ts` and `rpc-client.test.ts` cover the boundary
it sits behind.

## `workerTimings` — stages 6 and 7

The `update` handler reports `terrainWaitMs`, `meshMs` and its own
`workerTotalMs` beside the snapshot (click-path plan, milestone 3).

- **Beside the snapshot, not on it.** `DemoPipeline.update` builds the snapshot
  before either stage has happened; the terrain join and the mesh build are this
  handler's work. Putting them on the snapshot would mean mutating it after the
  fact.
- **`terrainWaitMs` is the stage the plan's first enumeration missed.** W3 runs
  the terrain load concurrently with the fetch and the scoring, so the join
  costs nothing when those are slow — and a fully cached refresh is exactly when
  they are not, which is the corner where a concurrent load becomes a visible
  wait. Legitimately zero on a category change or a widening ring.
- **`workerTotalMs` exists so the page can derive the transfer stage** without
  subtracting a worker timestamp from a page one. See `click-timings.ts.md`.
