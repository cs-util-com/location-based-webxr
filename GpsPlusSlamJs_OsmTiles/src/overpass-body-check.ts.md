# `overpass-body-check.ts`

## Purpose

Decides whether an Overpass `out geom` JSON answer is complete enough to
store, without parsing it: the Worker keeps the bytes exactly as sent and a
full `JSON.parse` of a dense tile would cost CPU time the Free plan does not
have.

## Public API

- `checkOverpassBody(bytes, now?)` - `{ ok: true, osmBase }` or
  `{ ok: false, reason }` with reason one of:
  - `not-json` - the head does not start with `{`;
  - `no-timestamp` - no `osm3s.timestamp_osm_base` in the first 2 KiB, or
    one of the right shape that is not a date (month 13): it would pass the
    future check as `NaN` and become the tile's data age;
  - `future-timestamp` - that timestamp is more than an hour after `now`
    (default `Date.now()`); it would win every newer-than comparison and
    block the tile's refreshes;
  - `remark` - a top-level `"remark"` follows the elements array (Overpass
    reports a timeout or a memory abort this way, with a partial array);
  - `incomplete` - the tail does not show the top-level end (a cut
    transfer).
- `checkOverpassHead(head, now?)` - the head reasons alone (`not-json`,
  `no-timestamp`, `future-timestamp`) on the decoded head text, for a body
  whose tail is not at hand (a gzip answer, of which only the start is
  inflated).
- `checkOverpassTail(tail)` - the tail reasons alone (`remark`,
  `incomplete`) on the decoded tail text.
- `hasTopLevelRemark(tail)` - the remark test alone: a `"remark"` key after
  the closing `]` of the elements array. The verify of a stored tile uses
  it without the layout rule below, which is the fill's alone.
- `checkOverpassBody` is the two together, the tail first, as before.
- `BODY_HEAD_BYTES` (2048) and `BODY_TAIL_BYTES` (512) - the windows.

## Invariants & assumptions

- Overpass writes `osm3s` before `elements` and a `remark` after it; the
  check reads only the head and the tail, so its cost does not grow with the
  tile.
- `osmBase` is the data timestamp the fill uses to never replace a newer
  tile with an older one; it is the 20-character ISO form Overpass writes.
- A `"remark"` key inside an element's tags is not matched: the pattern needs
  the closing `]` of the elements array in front of it.
- **The top-level end is a blank line, then `]`, then `}`**, as Overpass
  writes it (checked against a stored tile: the last element closes `}`
  at column 0, an empty line, `  ]`, `}`). An element's own arrays
  (`nodes`, `geometry`, `members`) also close in `]` and `}` but never
  after a blank line, so a body cut right after an untagged way or inside a
  relation is `incomplete`. A bare `] }` at the end, the earlier rule,
  passed exactly those cuts.

## Tests

`overpass-body-check.test.ts`: a real-shaped answer, each refusal reason, a
tag named `remark` in the last element, cuts after an untagged way and
inside a relation, the empty answer as Overpass writes it, the timestamp
looked for only in the head window, a future timestamp, a timestamp of the
right shape that is no date, two real Overpass tails accepted and their
cut and remark forms refused, and a property that
a big answer is judged by its tail whatever sits in the middle.
