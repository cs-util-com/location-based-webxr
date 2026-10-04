# Benchmark `/api/status` reading

## Purpose

Reads and parses Overpass's `/api/status` for the comparison benchmark, so a
request is issued when a slot is actually free and every refusal carries the
free-slot count that makes it attributable.

## Public API

- `parseStatus(body)` → snapshot `{ clientId, serverTimeMs, announcedEndpoint?,
rateLimit, unlimited, slotsAvailable, slotsAvailableAtMs, runningQueries,
nextSlotAtMs? }`. Throws `BenchmarkStatusParseError` on an empty body, a body
  with no `Rate limit:` line, or an unparseable `Current time:`.
- `msUntilSlot(status)` → milliseconds until a slot is expected free; `0` when
  one already is.
- `statusUrlFor(interpreterUrl)` → the sibling `/api/status` URL. Throws unless
  the input ends in `/api/interpreter`.
- `fetchStatus({ url, fetchImpl = fetch, timeoutMs = 15_000 })` → `{ ok, waitMs,
...snapshot }` on success, `{ ok: false, waitMs: 0, error }` otherwise.
  **Never throws.**

## Invariants and assumptions

- **This is a deliberate second implementation of
  `src/source/overpass-status.ts`.** The benchmark scripts run under bare `node`
  and cannot import TypeScript. Rather than pin this copy to the other's
  _source_, `benchmark-status.test.mjs` parses every fixture in
  `src/testdata/api-status/` with **both** implementations and asserts
  field-by-field agreement, plus agreement between `msUntilSlot` and
  `msUntilNextSlot`. Drift is therefore a red gate, not a wrong measurement.
- **Absence of the `N slots available now.` line means zero**, not unknown —
  Overpass omits it rather than printing a zero.
- **`Rate limit: 0` means unlimited**, and `slotsAvailable` is then `Infinity`.
- **Absolute slot timestamps are preferred** over the `in N seconds` figure,
  which is only accurate when the response was generated. A slot is never
  dropped on a parse miss: losing one makes the budget look healthier than it
  is, which is the direction that burns quota.
- **A failed read is never reported as a free slot.** `slotsAvailable` is
  absent, not zero and not `Infinity`, so a later refusal cannot be
  misattributed to load on the strength of a reading that never happened.
- `fetchStatus` bounds itself with an `AbortController`, because the status
  endpoint sits on the same struggling host as the query being measured.

## Example

```js
import { fetchStatus } from "./benchmark-status.mjs";

const snapshot = await fetchStatus({
  url: "https://z.overpass-api.de/api/interpreter",
});
if (snapshot.ok && snapshot.waitMs > 0) await sleep(snapshot.waitMs);
```

## Tests

`benchmark-status.test.mjs`: fixture discovery (guards a vacuous pass),
cross-implementation equivalence over every captured fixture, refusal of
unparseable bodies, status-URL derivation, idle/exhausted wait computation,
unreadable-status handling, and the self-imposed request timeout.

`benchmark-comparison-status.test.mjs` covers how the runner uses it.
