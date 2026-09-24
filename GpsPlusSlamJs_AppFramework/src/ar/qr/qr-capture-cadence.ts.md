# qr-capture-cadence

## Purpose

The one definition of how often a QR consumer captures a camera frame for
detection: the default interval and the bounds every app validates against.

## Public API

- `QR_CAPTURE_INTERVAL_CONSTRAINTS` - `{ min: 50, max: 1000, step: 25 }`
  (milliseconds).
- `DEFAULT_QR_CAPTURE_INTERVAL_MS` - `125` (~8 captures per second).

Deep import: `gps-plus-slam-app-framework/ar/qr/qr-capture-cadence`; also on
the `ar/qr` barrel.

## Invariants & assumptions

- **Why these numbers:** below ~50 ms the detector cannot keep up and frames
  only queue; above 1 s tracking feels dead. `step` is the Recorder's settings
  slider grid, and the default sits on it.
- **Why here and not in `ar/camera-frame-source.ts`:** the frame source is a
  generic throttled capturer; these bounds are statements about QR detection.
  (QR near-frontal pose plan 2026-09-23-2314, M1.)
- **Consumers:**
  - the Recorder re-exports the bounds as `QR_CONSTRAINTS.intervalMs` and
    uses the default in `DEFAULT_RECORDING_OPTIONS.qr`, clamping stored
    values;
  - the QR demo's `?interval=` parser rejects out-of-range values (the
    default stands), like its `?capture=` parser.
- No validation lives here: each consumer applies its own policy (clamp a
  stored option, reject a URL value) against the same bounds.

## Examples

```ts
import {
  DEFAULT_QR_CAPTURE_INTERVAL_MS,
  QR_CAPTURE_INTERVAL_CONSTRAINTS,
} from 'gps-plus-slam-app-framework/ar/qr/qr-capture-cadence';

const { min, max } = QR_CAPTURE_INTERVAL_CONSTRAINTS;
const ms = Math.min(
  max,
  Math.max(min, stored ?? DEFAULT_QR_CAPTURE_INTERVAL_MS)
);
```

## Tests

`qr-capture-cadence.test.ts`: the default lies inside the bounds and on the
step grid; the documented values are pinned.
