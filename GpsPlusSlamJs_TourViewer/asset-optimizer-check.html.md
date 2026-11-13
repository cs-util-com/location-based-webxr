# `asset-optimizer-check.html` - the editor's optimizers, seen and heard

## Purpose

A standalone check page that runs the editor's own picture, sound and 3D model optimizer rows (`ASSET_OPTIMIZERS`, through the real Worker) on a file the person chooses, or on a test file, at the chosen setting and one step either side, and shows each result next to the original: pictures to look at (with size, share of the original, SSIM and time), sounds to listen to (with size, length in milliseconds and time), 3D models drawn by three.js from one camera next to the original's drawing (with size, share of the original, largest texture side, the SSIM of the two drawings and time).

It is a Vite build entry (`vite.config.ts`), reachable on a deployed branch preview at `/tour/asset-optimizer-check.html` and linked from the prototype gallery (`public/prototypes/index.html`) only; nothing in the Tour Viewer imports it. Its wiring is the page's own inline script; the test files and the measures are `src/checks/asset-optimizer-check.ts` (unit-tested).

## What it shows

- **Pictures:** longest side 1600 px at WebP quality 0.75 (chosen, blue frame), quality 0.6 and 0.9 at 1600 px, and 1280 and 2048 px at 0.75. The test photo is 4000 x 3000 (12 MP).
- **Sounds:** a mono sound as speech at 24 kbps (chosen), 16 and 32 kbps; a stereo sound as music at 64 kbps (chosen), 48 and 96 kbps. The test voice lasts 3 minutes, the test music 30 seconds, both at 44.1 kHz so the page's resampling is exercised. A result whose length differs from the original's says so.
- **3D models:** textures at most 1024 px with 16-bit positions (chosen), 512 and 2048 px textures, and 8-bit positions with a 1 % error budget. The test model is the scanned rock in `public/prototypes/model-lod-1/`. A drawing is 256 x 256 px, lit by an ambient and a directional light, the camera framed on the original's box.

## For the e2e

`window.assetOptimizerCheck` carries `optimizePicture(blob, maxSidePx, quality)`, `optimizeSound(blob, bitsPerSecond)` (each resolves `{ blob, extension, width?, height?, ms }` or rejects with the row's words), `testPicture`, `testSound`, `pictureSsim`, `decode`, `durationMs` and `bestLag`; for models `optimizeModel(blob, modelSettings)`, `modelFacts(blob)` (`{ min, max, triangles, textureSide, inert }` as three.js and the tour's check see the file), `compareModel(blob, modelSettings)` (the result with both files' facts and the drawings' `ssim`) and `testModel(name)` (a scanned model by name). `playwright-tests/editor-asset-optimizers.spec.js` drives them.

## Invariants

- Settings are the shipped `OPTIMIZER_SETTINGS` with only the swept field changed; a sound's speech or music settings are chosen by the shipped row (by its channels), so both carry the variant's bitrate.
- WebCodecs needs a secure context: the page works on https and on localhost, not on a plain-http address.
- The runner's judgement (10 % smaller, the caps) is not applied here: the page shows every result.
