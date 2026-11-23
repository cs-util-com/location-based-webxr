# cockpit-view.ts

## Purpose

The cockpit view of the feature matching page (`?ui=cockpit`), a thin view over the shared store, ported from the chosen prototype `public/prototypes/feature-match-1-cockpit/` (markup in the page, styles in `cockpit-view.css`). The viewfinder sits above one fixed dock (beside it in landscape): the shot chip, the progress, the instruction line, the previous and current shot tiles around one big button, Retake and Next beside it, three readouts, the status line, Details and Download all. Details opens a drawer over the viewfinder with four tabs: Shots (every shot of the run, Download all, an own scene, Start over), Guide (the shot's words and "Before you start"), Results (Copy summary, the flat target capture and the measuring block: Options, Speed test, results) and Settings (taking a shot, countdown, places, sound, the ghost of the previous shot). After each shot the store moves to the next open shot by itself; Download all saves every ready pair in one zip.

## Public API

- `cockpitVideo(root)`: the cockpit's `#c-video`, for the page camera.
- `startCockpitView({ root, fm, engine, camera, log, fail })`: wires the cockpit and returns its render, which the entry calls on every store change. Throws `feature-match-check: missing <selector>` when the page lacks an element it needs.

## Invariants and assumptions

- **State in the store.** Every box is drawn from `cockpit-model.ts` on the page state (the run plan, the countdown, `busy`, `running`, `runZip`, `cameraStart`, `photoStoreFailing`, `handsOff`); taps only dispatch actions (`plan*`, `guidedCountSet`, `handsOff*`) or call `plan-io.ts`, shared with the guided view (the camera start, the countdown, the photo, Download all).
- **Outside the store**, as browser resources or transient UI nobody else reads: the drawer tab shown, the welcome card (a `localStorage` flag, read and written in try/catch), the ghost toggle (a checkbox), the motion level, and what the canvases, the segments, the shot list and the guide last drew. The tiles draw the photos' previews (`sides.previews`).
- **No measuring after a shot.** The cockpit neither measures nor packs a pair by itself: the photos go to the PC in Download all's zip.
- **Big button.** As `shutterView` says: Start (the camera; Starting, Retry camera), Take the shot (with the countdown; Tap to stop while it runs), Retake after a failed light check, Next shot, All done (Download all), or Measuring and Saving while busy. Retake retakes the current shot once it has a photo, else goes back to the scene's previous shot; a tap on the left tile goes back to it as well.
- **Hands-off shot.** With "Taking a shot: by itself when the phone is still" (the default, `capture: "auto"`) and a shot the sensor can judge (`handsOff` in `scenes.ts`: L2, F2 and D2 still, F3 after a move; never the light changes, the steps or the own scenes, which are taken at a tap), the shot takes itself:
  - a render arms it (`handsOffArmed`) once `handsOffDue` holds, the drawer is closed and a usable motion reading was seen, so a phone (or a browser test) without the sensor keeps the tap;
  - each `devicemotion` reading goes to `handsOffSample` (timed with `performance.now()`, the watchdog's clock); once the phase is `taking` the view calls `plan-io`'s `shoot()` and reports `handsOffShot` taken, refused or failed (`handsOffResult`);
  - a store change that only moved the detector (`sameDrawing`) draws nothing;
  - a watchdog every 500 ms sends a missing reading while it waits, so a sensor that stops ends the wait as failed;
  - every state has a way out on screen: a tap on the big button while it waits takes the shot after the countdown, refused and failed leave Take with the reason on the status line, opening the drawer pauses the wait (`handsOffPaused`) and closing it arms again; the setting "At a tap" turns it off.
- **Night.** Before a dimmed shot (L3, L4) is taken the dock dims (`.night`), so the screen does not light the room it is measuring.
- **Readouts.** Still (from `devicemotion` rotation rates through `motionStep` and `isMoving`; a reading without a finite rate is ignored, `hasRate`), the shot's light, and the capture mode. The meter ring fills with the countdown or with the dwell (`meterFill`).
- **The measuring block** keeps its own elements and listeners; it is moved into the Results tab at start, and its old home stays hidden.
- **Flat target.** "Flat target capture" in the Results tab cancels a countdown, stops the camera, closes the drawer and opens `flat-capture.ts`; its Exit draws the view again. It is off while a run or save goes.
- Escape closes the drawer; opening it cancels a running countdown.

## Differences from the prototype

Checked side by side at 412x915, 360x740, 915x412, 800x360, 800x300 and 880x790 before the move to shots; the dock's boxes are unchanged since.

- **Layout.** At 412x915 and 880x790 the dock's boxes sit where the prototype's do, within a pixel. At 360x740 the build narrows the side columns (`cockpit-view.css`), so the big button no longer overlaps the tiles. At 915x412 and 800x360 the build gives short landscape screens (below 560 px of height) the bottom dock's one-row controls in a wider column, so every control stays on screen; below about 330 px (800x300) that column scrolls by about 30 px.
- **Content, intended:** the welcome card's lede is `WELCOME_LEDE` and its list comes from `BEFORE_YOU_START`; the chip names the real shot and its place; the tiles are the scene's previous shot and the current one; the big button's first state is Start; the readouts show the real motion and light ("still: -" before a reading); there is no fake camera image.

## Example

```ts
const camera = createCameraControl(cockpitVideo(document), cameraDeps);
const render = startCockpitView({
  root: document,
  fm,
  engine,
  camera,
  log,
  fail,
});
fm.store.subscribe(render);
```

## Tests

- The dock's rules: `cockpit-model.test.ts`; the actions: `feature-match-slice.test.ts`.
- The view in the browser: `playwright-tests/feature-match-check.spec.js`, the cockpit tests: the run walked by shots with the next shot coming up by itself (its five ready pairs measured in the worker beside the camera, which keeps showing frames, with the frame gaps logged and a matches file per pair in the zip), a shot picked in the Shots tab, the night dock before L3, and Download all's zip (its exact file list: each shot's plain PNG at the captured size once, a frames JSON per ready pair with the legacy key, the shot files and takes, the turned pairs' crop and turn, the summary with its measured counts and the log); the guide and the first visit; L2 taking itself from synthetic `devicemotion` readings, paused by the drawer, and the tap after the readings stop; the light check holding L2 and L3 for their retakes; Download all preparing and failing without loss; the camera starts; the dock's layout at six viewports.
