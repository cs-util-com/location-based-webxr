# bench-synthetic.ts

## Purpose

A deterministic test pair for the benchmark: a procedural texture and the same texture under a known similarity warp, so matches can be scored without any photo.

## Public API

- `Warp { angleRad, scale, shiftX, shiftY }` (shifts as fractions of the width); `DEFAULT_WARP` = 8 degrees, scale 0.9, shift (0.04, -0.02).
- `warpPoint` / `unwarpPoint(warp, x, y, w, h)`: the warp about the image centre and its inverse.
- `syntheticTexture(w, h, seed)`: value noise at three octaves plus 60 discs, rectangles and lines, seeded with the framework's `mulberry32`.
- `syntheticPair` warps with an internal bilinear `warpFrame`, outside pixels mid-grey.
- `syntheticPair(w = 640, h = 480, seed = 1)`: `{ a, b, warp }`.
- `countCorrect(pairs, a, b, warp, w, h, tolPx)`: matches whose B point is within `tolPx` of A's point warped.

## Invariants

- Same seed, same pixels on every device.
- The warp is a plain similarity; the page does no pose verification of its own.

## Tests

`bench-synthetic.test.ts` (round trip of the warp, determinism, the count).
