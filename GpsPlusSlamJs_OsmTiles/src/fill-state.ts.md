# `fill-state.ts`

## Purpose

The small state the fills keep in the same R2 bucket: the daily counters
behind the global cap, one failure record per cell with its backoff, and
the manifest of filled cells.

## Public API

- `DailyState` - `upstreamRequests`, `fills`, `failures`, `rawBytes`,
  `storedBytes` for one UTC day; `readDaily(bucket, now)` (a missing or
  damaged object reads as all zero), `writeDaily(bucket, now, state)`.
- `utcDay(now)`, `msUntilNextUtcDay(now)` - the cap's day and the wait the
  fill endpoint names in `Retry-After` once it is spent.
- `FailureRecord` - `{ count, retryAt, reason }`; `readFailure`,
  `recordFailure(bucket, cell, now, reason)` (count + 1, backoff from
  `failureBackoffMs`), `clearFailure`.
- `failureBackoffMs(count)` - 1 h, doubling, capped at 7 days.
- `MANIFEST_KEY` (`osm/v3/manifest.tsv`), `upsertManifestLine`,
  `addToManifest(bucket, cell, osmBase, storedBytes)` - one line per cell:
  `cell<TAB>osmBase<TAB>storedBytes`, in fill order, a refill replacing its line.

## Invariants & assumptions

- **Only the serial consumer writes**, so read-modify-write needs no lock:
  the queue runs one message at a time (`max_concurrency = 1`). The fill
  endpoint only reads, so its cap check may lag one fill behind; the
  consumer re-checks before every upstream request.
- Keys: `state/daily/YYYY-MM-DD.json`, `state/failures/<cell>.json`. They
  sit outside `osm/`, so the open GET routes never serve them.
- The manifest is the list the ODbL notice points to: which cells exist and
  how old their data is.

## Tests

`fill-state.test.ts`: the backoff ladder and its cap, damaged state reading
as empty, the reset wait, the failure record counting up, and a manifest
upsert appending a new cell and replacing an existing one.
