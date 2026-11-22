# plan-io.ts

## Purpose

The photo test's browser side, shared by both views of the feature matching page (`guided-view.ts`, `cockpit-view.ts`): the camera start with its generation guard, the countdown with its beep, vibration and flash, the plan photo itself, a pair's own zip, the run's zip (Download all), the single files and the summary. Every outcome is an action on the shared store (`feature-match-slice.ts`).

## Public API

- `createPlanIo(deps)` -> `PlanIo`. `deps`: `fm` (the page store), `engine` (`bench-engine.ts`, for the device facts), `camera`, `video`, `flash` (shown for 360 ms after a photo), `note` (a toast saying why a tap or countdown ended without a photo), `log`, `fail`, `moving()` (the view's motion reading), `deviceKnown()` (called once the device line is known) and, optionally, `shot(slot, which)` (called after the store took a photo).
- `PlanIo`:
  - `startCamera()`: `cameraStartSet("starting")`, then `idle` or `failed`; only the newest start reports back.
  - `beginCount(shot)`: vibrates 30 ms (only at the tap), then shoots at once with the countdown off, else sets `guidedCountSet({ shot, left })`, beeps and ticks once a second; at 1 the count ends and the photo is taken. A tick the reducer refuses cancels it as `refused`.
  - `cancelCount(why)`: ends a running countdown without a photo, logged `countdown: <why>`. `syncTimer()`: stops the timer when the state's count is null (a move, a reset).
  - `shoot(shot)`: captures the video (at most `CAPTURE_MAX`), puts the frame with `planPhotoTaken` in one `put`, beeps, flashes and logs `photo A: <slot> #<seq> WxH grey mean M` (with " (phone moved during countdown)"), and `light check <slot>: <result>` for a complete light pair. No picture yet, or a refused photo, is a note and `false`.
  - `moved()`: the phone moved; named in the photo's log line if a count runs.
  - `summaryOf(s)`: `summaryText` with the device line.
  - `matchesOf(s, pair)`: the results of a plan run on exactly this take, else undefined.
  - `pairZip(s, pair)`: one pair as one zip (both PNGs, frames JSON, matches JSON, the log and the report; an empty matches list when nothing was measured).
  - `downloadAll()`: `runZipStarted` (refused unless idle with a complete pair), every complete pair (its kept zip when this take has one on the page, else its PNGs and frames JSON), the summary and the log, saved with `downloadBlob` under `runZipName(session)`. Saved: `runZipEnded("saved")`, `planRunDownloaded`, the kept files marked downloaded and dropped. A closed dialog: `idle`, "Nothing was lost". A failure: `failed` with its error.
  - `saveFile(kind)`: one file of the current pair (`A`, `B`, `info`, `matches`) under busy `saving` (`planFileSaveStarted`, `planFileSaveEnded(note)`); a saved file marks the take downloaded (`planFileKept`, `planFilesDownloaded`, `planKeptDropped`), so a retake gets a new running number. The Blob is not kept: the take's photos already are.
  - `copyText(text, out)`: the clipboard, "copied" or "copy refused: select the text and copy by hand".
- `SUMMARY_FILE` (`feature-match-summary.txt`), `FileKind`, types `PlanIoDeps`, `PlanIo`.

## Invariants and assumptions

- **Outside the store**, as browser resources or guards: the count timer, the AudioContext, the newest camera start (a counter), whether the phone moved during a count, the device line. Everything a view draws is in the store.
- Sound follows the plan's `sound` setting; a missing AudioContext or vibration is ignored, never an error.
- Every save path ends in its end action (`runZipEnded`, `planFileSaveEnded`), so the page never stays busy after a failure.

## Example

```ts
const io = createPlanIo({
  fm,
  engine,
  camera,
  video,
  flash,
  note,
  log,
  fail,
  moving: () => false,
  deviceKnown: render,
});
io.beginCount("a");
```

## Tests

Browser-only DOM code: `playwright-tests/feature-match-check.spec.js` covers it through both views (photos with a faked camera, the countdown on the page clock, a refused photo and tick, the pair zip, Download all through the picker and the link, a closed dialog and a failure, the single files). The rules it calls are unit-tested in `guided-model`, `plan-slots`, `run-plan` and `bench-export`.
