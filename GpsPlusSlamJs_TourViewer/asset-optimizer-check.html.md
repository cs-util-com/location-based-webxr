# `asset-optimizer-check.html` - the editor's optimizers, seen and heard

## Purpose

A standalone check page that runs the editor's own picture and sound optimizer rows (`ASSET_OPTIMIZERS`, through the real Worker) on a file the person chooses, or on a test file, at the chosen setting and one step either side, and shows each result next to the original: pictures to look at (with size, share of the original, SSIM and time), sounds to listen to (with size, length in milliseconds and time).

It is a Vite build entry (`vite.config.ts`), reachable on a deployed branch preview at `/tour/asset-optimizer-check.html` and linked from the prototype gallery (`public/prototypes/index.html`) only; nothing in the Tour Viewer imports it. Its wiring is the page's own inline script; the test files and the measures are `src/checks/asset-optimizer-check.ts` (unit-tested).

## What it shows

- **Pictures:** longest side 1600 px at WebP quality 0.75 (chosen, blue frame), quality 0.6 and 0.9 at 1600 px, and 1280 and 2048 px at 0.75. The test photo is 4000 x 3000 (12 MP).
- **Sounds:** a mono sound as speech at 24 kbps (chosen), 16 and 32 kbps; a stereo sound as music at 64 kbps (chosen), 48 and 96 kbps. The test voice lasts 3 minutes, the test music 30 seconds, both at 44.1 kHz so the page's resampling is exercised. A result whose length differs from the original's says so.

## For the e2e

`window.assetOptimizerCheck` carries `optimizePicture(blob, maxSidePx, quality)`, `optimizeSound(blob, bitsPerSecond)` (each resolves `{ blob, extension, width?, height?, ms }` or rejects with the row's words), `testPicture`, `testSound`, `pictureSsim`, `decode`, `durationMs` and `bestLag`. `playwright-tests/editor-asset-optimizers.spec.js` drives them.

## Invariants

- Settings are the shipped `OPTIMIZER_SETTINGS` with only the swept field changed; a sound's speech or music settings are chosen by the shipped row (by its channels), so both carry the variant's bitrate.
- WebCodecs needs a secure context: the page works on https and on localhost, not on a plain-http address.
- The runner's judgement (10 % smaller, the caps) is not applied here: the page shows every result.
