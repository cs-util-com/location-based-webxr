# `test-utils/load-fixtures.ts`

## Purpose

Loads the checked-in Overpass fixtures from `../testdata/` for use in tests.

## Public API

- `loadFixture(slug)` → `CapturedFixture`.
- `loadAllFixtures()` → every fixture in the directory.
- `FIXTURE_SLUGS` — the four slugs, so tests can `it.each` without hardcoding.
- `CapturedFixture` — `OsmFixture` plus provenance: `label`, `centre`, `bbox`,
  `query`, `capturedFrom`, `rawBytes`, `elementCount`, `s3dbCensus`,
  `regenerateWith`.

## Invariants & assumptions

- **It lives in `test-utils/`, not next to the fixtures in `testdata/`.** It
  uses `node:fs`, and `tsconfig.app.json` (the production typecheck) excludes
  `src/test-utils/**` but not `src/testdata/**`. Keeping it here is what stops a
  Node-only import from failing the production typecheck — which it did, once.
- **Fixtures are read with `readFileSync`, not `import ... from './x.json'`.**
  JSON imports in an ESM package need import attributes, which need
  `module: nodenext`. These files are test-only and always run in Node, so
  reading them avoids adding a compiler-option constraint for the sake of test
  data. Same reasoning as `model/polygon-features.ts`.
- The returned object is the raw parsed JSON. No validation: if a fixture is
  malformed the tests that consume it should fail loudly, and a validation layer
  here would only mask that.

## Tests

Consumed by `source/fixture-source.test.ts`, which asserts the provenance
fields it exposes are all present and well-formed for every fixture.
