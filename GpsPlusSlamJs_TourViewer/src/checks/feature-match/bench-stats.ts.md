# bench-stats.ts

## Purpose

Summary statistics of timing samples for the feature matching benchmark.

## Public API

- `Summary { n, median, p90, min, max }`.
- `summarize(samples)`: median (interpolating) and p90 (nearest rank) via the framework's `utils/median` and `utils/percentile`. Empty input gives NaN fields with `n = 0`; a non-finite sample throws `RangeError`.
- `formatMs(ms)`: one decimal below 100 ms, whole numbers above, `-` for NaN.

## Invariants

- No local copy of median or percentile code: the framework's helpers are the one implementation.

## Example

```ts
summarize([12, 13, 14]); // { n: 3, median: 13, p90: 14, min: 12, max: 14 }
```

## Tests

`bench-stats.test.ts`, including a property test (min <= median <= p90 <= max).
