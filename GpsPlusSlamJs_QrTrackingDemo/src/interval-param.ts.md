# interval-param

## Purpose

Reads the optional `?interval=<ms>` URL override for the QR capture interval,
so a field test can measure a faster or slower detection rate on a real device
without a rebuild and without changing the default (QR near-frontal pose plan
2026-09-23-2314, M1).

## Public API

- `parseIntervalParam(search: string): number | undefined` - an integer
  within the framework's `QR_CAPTURE_INTERVAL_CONSTRAINTS` (50-1000 ms), or
  `undefined` when the param is absent, empty, non-numeric, non-finite or out
  of range. Fractions are floored.

## Invariants & assumptions

- The bounds are the framework's (`ar/qr/qr-capture-cadence`), shared with the
  Recorder's settings slider; nothing is restated here.
- Out-of-range values are REJECTED (the default stands), not clamped - the
  same policy as `capture-size-param.ts`. The Recorder clamps a stored option
  instead; both policies read the same bounds.
- `main.ts` uses `parseIntervalParam(location.search) ??
DEFAULT_QR_CAPTURE_INTERVAL_MS` as the frame source's `intervalMs`.

## Examples

```ts
parseIntervalParam("?qrperf=1&interval=60"); // 60
parseIntervalParam("?interval=10"); // undefined (below 50)
```

## Tests

`interval-param.test.ts`: absent, in-range (including both bounds and a
fraction), and the rejected shapes.
