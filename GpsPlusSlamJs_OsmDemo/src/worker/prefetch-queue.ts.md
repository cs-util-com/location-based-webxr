# `src/worker/prefetch-queue.ts`

## Purpose

Pulls the six neighbouring res-7 fetch tiles in the background, one at a time,
and drops them the moment the user leaves (W8, DEC-R2-6) — so crossing a tile
boundary stops being an unpredictable ~15–90 s stall.

## Why there are TWO ways to drop

`replace` both drops and starts, so it can only run AFTER the foreground
fetch - a background request issued before one is the sin this module exists to
prevent. That put the dropping too late as well: until 2026-09-21 the previous
position's prefetch held one of the two slots for the whole of the next click's
fetch. `OverpassSlotBudget.tryAcquire` refuses rather than queues, the refusal
lands in `demo-pipeline`'s per-tile catch, and the tile becomes a
`missingTiles` entry - **silently missing geometry, no error anywhere**, on the
18.5% of positions whose first ring needs two tiles.

`retain` is the dropping half alone. It runs before the fetch and starts
nothing. A prefetch the new position still wants is KEPT rather than abandoned,
because discarding a 15-90 s background fetch on every click would mean it never
completes - which is what calling `stop()` there would have cost.

## Public API

- `createPrefetchQueue({ fetchTile, isLoaded?, onSettled? }): PrefetchQueue`
  - `replace(tiles)` — states the **whole** desired set. Anything not in it is
    abandoned, including the request in flight.
  - `retain(tiles)` — the DROPPING half of `replace`, on its own. Aborts the
    in-flight tile if the new set does not want it, filters the queue, and
    **starts nothing**.
  - `stop()` — abandons everything, for teardown.
  - `inFlight` / `pending` — what it is doing, for tests and for a status line.

## Invariants & assumptions

- **One request in flight, ever.** The public Overpass instances allocate ~2
  slots per client and the user's own fetch needs one of them.
- **The user's fetch is never queued behind a prefetch.** The worker calls
  `replace` _after_ the visible work, and a prefetch that is running when the
  user moves is aborted rather than awaited.
- **`replace`, not `enqueue`.** Stating the whole set is what makes "dropped for
  areas the user has left" structural rather than a rule someone has to
  remember.
- **This queue's tiles are SPECULATIVE, and the wiring is what says so.** Every
  tile here is a ring warm nobody is waiting on, so `demo-worker` passes
  `{ speculative: true }` and `OverpassSource` declines to race it — one request
  per tile rather than two. The flag deliberately lives at the CALL SITE rather
  than inside this module: the queue has no opinion about how a source fetches,
  and should not grow one. See `osm-data-source.ts.md`.
- **The abort is real.** `fetchTile(tile, signal)` is honoured all the way down
  to `fetch`, so an abandoned tile stops transferring. DEC-R2-6 singles this out
  as the part that must genuinely work rather than be nominal, and it is asserted
  on the signal rather than on the bookkeeping.
- **Nothing is requested twice.** Already-loaded tiles are skipped, the in-flight
  tile is never also queued, and the queue is bounded at 6 — the ring of a
  position overlaps the ring of the next one by up to four tiles, so without this
  a two-step walk would queue the same ~21 MB tile twice.
- **A failure is not an error.** Nothing was promised, and the next click fetches
  it in the foreground. Stopping the queue on a 429 would be the worst of both.
- **The result is NOT merged into the index.** A prefetched tile is written to
  the OPFS blob store by `CachingSource` and stops there: the next click parses
  it from disk in seconds instead of fetching it in minutes, while the in-memory
  feature set stays limited to ground the user has actually reached. Merging
  every prefetched tile would multiply the worker's memory by seven for data that
  may never be looked at.
- **The cost is accepted with the number stated: 170–400 MB per move.**
  Throttling spreads that total over time; it does not reduce it (DEC-R2-6).

## Examples

```ts
const prefetch = createPrefetchQueue({
  fetchTile: (tile, signal) =>
    source.fetchTile(tile, { signal, speculative: true }),
  isLoaded: (tile) => pipeline.hasTile(tile),
});

// After the user-visible work of each pass:
// BEFORE the user's own fetch: free the slot, start nothing.
prefetch.retain(pipeline.neighbourTilesFor(position));
const snapshot = await pipeline.update(position, category, signal, radius);
// AFTER it: state the new desired set, which starts the background work.
prefetch.replace(pipeline.neighbourTilesFor(position));
```

## Tests

`prefetch-queue.test.ts` drives it through a fetch that never settles on its own,
so timing is the test's rather than the clock's. Each test is one of DEC-R2-6's
conditions, and every one of them fails **invisibly**: a second concurrent
request only makes things slower, an undropped prefetch only pulls a tile nobody
looks at, a duplicate only doubles the bytes. None produces a wrong picture, so
none would ever be noticed without an assertion.

End to end, `playwright-tests/`'s _"the background ring prefetch"_ block counts
requests — the only way to see a cache — and asserts both that the ring is pulled
and that a prefetched tile is reused rather than fetched again.
