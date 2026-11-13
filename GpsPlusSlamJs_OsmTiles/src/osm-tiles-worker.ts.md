# `osm-tiles-worker.ts`

## Purpose

The `osm-tiles` Worker entry (`wrangler.toml` `main`): wires the bindings
into the HTTP routes and runs the serial queue consumer that fills and
verifies tiles.

## Public API

- default export `{ fetch, queue }`:
  - `fetch(request, env)` - `handleRequest` with the clock.
  - `queue(batch, env)` - for each message: validate the cell and kind;
    sweep the pending markers (stale ones and any still flagged running,
    which belong to a killed run) and mark this cell running; `fillTile`
    with the OSM package's `DEFAULT_OVERPASS_ENDPOINTS`, the global
    `fetch`, the `USER_AGENT` var and the daily cap; log one JSON line with
    the outcome (what `wrangler tail` and the dashboard show); clear this
    cell's marker, also when the fill threw; ack. A `verify` message runs
    `verifyTile` with the `DAILY_VERIFY_CAP` var instead, logs one
    `{verify: ...}` line, and neither marks nor clears the pending marker
    (a fill of the same cell may be queued behind it).
- `QueueBatch` - the minimal batch shape.

## Invariants & assumptions

- **Every message is acknowledged**, also one whose fill threw: the queue
  has `max_retries = 0`, and a failing tile is retried only through its
  failure record and backoff, never by the queue re-sending the request.
- Serial by configuration: `max_batch_size = 1`, `max_concurrency = 1`.
  So a verify never runs beside a fill: a tile cannot be replaced between
  the verify's read and its delete.

## Tests

`osm-tiles-worker.test.ts`: the fetch path, an invalid message dropped and
acked, a throwing fill logged and acked, the marker cleared after a fill
that threw, the running mark plus the sweep of a killed run's marker, and a
verify message deleting a bad tile without touching the cell's marker.
