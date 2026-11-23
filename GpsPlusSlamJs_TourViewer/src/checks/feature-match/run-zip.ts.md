# run-zip.ts

## Purpose

The photo test's run zip (Download all), as a list of entries built from storage: every shot's photo once, a frames JSON per ready pair that names its two shot files, a matches JSON per pair the phone measured, the summary and the log. The photos and matches come through readers (`readPhoto`, `readMatches` of `feature-match-store.ts`), so the zip built after a reload is the same as before it. `plan-io.ts` packs the list with `packFilesAsZip` and saves it.

## Public API

- `RUN_FRAMES_FORMAT`: `"feature-match-frames/2"`, the format tag of a pair's frames JSON in this zip.
- `SUMMARY_FILE`: `"feature-match-summary.txt"`. `LOG_FILE`: `"feature-match-log.txt"` (`FRAME_FILES.log`).
- `shotFile(shot, take)`: `shots/<shot id>-t<take>.png`, e.g. `shots/light-s1/L2-t2.png`.
- `ZipEntry { path, data }` (`data` a Blob or text) and `RunZipInput { plan, session, results, device, captureMaxLongEdge, summary, log, photo(id), matches(key) }`.
- `runZipFiles(input)` -> `Promise<ZipEntry[]>`, in the order below. Rejects with whatever `photo` rejects with: a photo that cannot be read fails the zip instead of leaving a hole in it.

## The layout (exact)

The zip is named `runZipName(session)` = `feature-match-run-<session>.zip` (`scenes.ts`). Its entries, in this order:

1. `shots/<scene id>/<shot key>-t<take>.png`, one per shot that has a photo, in run order (`planShots`), e.g. `shots/light-s1/L1-t1.png`, `shots/flat-s1/F1-t1.png`. Only the photo the plan keeps for a shot goes in; `take` is its take (2 after one retake). The PNG is the captured frame at its captured size (at most `CAPTURE_MAX` on the long side), plain (`assertPlainPng`: no EXIF, text or time chunks).
2. Per ready derived pair, in `derivedPairs` order: `pairs/<pair id>/feature-match-frames.json`, e.g. `pairs/light-s1/L1-L2/feature-match-frames.json`, `pairs/flat-s1/F1-T90/feature-match-frames.json`. A pair is ready when both its shots have a photo.
3. Right after a pair's frames JSON, only when its result is `done` and its matches are stored: `pairs/<pair id>/feature-match-matches.json` (the text the on-phone measuring stored; no producer exists yet).
4. `feature-match-summary.txt` (`summaryText` of `scenes.ts`).
5. `feature-match-log.txt` (the page log, the log of earlier loads first, a `page reloaded` line between loads).

The frames JSON, pretty-printed (2 spaces) with a final newline, fields in this order:

- `format`: `"feature-match-frames/2"`.
- `pair`: the pair's legacy protocol key (`PAIRS` of `bench-export.ts`), always present, `t0` for `F1-T0`.
- `pairLabel`: that key's label.
- `derivedPair`: the pair id, `<scene id>/<A key>-<B key>` (the turns `<scene id>/F1-T0`, `F1-T90`, `F1-T180`).
- `kind`: `real`, `turn0`, `turn90` or `turn180`.
- `spot`: the pair's place, 1 to 3.
- `axis`: what the pair varies (`light`, `control` for F1-F2, `rot`, `oblique`, `scale`, `side-flat`, `side-deep`, `own`).
- `control`: true when the pair is a control for some axis (`controlFor` not empty).
- `controlFor`: the axes the pair is the control of.
- `session`: the page load's `sessionToken` (8 hex).
- `lightCheck`: `lightOf(B)` (`ok`, `changed`, `not-darker`, `too-dark-a`, `too-dark-b`, `not-darker-than-dimmed`), null for a non-light pair.
- `captureMaxLongEdge`: the long edge photos were captured at, at most.
- `frames`: A then B, each `{ name, shot, take, file, width, height, sourceWidth, sourceHeight, greyMean }` (`file` the `shots/...` entry above, `greyMean` 0-255 rounded to 2 decimals), and for a rotation pair also `crop: { x, y, side }`, the centre square (`centreCrop` of `rotation-square.ts`).
- `turn`: only for a rotation pair, `{ degrees: 0 | 90 | 180, direction: "cw" }`, the clockwise turn of B's square.
- `device`: the device facts (`DeviceInfo` of `bench-report.ts`).

No time and no place anywhere: the JSON fields are this fixed list, and the PNGs are plain.

## Invariants and assumptions

- Each shot's PNG is in the zip once, however many pairs use it; every `file` a frames JSON names is an entry of the zip (property test).
- A pair that is not ready has no folder; a result key that is not current (a retaken shot) has no matches file.
- Pure but for the two readers; no DOM.

## Example

```ts
const files = await runZipFiles({
  plan,
  session,
  results: state.results,
  device,
  captureMaxLongEdge: CAPTURE_MAX,
  summary,
  log,
  photo: fm.readPhoto,
  matches: fm.readMatches,
});
const zip = await packFilesAsZip(files);
```

## Tests

- `run-zip.test.ts`: the entry list of a run with L1, L2, F1 and F2 (each shot once, five frames JSON, summary and log last), the frames JSON of a turned pair field by field, `t0` as control, the light check, a retake's take in the shot file, a measured pair's matches file only when done and stored, and a photo that cannot be read failing the zip.
- `run-zip.property.test.ts`: for any shots taken, every named file is in the zip, no path twice, one PNG per shot and a frames JSON per ready pair.
- The saved zip in the browser: `playwright-tests/feature-match-check.spec.js` (the cockpit and guided zips with their exact file lists, the zip after a reload, a retake's take).
