# `model/polygon-features.ts`

## Purpose

The vendored table that decides which **closed ways bound an area** versus which
are lines that happen to loop.

## Public API

- `PolygonFeatureRule` — `{ key, polygon: 'all' | 'whitelist' | 'blacklist', values? }`.
- `POLYGON_FEATURES` — 27 rules, consumed by `osm-geometry.ts`.

## Provenance

`tyrasd/osm-polygon-features` → `polygon-features.json`, the same table
`osmtogeojson` uses. Captured **2026-07-28**. It is small and stable (it changes
a few times a decade), which is what makes vendoring the right call rather than
a dependency.

To refresh it, re-fetch
`https://raw.githubusercontent.com/tyrasd/osm-polygon-features/master/polygon-features.json`
and transcribe; the differential test against `osmtogeojson` will fail loudly if
our copy and theirs diverge on any of the 18 covered tag combinations.

## Invariants & assumptions

- **This is vendored DATA, not a dependency.** The plan's rule draws the line
  between "a checked-in table we own and version" and "a library that ships code
  we execute". Reading the JSON and transcribing it does not make
  `osmtogeojson` a runtime dependency — it remains a devDependency used only by
  the differential test.
- **It is a `.ts` module, not the raw `.json`, on purpose.** JSON imports from
  an ESM package require import attributes (`with { type: 'json' }`), which
  require `module: nodenext`/`esnext`, and downstream bundlers disagree about
  all of it. We tried the JSON import first and `tsc` rejected it under this
  package's `module: ES2022`. A typed constant removes the interop question
  entirely and supplies the element type for free.
- **Semantics are per tag, first match wins:** `all` → any value makes it an
  area; `whitelist` → only the listed values do; `blacklist` → every value
  except the listed ones does.
- The table does **not** encode the `area=yes` / `area=no` override — that is
  policy and lives in `isAreaWay` in `osm-geometry.ts`, where it correctly takes
  precedence over the table.

## The three entries that matter most

These are exactly where the C# reference's `highway`-only rule went wrong:

- `highway` is a **whitelist** (`services`, `rest_area`, `escape`, `elevator`),
  so a closed `highway=footway` stays a LineString — reproducing the
  way-449879297 rule the C# oracle pins, without special-casing it.
- `barrier` is a **whitelist**, so a closed `barrier=fence` is **not** an area
  (C# made it one).
- `natural` is a **blacklist**, so a closed `natural=coastline` is **not** an
  area while `natural=water` is (C# got coastline wrong).

## Tests

- `osm-geometry.test.ts` — per-rule behaviour, including all three cases above.
- `osm-geometry.differential.test.ts` — 18 tag combinations cross-checked
  against `osmtogeojson`, which is the real guard that our transcription matches
  upstream.
