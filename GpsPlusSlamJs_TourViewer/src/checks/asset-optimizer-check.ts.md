# asset-optimizer-check.ts

**Purpose:** the asset optimizer check's pure parts (`asset-optimizer-check.html`): the test files it makes and the measures it shows next to each result.

## Public API

- `seeded(seed)`: a seeded generator (mulberry32) of numbers in [0, 1).
- `testPicturePixels(width, height, seed?)`: RGBA pixels of a photo-like picture (a sky gradient, houses with windows, discs, a fine grain).
- `testSoundPlanes(kind, seconds, sampleRate, seed?)`: `"speech"` is one plane of a voice-like tone of moving pitch in syllables; `"music"` two planes of chords with a beat.
- `wavOf(planes, sampleRate)`: a 16-bit PCM WAV file's bytes.
- `lumaOf(rgba)`: BT.601 luma.
- `ssim(a, b, width, height)`: mean SSIM over 8 x 8 windows (1 for the same picture).
- `bestLag(a, b, start, length, maxLag)`: the lag within `maxLag` at which `b` best matches `a` over the window, and the normalised correlation there (a positive lag: `b` is late).

## Invariants

- The same seed gives the same file, so a sweep compares like with like.
- Every function throws with words for sizes that are no whole numbers in range, channels of different lengths, or a window that does not fit.

## Tests

`asset-optimizer-check.test.ts`: determinism, the sound shapes, the WAV header and samples, SSIM of the same and of damaged pictures, a known shift found either way. The e2e `playwright-tests/editor-asset-optimizers.spec.js` uses them on the shipped optimizers.
