# regenerate-qr-oracle-fixture.mjs

## Purpose

Writes `src/utils/qr-payload/qr-size-estimator.oracle.json`, the stored
answers of the `qrcode` oracle that `qr-size-estimator.test.ts` checks the
size estimator against (gate-speed plan 2026-10-04, G3; milestone review R10).

## Public API

- CLI: `pnpm run regenerate:qr-oracle` in `GpsPlusSlamJs_AppFramework`
  (or `node scripts/regenerate-qr-oracle-fixture.mjs`). Writes the fixture
  from the installed `qrcode` and prints its path and version.
- `deriveOracleFixture(versionOf, oracleLabel, maxChars?)`: the derivation,
  pure over an injected oracle (`versionOf(payload, ec) -> version`,
  `Infinity` when nothing fits). Returns
  `{ oracle, boundaries[ec][mode][version - 1], mixed[{ payload, versions }] }`.
- `EC_LEVELS`, `MODE_CHARS`, `MIXED_PAYLOADS`, `FIXTURE_PATH`.

## Invariants & assumptions

- The boundaries come from a binary search on the ORACLE alone, so the
  table never leans on the estimator it checks.
- The oracle's version grows with the repeat count; the binary search
  relies on it, as the test's two-point check does.
- The fixture records `qrcode@<version>`. `qr-size-estimator.test.ts` fails
  when the installed `qrcode` version differs, naming this script, and its
  live block (run when `GATE_SKIP_BROWSER_STAGES` is unset: CI and the
  milestone run) re-asks the live oracle at every stored boundary.
- `MIXED_PAYLOADS` must equal the test's list; the test asserts it.

## When to run it

After a `qrcode` upgrade (the version test says so), or when the mixed
payload list changes. Then run `pnpm run format` (or any gate): the script
writes plain `JSON.stringify` output and Prettier lays the arrays out
differently. Verified 2026-10-04: regenerating from qrcode@1.5.4 and
formatting reproduces the committed fixture byte for byte. Commit the JSON
with the change.

## Tests

`regenerate-qr-oracle-fixture.test.mjs`: a fake oracle with known
boundaries pins the binary search (exact boundary, every EC level, mode and
version) and the mixed-payload list.
