# cockpit-view.ts

## Purpose

The cockpit view of the feature matching page (`?ui=cockpit`), a thin view over the shared store, ported from the chosen prototype `public/prototypes/feature-match-1-cockpit/` (markup in the page, styles in `cockpit-view.css`). The viewfinder sits above one fixed dock (beside it in landscape): the pair chip, the progress, the instruction line, photo A and B around one big button, Retake and Next pair beside it, three readouts, the status line, Details and Download all. Details opens a drawer over the viewfinder with four tabs: Pairs (the run plan's slots, Download all, an extra pair, Start over), Guide (the pair's `PAIR_GUIDE` entry and "Before you start"), Results (the light warning, Run on this pair, the current pair's single files, Copy summary, the flat target capture and the measuring block: Options, Speed test, results) and Settings (saving, countdown, places, sound, the ghost of photo A). After photo B the pair is measured, packed as one zip and the next pair comes up by itself.

## Public API

- `cockpitVideo(root)`: the cockpit's `#c-video`, for the page camera.
- `startCockpitView({ root, fm, engine, camera, log, fail })`: wires the cockpit and returns its render, which the entry calls on every store change. Throws `feature-match-check: missing <selector>` when the page lacks an element it needs.

## Invariants and assumptions

- **State in the store.** Every box is drawn from `cockpit-model.ts` on the page state (the run plan, the `guided` retake and count, `busy`, `running`, `runZip`, `fileSave`, `cameraStart`, `photoStoreFailing`); taps only dispatch actions (`plan*`, `guided*`) or call `plan-io.ts`, shared with the guided view (the camera start, the countdown, the photo, the pair zip, Download all, the single files).
- **Outside the store**, as browser resources or transient UI nobody else reads: the drawer tab shown, the welcome card (a `localStorage` flag, read and written in try/catch), the ghost toggle (a checkbox), the motion level, the pair waiting for its zip after a run (a guard, like a generation counter: it names the take it was started for), the pair finished last (`LastPair`, for "Retake B of NN" after the automatic move), and what the canvases, the segments, the pair list and the guide last drew.
- **After photo B.** A complete pair with no retake pending and no failed light check starts `engine.startRun("plan")`, then waits for the run to end (the run is started first: a pack started before it would hold the page busy and refuse the run). When the run ends, or at once when it was refused, the pair is packed with `pairZip` (photos, frames JSON, matches, log, report) under busy `saving` (`planFileSaveStarted`):
  - saving "each": the zip is downloaded at once ("Download started: X.zip (allow multiple downloads if Chrome asks).": a browser download cannot say whether it was saved), kept on the page as well and the take marked downloaded, so Download all still holds it; a closed save dialog keeps it on the page, not downloaded;
  - saving "at the end": the zip is kept on the page (`sides.blobs`, `planFileKept`), and Download all adds it as it is;
  - a failed pack says "Could not pack the pair: ... The photos are kept.", and Download all still saves the photos;
  - a pair the run did not measure (`pairMeasured`; a method that could not load) adds "Not measured: see Results." to its save line, in red.
- **Then the next pair.** The next open slot comes up (`nextAfterPair`, `planMoved`), and the status line and a toast say what became of the pair; the move comes before the save ends, since a move clears the single-file line. A take that changed before it was packed is logged and not packed. A failed light check moves nothing: the instruction names the photo to take again (`warnShot`).
- **Big button.** As `shutterView` says: Start (the camera; Starting, Retry camera), Take or Retake A or B (with the countdown; Tap to stop while it runs), Retake after a failed light check, Next pair, All done (Download all), or Measuring and Saving while busy. A tap on a taken tile, or Retake, toggles a retake (`guidedRetakeToggled`); after the automatic move Retake offers "Retake B of NN", which moves back and points at B.
- **Hands-off photo B.** With "Taking photo B: by itself when the phone is still" (the default, `capture: "auto"`) and a pair the sensor can judge (`handsOffKind`: the still pairs and the turns 2b-2d; never the light pairs, the steps or the extra pair, whose B is taken at a tap), photo B takes itself:
  - a render arms it (`handsOffArmed`) once `handsOffDue` holds, the drawer is closed and a usable motion reading was seen, so a phone (or a browser test) without the sensor keeps the tap;
  - each `devicemotion` reading goes to `handsOffSample` (its `timeStamp`, on the same clock as `performance.now()`); once the phase is `taking` the view calls `plan-io`'s `shoot("b")` and reports `handsOffShot` taken, refused (no picture, or the store refused) or failed (it threw; `handsOffResult`);
  - a store change that only moved the detector (`sameDrawing`) draws nothing, so 60 readings a second redraw the page only when the meter or a text changes;
  - a watchdog every 500 ms sends a missing reading while it waits, so a sensor that stops ends the wait as failed ("No motion readings: tap to take photo B.");
  - every state has a way out on screen: a tap on the big button while it waits takes B after the countdown, as the texts say ("or tap"), refused and failed leave Take B with the reason on the status line, opening the drawer pauses the wait (`handsOffPaused`) and closing it arms again; photo A lost after a reload ends the wait; the setting "At a tap" turns it off.
- **Night.** Between photo A and B of the dimmed pairs (`1b`, `1c`) the dock dims (`.night`), so the screen does not light the room it is measuring.
- **Readouts.** Still (from `devicemotion` rotation rates through `motionStep` and `isMoving`; a reading without a finite rate is ignored, `hasRate`), the light of the take, and the capture mode (auto while photo B waits to take itself, else tap or tap with the countdown). The meter ring fills with the countdown or with the dwell (`meterFill`).
- **The measuring block** keeps its own elements and listeners; it is moved into the Results tab at start, and its old home stays hidden.
- **Flat target.** "Flat target capture" in the Results tab cancels a countdown, stops the camera, closes the drawer and opens `flat-capture.ts`; its Exit draws the view again. It is off while a run or save goes (it would take the camera from the run), and a pair packed while it is open does not start the cockpit camera under it.
- Escape closes the drawer; opening it cancels a running countdown.

## Differences from the prototype

Checked side by side at 412x915, 360x740, 915x412, 800x360, 800x300 and 880x790 (the page on its first visit, without a camera, the prototype with its own image), boxes measured.

- **Layout.** At 412x915 and 880x790 the dock's boxes (stage, chip, instruction, big button, side buttons, readouts, status) sit where the prototype's do, within a pixel; the welcome card is a few pixels taller (other text). At 360x740 the build narrows the side columns (`cockpit-view.css`), so the big button no longer overlaps the photo tiles as in the prototype. At 915x412 and 800x360 the build differs on purpose: the prototype's side dock needs about 550 px for its eight rows and cuts off its readouts, status and footer on a phone on its side; the build gives short landscape screens (below 560 px of height) the bottom dock's one-row controls in a wider column, so every control stays on screen. Below about 330 px (800x300) that column scrolls by about 30 px, the big button still on screen; the prototype's dock is cut off by about 230 px.
- **Welcome card on a short screen.** Its last line, "Tap the big button to start the camera.", is scrolled out of the card at 360x740, 915x412 (the prototype's fits there), 800x360 and 800x300 (the prototype's too, except at 915x412); the card scrolls, and the big button below says Start.
- **Content, intended:** the welcome card's list comes from `BEFORE_YOU_START`; the chip names the real pair (`guidedCard`) and its place; the big button's first state is Start, in the plain colour (the prototype starts armed, with a camera already on); Next pair is enabled whenever a later pair exists; the readouts show the real motion and light ("still: -" before a reading); the status line shows a first-visit hint; there is no fake camera image; and tile A is not armed before the camera is on.

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
- The view in the browser: `playwright-tests/feature-match-check.spec.js`, the cockpit tests (a pair measured by itself with every button off while the run is held, its zip read back entry by entry and the next pair coming up; pairs kept for Download all; the packing state and a failed pack that loses nothing; the guide, Before you start and the first visit; the photo test settings; photo B taking itself from synthetic `devicemotion` readings, and the fall-back to the tap when they stop and with "At a tap" set; the light check with its retake; the numbering across a reload, after a single-file download and with storage blocked; a retaken photo B shipped instead of the old kept zip; a pair not measured and not saved, said in red; Download all failing and losing nothing; the flat target off while measuring; photo B waiting through 2.5 s of shaking and through the drawer; and the dock's layout at 412x915, 360x740, 915x412, 800x360, 800x300 and 880x790, positions and gaps with room for the taller Linux fonts of CI).
