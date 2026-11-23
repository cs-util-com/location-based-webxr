# plan-io.ts

## Purpose

The photo test's browser side, shared by both views of the feature matching page (`guided-view.ts`, `cockpit-view.ts`): the camera start with its generation guard, the countdown with its beep, vibration and flash, the shot's photo itself, the run's zip (Download all) and the summary. Every outcome is an action on the shared store (`feature-match-slice.ts`).

## Public API

- `createPlanIo(deps)` -> `PlanIo`. `deps`: `fm` (the page store), `engine` (`bench-engine.ts`, for the device facts), `camera`, `video`, `flash` (shown for 360 ms after a photo), `note` (a toast saying why a tap or countdown ended without a photo), `log`, `fail`, `moving()` (the view's motion reading) and `deviceKnown()` (called once the device line is known).
- `PlanIo`:
  - `startCamera()`: `cameraStartSet("starting")`, then `idle` or `failed`; only the newest start reports back.
  - `beginCount()`: for the current shot. Vibrates 30 ms (only at the tap), then shoots at once with the countdown off, else sets `guidedCountSet({ shot, left })`, beeps and ticks once a second; at 1 the count ends and the photo is taken. A tick the reducer refuses cancels it as `refused`.
  - `cancelCount(why)`: ends a running countdown without a photo, logged `countdown: <why>`. `syncTimer()`: stops the timer when the state's count is null (a move, a reset, a run or the zip starting).
  - `shoot()`: captures the video (at most `CAPTURE_MAX`) for the current shot and puts the frame with `planShotTaken` in one `put`; beeps, flashes and logs `photo <shot id> take <n>: WxH grey mean M` (with " (phone moved during countdown)"), and `light check <shot id>: <result>` for a light shot. No picture yet, or a refused photo, is a note and `false`. The cockpit's hands-off shot calls it directly, without a countdown.
  - `moved()`: the phone moved; named in the photo's log line if a count runs.
  - `summaryOf(s)`: `summaryText` (`scenes.ts`) with the device line.
  - `downloadAll()`: `runZipStarted` (refused unless idle with a ready pair), packs the run zip below, saves it with `downloadBlob` under `runZipName(session)`. Saved: `runZipEnded("saved")`. A closed dialog: `idle`, "Nothing was lost". A failure (a photo not loaded, a zip error): `failed` with its error.
  - `copyText(text, out)`: the clipboard, "copied" or "copy refused: select the text and copy by hand".
- Types `PlanIoDeps`, `PlanIo`.

## The run zip

The layout the PC side reads; `scenes.ts.md` names the pair table behind it.

- Per ready derived pair, in run order, a folder named `pairFileNames(pairFolderTag(pair, n)).all` without `.zip` (`n` = the pair's position in `derivedPairs` plus 1), e.g. `feature-match-01-1a-s1-light-control-same-light/`. The rotation control `F1-T0` has the key `t0`: its folder is `feature-match-05-t0-s1-rotation-control-centre-squares/` with one place.
- In each folder: `feature-match-frame-a.png`, `feature-match-frame-b.png` (full frames, PNG without metadata) and `feature-match-frames.json` (`framesInfo` from `bench-export.ts`): `pair` is the legacy key, `lightCheck` is `lightOf(B)`, plus `derivedPair`, `kind`, `axis`, `controlFor` and `shots: { A: { id, take }, B: { id, take } }`.
- The rotation pairs carry the full F1 and F2; their frames JSON adds `rotation: { cropA, cropB, turnB, direction: "cw" }` (`centreCrop` from `rotation-square.ts`, `turnB` 0, 90 or 180), so the PC cuts and turns the same squares.
- At the root: `feature-match-summary.txt` and `feature-match-log.txt`.
- No matches JSON: nothing is measured on the phone.

## Invariants and assumptions

- **Outside the store**, as browser resources or guards: the count timer, the AudioContext, the newest camera start (a counter), whether the phone moved during a count, the device line. Everything a view draws is in the store.
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

Browser-only DOM code: `playwright-tests/feature-match-check.spec.js` covers it through both views (photos with a faked camera, the countdown, a refused photo, Download all with its per-pair folders, a closed dialog). The rules it calls are unit-tested in `scenes`, `run-plan`, `rotation-square`, `guided-model` and `bench-export`.
