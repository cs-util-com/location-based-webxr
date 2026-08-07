# `source/overpass-status.ts`

## Purpose

Parses Overpass's `/api/status` plain-text response into a typed snapshot. Pure
string → object; no I/O.

## Public API

- `parseOverpassStatus(body: string): OverpassStatus` — **throws**
  `OverpassStatusParseError` when a required field is missing or unparseable.
- `msUntilNextSlot(status): number` — 0 if a slot is free, else the wait implied
  by the snapshot, computed against the **server** clock.
- `OverpassStatusParseError` — carries the offending body (truncated) so a log
  line is actionable.

`OverpassStatus` fields: `clientId`, `serverTimeMs`, `announcedEndpoint?`,
`rateLimit`, `unlimited`, `slotsAvailable`, `slotsAvailableAtMs`,
`runningQueries`, `nextSlotAtMs?`.

## Invariants & assumptions

- **`Rate limit: 0` means UNLIMITED, not zero slots.** Reported by self-hosted
  instances and some public ones. Read naively it makes the client refuse every
  request against an instance with no limit at all — a silent, total outage that
  looks like the instance being down. `unlimited` is the flag; `slotsAvailable`
  is `Infinity`.
- **Zero availability is inferred from ABSENCE.** Overpass omits the
  `N slots available now.` line entirely rather than printing a zero.
- **A free-slot count and pending-slot lines coexist.** A parser written against
  the idle capture alone reads `partially-consumed.txt` as "1 free" and never
  notices the pending slot.
- **Times are the server's.** Recovery is derived from `serverTimeMs`, so a
  device with a skewed clock still computes a correct duration.
- **Strict about required fields, tolerant of unknown ones.** Missing
  `Rate limit:` or an unparseable `Current time:` throws; an unrecognised extra
  line is ignored, because the format carries no version and a new informational
  line must not break the client.
- CRLF is normalised before matching. Not hypothetical — a stray `\r` leaves
  `parseInt` happy while an anchored regex misses.
- If a pending slot's absolute timestamp is unparseable, the relative
  `in N seconds` figure is used rather than dropping the slot: losing a pending
  slot makes the budget look healthier than it is, which is the direction that
  burns quota.

## Examples

```ts
const res = await fetch("https://overpass-api.de/api/status");
const status = parseOverpassStatus(await res.text());
if (status.slotsAvailable === 0) {
  console.log(`wait ${msUntilNextSlot(status)} ms`);
}
```

## Tests

`overpass-status.test.ts`, entirely against byte-for-byte captures in
`../testdata/api-status/` — idle, partially-consumed, exhausted and unlimited —
plus defensive cases (HTML error page, empty body, missing rate limit, bad
date, CRLF, unknown extra line).
