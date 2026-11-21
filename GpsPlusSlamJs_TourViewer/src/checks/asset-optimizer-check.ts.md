# asset-optimizer-check.ts

**Purpose:** the asset optimizer check's pure parts (`asset-optimizer-check.html`): the test files it makes and the measures it shows next to each result. Its test files draw from the framework's `mulberry32` (`gps-plus-slam-app-framework/utils/mulberry32`), so the same seed gives the same file.

## Public API

- `testPicturePixels(width, height, seed?)`: RGBA pixels of a photo-like picture (a sky gradient, houses with windows, discs, a fine grain).
- `cartoonPicturePixels(width, height, { shaded, seed? })`: RGBA pixels of a cartoon figure of a few flat colours (sky, ground, sun, clouds, a figure with black outlines, a label of dark "words" as small detail), anti-aliased with 2 x 2 samples a pixel; `shaded` lights and rounds the same figure as many AI-made pictures are, so it has gradients instead of flat areas. The flat-colour samples of the check page and of the flat-colour sweep.
- `testSoundPlanes(kind, seconds, sampleRate, seed?)`: `"speech"` is one plane of a voice-like tone of moving pitch in syllables; `"music"` two planes of chords with a beat.
- `wavOf(planes, sampleRate)`: a 16-bit PCM WAV file's bytes.
- `lumaOf(rgba)`: BT.601 luma.
- `ssim(a, b, width, height)`: mean SSIM over 8 x 8 windows (1 for the same picture).
- `pictureErrors(a, b)`: `{ psnr, nearWorst }` of two RGBA pictures of one size over their colour channels: PSNR in dB (`Infinity` for the same pixels) and the 99.9th percentile of each pixel's largest channel error (0..255), which sees edge fringes and smeared text that PSNR averages away.
- `commonColourShare(rgba, top, bits)`: the share of pixels (0..1) whose colour, read at `bits` bits a channel, is one of the `top` most common. Nearly 1 for a picture of a few flat colours; fewer bits merge near colours, so gradients count as flatter. The measure a flat-colour classifier would read; none is built (see `optimizer-settings.ts.md`).
- `bestLag(a, b, start, length, maxLag)`: the lag within `maxLag` at which `b` best matches `a` over the window, and the normalised correlation there (a positive lag: `b` is late).
- `glbByteShares(bytes)`: a GLB's bytes as `{ total, textures, geometry }`: textures are the buffer views images name, each counted once; geometry is the rest (meshes, the coarser levels' index lists, the JSON and the headers). Throws on a file that is no well-formed GLB (the chunks are read by the framework's `utils/glb-chunks`, the same reader the tour's check uses, and its reason is in the message), or an image naming a buffer view the file lacks. The page's size panel and the slider order rest on it.

## Invariants

- The same seed gives the same file, so a sweep compares like with like.
- `cartoonPicturePixels` and `pictureErrors` are plain loops over every pixel, a second or so for the page's 2400 x 1800 samples; the unit tests use small sizes.
- Every function throws with words for sizes that are no whole numbers in range, channels of different lengths, or a window that does not fit.

## Tests

- `asset-optimizer-check.test.ts`: determinism, the cartoon flat and shaded, the sound shapes, the WAV header and samples, SSIM of the same and of damaged pictures, PSNR and the near-worst error for known damage, the common-colour share of the flat cartoon and of the grainy picture, a known shift found either way, a GLB split into texture and geometry bytes.
- `asset-optimizer-check.property.test.ts`: the common-colour share lies in (0, 1] and never falls with more colours counted or fewer bits.
- The e2e `playwright-tests/editor-asset-optimizers.spec.js` uses them on the shipped optimizers, next to the real samples in `playwright-tests/fixtures/asset-optimizer/` (the real files carry the size and quality measurements; the generated ones pin exact lengths over sample rates and the long-input timings).
