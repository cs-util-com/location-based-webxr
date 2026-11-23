# guided-view.ts

## Purpose

The guided view of `feature-match-check.html`, the page's default (`?ui=cockpit` shows the cockpit view instead, `cockpit-view.ts`). It walks the tester through three scenes one photo at a time: an intro, the run screen (scene header with its rule chip, a strip with a tab per scene and the scene's photos, the step card, the viewfinder with a countdown before each photo, a secondary and a big primary button), the end view (the measuring per scene, the zip choice, one download, the shots not taken), a menu and an optional measure sheet. Ported from the chosen prototype `public/prototypes/feature-match-3-scenes-guided/` (markup in the page, styles in `guided-view.css`).

## Public API

- `startGuidedView({ root, fm, engine, camera, log, fail })`: wires the view found under `root` and returns its render, which the entry calls on every store change. Throws `feature-match-check: missing <selector>` when the page lacks an element it needs.
- `guidedVideo(root)`: the view's video element, for the page camera.
- The camera start, the countdown, the photo, the run zip, the summary and the clipboard are `plan-io.ts`, shared with the cockpit view.

## Invariants and assumptions

- **State in the store.** Every screen is drawn from `guided-scene-model.ts` (`runView`, `stripView`, `endView`) on the page state; taps only dispatch actions. The screen shown (`guidedShown`), the retake choice (`retakeChosen`) and the zip choice (`endChoiceSet`) are the store's, so a reload opens the screen the plan is at (the intro for a fresh run, else the run or, with nothing open, the end view).
- **Outside the store**, as browser resources or transient UI nobody else reads: the open sheet (menu or measure), the scene the strip is browsing (reset when the current shot changes), the shot the ghost toggle was switched on for, the motion level, the screen the camera was last set up for, and what the rebuilt lists and canvases last drew (`data-id` on a canvas). Thumbs and the ghost draw the photo's preview (`sides.previews`), never the full PNG.
- **Camera.** Only the run screen runs it: entering it starts the camera unless the page is busy or the last start failed; any other screen cancels the countdown and stops it. With the camera off the primary button starts it; the finder says "Starting the camera..." while a start waits (the button is off meanwhile), "Camera unavailable: tap Capture to retry" after a failed one.
- **Primary button.** Cancel while counting; Capture, Retake (a taken shot chosen again) or, after a failed light check, Retake or "Back to L1" when L1 is too dark to dim from; "See the measuring" once every shot is closed. Off while busy and in a tab that does not hold the run.
- **Secondary button.** "Skip scene" on a scene's first shot (every open shot of it), else "Skip photo"; "Back to <next open shot>" (or Cancel) on a retake; "Keep it, go on" after a failed light check. A skipped shot stays in the strip and in the end view's "Not taken" list; moving to it or taking it ends the skip. The last shot closed opens the end view (the slice does it).
- **Strip.** A scene tab browses that scene's photos; a thumb moves to its shot and chooses it for a retake when it has a photo. Thumbs are off while busy or counting.
- **Menu.** Cockpit view (stops the camera, reloads with `?ui=cockpit`), Add your own pair (up to `MAX_EXTRA`, moves to its X1), Skip this scene (run screen only, while the scene has an open shot), Finish now, How this test works (the intro), the countdown (3, 5, off) and the sound, and for debugging Copy log ("copying...", then "copied" or "copy refused by the browser"), Speed and synthetic tests (the measure sheet) and Start over (asks first, refused while busy). Opening a sheet cancels the countdown; Escape closes it.
- **End view.** One row per scene with its pair count and measuring badge; "Retry failed" while a failure kept for this load exists (`failedRetried`); the choice "Good enough - make the zip now" or "Wait for the rest" while pairs wait; the download button (`plan-io`'s `downloadAll`): "Packing the zip..." and off while packing, "Waiting for the rest" as a progress bar while waiting, "Download failed - try again" painted red after a failure, "Download again" after a save; amber while the zip leaves out pairs still measuring ("Make the zip now", or after an early save the count it lacks), then "Download the full zip" once they are measured; the line below says what was saved or why not. Each missing shot is a button that takes it now.
- **Steady hint.** `devicemotion` rotation rates feed `motionStep`; the chip shows "steady" or "phone moving" (`isMoving`) only on the run screen, once a reading was seen.
- **Ghost.** While a later shot of a scene is due, "Show <base>" lays the scene's base photo over the finder; it turns off on every move, the store's own move after a photo included.
- **Measure sheet.** Holds the measuring block, moved in at start with its own listeners: the synthetic run, Options, Speed test and Results. "Flat targets" stops the camera and opens `flat-capture.ts`. The run's pairs are measured by the queue in a worker (`measure-queue.ts`), not from this sheet.

## Differences from the prototype

- No simulated room, fake canvas or "Simulate reload": the build has the real camera and storage.
- The step card's diagram is the app's own two-panel pair drawing (`guided-diagram.ts`), drawn above the steps; the card's texts are the app's (`guided-texts.ts`).
- The end rows show the outcome per scene, not one line per method; the download line has no size estimate (PNG sizes are unknown before encoding).
- After a retake the run goes to the next open shot. "Download again" replaces "Download the new zip"; "Wait" turns the download into a progress bar that wakes up when the rest is measured, rather than downloading by itself.
- The menu gains "Speed and synthetic tests"; Copy summary is gone (the summary is in the zip).

## Example

```ts
const camera = createCameraControl(guidedVideo(document), cameraDeps);
const view = startGuidedView({ root: document, fm, engine, camera, log, fail });
fm.store.subscribe(view);
```

## Tests

- Screen rules: `guided-scene-model.test.ts`; the actions: `feature-match-slice.test.ts`; the skips: `run-plan.test.ts` and `run-plan.property.test.ts`.
- The view in the browser: the guided tests of `playwright-tests/feature-match-check.spec.js`: intro to a saved zip (the countdown cancelled, the ghost, a shot picked from another scene's strip, a retake left again, a closed save dialog, the zip's files); the skip paths to the end view and back; a download link and a reload that keeps the photos; a second tab refused; the countdown under the page clock and ended by a save under it; the camera-starting line and a camera start again after the help; a failed download (packing, red, nothing lost); the measure sheet from the menu; the run screen's layout at four viewports.
