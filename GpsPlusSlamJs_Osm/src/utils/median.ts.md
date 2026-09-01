# `median.ts`

## Purpose

The **one** median implementation in `GpsPlusSlamJs_Osm`. The package has no
dependency on `gps-plus-slam-app-framework`, so under the helper-unification
rule (DEC-H3) it keeps its own copy rather than gaining a dependency for
eight lines — but exactly one copy, which
`tests/repo-config/duplicate-helpers.test.js` enforces as a `perPackage`
entry.

## Public API

- `median(values: readonly number[]): number | undefined` — interpolating
  median. Odd length returns the middle value; **even length returns the mean
  of the two middles**, so the result may be a value that was never observed.
  Empty input returns `undefined`.

## Invariants & assumptions

- **The even-length rule is the contract**, not an implementation detail.
  Averaging is right for the continuous quantities this package medians (DEM
  elevations from disagreeing providers, affordance scores) and wrong where a
  representative _real_ sample is needed. The framework draws the same
  distinction explicitly as `interpolatingMedian` vs `lowerMedian`; here only
  the interpolating rule has a caller, so only it exists.
- **No numeric sentinel for empty input.** `undefined` forces a caller with a
  domain default to write it where it can be seen — `region-builder.ts` uses
  `median(scores) ?? 1`. The previous private copy returned a bare `1` from
  inside the arithmetic, which is unreadable at the call site and wrong for
  any other caller.
- Input is not mutated (sorts a copy). Non-finite values are not filtered:
  callers pass validated numbers, and a NaN in equals a NaN out rather than a
  silently shifted answer.

## Examples

```ts
import { median } from "../utils/median.js";

median([3, 1, 2]); // 2
median([4, 1, 2, 3]); // 2.5  — averaged, never observed
median([]); // undefined
median(scores) ?? 1; // the caller's domain default, stated by the caller
```

## Tests

`src/utils/median.test.ts` — odd/even/empty and the non-mutation invariant.
The two former call sites keep their own coverage:
`src/elevation/elevation-provider.test.ts` (consensus over disagreeing DEM
providers) and `src/regions/region-builder.test.ts` (`medianScore`, including
the empty-scores default).
