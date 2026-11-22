# guided-view.ts

## Purpose

The guided view of `feature-match-check.html`, the page's default (`?ui=cockpit` shows the four-step view instead, `cockpit-view.ts`). It walks the tester through the run plan one pair at a time: an intro, the run screen (step card, viewfinder, countdown, the two photo slots and one big button), the pairs sheet, the end screen with Download all and the summary, and an optional measure sheet. Ported from the chosen prototype `public/prototypes/feature-match-2-guided/` (markup in the page, styles in `guided-view.css`).

## Public API

- `startGuidedView({ root, fm, engine, camera, log, fail })`: wires the view found under `root` and returns its render, which the entry calls on every store change. Throws `feature-match-check: missing <selector>` when the page lacks an element it needs.
- `guidedVideo(root)`: the view's video element, for the page camera.
- The summary goes into the run zip as `feature-match-summary.txt` (`SUMMARY_FILE`, module-private).

## Invariants and assumptions

- **State in the store.** Everything a screen shows comes from `guided-model.ts` (`runView`, `pairRows`, `endView`, `planPairOf`, `runPairs`) on the page state; taps only dispatch actions (`plan*`, `guided*`, `runZip*`). Photos go in through `put`, in the same step as `planPhotoTaken`; a refused photo leaves nothing behind.
- **Outside the store**, as browser resources or transient UI nobody else reads: the screen (intro, run, end) and the sheet shown, the countdown's interval timer, the AudioContext, the motion level and whether a reading was seen, whether the phone moved during the countdown, the ghost toggle, the camera-failed flag, the device line for the summary, the file buttons' note and in-flight guard, the pair grid's last rows, and which frame each canvas last drew (`data-id`).
- **First screen.** The intro when the plan has no photo yet (`plan.shots === 0`), else the run screen. The intro's Start reads "Continue where you left off" once a photo exists; the light-test place buttons (1-3) are off once any slot holds a photo.
- **Camera.** The run screen starts the camera (unless a run is busy or the last start failed); the intro, the end screen and the flat targets stop it. With the camera off, the big button's Capture only starts it, and a chip in the finder says "camera off: tap Capture" or "camera unavailable: tap Capture to retry".
- **Countdown.** A capture tap vibrates (30 ms, only at the tap) and, with a countdown of 3 or 5 s, sets `guidedCountSet({ shot, left })`, beeps (660 Hz) and ticks once a second; at 1 it clears the count and takes the photo. Countdown off shoots at once. Cancel, opening the pairs sheet and leaving the run screen cancel it (logged `countdown: <why>`). The timer stops whenever the state's count is null (a reset, a move or a refused tick). The photo beeps (1320 Hz) and flashes for 360 ms; sound follows the plan's setting.
- **Photo log line.** `photo A: <slot> #<seq> WxH grey mean M`, with " (phone moved during countdown)" when the steady hint read moving at any point of the countdown; a complete light pair adds `light check <slot>: <result>`.
- **Steady hint.** `devicemotion` rotation rates feed `motionStep`; the chip shows "steady" or "phone moving" (`isMoving`, threshold `STEADY_THRESHOLD`) only on the run screen, once a reading was seen, and not while the pair is reviewed.
- **Ghost and review.** While photo B is due, "Show A" lays photo A at 40 % over the finder; it turns off after a new photo A and on every move. With both photos taken, the finder shows them side by side with the light-check or completion note; tapping a slot toggles its retake (`guidedRetakeToggled`).
- **Big button.** Cancel, Capture/Retake A or B, Next pair (`planMoved`, logged `next pair: <slot>`), Next missing pair, or Finish (the end screen), as `runView` says.
- **Pairs sheet.** Every slot with its state; a tap moves there and shows the run screen. Countdown (3, 5, off) and the sound switch change the plan's settings. "Add an extra pair (other)" adds one (up to `MAX_EXTRA`) and moves to it; "Finish and download" opens the end screen; "Start over" asks first and then resets the plan (refused while busy). Escape closes either sheet.
- **Download all.** `runZipStarted` (refused unless idle with a complete pair), then every complete pair (`runPairs`) as its two PNGs and its frames JSON under the pair's own names, plus `feature-match-summary.txt` and the log, packed with `packFilesAsZip` and saved with `downloadBlob` under `runZipName(session)`. Saved: `planRunDownloaded`, then "Saved <name> (<size>). Send this file." The save dialog closed: "Not saved: the save dialog was closed. Nothing was lost." and no download counted. A failure (a frame not loaded, an encode error): an `ERROR download:` line and "Could not prepare the zip: ... Nothing was lost; try again." The button reads "Preparing the zip..." and is off meanwhile.
- **Summary and log.** The end screen shows `summaryText` (session, pairs complete, missing, light checks, retakes, downloads, the phone line from `deviceSummary`); Copy summary and Copy log write to the clipboard ("copied", or "copy refused: select the text and copy by hand").
- **Measure sheet.** Holds the measuring block, moved in at start with its own listeners: the synthetic run button, Options, Speed test and Results (table, pictures, report, log; the cockpit's Options note is hidden). "Run on this pair" runs the benchmark on the current plan pair (`engine.startRun("plan")`, the photo-test settings). The current pair's single files (photo A, photo B, sizes and device, matches after a run on this take) save through `downloadBlob`; a saved file marks the take downloaded (`planFileKept`, `planFilesDownloaded`, `planKeptDropped`), so a retake gets a new running number. "Flat targets" stops the camera and opens `flat-capture.ts`.

## Example

```ts
const camera = createCameraControl(guidedVideo(document), cameraDeps);
const view = startGuidedView({ root: document, fm, engine, camera, log, fail });
fm.store.subscribe(view);
```

## Tests

- Screen rules: `guided-model.test.ts` (run view, pair rows, end view and download label, run pairs, device line, steady hint with its threshold sweep); the actions: `feature-match-slice.test.ts`.
- The view in the browser: `playwright-tests/feature-match-check.spec.js`, the guided tests (intro to end with a faked camera and countdown off, Download all through the save picker and through the link fallback, a closed save dialog, the plan run on a pair with stubbed SIFT, and the layout at three viewports).
