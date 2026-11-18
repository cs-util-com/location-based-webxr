# `min-max.ts`

## Purpose

The package's one min-and-max of a list of numbers. It replaces
`Math.min(...xs)` / `Math.max(...xs)` in production code, because a spread
passes one argument per element and overflows the call stack for a long
list (measured in Node: fine at 100 000 elements, `RangeError` from 125 000).
`elevation/heightfield.ts`'s `peakToTrough` and `mesh/cosmetic-trees.ts`'s
`ringBounds` are older folds of the same kind over their own shapes.

## Public API

- `minMaxOf(values: ArrayLike<number>): [number, number]` - `[min, max]`.
  - Never throws, for any length; a plain array or a typed array.
  - Empty list: `[Infinity, -Infinity]`, as `Math.min()` / `Math.max()`.
  - Any NaN: `[NaN, NaN]`; `-0` counts as below `+0`.

## Invariants & assumptions

- **The spread's answer, exactly.** The fold calls `Math.min` / `Math.max`
  pairwise, so NaN and signed zero behave as the variadic call did; call
  sites switched from the spread keep their results bit for bit.
- Validation is the caller's: a call site that must refuse NaN or an empty
  list checks it, as it had to before.

## Example

```ts
import { minMaxOf } from "../utils/min-max.js";

const [lo, hi] = minMaxOf(ring.map((p) => p.x));
```

## Tests

- `min-max.test.ts`: a 200 000-element list (past the spread's limit), the
  empty list, NaN, signed zero, a typed array.
- `min-max.property.test.ts`: equal to the spread for every list the spread
  can take, NaN and -0 included.
