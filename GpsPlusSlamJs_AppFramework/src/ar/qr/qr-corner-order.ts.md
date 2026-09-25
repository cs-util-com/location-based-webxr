# qr-corner-order

## Purpose

Puts a detected QR's four corners into SYMBOL order (TL, TR, BR, BL of the
printed code), whatever order the detector reported. The native
`BarcodeDetector` on the owner's phone reports them in IMAGE order (QR summary
§4b, runs 3-6), which turned every solved pose by 90 or 180 deg about the
code's normal ("Cause A", `2026-06-20-0030-qr-axis-jump-step0-findings-and-next.md`).
QR near-frontal pose plan 2026-09-23-2314, M1c.

## Public API

- `canonicalizeCorners(image, corners): { corners, confident, source }` -
  stateless. `source` (near-frontal pose plan §39 F0a) is `finder` when
  confident, else `native` (the detector's own order).
  `confident` is true when exactly one corner lacks a finder pattern; the
  corners are then rotated cyclically so that corner is BR (index 2).
  Otherwise the input comes back unchanged.
- `createCornerOrderCanonicalizer({ now?, memoryMs? })` - adds a per-code
  memory: an unsure frame takes the cyclic shift closest (sum of corner
  distances, image space) to the same code's last confident order, while
  that is younger than `memoryMs` (default 500) - `source: 'memory'`;
  otherwise the detector's order stands (`source: 'native'`).
- `CornerOrderSource` = `'finder' | 'memory' | 'native'`: carried on
  `QrDetection.orderSource` so a field test can tell a confidently wrong
  order from a fallback (plan §39: the corner-order flips).

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

## Cross-scans (milestone review 2026-09-24, finding 1)

The diagonal alone was fooled by the code's own content: from BR it crosses
four data modules and then the alignment pattern's rings, which for many
codes merge into a perfect 1:1:3:1:1 (e.g. `https://ex.co/p/0`: D1 L1 D3
L1 D1). A diagonal candidate now also has to read 1:1:3:1:1 on scans through
the centre of its core along BOTH symbol axes, ±6 modules (the module size
from the diagonal's runs), with the core run containing the centre - as
zxing does. The fake BR reads 3-1-5 and 1-1-4 there.

Over 200 payloads (100 short at level M, versions 2-3; 100 launch URLs at
level Q, versions 6-9), 4 rolls, the folded phone at 0.9 m, noise 2
(`qr-zxing.sweep.test.ts`, "many payloads"):

- corner error 0 / 1 px: confident 100 %, wrong 0, codes never ordered 0.
- corner error 2 px: confident 89 %, wrong 0, codes never ordered 7 / 200.
- TL finder washed out: confident 0 %, **wrong 0** (was the confident 90 /
  180 deg error before).
- Before the cross-scans: 63 of the first ~240 frames of a similar payload
  search were unsure; the review's probe found up to 111 wrong-confident in
  1 200 washed-out frames.

## Measured (opt-in sweep, `qr-zxing.sweep.test.ts`)

Corners emulating the phone: the true corners moved by up to 1, 2 or 3 px
per axis, rounded, handed over in image order; two capture geometries
(439x1024 at fovY 64, 1024x768 at 50), distances 0.3-3 m, four tilts, four
rolls, blur 0/1, noise 2 (1 152 frames). Confident share by corner error and
px/module (blur 0 / 1):

- **1 px:** 2-3 px/mod 100 / 100 %; 3-4: 100 / 100 %.
- **2 px** (the phone's distance from zxing's corners, QR summary §4b):
  2-3 px/mod 72 / 72 %; 3-4: 100 / 100 %.
- **3 px:** 2-3 px/mod 0 / 0 %; 3-4: 33 / 39 %.
- Below 2 px/module (mostly undecodable): 0-40 %. Near codes (4-6 and 6+
  px/module): 62-79 % at every error - every unsure near frame had a corner
  outside the image (diagnosed 2026-09-24), a code the detector cannot decode
  anyway.
- **Wrong confident answers: 1 in 1 152** (1 px error, below 2 px/module,
  blur 0). Rare and at an undecodable size, but not zero.
- An earlier run with 1 px only reported 0 wrong in 768 frames; the sampling
  differed, so that "0" was never a guarantee.

**A relaxed rule was tried and reverted (2026-09-24):** judging the ring
ratios on the inner runs only (tolerating a cut-off outer ring) and allowing
20 % leading light passed a 3 px-inward unit case but measured WORSE across
the sweep: 2 px / 2-3 px/mod 63 / 53 %, 3-4 px/mod 89 / 94 %, and two wrong
confident answers. Robustness to 2-3 px corner error on small codes is open
(QR near-frontal pose plan, M1c follow-up).

The phone (QR summary §4b run 8): 0 deg 100/100, 180 deg 39/39, 270 deg
43/48 frames in symbol order - consistent with unsure frames on a small code.

## Examples

```ts
const out = canonicalizeCorners(frame.image, detection.corners);
if (out.confident) solveWith(out.corners);
```

## Tests

`qr-corner-order.test.ts`: rolls 0-315 and tilted codes from image-ordered
integer corners, corners 2 px inward or outward on a small code, every cyclic shift of the input, a blank quad (unsure), a
hand-drawn 1:1:1:1:1 corner (mutation-checked: the core check), corners
outside the image, the memory (recent, stale, other code), and the order
source of each case (finder, memory, native). Four
mutations of the rule were each caught. Front-end wiring:
`qr-frontend.test.ts`.
