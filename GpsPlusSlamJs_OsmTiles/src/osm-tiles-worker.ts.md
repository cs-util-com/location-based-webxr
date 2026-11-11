# `osm-tiles-worker.ts`

## Purpose

The `osm-tiles` Worker entry (`wrangler.toml` `main`): wires the bindings
into the HTTP routes and runs the serial queue consumer that fills tiles.

## Public API

- default export `{ fetch, queue }`:
  - `fetch(request, env)` - `handleRequest` with the clock and
    `caches.default` (the manifest's edge cache) where the runtime has it.
  - `queue(batch, env)` - for each message: validate the cell and kind;
    sweep the pending markers (stale ones and any still flagged running,
    which belong to a killed run) and mark this cell running; `fillTile`
    with the OSM package's `DEFAULT_OVERPASS_ENDPOINTS`, the global
    `fetch`, the `USER_AGENT` var and the daily cap; log one JSON line with
    the outcome (what `wrangler tail` and the dashboard show); clear this
    cell's marker, also when the fill threw; ack.
- `QueueBatch` - the minimal batch shape.

## Invariants & assumptions

- **Every message is acknowledged**, also one whose fill threw: the queue
  has `max_retries = 0`, and a failing tile is retried only through its
  failure record and backoff, never by the queue re-sending the request.
- Serial by configuration: `max_batch_size = 1`, `max_concurrency = 1`.
- `STORE_GZIP = "false"` stores the bytes as sent (a fallback should the
  native gzip ever exceed the plan's CPU limit); the client reads both.

## Tests

`osm-tiles-worker.test.ts`: the fetch path, an invalid message dropped and
acked, a throwing fill logged and acked, the marker cleared after a fill
that threw, and the running mark plus the sweep of a killed run's marker.
