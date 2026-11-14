# `fill-state.ts`

## Purpose

The small state the fills keep in the same R2 bucket: the daily counters
behind the global caps, one failure record per cell with its backoff, one
pending marker per queued or running fill (the backlog the fill endpoint
reads), one verifying marker per open verify (what the report endpoint
reads), and one verified memo per cell (the ETag a verify found good).

## Public API

- `DailyState` - `upstreamRequests`, `fills`, `failures`, `rawBytes`
  (decoded bytes of the fills: a raw answer's length, a gzip answer's
  trailer ISIZE), `storedBytes`, `verifies` for one UTC day; `readDaily(bucket, now)`
  (a missing or damaged object, or a field missing in a day written before
  it existed, reads as zero), `writeDaily(bucket, now, state)`.
- `utcDay(now)`, `msUntilNextUtcDay(now)` - the cap's day and the wait the
  fill endpoint names in `Retry-After` once it is spent.
- `FailureRecord` - `{ count, retryAt, reason, badCount? }`; `readFailure`,
  `recordFailure(bucket, cell, now, reason)` (count + 1, backoff from
  `failureBackoffMs`, `badCount` kept), `writeFailure(bucket, cell, record)` (stores a
  record as is: the fill names the reason at the end without counting a
  second failure), `clearFailure` (a successful fill: deletes the record,
  or, when the cell ever had a bad tile, keeps only its `badCount` with
  `count` and `retryAt` 0).
- `recordBadTile(bucket, cell, now, reason)` - a verify deleted the cell's
  tile: `badCount` + 1, `retryAt` from `failureBackoffMs(badCount)`, reason
  `bad-tile:<reason>`. The count survives successful fills, so a cell whose
  answer is always partial backs off 1 h, 2 h, 4 h, ... up to 7 days
  instead of looping fill, report, delete once an hour.
- Verify memo: `VerifiedMemo { etag, state: "good" | "started", at }`,
  `readVerified(bucket, cell)`, `writeVerified(bucket, cell, etag, at,
state = "good")`, `clearVerified`, `VERIFIED_TTL_MS` (7 days). One empty
  object per cell. The verify writes `started` before it reads the body
  and `good` after the body passed, so a `started` memo that stays is the
  trace of a verify the runtime killed. A good memo younger than the TTL
  spares a second verify of the same object; an older one is verified
  again. A memo written before it held a state reads as good with `at` 0
  (expired).
- `failureBackoffMs(count)` - 1 h, doubling, capped at 7 days.
- Pending markers: `PendingFill { cell, queuedAt, running }`,
  `markPending(bucket, cell, now, running?)`, `clearPending`,
  `listPending(bucket, now)` (fresh markers, oldest first),
  `sweepPending(bucket, now)` (removes stale markers and every marker still
  flagged running), `PENDING_STALE_MS` (15 min).
- `DailyState.replaceRequests` - of `upstreamRequests`, those a replace
  sent (0 for a day written before the field).
- The last replace: `readLastReplace(bucket, cell)` and
  `writeLastReplace(bucket, cell, at)` (an empty object
  `state/replaced/<cell>`, the time in its metadata), and
  `REPLACE_MIN_GAP_MS` (24 h), the least time between two replaces of
  one cell. These markers are kept on purpose and never swept: a
  marker older than 24 h is inert (it only says the gap has passed), so
  a sweep would buy nothing but its own list and delete operations
  (R2 Class A). Their number cannot grow without bound: at most one
  empty object per cell ever replaced, and at most `DAILY_REPLACE_CAP`
  new ones a day, against one stored tile per cell already.
- Verifying markers: `VerifyingMarker { cell, etag, queuedAt }`,
  `markVerifying(bucket, cell, etag, now)`, `readVerifying(bucket, cell,
now)` (fresh only), `clearVerifying`, `clearVerifyingIf(bucket, cell,
etag)` (clears only a marker naming `etag`, so a verify of a replaced
  object leaves the marker of the new object's report), `listVerifying(bucket, now)` (fresh
  ones), `sweepVerifying(bucket, now)` (removes the stale ones). The same
  15-minute stale age as the pending markers.

## Invariants & assumptions

- **Only the serial consumer writes the counter and the records**, so
  read-modify-write needs no lock: the queue runs one message at a time
  (`max_concurrency = 1`). The fill endpoint reads them, so its cap check
  may lag one fill behind; the consumer re-checks before every upstream
  request. The endpoints write only their own cell's markers (pending or
  verifying), whole objects, never a read-modify-write.
- Keys: `state/daily/YYYY-MM-DD.json`, `state/failures/<cell>.json`,
  `state/pending/<cell>` (empty body; `queuedAt` and `running` in the
  custom metadata), `state/verifying/<cell>` (empty body; `etag` and
  `queuedAt` in the custom metadata), `state/verified/<cell>` (empty body; `etag`, `state` and
  `at` in the custom metadata). They sit outside `osm/`, so the open GET routes never
  serve them. A memo is never wrong for long: a refill changes the ETag,
  and a memo naming another ETag is simply not a match.
- Verifies never mark a cell pending: they are no fill, and the backlog
  counts fills only.
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
replaced without a second count, the bad-tile count growing and surviving
a successful fill and ordinary failures (a cell never bad loses its record),
the verify memo (its state and time, an old memo read as expired), and
the pending markers: fresh ones
listed oldest first, stale ones ignored, the sweep, and a property that a
listing holds exactly the fresh markers; the verifying markers read,
listed, cleared and swept by their stale age, a marker naming another
object left by `clearVerifyingIf`; the last replace's round trip and the
replace counter reading 0 for an older day.
