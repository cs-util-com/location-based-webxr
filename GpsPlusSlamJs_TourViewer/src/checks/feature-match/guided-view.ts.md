# guided-view.ts

## Purpose

The guided view of `feature-match-check.html`, the page's default (`?ui=cockpit` shows the cockpit view instead, `cockpit-view.ts`). It walks the tester through the run one shot at a time: an intro, the run screen (step card, viewfinder, countdown, the previous and current shot thumbs and one big button), the shots sheet, the end screen with Download all and the summary, and an optional measure sheet. Ported from the chosen prototype `public/prototypes/feature-match-2-guided/` (markup in the page, styles in `guided-view.css`); the prototype walked pairs, the build walks shots with the same screens.

## Public API

- `startGuidedView({ root, fm, engine, camera, log, fail })`: wires the view found under `root` and returns its render, which the entry calls on every store change. Throws `feature-match-check: missing <selector>` when the page lacks an element it needs.
- `guidedVideo(root)`: the view's video element, for the page camera.
- The camera start, the countdown, the photo, the run zip and the summary are `plan-io.ts`, shared with the cockpit view.

## Invariants and assumptions

- **State in the store.** Everything a screen shows comes from `guided-model.ts` (`runView`, `shotRows`, `endView`) on the page state; taps only dispatch actions (`plan*`, `guidedCountSet`, `runZip*`). Photos go in through `put`, in the same step as `planShotTaken`; a refused photo leaves nothing behind.
- **Outside the store**, as browser resources or transient UI nobody else reads: the screen (intro, run, end) and the sheet shown, the motion level and whether a reading was seen, the ghost toggle, and which photo each canvas last drew (`data-id`). The slot, review and ghost canvases draw the photo's preview (`sides.previews`), never the full PNG. The countdown's timer, the AudioContext, whether the phone moved during the countdown, the camera start's generation counter and the device line are in `plan-io.ts`.
- **Intro.** The hands-off line follows the plan's countdown and sound settings (`introCountdownText`). The light-scene place buttons (1-3) set the plan's size; they are off once a shot outside the kept size holds a photo. The intro shows when the plan has no photo yet, else the run screen.
- **Camera.** The run screen starts the camera unless a run is busy or the last start failed (`state.cameraStart` is `failed`); the intro, the end screen and the flat targets stop it. With the camera off, the big button only starts it, and a chip in the finder says "starting camera..." while a start waits, "camera unavailable: tap Capture to retry" after a failed one, else "camera off: tap Capture".
- **Photos not stored.** While a photo could not be written to the phone's database (`state.photoStoreFailing`), the run screen shows the chip "not stored on this phone: download soon" and the end screen a line saying a reload would lose them. In a tab that does not hold the run (`state.otherTab`) the same chip says `OTHER_TAB_TEXT`.
- **Countdown and photo.** A capture tap calls `plan-io`'s `beginCount()` for the current shot; Cancel, opening the shots sheet and leaving the run screen cancel it (logged `countdown: <why>`). A shot with no camera picture yet, or a photo the reducer refuses, says so in a short note at the foot of the finder (`#g-shot-note`). After a photo whose light check passes, the store moves to the next open shot by itself; a failed check stays for the retake.
- **Steady hint.** `devicemotion` rotation rates feed `motionStep`; the chip shows "steady" or "phone moving" (`isMoving`, threshold `STEADY_THRESHOLD`) only on the run screen, once a reading was seen, and not while a shot is reviewed.
- **Ghost and review.** While a later shot of a scene is due, "Show A" lays the scene's previous photo at 40 % over the finder. The toggle remembers the shot it was switched on for, so it turns off on every move, the store's own move after a photo included. A taken shot shows its photo with the light check note and what a retake redoes ("Retaking F1 redoes 7 measurements."). The left thumb goes back to the scene's previous shot; the right one retakes the current shot.
- **Big button.** Cancel, Capture or Retake the shot, Next shot (`planMoved`, logged `next shot: <id>`), Next missing shot, or Finish (the end screen), as `runView` says.
- **Shots sheet.** Every shot with its state; a tap moves there and shows the run screen. Countdown (3, 5, off) and the sound switch change the plan's settings. "Add an own scene" adds one (up to `MAX_EXTRA`) and moves to its X1; "Finish and download" opens the end screen; "Start over" asks first and then resets the plan (refused while busy). Escape closes either sheet.
- **Download all.** `plan-io`'s `downloadAll()`: one zip with a folder per ready pair, the summary and the log (layout in `plan-io.ts.md`). The button reads "Preparing the zip..." and is off meanwhile, then "Download again" with the saved line, or the failure with "Nothing was lost; try again."
- **Summary and log.** The end screen shows `summaryText` (session, shots taken and missing, pairs ready, light checks, retakes, the phone line); Copy summary and Copy log write to the clipboard ("copied", or "copy refused: select the text and copy by hand").
- **Measure sheet.** Holds the measuring block, moved in at start with its own listeners: the synthetic run, Options, Speed test (on F1 and F2 once both are taken, else synthetic) and Results (table, pictures, report, log). Nothing is measured on the run's pairs on the phone. "Flat targets" stops the camera and opens `flat-capture.ts`.

## Differences from the prototype

- **Shots, not pairs.** The prototype's header, card and sheet counted pairs; the build counts shots ("Shot 1 of 13") and the two thumbs are the scene's previous shot and the current one.
- **Measure.** The prototype's "Run on my pairs" ran every pair; the build's measure sheet holds the synthetic run and the speed test only.
- **Phone on its side.** At 915x412 the prototype's step card overflows: the foot lines lie over the sequence and "then" and B are cut off below the card. The build has the same markup and fixes it in `guided-view.css` (no diagram below 560 px of height in landscape, a card that scrolls as the last resort). Below 400 px of height (800x360, a common phone on its side) the purpose line goes as well and the card column widens to 55 %.

## Example

```ts
const camera = createCameraControl(guidedVideo(document), cameraDeps);
const view = startGuidedView({ root: document, fm, engine, camera, log, fail });
fm.store.subscribe(view);
```

## Tests

- Screen rules: `guided-model.test.ts` (run view, shot rows, counts, end view and download label, device line, steady hint with its threshold sweep); the actions: `feature-match-slice.test.ts`.
- The view in the browser: `playwright-tests/feature-match-check.spec.js`, the guided tests: intro to Download all by shots with a faked camera (the ghost gone once the run moves on, F1 picked in the shots sheet and its review saying a retake redoes 7 measurements, a closed save dialog, the zip's pair folder, summary and log); a download link and a reload that keeps the photos, gives a new photo its own id and yields the exact file list with the log of both loads; a second tab refused; the countdown under the page clock, and ended at once by a save that starts under it (no photo at its end); the "starting camera..." chip and a camera start again after the help; Download all failing without loss; the synthetic run from the measure sheet; the run screen's layout at four viewports.
