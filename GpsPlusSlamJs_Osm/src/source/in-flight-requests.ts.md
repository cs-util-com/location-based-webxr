# `source/in-flight-requests.ts`

## Purpose

De-duplicates concurrent requests for the same key so they make one downstream
call — **without** letting the first caller's `AbortSignal` govern the rest.

## Public API

- `class InFlightRequests<T>`
  - `join(key, dispatch, signal?): Promise<T>` — joins the request in flight for
    `key`, or starts one by calling `dispatch(internalSignal)`. Each caller gets
    its own promise, which rejects with its own `signal.reason` if that signal
    aborts.
  - `has(key): boolean` — whether a request is already running, so the caller
    can keep its own dedup counter. Deliberately not folded into `join`: the
    stat belongs to the caller, and the return type stays a plain promise.
  - `size: number` — requests currently in flight.
- Error modes: an already-aborted `signal` rejects immediately, dispatching
  nothing and joining nothing. A `dispatch` that throws synchronously is
  normalised into a rejected promise rather than escaping `join`.

## Invariants & assumptions

- **`dispatch` never receives a caller's signal.** It gets an internal one owned
  by the entry. This is the entire reason the module exists — the four-line
  `Map<string, Promise>` version that three call sites had written inherits two
  opposite bugs at once:
  - _A joiner's cancellation reaches everyone._ A prefetch and a movement
    trigger want the same tile; cancelling the prefetch aborted the shared
    request, so the movement trigger's whole working-set load rejected with an
    `AbortError` for a signal it never owned — and `loadTiles` rethrows aborts,
    so there was no `deferred`/`failed` entry to explain it.
  - _A joiner's cancellation reaches no one._ The mirror: a joiner that aborts
    cancelled nothing, because the in-flight request belonged to the first
    caller. Passing a signal looked like it worked and did not.
- **Waiters are ref-counted; the internal controller aborts only when the last
  one leaves.** A caller that passes **no** signal declares itself
  uncancellable and _pins_ the request — an unrelated abort cannot pull the
  result out from under it.
- **Each waiter is released exactly once.** "The request settled" and "this
  caller aborted" race, so both paths go through one guarded `release()`; the
  abort listener is removed on settle.
- **The shared promise carries a no-op `catch`.** If every caller detaches, the
  resulting rejection would otherwise be unobserved and Node would print an
  unhandled-rejection warning for a cancellation we asked for. Callers' own
  promises are separate and still reject normally.
- **Dispatch is synchronous**, so a caller can observe the request it just
  started (several tests depend on this, as does the concurrency semaphore in
  `OverpassSource`, which must take its slot in the same tick).
- **The key is released when the request settles**, success or failure — a
  failed tile must stay retryable rather than being poisoned by a cached
  rejection.

## Examples

```ts
private readonly inFlight = new InFlightRequests<OsmTileResult>();

fetchTile(tile: string, signal?: AbortSignal): Promise<OsmTileResult> {
  if (this.inFlight.has(tile)) this.stats.deduplicated++;
  return this.inFlight.join(tile, (own) => this.fetchUncached(tile, own), signal);
}
```

## Tests

`in-flight-requests.test.ts` — one dispatch for many callers, key release after
both success and failure, and the signal-isolation properties in both
directions: one caller's abort rejects only that caller and leaves the request
running, every caller aborting does cancel it, a signal-less caller pins it, an
already-aborted caller neither dispatches nor is counted as a waiter.

Used in anger by `overpass-source.test.ts`, `caching-source.test.ts` (which has
the prefetch-vs-movement scenario end to end) and `terrarium.test.ts`.
