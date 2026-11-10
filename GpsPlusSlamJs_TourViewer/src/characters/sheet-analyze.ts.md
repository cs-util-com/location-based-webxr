# sheet-analyze.ts

**Purpose:** the whole cut in one call, step by step, reporting each step to a listener so the page can show which step runs, which passed and which refused.

## Public API

- `CUT_PHASES`: the steps in order with their labels (read, background, poses, align, check).
- `PhaseState`: running, done or failed; `PhaseListener(phase, state, note?)`.
- `SheetAnalysis { frames, steadyFrames, check, mode, gaps, size, specks }`: what the page shows and saves (both variants, so "as drawn" and "steady" switch without a re-cut); `specks` is the count of loose specks the island filter cleaned away, for the status line of "Adjust the cut".
- `checkPictureSize(w, h, s)`: refuses a picture above `maxPixels` ("too big") or under 240 x 120 ("too small").
- `analyzeSheet(img, s, listener)`: background, poses, align, check; each step reports running, then done (with a short note) or failed, and a failure throws its `CutError`.

## Invariants

- Exactly one terminal state per step that started; later steps do not start after a failure.
- Pure apart from the listener.

## Tests

`sheet-analyze.test.ts` (the phase sequence on a good sheet, the failing phase on a refused one, size refusals).
