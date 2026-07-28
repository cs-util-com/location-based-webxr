# `source/fixture-source.ts`

## Purpose

An `OsmDataSource` backed by checked-in Overpass responses. What makes the whole
package testable offline and deterministically.

## Public API

- `FixtureSource` implementing `OsmDataSource`.
- `OsmFixture` — `{ name, tile, capturedAt, payload }`.
- `FixtureSourceOptions` — `{ onMissing: 'empty' | 'throw' }`.
- `requested` — every tile id asked for, so tests can assert fetch policy.

## Invariants & assumptions

- **`fetchedAt` is the capture time, and a missing fixture yields epoch 0** —
  never `Date.now()`. A fixture result must be byte-identical across runs, or
  every downstream snapshot comparison becomes time-dependent and flaky.
- **A missing tile returns an empty tile by default**, which is what a real
  source does for genuinely unmapped ocean and keeps working-set tests simple.
  `onMissing: 'throw'` is for tests that must prove a specific tile was fetched.
- Fixtures run through the **same parser as the network path**, so a parser
  regression fails here too rather than only in production.

## The fixtures themselves

Four real captures; provenance and the S3DB census are in
[`../testdata/README.md`](../testdata/README.md). They are **res-10** tiles, not
res-8 fetch tiles: res-8 capture 504s against public instances, which is
measured and documented there.

The `beach` fixture is a single element — the entire North Sea relation, 0.99 MB
— which proves a single relation can dominate a tile's payload, and will recur
on every coastal tile.

## Tests

`fixture-source.test.ts` — contract conformance, interchangeability behind
`CachingSource`, a JSON round-trip, provenance assertions over all four
fixtures, and end-to-end parse plus geometry conversion of real data (all four
parse with **zero** skipped elements).
