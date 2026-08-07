# `/api/status` captures

Input fixtures for `source/overpass-status.ts`. Tiny plain-text files rather
than a `.ts` module, because the whole point is to parse **exactly what the
server sends**, byte for byte — a hand-retyped string would drift and would not
catch a trailing-whitespace or line-ending change.

Captured 2026-07-28 from `overpass-api.de` unless noted.

## The files

- **`idle.txt`** — real capture, 08:29 UTC. Full allocation free. Also the shape
  returned by `z.` and `lz4.` at the same moment.
- **`partially-consumed.txt`** — real capture, 08:40 UTC, after deliberately
  running queries back to back. **The important shape:** a free-slot count and a
  pending-slot line **coexist**. A parser written against `idle.txt` alone reads
  this as "1 slot free" and never notices the pending one.
- **`exhausted.txt`** — **SYNTHETIC**, derived from the two real captures by
  removing the `N slots available now.` line and adding a second pending slot.
  Overpass omits the count line entirely when nothing is free, so this is the
  zero branch.
  - **Replace this with a genuine capture when one is obtained.** Provoking it
    reliably proved awkward: firing three concurrent queries produced a 429, but
    `/api/status` sampled 600 ms later still reported the full allocation free
    (see below), so the window is narrow and costs quota to hunt.
- **`unlimited.txt`** — **SYNTHETIC**. Some instances (notably self-hosted ones
  and `overpass.kumi.systems`) report `Rate limit: 0`, meaning no limit, and omit
  the slot lines. `0` must not be read as "no slots available" — that would make
  the client refuse every request against an instance with no limit at all.

## The finding these fixtures exist because of

**`/api/status` lags actual slot consumption and cannot be used as a
pre-flight gate.** Measured: three concurrent queries returned `200, 429, 200`
while a status read 600 ms into the burst still reported `2 slots available now`.

So the client maintains **its own** budget, decremented locally the moment a
request is dispatched, and treats `/api/status` as a periodic re-sync and a
source of recovery times — never as the authority on whether the next request
will be accepted. That is why `OverpassSlotBudget` exists as a separate thing
from the parser.

## Other facts worth keeping with these files

- `Rate limit: 2` on the public instances, and **recovery is ~30 seconds**, not
  hours or a daily cap.
- All three pooled hosts return the **same `Connected as` id**, so they share one
  allocation: rotation buys failover, not quota.
- Refusal on the query endpoint is **HTTP 429** with an OSM3S body containing
  `Dispatcher_Client::request_read_and_idx::rate_limited`, arriving in ~8 s —
  distinct from the fast empty-bodied 504 that means the query itself was killed
  upstream.

Full context:
`GpsPlusSlamJs_Docs/docs/2026-07-28-1040-overpass-remeasurement-findings.md`.
