# json-guards.ts

## Purpose

The two type guards every hand-edited-JSON parser in the package needs: a
JSON object and a finite number. One copy per package (DEC-H3); the M1
review of the guided-setup plan (2026-09-08) found three.

## Public API

- `isRecord(v: unknown): v is Record<string, unknown>` - non-null object
  (arrays included; callers narrow further).
- `isFiniteNumber(v: unknown): v is number` - a number that is neither NaN
  nor infinite.

## Invariants & assumptions

- Pure, dependency-free; deep-imported (`utils/json-guards`), never through
  the `/utils` barrel (which feeds the package root).

## Tests

Exercised through `ar/qr/qr-level.test.ts`, `ar/qr/geo-pose.test.ts` and
`ar/tour-manifest.test.ts`, whose rejection cases are these guards' false
branches.
