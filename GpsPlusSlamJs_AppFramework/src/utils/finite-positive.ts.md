# finite-positive.ts

## Purpose

One rule for measured values that come from sensors and files (a GPS
accuracy, a code's mint accuracy, a physical size, an extent): only a finite
number above zero can be judged by. And one rule for combining two
accuracies: the worse (larger) one.

Deep import only: `gps-plus-slam-app-framework/utils/finite-positive`.

## Public API

- `finitePositive(v: unknown): number | null`: `v` when it is a number,
  finite and above zero; null for anything else (0, negatives, NaN,
  infinities, non-numbers).
- `worse(a, b): number | null`: the larger of two accuracies; either alone
  when the other is null; null when both are.

## Invariants and defensive measures

- Never coerces: a string `'3'` is null, not 3.
- `worse` is symmetric and never below either non-null input.

## Examples

```ts
import {
  finitePositive,
  worse,
} from 'gps-plus-slam-app-framework/utils/finite-positive';

const own = finitePositive(fix.latLongAccuracy);
const accuracyM = worse(median, own);
```

## Tests

- `finite-positive.test.ts`: accepted and rejected values; `worse` with
  either or both inputs null.
- `finite-positive.property.test.ts`: the input comes back unchanged or as
  null; `worse` is symmetric and never below an input.
- Users: `state/position-precision.ts`, `ar/targets/nearby-targets.ts`,
  `ar/targets/nearby-position.ts`, the Tour Viewer's `visitor-position.ts`.
