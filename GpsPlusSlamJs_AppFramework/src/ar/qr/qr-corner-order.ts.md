# qr-corner-order

## Purpose

Puts a detected QR's four corners into SYMBOL order (TL, TR, BR, BL of the
printed code), whatever order the detector reported. The native
`BarcodeDetector` on the owner's phone reports them in IMAGE order (QR summary
§4b, runs 3-6), which turned every solved pose by 90 or 180 deg about the
code's normal ("Cause A", `2026-06-20-0030-qr-axis-jump-step0-findings-and-next.md`).
QR near-frontal pose plan 2026-09-23-2314, M1c.

## Public API

- `canonicalizeCorners(image, corners): { corners, confident }` - stateless.
  `confident` is true when exactly one corner lacks a finder pattern; the
  corners are then rotated cyclically so that corner is BR (index 2).
  Otherwise the input comes back unchanged.
- `createCornerOrderCanonicalizer({ now?, memoryMs? })` - adds a per-code
  memory: an unsure frame takes the cyclic shift closest (sum of corner
  distances, image space) to the same code's last confident order, while
  that is younger than `memoryMs` (default 500); otherwise the detector's
  order stands.

Used by `qr-frontend.ts` (`BarcodeDetectorFrontEnd`, one canonicalizer per
front end), so every app's detections are symbol-ordered.

## Invariants & assumptions

- **Rule:** a QR symbol has finder patterns at TL, TR and BL; BR has none.
  Each corner's half-diagonal is sampled (0 to 80 % of the way to the centre,
  through the square-to-quad homography of the detected corners, bilinear
  luminance, >= 3 samples per pixel of path) and binarised at the midpoint of
  the 10th and 90th percentile of all four profiles. A finder reads, from the
  first dark sample, dark-light-dark-light-dark in 1:1:3:1:1: rings within
  0.5-1.6x the unit, the core within 2-4.2x.
- **The 3-unit core check is what rejects one-module rings** (the alignment
  pattern near BR, random data): without it a BR corner can read as a finder.
- **Only cyclic rotations are applied.** The winding is left alone;
  `validateQuad` still rejects a mirrored quad downstream.
- **Unsure is safe, confidently wrong is not.** Unsure cases: a profile that
  leaves the image, more than 12 % light before the first dark run, and any
  count of finder-less corners other than one (blank quads read as four).
- Cost: four profiles of a few hundred samples per detection; negligible
  next to the detect call.
- Defensive: non-4 corner lists, tiny images and out-of-image quads return
  the input with `confident: false`; nothing throws.

## Measured (opt-in sweep, `qr-zxing.sweep.test.ts`, 768 synthetic frames)

Corners emulating the phone (true corners nudged by up to 1 px, rounded,
handed over in image order); two capture geometries (439x1024 at fovY 64,
1024x768 at 50), distances 0.3-3 m, four tilts, four rolls, blur 0/1, noise
2/6:

- **Wrong confident answers: 0 in every band.**
- Confident: 100 % at 2-4 px/module (97 % at 2-3 with blur); 42 % / 16 %
  below 2 px/module (blur 0 / 1), where decoding mostly fails anyway; 79 % at
  4-6 and ~64 % at 6+ px/module. Explained (diagnosed 2026-09-24): every
  unsure near frame (0.3 / 0.6 m) had a corner OUTSIDE the image - a code the
  detector cannot decode anyway. Every fully visible near frame was
  confident; across the 2-4 px/module bands, 97-100 %.

## Examples

```ts
const out = canonicalizeCorners(frame.image, detection.corners);
if (out.confident) solveWith(out.corners);
```

## Tests

`qr-corner-order.test.ts`: rolls 0-315 and tilted codes from image-ordered
integer corners, every cyclic shift of the input, a blank quad (unsure), a
hand-drawn 1:1:1:1:1 corner (mutation-checked: the core check), corners
outside the image, and the memory (recent, stale, other code). Four
mutations of the rule were each caught. Front-end wiring:
`qr-frontend.test.ts`.
