# json-guards.ts

## Purpose

The type guards every hand-edited-JSON parser needs: an object, a JSON
object that is no array, and a finite number, in one module so the
workspace keeps one implementation of each (three had grown in this
package by 2026-09-08; the Tour Viewer's stored-record readers held four
more copies of the no-array guard).

## Public API

- `isRecord(v: unknown): v is Record<string, unknown>` - non-null object
  (arrays included; callers narrow further).
- `isJsonObject(v: unknown): v is Record<string, unknown>` - a non-null
  object that is not an array: the shape of a stored JSON record. Used by
  the Tour Viewer's character, level spot, travelling box and feature-match
  readers.
- `isFiniteNumber(v: unknown): v is number` - a number that is neither NaN
  nor infinite.

## Invariants & assumptions

- Pure, dependency-free; deep-imported (`utils/json-guards`), never through
  the `/utils` barrel (which feeds the package root).

## Tests

`json-guards.test.ts`: each guard's true and false cases (arrays apart).
Also exercised through `ar/qr/qr-level.test.ts`, `ar/qr/geo-pose.test.ts`
and `ar/tour-manifest.test.ts`, whose rejection cases are these guards'
false branches.
