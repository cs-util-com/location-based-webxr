# qr-depth-resolver.ts

## Purpose

The **as-of depth resolver** for the recorder live-QR debug viz (WS-5) — the one
genuinely new piece WS-5 needs. Keeps a bounded history of recorded depth samples
and answers `resolveDepthAt(timestamp)` with the depth context active at that
detection's timestamp (the sample whose `timestamp` is the latest `≤` the query),
which is exactly what the derive-on-read size join
(`gps-plus-slam-app-framework/ar/qr/qr-derived-pose`) needs.

## Public API

- `createQrDepthResolver({ maxSamples? }) → QrDepthResolver`
  - `append(sample)` — add a depth sample (idempotent on object identity; oldest
    dropped past `maxSamples`, default `DEFAULT_QR_DEPTH_HISTORY = 100`).
  - `resolveDepthAt(timestamp) → QrSizeDepthContext | null` — the as-of join:
    builds an unprojector + bilinear grid lookup from the latest sample `≤`
    `timestamp`; `null` when none precedes it or it has no usable projection.
  - `reset()` — drop all samples.
- Default sample cap is **100** (module-private `DEFAULT_QR_DEPTH_HISTORY`), matching the recorder's QR live-history cap; override via `maxSamples`.

## Invariants & assumptions

- **Clock domain (load-bearing):** depth timestamps are EPOCH ms
  (`DepthSample.timestamp = performance.timeOrigin + frameTs`, `ar/depth-sampler.ts`);
  QR detections MUST carry the same epoch clock (since QR perf plan M4 the
  frame's capture time, `performance.timeOrigin + xrTime`; plan open topic A) or the `≤` join silently misses every time. (Stamping
  `performance.now()` was the original "no debug cube" bug.)
- **Live == replay:** `append` is fed every recorded depth sample — live via the
  capture path, replay via the re-dispatched `recordDepthSample` reflected in the
  store's `latestDepthSample` — so the join reproduces the live result.
- **Best-effort:** never throws; a sample without a (valid, invertible) projection
  matrix yields `null` (the small-QR / pre-2026-06 recording degrade-to-no-cube).
- Selection scans for the latest `≤` regardless of insertion order, tolerating a
  momentarily out-of-order append.

## Tests

- `qr-depth-resolver.test.ts` — null before any sample / when none precedes the
  query; as-of selection picks the latest `≤` (verified via the chosen sample's
  constant depth); no-projection → no context; identity de-dup; `maxSamples` cap;
  `reset()`.

## Related

- [qr-debug-controller.ts.md](qr-debug-controller.ts.md) — drives `append` + renders.
- `gps-plus-slam-app-framework/ar/qr/qr-derived-pose` — consumer of `resolveDepthAt`.
