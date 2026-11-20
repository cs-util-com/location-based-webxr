# splat-math.ts

## Purpose

The two helpers the splat trainer's planning modules (`walk-windows.ts`,
`splat-ownership.ts`, `training-budget.ts`) share, kept once in this
package instead of once per file.

## Public API

- `distance(a, b)`: the Euclidean distance between two `Vector3` points,
  in the points' unit (metres throughout the trainer).
- `requirePositive(name, value)`: returns nothing for a positive finite
  number; throws a `RangeError` whose message names `name` and the value
  for NaN, zero, a negative number or an infinity.

## Invariants and assumptions

- Both are pure and allocation-free.
- `requirePositive` is the boundary check for settings and device limits;
  it is written as `!(value > 0)` so that NaN is refused too.
- No helper of the same behaviour exists in the framework to reuse: the
  framework's vector helpers are scoped to their own modules.

## Examples

```ts
distance([0, 0, 0], [3, 4, 0]); // 5
requirePositive("windowM", 30); // fine
requirePositive("windowM", Number.NaN); // RangeError: windowM must be ...
```

## Tests

Covered through their callers: `walk-windows.test.ts`,
`splat-ownership.test.ts` and `training-budget.test.ts` each check that a
bad setting is refused with a `RangeError`, and every distance the plans
and the ownership use runs through `distance`.
