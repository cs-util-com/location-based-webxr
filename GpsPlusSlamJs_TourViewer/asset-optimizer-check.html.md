# `asset-optimizer-check.html` - the editor's optimizers, seen and heard

## Purpose

A standalone check page that runs the editor's own picture and sound optimizer rows (`ASSET_OPTIMIZERS`, through the real Worker) on a file the person chooses, or on a sample file, at the chosen setting and one step either side, and shows each result next to the original: pictures to look at (with size, share of the original, SSIM and time), sounds to listen to (with size, length in milliseconds and time).

It is a Vite build entry (`vite.config.ts`), reachable on a deployed branch preview at `/tour/asset-optimizer-check.html` and linked from the prototype gallery (`public/prototypes/index.html`) only; nothing in the Tour Viewer imports it. Its wiring is the page's own inline script; the generated test files and the measures are `src/checks/asset-optimizer-check.ts` (unit-tested).

## What it shows

- **Pictures:** longest side 1600 px at WebP quality 0.75 (chosen, blue frame), quality 0.6 and 0.9 at 1600 px, and 1280 and 2048 px at 0.75. The sample photo is a real street photo, 2400 x 1800.
- **Sounds:** a mono sound as speech at 24 kbps (chosen), 16 and 32 kbps; a stereo sound as music at 64 kbps (chosen), 48 and 96 kbps. The samples are real recordings: German speech (20 s, MP3 at 22.05 kHz), English speech (20 s, MP3 at 44.1 kHz), piano (15 s, FLAC at 44.1 kHz) and orchestra (15 s, FLAC at 48 kHz), so the page's resampling is exercised. Each result says whether, decoded at 48 kHz, it has the original's number of samples (a player's millisecond length of an Opus file is about 7 ms longer, its pre-skip, so it is not the measure).

## Samples

The sample files live next to the e2e in `playwright-tests/fixtures/asset-optimizer/`, with their sources and licences (public domain or CC0, each checked on its source page) in `SOURCES.md` there. The page imports each by URL (`?url`), so Vite serves them in development and copies them into the build; `sample(name)` fetches one as a Blob (`photo`, `speech-de`, `speech-en`, `piano`, `orchestra`) and rejects with words for an unknown name or a failed load.

## For the e2e

`window.assetOptimizerCheck` carries `optimizePicture(blob, maxSidePx, quality)`, `optimizeSound(blob, bitsPerSecond)` (each resolves `{ blob, extension, width?, height?, ms }` or rejects with the row's words), `sample`, `testPicture` and `testSound` (the generated files, which the e2e keeps for exact lengths over sample rates, the 3-minute memo and the 12 MP timing), `pictureSsim`, `pictureSsim`, `decode`, `durationMs` and `bestLag`. `playwright-tests/editor-asset-optimizers.spec.js` drives them.

## Invariants

- Settings are the shipped `OPTIMIZER_SETTINGS` with only the swept field changed; a sound's speech or music settings are chosen by the shipped row (by its channels), so both carry the variant's bitrate.
- WebCodecs needs a secure context: the page works on https and on localhost, not on a plain-http address.
- The runner's judgement (10 % smaller, the caps) is not applied here: the page shows every result.
