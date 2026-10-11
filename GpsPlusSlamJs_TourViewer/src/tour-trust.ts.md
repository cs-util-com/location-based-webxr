# tour-trust.ts

## Purpose

Trust on first use, keyed by SOURCE (tour kit plan K1, §8 D2,
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`):
the phone remembers which key signed what it opened - per link (read as
a URL, below), per printed code and per series - and warns when a source that was
signed now serves another key or no signature at all. Keyed by series
alone, the check would be bypassed by a fresh series id or a stripped
signature (the cold review's D2), which is why the sources come first.

## Public API

- `judgeTrust(known, sourceKeys, observed, nowMs)` - PURE: returns
  `{ warnings, records }`, never touching `known`. `observed` is
  `{ author: did | null, seriesId: string | null }`.
- `linkTrustKey(url)` - `link:<url>`, the url PARSED and serialised again
  without its fragment (K1 milestone review R5): URL serialisation folds the
  host's case and drops a default port, a fragment never reaches the
  server, and the query is kept (another query can name another file). A
  relative link (the Drive proxy route) keeps its path and query; text that
  is no URL stays as is. Before R5 the key was the raw text, so every
  spelling of a link was a first use. `normalizeShareUrl` does NOT do this
  (it passes an unknown host's link through byte-identical, for the cache
  key), which is why the key does it itself. Tracking parameters are NOT
  removed: no rule can tell them from a query that names a file.
- `codeTrustKey(printed)` - `code:<payload>`: a launch URL is named by its
  `?qr=` payload, so a scan (the full printed text) and a `?qr=` boot (the
  payload alone) name ONE source; any other code by its text.
- `loadTrustRecords(storage)` / `saveTrustRecords(storage, records)` and
  `trustStorage()` (`localStorage`, or undefined where it throws or is
  missing).
- `MAX_TRUST_RECORDS = 500`.
- Types `TrustObservation`, `TrustRecord`, `TrustWarning`
  (`source-key-changed`, `source-lost-signature`, `series-key-changed`),
  `TrustStorage`.

## Invariants & assumptions

- **The first key stays.** A warning does not update the record, so it
  repeats on every open instead of being learned away after one
  dismissal. The one upgrade is unsigned -> signed: the first signature a
  source shows becomes its reference.
- **What warns:** a source (link or code) that was signed by key A and
  now serves key B or no signature; a series id first seen under key A
  that turns up under another key or unsigned (a fork posing as an
  update). An unsigned source staying unsigned, the same key again, and a
  first sight are silent.
- **A signature this browser cannot check is not an observation** - the
  caller (`tour-trust-view.ts`) skips the judgement: an unchecked key must
  neither be learned nor compared.
- **No "trust the new key" action yet.** Rotation is the spare key's job
  (K-D8); accepting a new key is a decision for K2/K3. Until then a
  creator who genuinely changes key is warned about on every open of a
  source that knew the old one (recorded as an open question).
- **Storage.** `localStorage`, per device, which is all trust on first use
  is. Safari deletes script-written storage after seven days without a
  visit; the next open is then a first use again. Unreadable or throwing
  storage reads as no records and a failed write is dropped: never a
  failed open.
- **Sweep of the record cap.** An open writes up to three records (link,
  code, series), about 200 bytes each; 500 records is ~100 KB of the ~5 MB
  a browser grants `localStorage`, enough for ~160 different tours before
  the least recently seen are forgotten. No tours are in the field yet
  (signing is K2). A visitor who opens more than ~160 tours and expects
  the oldest to be remembered would reverse it; doubling it costs nothing
  measurable either.

## Tests

`tour-trust.test.ts`: first sight silent and recorded; the same key
silent; another key and a stripped signature warn per source; the code as
its own source; a known series under another key or unsigned warns; the
first key is kept so warnings repeat; unsigned -> signed upgrades; the
judgement is pure; a property that a key change always warns whatever was
seen between; storage round trip, corrupt/missing/throwing storage, a bad
record costing itself, the cap keeping the most recent; the source keys
(a scan and a `?qr=` boot name one code; links and codes never collide).
