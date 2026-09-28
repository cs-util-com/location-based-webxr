# `terrarium-png.mjs`

**Purpose:** write synthetic Terrarium elevation tiles as real PNG bytes, so an
e2e suite can serve a page KNOWN terrain and let it run its whole tile path
(fetch, decode, sample) for real.

## Why one shared module

Two suites need it: OsmDemo's (its 2x2 DEM tile, `stubNetwork` in
`GpsPlusSlamJs_OsmDemo/playwright-tests/fixtures.js`) and the design
system's terrain lab (the ridge and flat tiles of its geometry checks,
terrain plan 2026-09-27-0605 §9 findings 6-7). The encoding carries a
contract (one red step is 256 m), so under DEC-H3 it has ONE implementation.
It began as an inline function in OsmDemo's fixtures and moved here, byte for
byte, when the second consumer arrived.

## Public API

- `terrariumRgb(heightM)` -> `[r, g, b]`: the height rounded to Terrarium's
  1/256 m step; the rounding carries into G and R. Throws `RangeError` for a
  non-finite height or one outside `[-32768, 32768)`.
- `encodeRgbPng(width, height, rgb)` -> `Buffer`: a truecolour 8-bit PNG,
  filter 0 on every row, one IDAT. Throws `RangeError` for a non-positive or
  non-integer size, or `rgb` not `width * height * 3` bytes long.
- `terrariumPng(width, height, heightAt)` -> `Buffer`: pixel (col, row)
  holds `heightAt(col, row)` metres.

## Invariants

- Node only (`node:zlib`); test-side only. Production decodes tiles and never
  encodes one.
- Decoding the output with Terrarium's published formula
  `R*256 + G + B/256 - 32768` returns every height that is a multiple of
  1/256 m exactly.

## Example

```js
import { terrariumPng } from '../../scripts/e2e/terrarium-png.mjs';
const flat = terrariumPng(256, 256, () => 500); // a 500 m plateau
await route.fulfill({ status: 200, contentType: 'image/png', body: flat });
```

## Tests

`terrarium-png.test.mjs` (root vitest, `scripts/e2e/**/*.test.mjs`): exact
round trips through a real PNG decode (inflate and scanlines, not the
encoder's arithmetic), the carry, range refusals, pixel placement, and the
OsmDemo tile's bytes as captured before the move.
