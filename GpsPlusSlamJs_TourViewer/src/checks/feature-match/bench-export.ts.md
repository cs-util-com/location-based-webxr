# bench-export.ts

## Purpose

Saving the benchmark's captured camera frames to the device: the file names, a check that a PNG holds image chunks only, and the JSON that travels with the frames.

## Public API

- `FRAME_FILES`: `A` `feature-match-frame-a.png`, `B` `feature-match-frame-b.png`, `info` `feature-match-frames.json`, `matches` `feature-match-matches.json`, `log` `feature-match-log.txt`, `report` `feature-match-report.txt`, `all` `feature-match-all.zip`; no two names alike.
- `allFilesZip(files, { log, report })`: an uncompressed zip (`application/zip`, written by the framework `packFilesAsZip`) holding each `{ name, blob }` byte for byte, the page log as `feature-match-log.txt` and the report as `feature-match-report.txt`, the report left out when it is empty. Rejects with the framework `ZipPackagingError` on a duplicate or unsafe name or a failed write.
- `matchesInfo(results, { a, b })`: compact JSON with exactly `format` (`feature-match-matches/1`), `coordinates` (a sentence on the coordinate convention), `frames` (A and B: file, width, height) and `methods` (id, label, backend, error, and per size its long edge, the width and height it was computed at, its error, `keypointsA` and `keypointsB` as `[x, y]` and `matches` as `[indexA, indexB]`). Keypoints are mapped from the size computed to the saved frame's own pixels with `toFramePoint` and rounded to 0.01 px. A failed size or method has empty lists. These are raw counts: nothing here checks a match against the geometry.
- `SavedFrame { name: "A" | "B", frame, source: { width, height } }`: a captured frame and the camera size it was taken from.
- `pngChunkTypes(bytes)`: the chunk types in order; throws `not a PNG` on a wrong signature and `PNG truncated` when a chunk runs past the end. CRCs are not checked.
- `assertPlainPng(bytes, label)`: throws `<label>: PNG carries a <type> chunk` for anything but `IHDR PLTE tRNS sRGB gAMA cHRM iCCP pHYs sBIT bKGD cICP cLLI mDCV IDAT IEND` (so `eXIf`, `tEXt`, `iTXt`, `zTXt`, `tIME` and unknown chunks are refused). The ancillary chunks it accepts only describe the pixels (density, significant bits, background, colour coding, HDR levels) and carry no device, time or place; another browser's encoder may add them, and `<label>: PNG has no IEND` for a cut-off file.
- `framesInfo(frames, device, captureMaxLongEdge)`: pretty JSON with exactly `format` (`feature-match-frames/1`), `captureMaxLongEdge`, `frames` (name, file, width, height, sourceWidth, sourceHeight, greyMean, greySd rounded to 2 decimals) and `device`.

## Invariants

- Pure functions; no DOM, no network. The page does the encoding and offers the files as local downloads only.
- The files carry no time and no place: the PNG check refuses metadata chunks, and the JSON's fields are a fixed list (pinned by a test that walks every key). The matches JSON holds no device facts either; those are in the frames JSON only.

## Example

```ts
assertPlainPng(new Uint8Array(await blob.arrayBuffer()), "frame A");
const json = framesInfo([a, b], device, 1280);
```

## Tests

`bench-export.test.ts` (the zip is read back with zip.js: every entry name and its bytes, the report left out when empty, the names distinct); the page's saved files are checked in `playwright-tests/feature-match-check.spec.js`.
