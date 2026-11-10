# cut-settings.ts

**Purpose:** every parameter of the character-sheet cut in one settings object, with its default and its allowed range, so the cut, the Worker, the sliders of "Adjust the cut" and the sweeps all read the same numbers.

## Public API

- `CutSettings`: the parameters (all numbers or booleans).
  - Background: `whiteTol` (largest channel distance a background pixel may have from the border's colour), `alphaThr` (alpha under this is dropped when the picture has real transparency).
  - Ground shadow: `shadowOn`, `shadowFloor`, `shadowSpread` (a light, colourless pixel, every channel at least the floor and the channels within the spread, is also background when the fill reaches it).
  - Specks: `islandMin` (a separate figure piece of fewer pixels becomes background; 0 keeps all).
  - Edge: `edgeSoft` (the width of the edge ramp in channel steps).
  - Poses: `minGapFrac` (a gap narrower than this share of the width joins two column groups), `specFrac` (a group under this share of the largest is a speck).
  - Frames: `cellW`, `cellH` (one frame, 512 x 1024).
  - Checks: `headBand`, `featherFrac`, `diffThr`, `jitterWarn`, `mouthMin`, `maxShift`.
  - Size: `maxPixels` (a larger picture is refused before it is decoded into memory).
- `CUT_SETTINGS`: the defaults. Their evidence is the sweep in `sheet-cut.ts.md`.
- `cutSettingsOf(input: unknown): CutSettings`: reads settings from anything (a page, a stored choice, a Worker message).

## Invariants

- `cutSettingsOf` never throws. A switch is taken only as a boolean. A missing, non-finite, wrongly typed or out-of-range number falls back to its default (it is not clamped, so a broken slider never silently cuts at an extreme); unknown keys are dropped; reading twice changes nothing.
- The defaults are the prototype's (`public/prototypes/character-sheet-1-guided-steps/import.js`) plus the shadow pass, island filter and edge width, whose defaults rest on the sweep recorded in `sheet-cut.ts.md`.

## Example

```ts
const s = cutSettingsOf({ whiteTol: 40 }); // the rest are the defaults
```

## Tests

`cut-settings.test.ts` (defaults, fallback per kind of bad value, unknown keys); `sheet-cut.property.test.ts` (any input gives finite, known, stable settings).
