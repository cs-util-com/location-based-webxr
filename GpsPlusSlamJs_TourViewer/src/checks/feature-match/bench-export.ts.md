# bench-export.ts

## Purpose

Saving the benchmark's captured camera frames to the device: the photo pairs of the test protocol and the names that say which pair a file holds, the file names inside the zip, a check that a PNG holds image chunks only, and the JSON that travels with the frames.

## Public API

- `PAIRS`: the protocol's pairs in the order taken, `{ key, label }`: `1a` light: control (same light), `1b` light: dimmed, `1c` light: dark, not black, `2a` rotation: control (both upright), `2b` rotation: 90 deg, `2c` rotation: 180 deg, `2d` rotation: tilted 30-45 deg, `3a` distance: control (both 1.5 m), `3b` distance: 1.5 m to 3 m, `3c` distance: 1 m to 3 m, `4a` side step, flat: control, `4b` side step, flat: 1 m, `4c` side step, deep: control, `4d` side step, deep: 1 m, `x` other. The light pairs are repeated at up to three spots.
- `NO_PAIR` (`{ key: "none", label: "manual run" }`): the selector's manual run, which uses the Options; not in `PAIRS`, so `nextPair` never moves into or out of it. `PairKey`: a key of `PAIRS` or `none`. Each key's guidance texts are in `bench-guide.ts`.
- `pairTag(key, spot, sequence)` -> `PairTag { pair, pairLabel, spot, sequence }` (`key` a `PAIRS` key or `none`); throws on an unknown key, a spot that is not an integer 1-3 or a sequence below 1 or not an integer.
- `parseSpot(text)`: the spot field's value; anything but 1, 2 or 3 reads as 1.
- `nextPair(key, spot)` -> `{ key, spot }`: the next pair in `PAIRS`; `1c` at a spot below 3 goes on to `1a` at the next spot, `1c` at spot 3 to `2a` at spot 1, every other pair keeps its spot, and `x` (the last) stays.
- `pairFileNames(tag)` -> `{ all, A, B, info, matches }`: the names one pair's files are offered under, `feature-match-<sequence, two digits at least>-<key>-s<spot>-<label slug>` plus `.zip`, `-frame-a.png`, `-frame-b.png`, `-frames.json`, `-matches.json`, e.g. `feature-match-03-1b-s2-light-dimmed.zip`. The slug is the label in lower case with every run of other characters one hyphen, so names are ASCII without spaces, and the sequence makes them unique within a page session.
- `FRAME_FILES` (the names of the entries inside the zip, the same in every zip, so a tool reads any zip the same way): `A` `feature-match-frame-a.png`, `B` `feature-match-frame-b.png`, `info` `feature-match-frames.json`, `matches` `feature-match-matches.json`, `log` `feature-match-log.txt`, `report` `feature-match-report.txt`, `all` `feature-match-all.zip`; no two names alike.
- `allFilesZip(files, { log, report })`: an uncompressed zip (`application/zip`, written by the framework `packFilesAsZip`) holding each `{ name, blob }` byte for byte, the page log as `feature-match-log.txt` and the report as `feature-match-report.txt`, the report left out when it is empty. Rejects with the framework `ZipPackagingError` on a duplicate or unsafe name or a failed write.
- `matchesInfo(results, { a, b })`: compact JSON with exactly `format` (`feature-match-matches/1`), `coordinates` (a sentence on the coordinate convention), `frames` (A and B: file, width, height) and `methods` (id, label, backend, error, and per size its long edge, the width and height it was computed at, its error, `keypointsA` and `keypointsB` as `[x, y]` and `matches` as `[indexA, indexB]`). Keypoints are mapped from the size computed to the saved frame's own pixels with `toFramePoint` and rounded to 0.01 px. A failed size or method has empty lists. These are raw counts: nothing here checks a match against the geometry.
- `SavedFrame { name: "A" | "B", frame, source: { width, height } }`: a captured frame and the camera size it was taken from.
- `pngChunkTypes(bytes)`: the chunk types in order; throws `not a PNG` on a wrong signature and `PNG truncated` when a chunk runs past the end. CRCs are not checked.
- `assertPlainPng(bytes, label)`: throws `<label>: PNG carries a <type> chunk` for anything but `IHDR PLTE tRNS sRGB gAMA cHRM iCCP pHYs sBIT bKGD cICP cLLI mDCV IDAT IEND` (so `eXIf`, `tEXt`, `iTXt`, `zTXt`, `tIME` and unknown chunks are refused). The ancillary chunks it accepts only describe the pixels (density, significant bits, background, colour coding, HDR levels) and carry no device, time or place; another browser's encoder may add them, and `<label>: PNG has no IEND` for a cut-off file.
- `framesInfo(frames, device, captureMaxLongEdge, tag)`: pretty JSON with exactly `format` (`feature-match-frames/1`), `pair` (the key), `pairLabel`, `spot`, `sequence`, `captureMaxLongEdge`, `frames` (name, file, width, height, sourceWidth, sourceHeight, greyMean, greySd rounded to 2 decimals) and `device`.

## Invariants

- Pure functions; no DOM, no network. The page does the encoding and offers the files as local downloads only.
- The files carry no time and no place: the PNG check refuses metadata chunks, and the JSON's fields are a fixed list (pinned by a test that walks every key). The matches JSON holds no device facts either; those are in the frames JSON only.

## Example

```ts
assertPlainPng(new Uint8Array(await blob.arrayBuffer()), "frame A");
const tag = pairTag("1b", 2, 3);
const json = framesInfo([a, b], device, 1280, tag);
pairFileNames(tag).all; // "feature-match-03-1b-s2-light-dimmed.zip"
```

## Tests

`bench-export.test.ts` (the zip is read back with zip.js: every entry name and its bytes, the report left out when empty, the names distinct; the pair list, the names of a pair, a property test that names are ASCII without spaces and unique across sequence numbers, the manual run's tag and name, the refused tags, the spot field and the advance rule); the page's saved files are checked in `playwright-tests/feature-match-check.spec.js`.
