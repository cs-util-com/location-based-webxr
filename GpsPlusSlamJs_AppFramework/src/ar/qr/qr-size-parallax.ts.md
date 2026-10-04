# qr-size-parallax.ts

## Purpose

A QR code's printed size from parallax (QR size consensus plan
`GpsPlusSlamJs_Docs/docs/2026-09-27-0350-qr-size-consensus-plan.md`, §2, §7,
S1): the tracker knows every camera position in metres, so views of the code
from different spots fix its scale without the depth sensor. The size source
for codes whose size nobody stated, and a check on those whose size a level
states.

## Public API

- `estimateQrSizeFromParallax(entries, options?)` → `QrParallaxSize | null`
  - `entries`: a code's detections, oldest first (`QrFusedEntry`, e.g.
    `selectQrFusedEntries`); only the newest entry's frame epoch is used, at
    most `maxEntries` (32) of its newest.
  - Returns `{ sizeM, lateralBaselineM, views, oldestTimestamp,
newestTimestamp }` (the window's time span, for independence), or `null` when the views
    carry no scale: fewer than `minViews` (5) usable, a median code edge
    under `minEdgePx` (40 px), a lateral baseline under
    `minLateralBaselineM` (0.08 m), or rays that do not meet ahead of the
    cameras.

## Invariants & assumptions

- **Why a nominal size works:** a single-view solve at a wrong size keeps
  the code centre on the true viewing ray, scaled about the camera by the
  size ratio (exact for the framework's solver; the test pins it). So each
  view's solve at 0.16 m gives a ray to the true centre and a distance
  `d_i`; the centre `p` is the rays' least-squares point, and the size is
  the median of `0.16 * |p - cam_i| / d_i`.
- **Bearing triangulation, not a regression** of positions on cameras: the
  regression is biased upward by tracker position jitter (errors in
  variables; +7 % on a 10 cm step at 1 cm jitter), the bearings are not
  (plan §6 #2, §7). The bearing method is blind to walking straight at the
  code - the lateral gate refuses that walk.
- **The lateral baseline** is the rms of the camera positions across the
  mean viewing direction: an even 30 cm step gives ~0.098 m. Measured
  (plan §4, §7, 40 seeds): at +-0.5 cm / 0.2 deg tracker jitter, 30 cm steps
  and 20 deg arcs give the size within ~1-2 % (median); a 10 cm step or a
  standing phone does not.
- **The edge floor** (median 40 px) keeps out codes so small on screen that
  corner noise biases the size (+2-4 % at 22 px).
- Each entry's own solve is cached on its CORNERS array (a `WeakMap`):
  `selectQrFusedEntries` builds new entry objects after every detection but
  keeps the corners by reference, so a caller re-reading a code's entries
  pays for new detections only (plan §12 #6; a test counts the solves).
- Not modelled: the tracker's own SCALE error (a world a few percent too
  large makes the size a few percent too large - right for placement in that
  world), slow drift over the window (to be measured from a recorded
  still-code session), rolling shutter.
- One payload printed at two sizes is one "code" to this function (the
  slice merges them): the size is then meaningless (plan §6 #13).

## Example

```ts
const size = estimateQrSizeFromParallax(
  selectQrFusedEntries(store.getState(), text)
);
if (size) log(`parallax ${(size.sizeM * 100).toFixed(1)} cm`);
```

## Tests

`qr-size-parallax.cache.test.ts` - one solve per detection across rebuilt
entry objects, and the reported time span. `qr-size-parallax.test.ts` - the scaling identity the method rests on; the
size within 2 % (median) / 6 % (max) over 12 seeds for 10/16/25 cm codes on
30-60 cm steps and 20-45 deg arcs at 1 px noise and +-0.5 cm / 0.2 deg
jitter; refusal of a standing phone, a walk straight at the code, a 3 cm
step, a 5 cm code at 3 m, and 4 views; the newest epoch only; an unusable
view skipped without misaligning the rest; the reported baseline and a
stricter gate. Each refusal rule and the epoch filter are mutation-checked.
