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

## Performance

Measured 2026-08-30 (perf loop, OSM iteration 12) on **devbox-win11** (Win 11
Pro, 11th Gen Intel i7-1185G7 @ 3.00 GHz, 8 threads, Node 24.14.1).
`overpass-parser.bench.ts` pins both scales.

- **One fixture site (2 259 elements): ~2.5 ms.**
- **Tile scale (54 216 elements): 67–101 ms**, i.e. ~1.2–1.9 µs per element.
  The cost is linear; the only open question was ever the constant.

**The perf-loop state doc predicted this would "dominate a real click". It does
not, and that prediction is retracted.** Against a mesh build that extrapolates
to ~1.5 s, the parse is a few per cent. It was never measured above fixture
scale before, which is exactly how a linear cost with a small constant acquires
a reputation it has not earned.

**The parse is allocation-bound, not compute-bound.** CPU profile self-time at
tile scale: `parseTags` 33.9 %, **garbage collection 24.9 %**, `parseGeometry`
9.8 %, `parseElement` 7.9 %. That shape is what makes local tweaks unrewarding
— the work is one `{lat, lng}` per position and one tags object per element,
not the loops around them.

- **Rejected, measured:** `Object.keys` in place of `Object.entries` in
  `parseTags`. Paired interleaved full parses, 9 runs each: 67.4 → 56.3 ms,
  **−16.5 %** — real, but under the loop's 20 % bar, and the spread
  (55–128 ms against 43–180 ms) is too wide to call it tighter.
  - Two traps this measurement walked into first, both worth knowing before
    trusting any number here: the FIRST variant timed reads ~2.7× slow from
    cold JIT unless every variant is warmed before any is measured, and an
    ISOLATED microbench of the two put them within 0.01 ms of each other. The
    end-to-end difference is GC pressure, not the iteration form — which is
    also why `vitest bench` reported it as −33 % at ±22 % rme, a figure the
    paired run does not support.
