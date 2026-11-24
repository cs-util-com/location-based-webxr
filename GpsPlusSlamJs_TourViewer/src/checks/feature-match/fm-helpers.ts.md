# fm-helpers.ts

## Purpose

The two small helpers the feature-match check's modules share, one copy for the check: the guard of a stored JSON object and the counted plural of the texts. The finite-number guard is the framework's `isFiniteNumber` (`gps-plus-slam-app-framework/utils/json-guards`), imported where needed.

## Public API

- `isObj(v)`: `v` is a JSON object: not null and not an array.
- `plural(n, word)`: "1 pair", "2 pairs": the count, a space and the word with an "s" unless `n` is 1.

## Invariants

- No dependencies; pure.
- Used by `camera-report.ts`, `run-plan.ts`, `flat-progress.ts`, `measure-protocol.ts` (isObj) and `guided-scene-model.ts`, `measure-queue.ts` (plural). `measure-protocol.ts` accepted arrays as objects before; nothing it reads is an array, so the stricter guard only refuses malformed messages sooner.

## Example

```ts
plural(2, "pair"); // "2 pairs"
isObj([]); // false
```

## Tests

Covered through the modules that use it (`run-plan.test.ts`, `camera-report.test.ts`, `guided-scene-model.test.ts`, `measure-queue.test.ts`); the helpers are one line each.
