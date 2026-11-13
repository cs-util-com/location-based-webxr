# `verify-tile.ts`

## Purpose

One verify of a tile a viewer reported bad, run by the serial queue
consumer. The stored bytes are judged here, never by the report, so a
report can cost CPU but never a good tile or an upstream request.

## Public API

- `verifyTile(message, deps)` with `VerifyDeps { bucket, now,
dailyVerifyCap }` and a `verify` `FillMessage` (`etag` optional). Returns
  a `VerifyOutcome { cell, kind: "verify", outcome, reason?, wallMs }`:
  - `missing` - no tile (already deleted or never stored);
  - `stale` - the message names another ETag: the object was replaced;
  - `verified` - the stored ETag is the memo's (verified good before);
  - `cap` - the day's verifies are spent; nothing read;
  - `good` - the head and tail checks pass; the memo now holds the ETag;
  - `bad` with `reason` (`not-json`, `no-timestamp`, `remark`,
    `incomplete`, or `encoding` for a gzip stream that does not inflate):
    the tile and its memo are deleted, and `recordBadTile` backs the cell
    off by its bad count.
- `strongEtag(etag)` - drops a `W/` prefix: the edge weakens the ETag of a
  response it compressed, and the report endpoint compares with it too.

## Invariants & assumptions

- **Counted before the work**, as fills count upstream requests: a verify
  the runtime kills (CPU) still counts against the day's cap, and changes
  nothing else (no delete, no memo).
- The object is streamed once (`readBodyEnds`), inflated when its
  `contentEncoding` is `gzip`; only its first 2 KB and last 512 bytes are
  kept. Legacy objects (the earlier fill's own gzip, no `storedAs`) take
  the same path and verify good.
- The data timestamp is checked for presence and validity only, not
  against today's clock (a stored tile's age is not a fault).
- Serial consumer: no fill runs during a verify, so the tile read is the
  tile deleted.
- CPU: the inflate costs about 1.3 ms per MB raw inside workerd up to about
  7 ms per MB measured through a JS stream in Node 24, so a dense tile's
  verify leans on the Free plan's burst budget; reports are rare and the
  daily cap (50 by default) bounds the total.

## Example

```ts
const outcome = await verifyTile(
  { cell, kind: "verify", at: Date.now(), etag },
  { bucket: env.TILES, now: () => Date.now(), dailyVerifyCap: 50 },
);
```

## Tests

`verify-tile.test.ts`: a good gzip tile kept with its memo and one verify
counted, a gzip tile with a tail remark deleted with backoff, a cut raw
tile deleted, a gzip that does not inflate deleted, a legacy tile kept, a
replaced object (stale) and a missing one left alone, a memo hit costing
no verify, the cap, the backoff growing across a refill, and a property
that a complete answer of any size, gzip or raw, is never deleted.
