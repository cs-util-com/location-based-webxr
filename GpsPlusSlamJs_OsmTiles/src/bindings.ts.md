# `bindings.ts`

## Purpose

The minimal shapes of the Cloudflare bindings the Worker uses (R2 bucket,
queue producer, rate limiter) and of its environment. Declared
locally instead of pulling `@cloudflare/workers-types` for a handful of
methods, so the unit tests can pass small fakes.

## Public API

- `TileBucket` - `head`, `get`, `put`, `delete` with `TileObjectHead` /
  `TileObjectBody` results; a subset of `R2Bucket`.
- `FillMessage` - `{ cell, kind: "fill" | "refresh", at }`, the queue body.
- `FillQueue`, `RateLimiter`, `TileCache` - one or two methods each.
- `OsmTilesEnv` - `TILES`, `FILL_QUEUE`, optional `FILL_LIMITER`, and the
  string vars `DAILY_UPSTREAM_CAP`, `USER_AGENT`, `STORE_GZIP`.

## Invariants & assumptions

- Every var is optional and parsed defensively where it is read
  (`dailyUpstreamCap` falls back to 300 on a missing or invalid value).
- `FILL_LIMITER` is optional: without the binding the fill endpoint relies
  on the daily cap alone.

## Tests

Types only; exercised through `routes.test.ts`, `fill-tile.test.ts` and the
fakes in `testing/fake-bindings.ts`.
