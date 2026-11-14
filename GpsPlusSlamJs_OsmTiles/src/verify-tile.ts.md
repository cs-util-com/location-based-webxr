# `verify-tile.ts`

## Purpose

One verify of a tile a viewer reported bad, run by the serial queue
consumer. The stored bytes are judged here, never by the report, so a
report can cost CPU but never a good tile or an upstream request.

## Public API

- `verifyTile(message, deps)` with `VerifyDeps { bucket, now,
dailyVerifyCap, maxDecodedBytes? }` and a `verify` `FillMessage` (`etag` optional). Returns
  a `VerifyOutcome { cell, kind: "verify", outcome, reason?, wallMs }`:
  - `missing` - no tile (already deleted or never stored);
  - `stale` - the message names another ETag: the object was replaced;
  - `verified` - the stored ETag is the memo's, judged good less than 7
    days ago (`VERIFIED_TTL_MS`); an older good memo is verified again;
  - `unfinished` - the memo for this ETag says `started`: the last verify
    of this object never finished (the runtime killed it) and would be
    killed again; nothing is read or counted, and the report endpoint
    refetches such a tile (`replace`) instead;
  - `cap` - the day's verifies are spent; nothing read;
  - `good` - the head and tail checks pass; the memo holds the ETag as
    `good` with the time;
  - `bad` with `reason` (`not-json`, `remark`, `incomplete`, `encoding`
    for a gzip stream that does not inflate, or
    `too-large` once more than `maxDecodedBytes` (default
    `MAX_TILE_DECODED_BYTES`, 150 MiB) came out of it):
    the tile and its memo are deleted, and `recordBadTile` backs the cell
    off by its bad count.
  - A failed read of the stored object (`SourceReadError`, an R2 stream
    error) is no evidence: `verifyTile` rejects with it, nothing is
    deleted or recorded, and the memo stays `started`, so the next report
    of the object refetches the tile (`replace`) instead.
- `strongEtag(etag)` - drops a `W/` prefix: the edge weakens the ETag of a
  response it compressed, and the report endpoint compares with it too.

## Invariants & assumptions

- **Counted before the work**, as fills count upstream requests: a verify
  the runtime kills (CPU) still counts against the day's cap. Right after
  the count the memo is written `started` with the ETag, before the body
  is read; a kill leaves that trace and nothing else (no delete).
- The object is streamed once (`readBodyEnds`), inflated when its
  `contentEncoding` is `gzip`; only its first 2 KB and last 512 bytes are
  kept. Legacy objects (the earlier fill's own gzip, no `storedAs`) take
  the same path and verify good.
- **A tile is deleted only on positive evidence**, because anyone can
  report and a delete costs the operators a refill: a gzip stream that
  does not inflate (a cut one included), a body past the decoded bound, a
  head that is not a JSON object, a top-level `remark` after the elements
  array (a partial answer), or an end that does not close the object with
  `}` at all. The fill's stricter checks are not repeated here: no data
  timestamp is required in the head, and the tail is not held to the
  blank-line layout Overpass writes today, so a later layout, or a tile
  stored before a fill check existed, is kept. A body cut exactly after an
  element's closing brace passes; the client rejects it when it parses,
  and its next report refetches the tile (`replace`) instead.
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
no verify, a good memo older than a week verified again, the memo written
`started` before the read and `good` after, a `started` memo answered
`unfinished` without a read, a gzip bomb stopped at the decoded bound and
deleted, a read error of a raw or gzip object keeping the tile with its
memo `started` and no failure record, the cap, the backoff growing across a refill, and a property
that a complete answer of any size, gzip or raw, is never deleted. The
positive-evidence block keeps a compact layout and a head without a
timestamp, deletes an HTML head, keeps two real Overpass tails
(`testing/overpass-tails.ts`, raw and gzip) and deletes their remark and
cut forms, and has two properties: any JSON object written by
`JSON.stringify` at any indent is kept, and any cut of a gzip tile is
deleted.
