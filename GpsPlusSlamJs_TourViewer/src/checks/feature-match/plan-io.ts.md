# plan-io.ts

## Purpose

The photo test's browser side, shared by both views of the feature matching page (`guided-view.ts`, `cockpit-view.ts`): the camera start with its generation guard, the countdown with its beep, vibration and flash, the shot's photo itself (its PNG encoded at once and kept until stored, its preview, and the one request that the browser keeps the stored photos), the run's zip read from storage (Download all) and the summary. Every outcome is an action on the shared store (`feature-match-slice.ts`).

## Public API

- `createPlanIo(deps)` -> `PlanIo`. `deps`: `fm` (the page store), `engine` (`bench-engine.ts`, for the device facts), `camera`, `video`, `flash` (shown for 360 ms after a photo), `note` (a toast saying why a tap or countdown ended without a photo), `log`, `fail`, `moving()` (the view's motion reading) and `deviceKnown()` (called once the device line is known).
- `PlanIo`:
  - `startCamera()`: `cameraStartSet("starting")`, then `idle` or `failed`; only the newest start reports back.
  - `beginCount()`: for the current shot. Vibrates 30 ms (only at the tap), then shoots at once with the countdown off, else sets `guidedCountSet({ shot, left })`, beeps and ticks once a second; at 1 the count ends and the photo is taken. A tick the reducer refuses cancels it as `refused`.
  - `cancelCount(why)`: ends a running countdown without a photo, logged `countdown: <why>`. `syncTimer()`: stops the timer when the state's count is null (a move, a reset, a run or the zip starting).
  - `shoot()`: captures the video (at most `CAPTURE_MAX`) for the current shot, starts its PNG encode (`framePng`), sets its preview (`previewFrame`) and puts the PNG with `planShotTaken` in one `put`; an encode that fails (`toBlob` gave nothing) while the plan still holds that photo reports `fail("capture", e)` and dispatches `planShotLost`, so the shot asks again and the reconcile drops the rejected PNG (Download all goes on without it); the first accepted photo of a load asks `navigator.storage.persist()` once and logs `storage persist: granted`, `refused`, `unavailable` or `failed (<error>)`; beeps, flashes and logs `photo <shot id> take <n>: WxH grey mean M` (with " (phone moved during countdown)"), and `light check <shot id>: <result>` for a light shot. It also keeps the camera's report at the photo (`camera.report()`, `camera-report.ts`) on the photo and logs `camera at <shot id>: <report>`, so the desk sees whether the phone reports a usable focus distance; distances are never demanded. No picture yet, or a refused photo, is a note and `false`; in a tab that does not hold the run the note says the test is open in another tab. The cockpit's hands-off shot calls it directly, without a countdown.
  - `moved()`: the phone moved; named in the photo's log line if a count runs.
  - `summaryOf(s)`: `summaryText` (`scenes.ts`) with the results, the ticked methods (the summary names those the phone measures) and the device line.
  - `downloadAll()`: `runZipStarted` (refused unless idle with a ready pair), awaits `fm.restore()` (right after a load the stored log and results may not be back yet, and the zip would miss them), packs the run zip (`runZipFiles` of `run-zip.ts`, the photos read through `fm.readPhoto`, the matches through `fm.readMatches`, then `packFilesAsZip` with `timeless`: no clock time in the archive, and the same run packs to the same bytes), saves it with `downloadBlob` under `runZipName(session)`. Saved: `runZipEnded("saved")`. A closed dialog: `idle`, "Nothing was lost". A failure (a photo storage cannot read, a zip error): `failed` with its error.
  - `copyText(text, out)`: the clipboard; `out` says "copying..." while it waits, then "copied" or "copy refused by the browser".
- Types `PlanIoDeps`, `PlanIo`.

## The run zip

The exact layout, file names and JSON fields are in `run-zip.ts.md`; it is read from storage, so the zip after a reload is the same.

## Invariants and assumptions

- **Outside the store**, as browser resources or guards: the count timer, the AudioContext, the newest camera start (a counter), whether the phone moved during a count, the device line, whether persistence was asked for. Everything a view draws is in the store.
- Sound follows the plan's `sound` setting; a missing AudioContext or vibration is ignored, never an error.
- Every save path ends in `runZipEnded`, so the page never stays busy after a failure.

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
io.beginCount();
```

## Tests

`plan-io.test.ts` (no DOM: the camera frame and the PNG encode are faked): the camera report kept on the photo and logged; a PNG that cannot be encoded makes the shot ask again and the zip go on without it; Download all right after a load waits for the stored log.

In the browser, `playwright-tests/feature-match-check.spec.js` covers it through both views (photos with a faked camera, the countdown, a refused photo, Download all with its exact file list, a closed dialog, a failed photo read, the `storage persist:` line, a second tab refused). The rules it calls are unit-tested in `scenes`, `run-plan`, `rotation-square`, `run-zip`, `guided-model` and `bench-export`.
