# `src/height-ramp.ts`

## Purpose

Turns terrain heights in metres into per-vertex colours for the ground's height
ramp (W24, DEC-R2-25) — the view that answers "did the DEM load, or is this place
simply flat?".

It was the `terrainDebug` LAYER until W6 (DEC-R5-4) folded it into the ground mode
as an appearance and made it the default; the colour arithmetic here is unchanged.

## Public API

- `RampRange` — `{ min, max }` in metres.
- `rampRange(heights) → RampRange | undefined` — the finite extent of a field.
  `undefined` when no sample is finite, which is the honest answer for a DEM
  outage rather than a throw or a fabricated flat surface.
- `rampColour(t) → [r, g, b]` — the ramp at `t`, each channel in `0..1`.
  `t` outside `0..1` (and non-finite `t`) is clamped, never extrapolated.
- `heightRampColours(heights) → Float32Array` — one RGB triple per height, ready
  for a three.js `color` `BufferAttribute`.
- `NO_DATA_RGB` — magenta, for posts with no finite height.

## Invariants & assumptions

- **The range is the DATA's own min/max, never a theoretical one.** This is the
  module's whole reason for existing. `geo-three`'s `HeightDebugProvider`
  normalises by `1667721.6` — the maximum of its height encoding — so real
  terrain occupies a sliver at the bottom of the ramp and the output is
  effectively monochrome. That failure looks exactly like flat ground, i.e. it
  produces the very answer the layer was added to rule out.
- **The ramp rises monotonically in luminance.** A ramp that dips gives two
  different heights the same apparent brightness and the reader cannot tell which
  way the slope runs. The first draft ended in **red**, as `HeightDebugProvider`
  does, and the monotonicity test rejected it: red is darker than the yellow
  before it (luma 0.39 against 0.86), so the top of the ramp doubled back.
  Deep blue → cyan → amber → near-white is single-valued throughout.
- **Non-finite samples are skipped when computing the range, and rendered as
  `NO_DATA_RGB`.** A single `NaN` in a spread-based min/max makes both ends
  `NaN`; every later comparison against `NaN` is false, so the whole ramp
  collapses to one colour — indistinguishable from flat ground, the one thing
  this layer must never say by accident. Colouring a missing post with a
  plausible ramp value would defeat the layer at exactly the moment it matters.
- **A flat field (`min === max`) maps to the ramp's floor, not to `NaN`.** The
  naive normalisation is `0 / 0` in every channel, and a `NaN` vertex colour
  renders as black or as driver-dependent garbage — a rendering artefact that
  reads as a bug in the terrain rather than as "this ground is flat".
- **`rampRange` iterates; it does not spread.** `Math.max(...heights)` throws
  `RangeError` above roughly 100–125 k arguments. The ground lattice is 16 641
  posts today and W23 removes the cap that keeps it there; this repo has already
  had to fix that exact call once.
- **Output is `Float32Array`**, so values come back at single precision — `0.05`
  reads as `0.05000000074505806`. Compare with `toBeCloseTo`, not `toEqual`.

## Examples

```ts
const colours = heightRampColours(heights); // Float32Array, 3 per post
geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
// Paired with an UNLIT material — see building-view.ts.md.
```

## Tests

`height-ramp.test.ts` — 12 tests:

- `rampRange` — uses the data's own extent; ignores non-finite samples; returns
  `undefined` for a field with no finite data; survives 100 k posts.
- `rampColour` — the ends are far apart (not merely different); luminance rises
  across 40 samples; every channel stays inside the unit cube for `t` from `-1`
  to `2`.
- `heightRampColours` — one triple per height; spans the full ramp; a flat field
  gives the floor rather than `NaN`; a missing post is `NO_DATA_RGB` and does not
  drag the range; an all-missing field is entirely no-data.

The pixel half — that the ramp reaches the screen — is
`playwright-tests/` › "shows the terrain as a height ramp, which is the default ground".
It counts the ramp's **two ends** (blue-dominant for the floor, bright-neutral
for the top) and asserts both are present from a fresh load, that selecting the
plain `cpu` ground entry returns the scene to neither, and that `gpu-ramp`
brings them back — the ramp is an appearance of the ground mode since W6, not a
checkbox.

**The first version of that test counted "saturated pixels" and was wrong in a
way worth recording**: a ground rendered entirely in `NO_DATA_RGB` magenta is
maximally saturated, so the test would have been green on the single worst
possible output — the one this layer exists to make visible. It was caught by
capturing a screenshot of a passing run and looking at it. Two mutation checks
now pin it: forcing `setGroundDebug` to keep the normal material, and forcing
`heightRampColours` to emit only no-data. Both fail the current test; the second
would have passed the first version.

Measured reference values, after three's linear-to-sRGB output conversion: the
ramp's floor renders as `rgb(64,64,160)` and its top as `rgb(224,224,224)`.
