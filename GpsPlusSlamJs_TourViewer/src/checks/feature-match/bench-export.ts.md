# bench-export.ts

## Purpose

The benchmark's file vocabulary: the photo pairs of the test protocol, the fixed file names inside a zip, a check that a PNG holds image chunks only, the light check, the matches JSON and the session token. The run zip's own layout and frames JSON are in `run-zip.ts`.

## Public API

- `PAIRS`: the protocol's pair keys and labels, `{ key, label }`, the vocabulary the frames JSON and the PC side share: `1a` light: control (same light), `1b` light: dimmed, `1c` light: dark, not black, `2a` rotation: control (both upright), `t0` rotation: control, centre squares, `t90` rotation: centre square turned 90 deg, `t180` rotation: centre square turned 180 deg, `2d` rotation: tilted 30-45 deg, `3b` distance: 1.5 m to 3 m, `3c` distance: 1 m to 3 m, `4b` side step, flat: 1 m, `4c` side step, deep: control, `4d` side step, deep: 1 m, `x` other. The pairs themselves are derived from shots (`scenes.ts`), which name these keys as their legacy keys; the old duplicate controls `3a` and `4a` no longer occur (F1-F2, `2a`, is the one flat control). The turns of F1's and F2's centre squares are made on the phone, not captured, so they have keys of their own (`t0`, `t90`, `t180`); the old `2b` and `2c` named a phone turned by hand and are gone, so an old zip's pair never reads as a new measurement. `PairKey`: a key of `PAIRS`.
- `MAX_SPOTS` (3): the places the light pairs are repeated at; `scenes.ts` bounds its light scenes by the same constant, so a run's highest place is always a valid spot.
- `ShotLight`: a light shot's check, the `LightCheck` values plus `"not-darker-than-dimmed"` (L4 brighter than L3); `scenes.ts` computes it.
- `sessionToken(bytes)`: the bytes as lower-case hex (the page passes 4 random bytes, 8 characters); `RangeError` below 4 bytes. No time and no place: it only tells two page loads apart.
- `FRAME_FILES` (the names of the entries inside the zip, the same in every zip, so a tool reads any zip the same way): `A` `feature-match-frame-a.png`, `B` `feature-match-frame-b.png`, `info` `feature-match-frames.json`, `matches` `feature-match-matches.json`, `log` `feature-match-log.txt`, `report` `feature-match-report.txt`, `all` `feature-match-all.zip`; no two names alike.
- `allFilesZip(files, { log, report })`: an uncompressed zip (`application/zip`, written by the framework `packFilesAsZip`) holding each `{ name, blob }` byte for byte, the page log as `feature-match-log.txt` and the report as `feature-match-report.txt`, the report left out when it is empty. Rejects with the framework `ZipPackagingError` on a duplicate or unsafe name or a failed write. Used by the flat-target capture (`flat-capture.ts`).
- `matchesInfo(results, { a, b })`: compact JSON with exactly `format` (`feature-match-matches/1`), `coordinates` (a sentence on the coordinate convention), `frames` (A and B: file, width, height) and `methods` (id, label, backend, error, and per size its long edge, the width and height it was computed at, its error, `keypointsA` and `keypointsB` as `[x, y]` and `matches` as `[indexA, indexB]`). Keypoints are mapped from the size computed to the saved frame's own pixels with `toFramePoint` and rounded to 0.01 px. A failed size or method has empty lists. These are raw counts: nothing here checks a match against the geometry. Not called by the page yet: the on-phone measuring of a later step writes it beside a measured pair.
- `SavedFrame { name: "A" | "B", frame, source: { width, height } }`: a captured frame and the camera size it was taken from.
- `pngChunkTypes(bytes)`: the chunk types in order; throws `not a PNG` on a wrong signature and `PNG truncated` when a chunk runs past the end. CRCs are not checked.
- `assertPlainPng(bytes, label)`: throws `<label>: PNG carries a <type> chunk` for anything but `IHDR PLTE tRNS sRGB gAMA cHRM iCCP pHYs sBIT bKGD cICP cLLI mDCV IDAT IEND` (so `eXIf`, `tEXt`, `iTXt`, `zTXt`, `tIME` and unknown chunks are refused). The ancillary chunks it accepts only describe the pixels (density, significant bits, background, colour coding, HDR levels) and carry no device, time or place; another browser's encoder may add them, and `<label>: PNG has no IEND` for a cut-off file.
- `lightCheck(key, meanA, meanB)` -> `"ok" | "not-darker" | "too-dark-a" | "too-dark-b" | "changed" | null`, from the two frames' grey means (0-255, else `RangeError`). For the dimmed pairs `1b` and `1c`: "too-dark-a" when A's mean is below `LIGHT_FLOOR_A` (10, nothing to dim from); "too-dark-b" when B's mean is below `LIGHT_FLOOR_B` (3, black: a black frame has nothing to match, dimmed or dark); otherwise "not-darker" when B's mean is above `LIGHT_DARKER_RATIO` (0.8) times A's. For the control pair `1a`, "changed" when B differs from A by more than `LIGHT_CONTROL_TOLERANCE` (0.2) of A's mean, or by more than 3 grey levels when A's mean is below 10 (a share of almost nothing would refuse any noise). Every bound counts as "ok". `null` for every other pair. The tester's real, correctly dimmed pairs measured B at 0.68 and 0.45 of A and are pinned as "ok". Why: on the first evening the light was dimmed before photo A, and the pair's A and B came out equally dark.

## Invariants

- Pure functions; no DOM, no network. The page does the encoding and offers the files as local downloads only.
- The files carry no time and no place: the PNG check refuses metadata chunks, and the JSON's fields are a fixed list (pinned by a test that walks every key). The matches JSON holds no device facts either; those are in the frames JSON only.

## Example

```ts
assertPlainPng(new Uint8Array(await blob.arrayBuffer()), "frame A");
const session = sessionToken(crypto.getRandomValues(new Uint8Array(4)));
lightCheck("1b", 120, 60); // "ok"
```

## Tests

`bench-export.test.ts` (the zip is read back with zip.js: every entry name and its bytes, the report left out when empty, the names distinct; the pair list, `lightCheck` at ratios 0.7, 0.8 and 0.9, the real 0.68 and 0.45 pairs, the floors of A and B and the control's 20 % and 3-level bounds, and the session token as hex, distinct for distinct bytes); the page's saved files are checked in `playwright-tests/feature-match-check.spec.js`.
