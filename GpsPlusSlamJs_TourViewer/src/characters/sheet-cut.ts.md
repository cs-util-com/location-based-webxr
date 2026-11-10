# sheet-cut.ts

**Purpose:** the first two steps of making a character from an image AI's four-pose sheet: cut the background away (`cutBackground`), then find the four poses (`findFigures`). Pure typed-array code, ported from the prototype `public/prototypes/character-sheet-1-guided-steps/import.js`, with a ground-shadow pass, an island filter and a settable edge ramp added.

## Public API

- `CutError(phase, code, message, detail)`: every refusal, with the step (`CutPhase`: read, background, poses, align, check), a code and the words the page shows.
  - Codes: `not-image`, `decode`, `too-big`, `too-small`, `checkerboard`, `busy` (also for a picture that is almost all figure), `empty`, `joined`, `extra`, `missing`.
- `cutBackground(img, s): Cut`: `{ alpha, rgb, mode, bg?, specks }`.
  - **Alpha mode**, when more than 1 % of sampled pixels have alpha under 250: alpha under `alphaThr` becomes 0, 240 and above becomes 255; `specks` is 0.
  - **Flat mode** otherwise: the border's median colour is the background; a flood fill from the border takes every pixel within `whiteTol` of it, so light pixels enclosed by the outline (eye whites) stay figure.
    - With `shadowOn` the fill also passes light, colourless pixels (every channel at least `shadowFloor`, channels within `shadowSpread`): a soft ground shadow under a pose.
    - Then every separate figure piece under `islandMin` pixels (8-connected) becomes background and is counted in `specks`.
    - Edge pixels get an alpha ramp of width `edgeSoft` and the background colour is taken out of them.
  - Refuses a painted checkerboard (two alternating border colours), a busy border, a picture with no figure, and one that is almost all figure.
- `findFigures(alpha, w, h, s): Figures`: column groups of figure pixels, joined across gaps narrower than `minGapFrac * w`, specks under `specFrac` of the largest dropped, each with its top and bottom row.
- `diagnoseCount(runs)` and `countError(figures, w, h)`: why a count is not four (joined poses, extra shapes, none, missing) in words, with the runs for the page to draw.

## Invariants

- Never reads outside the image; never mutates its input.
- A pose's bottom row is its lowest row with at least 2 figure pixels, so a stray pixel does not move the feet.
- Pieces enclosed by a figure (eye whites) belong to the figure's piece, so the island filter never removes them.

## The shadow pass and its sweep

Image AIs often draw a soft grey ground shadow under each pose. With the prototype's cut (tolerance 28, no shadow pass) a shadow darker than about 230 on a 254 background is kept as figure: every pose's feet move down onto it (4-27 px at 2528 x 1696, so the character would float above the ground) and thousands of grey pixels stay around the feet.

The question was whether a larger tolerance plus the island filter is enough, or whether a separate shadow pass is needed. Synthetic sheets with known truth (shadow core 190-245, noise 0-8, grey figures 150-230 with and without an outline, light coloured figures without an outline), at 800 x 520 and at 2528 x 1696, gave the same verdict at both sizes:

- **Tolerance alone** cuts a 190 shadow only from tolerance 72 up, and from 56 up it eats light coloured figures without an outline (cream, light blue, skin): refused as "no figure" or cut in half. No tolerance passes both, so the shadow pass is kept.
- **Shadow pass**, tolerance 16-40, floor 150-170, spread 20-28: every shadow case clean (no leak, feet within 1 px, eye whites kept, nothing lost).
  - Spread 6-12 fails at noise 4-8 (a noisy shadow is not colourless enough); floor 190 and above fails the 190 shadow; floor 150 also eats a 150 grey figure without an outline.
  - Tolerance 56 and above eats the light coloured figures again.
- **The price at the chosen defaults:** a grey figure lighter than the floor with **no outline** (grey 190, 230) is taken as background and refused as "no figure". A grey figure with an outline is safe at every grey (the outline stops the fill). A colourless anti-aliasing pixel lighter than the floor goes with the background, so an outline keeps only its darker edge pixels (pinned in `sheet-cut.test.ts`).
- **Island filter** (N 0-256): no effect on any synthetic shadow case once the shadow pass is on (clean at every N). With tolerance alone it cut the leaked pieces (8-connected) from up to 135 to 4-29. Its committed evidence is the injected-speck test. Speck counts depend on the counting method, so both 4- and 8-connected counts were recorded.
- **Pose gap** (`minGapFrac` 0.001-0.016, poses 31-140 px apart at 1264 x 848): four poses found everywhere; 0.03 joins the closest pair. The default 0.004 has a wide margin.
- **Chosen:** tolerance 28 (the prototype's; 16-40 give the same verdict and the lower end keeps more light colours), `shadowOn` true, floor 170, spread 20, `islandMin` 64, `edgeSoft` 96 (the prototype's fixed ramp).
- Not covered by synthetic sheets: real JPEG artefacts and painted (not flat) shadows. The maker's "Adjust the cut" sliders exist for those.
- Node timing at 2528 x 1696 on a desktop: cut 315 ms, the whole analysis 841 ms.

## Tests

- `sheet-cut.test.ts`: flat and alpha cuts, eye whites kept, edge ramp and its width, the light edge ring under the shadow pass, each refusal, pose finding off the quarters, specks, count words.
- `sheet-cut-shadow.test.ts`: shadow 190-245 x noise 0-8 at the defaults, outlined grey figures above a shadow, a pale coloured figure without an outline, the island filter on injected specks.
- `sheet-cut.property.test.ts`: varied size, colour and noise: nothing lost, nothing leaked, four feet.
- Synthetic sheets come from `test-support/synthetic-sheet.ts`; no real picture is used in the tests.
