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
- **The merged features never leave.** They are 28–68 MB. `explainCell` and the
  mesh build both run here _because_ that is where the features are; answering
  either on the main thread would mean shipping them across.
- **`inFlight` maps request id → `AbortController`**, which is what makes `abort`
  stop real work rather than just discard a reply.
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
