# `fill-state.ts`

## Purpose

The small state the fills keep in the same R2 bucket: the daily counters
behind the global cap, one failure record per cell with its backoff, and
one pending marker per queued or running fill (the backlog the fill
endpoint reads).

## Public API

- `DailyState` - `upstreamRequests`, `fills`, `failures`, `rawBytes`,
  `storedBytes` for one UTC day; `readDaily(bucket, now)` (a missing or
  damaged object reads as all zero), `writeDaily(bucket, now, state)`.
- `utcDay(now)`, `msUntilNextUtcDay(now)` - the cap's day and the wait the
  fill endpoint names in `Retry-After` once it is spent.
- `FailureRecord` - `{ count, retryAt, reason }`; `readFailure`,
  `recordFailure(bucket, cell, now, reason)` (count + 1, backoff from
  `failureBackoffMs`), `writeFailure(bucket, cell, record)` (stores a
  record as is: the fill names the reason at the end without counting a
  second failure), `clearFailure`.
- `failureBackoffMs(count)` - 1 h, doubling, capped at 7 days.
- Pending markers: `PendingFill { cell, queuedAt, running }`,
  `markPending(bucket, cell, now, running?)`, `clearPending`,
  `listPending(bucket, now)` (fresh markers, oldest first),
  `sweepPending(bucket, now)` (removes stale markers and every marker still
  flagged running), `PENDING_STALE_MS` (15 min).

## Invariants & assumptions

- **Only the serial consumer writes the counter and the records**, so
  read-modify-write needs no lock: the queue runs one message at a time
  (`max_concurrency = 1`). The fill endpoint reads them, so its cap check
  may lag one fill behind; the consumer re-checks before every upstream
  request. The endpoint writes only its own cell's pending marker, a whole
  object, never a read-modify-write.
- Keys: `state/daily/YYYY-MM-DD.json`, `state/failures/<cell>.json`,
  `state/pending/<cell>` (empty body; `queuedAt` and `running` in the
  custom metadata). They sit outside `osm/`, so the open GET routes never
  serve them.
- **A marker stops counting after 15 minutes**, the consumer's wall limit:
  a fill still marked then was killed. The consumer also sweeps markers
  still flagged running as each message starts, since it is serial and such
  a marker belongs to a killed run; so a kill holds a backlog slot only
  until the next message, at most 15 minutes.
- The pending listing reads one page (up to 1000 markers): the endpoint
  refuses new fills long before that (`MAX_PENDING_FILLS`, 4).

## Tests

`fill-state.test.ts`: the backoff ladder and its cap, damaged state reading
as empty, the reset wait, the failure record counting up, a reason
replaced without a second count, and the pending markers: fresh ones
listed oldest first, stale ones ignored, the sweep, and a property that a
listing holds exactly the fresh markers.
