# stats-view.ts

## Purpose

Pure presentation mapping for the live streaming counters — numbers in,
display strings out. The panel it feeds is the demo's core message
("streaming, not downloading"), so the mapping is kept DOM-free and pinned by
unit tests.

## Public API

- `toStatsView(stats, archiveSize, origin): StatsView` —
  `StatsView { headline; detail }`.

## Invariants & assumptions

- The percentage is clamped to [0, 100] and a zero archive size renders 0.0%
  — never NaN.
- Byte counts format via the framework's `utils/format-file-size` (the repo's
  one implementation).

## Examples

```ts
toStatsView(
  { networkRequests: 9, networkBytes: 10638, cacheReads: 0, cacheBytes: 0 },
  88642,
  "network",
);
// headline: '10.4 KB of 86.6 KB fetched (12.0%)'
```

## Tests

`stats-view.test.ts` — the rendering and the NaN/overflow clamps.
