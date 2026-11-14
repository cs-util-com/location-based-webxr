# `bindings.ts`

## Purpose

The minimal shapes of the Cloudflare bindings the Worker uses (R2 bucket,
queue producer, rate limiter) and of its environment. Declared
locally instead of pulling `@cloudflare/workers-types` for a handful of
methods, so the unit tests can pass small fakes.

## Public API

- `TileBucket` - `head`, `get`, `put`, `delete`, `list` with
  `TileObjectHead` / `TileObjectBody` / `BucketListing` results
  (`BucketListOptions`: `prefix`, `limit`, `cursor`, `include`); a subset
  of `R2Bucket`.
- `FillMessage` - `{ cell, kind: "fill" | "refresh" | "verify" | "replace", at, etag? }`,
  the queue body; `etag` names the object a `verify` is about.
- `FillQueue`, `RateLimiter` - one method each.
- `OsmTilesEnv` - `TILES`, `FILL_QUEUE`, optional `FILL_LIMITER`, and the
  string vars `DAILY_UPSTREAM_CAP`, `MAX_PENDING_FILLS`,
  `DAILY_VERIFY_CAP`, `USER_AGENT`.

## Invariants & assumptions

- Every var is optional and parsed defensively where it is read
  (`DAILY_UPSTREAM_CAP` falls back to 300, `MAX_PENDING_FILLS` to 4 and
  `DAILY_VERIFY_CAP` to 50 on a missing or invalid value).
- Queue messages are data from the past: the consumer validates the cell
  and the kind of each, and a `fill` or `refresh` queued before a deploy
  stays valid after it.
- `list` returns custom metadata only when `include` names it, as R2
  does; the test fake copies that.
- `FILL_LIMITER` is optional: without the binding the fill endpoint relies
  on the daily cap alone.

## Tests

Types only; exercised through `routes.test.ts`, `fill-tile.test.ts` and the
fakes in `testing/fake-bindings.ts`.
