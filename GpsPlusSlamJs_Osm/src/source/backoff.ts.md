# `source/backoff.ts`

## Purpose

Retry policy for Overpass requests: which statuses are retryable, how long to
wait, and an abortable sleep.

## Public API

- `RETRYABLE_STATUSES` — `{429, 502, 503, 504}`.
- `backoffDelayMs(attempt, options?)` — exponential with **full jitter**.
- `parseRetryAfterMs(header, now)` — delta-seconds or HTTP-date → ms, or
  `undefined`.
- `nextDelayMs(attempt, retryAfterHeader, now, options?)` — the delay to use.
- `sleep(ms, signal?)` — abortable.
- `abortError()` — a `DOMException`-shaped `AbortError`, matching `fetch`.

## Invariants & assumptions

- **Full jitter, not fixed exponential.** Every client that backs off on the
  same schedule retries in the same instant, turning one overload into a
  self-sustaining thundering herd. The delay is uniform over `[0, ceiling)`.
  A test asserts the spread rather than a single value.
- **The server's `Retry-After` always wins** over our own backoff — it knows its
  load, and ignoring it is how a client gets blocked — but it is capped by
  `maxDelayMs` so one bad header cannot stall the app for a day.
- **`parseRetryAfterMs` returns `undefined` rather than guessing.** The
  HTTP-date branch requires a leading day name before calling `Date.parse`,
  because `Date.parse` is extremely lenient: `Date.parse('-5')` succeeds, and
  without the gate a malformed header became a confident "retry now". That was
  a real bug, caught by the negative-seconds test.
- A past HTTP-date clamps to 0 ("retry now"), never to a negative delay.
- **`sleep` clears its timer on abort.** A pending 30 s backoff would otherwise
  keep the process alive and then retry an area the user has already left.
- 500 is deliberately **not** retryable: it usually means the query itself broke
  the server, and retrying costs quota for the same answer.

## Tests

- `backoff.test.ts` — the retryable/non-retryable split; exponential growth and
  the cap; the jitter spread; two fast-check properties (never negative, never
  above the cap, for any attempt); every `Retry-After` form including the ones
  that must return `undefined`; and abort both before and during a wait.
