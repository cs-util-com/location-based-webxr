# `model/overpass-parser.ts`

## Purpose

Parses an Overpass JSON payload (produced with `out geom`) into the typed OSM
feature model. This is the package's outermost trust boundary.

## Public API

- `parseOverpassJson(payload: unknown)` → `ParseResult`:
  - `features` — successfully parsed `OsmFeature[]`.
  - `skipped` — `{ featureKey, reason }[]`, one per rejected element.
  - `copyright` — Overpass's own attribution string, when present.
  - `osmBaseTimestamp` — `osm3s.timestamp_osm_base`, i.e. how fresh the
    underlying planet data is.
- `SkippedElement`, `ParseResult`.

## Invariants & assumptions

- **Takes `unknown`, deliberately.** Callers hand it `await response.json()`.
  Typing that parameter as a well-formed shape is exactly the assumption that
  turns a bad gateway's HTML error page into a crash — and public Overpass
  instances really do return HTML error pages under load (we hit a 504 from the
  main instance while building this package).
- **Nothing throws.** Every malformed input yields `features: []` plus a named
  skip, and a bad element in the middle of a payload never costs the good
  elements around it.
- **`lon` → `lng` is converted exactly here**, at the boundary, and nowhere
  else. Coordinates outside [-90, 90] / [-180, 180] are rejected rather than
  clamped.
- **`null` positions are dropped, but a way that falls below 2 usable positions
  is skipped entirely** rather than emitted as a stub. Overpass emits `null` for
  positions outside the queried bbox; a partially materialised way stitches into
  a ring that closes in the wrong place, which is a plausible-but-wrong polygon
  and worse than a missing one.
- **A way with no `geometry` names `out geom` in its skip reason.** That case is
  a _query_ bug, not a data problem, and its symptom (an empty-looking tile) is
  otherwise indistinguishable from "nothing is mapped here".
- **Non-string tag values are dropped, not coerced.** A coerced tag is a fake
  tag: it would produce a rule key no mapper ever wrote, and could silently
  match or miss a scoring rule.
- **A relation with zero usable members is kept, not skipped.** Its tags still
  matter to diagnostics, and `toGeometry` reports the real reason with a typed
  error.
- Relation members with a missing `role` default to `''` rather than an invented
  role.

## Examples

```ts
const { features, skipped, osmBaseTimestamp } = parseOverpassJson(
  await res.json(),
);
if (skipped.length > 0) {
  logger.debug(`skipped ${skipped.length} element(s)`, skipped.slice(0, 5));
}
```

## Tests

- `overpass-parser.test.ts` — the happy path (including `lon`→`lng` and
  provenance fields); six malformed payload shapes; eight malformed element
  shapes; the "good elements either side of a bad one survive" case; clipped
  geometry with `null` entries both above and below the 2-position floor; tag
  coercion; and relation-member handling.
