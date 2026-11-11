# `overpass-body-check.ts`

## Purpose

Decides whether an Overpass `out geom` JSON answer is complete enough to
store, without parsing it: the Worker keeps the bytes exactly as sent and a
full `JSON.parse` of a dense tile would cost CPU time the Free plan does not
have.

## Public API

- `checkOverpassBody(bytes)` - `{ ok: true, osmBase }` or
  `{ ok: false, reason }` with reason one of:
  - `not-json` - the head does not start with `{`;
  - `no-timestamp` - no `osm3s.timestamp_osm_base` in the first 2 KiB;
  - `remark` - a top-level `"remark"` follows the elements array (Overpass
    reports a timeout or a memory abort this way, with a partial array);
  - `incomplete` - the last 512 bytes do not end in `] }` (a cut transfer).

## Invariants & assumptions

- Overpass writes `osm3s` before `elements` and a `remark` after it; the
  check reads only the head and the tail, so its cost does not grow with the
  tile.
- `osmBase` is the data timestamp the fill uses to never replace a newer
  tile with an older one; it is the 20-character ISO form Overpass writes.
- A `"remark"` key inside an element's tags is not matched: the pattern needs
  the closing `]` of the elements array in front of it.

## Tests

`overpass-body-check.test.ts`: a real-shaped answer, each refusal reason, a
tag named `remark` in the last element, and a property that a big answer is
judged by its tail whatever sits in the middle.
