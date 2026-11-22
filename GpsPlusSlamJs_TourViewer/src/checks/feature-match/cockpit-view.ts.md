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
  - saving "each": the zip is downloaded at once and the take marked downloaded; a closed save dialog keeps it on the page instead;
  - saving "at the end": the zip is kept on the page (`sides.blobs`, `planFileKept`), and Download all adds it as it is;
  - a failed pack says "Could not pack the pair: ... The photos are kept.", and Download all still saves the photos.
- **Then the next pair.** The next open slot comes up (`nextAfterPair`, `planMoved`), and the status line and a toast say what became of the pair; the move comes before the save ends, since a move clears the single-file line. A take that changed before it was packed is logged and not packed. A failed light check moves nothing: the instruction names the photo to take again (`warnShot`).
- **Big button.** As `shutterView` says: Start (the camera; Starting, Retry camera), Take or Retake A or B (with the countdown; Tap to stop while it runs), Retake after a failed light check, Next pair, All done (Download all), or Measuring and Saving while busy. A tap on a taken tile, or Retake, toggles a retake (`guidedRetakeToggled`); after the automatic move Retake offers "Retake B of NN", which moves back and points at B.
- **Hands-off photo B.** With "Taking photo B: by itself when the phone is still" (the default, `capture: "auto"`) and a pair the sensor can judge (`handsOffKind`: the still pairs and the viewpoint pairs, never the light pairs), photo B takes itself:
  - a render arms it (`handsOffArmed`) once `handsOffDue` holds, the drawer is closed and a usable motion reading was seen, so a phone (or a browser test) without the sensor keeps the tap;
  - each `devicemotion` reading goes to `handsOffSample` (its `timeStamp`, on the same clock as `performance.now()`); once the phase is `taking` the view calls `plan-io`'s `shoot("b")` and reports `handsOffShot` taken, refused (no picture, or the store refused) or failed (it threw);
  - a watchdog every 500 ms sends a missing reading while it waits, so a sensor that stops ends the wait as failed ("No motion readings: tap to take photo B.");
  - every state has a way out on screen: a tap on the big button while it waits takes B at once (with the countdown), refused and failed leave Take B with the reason on the status line, opening the drawer pauses the wait (`handsOffPaused`) and closing it arms again; the setting "At a tap" turns it off.
- **Night.** Between photo A and B of the dimmed pairs (`1b`, `1c`) the dock dims (`.night`), so the screen does not light the room it is measuring.
- **Readouts.** Still (from `devicemotion` rotation rates through `motionStep` and `isMoving`; a reading without a finite rate is ignored, `hasRate`), the light of the take, and the capture mode (auto while photo B waits to take itself, else tap or tap with the countdown). The meter ring fills with the countdown or with the dwell (`meterFill`).
- **The measuring block** keeps its own elements and listeners; it is moved into the Results tab at start, and its old home stays hidden.
- **Flat target.** "Flat target capture" in the Results tab cancels a countdown, stops the camera, closes the drawer and opens `flat-capture.ts`; its Exit draws the view again.
- Escape closes the drawer; opening it cancels a running countdown.

## Differences from the prototype

Checked side by side at 412x915, 915x412, 800x360 and 880x790 (the page with a faked camera, the prototype with its own image).

- **Layout.** 412x915 and 880x790 match the prototype box for box. At 915x412 and 800x360 the build differs on purpose: the prototype's side dock needs about 550 px for its eight rows and cuts off its readouts, status and footer on a phone on its side; the build gives short landscape screens (below 560 px of height) the bottom dock's one-row controls in a wider column (`cockpit-view.css`), so every control stays on screen.
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
- The view in the browser: `playwright-tests/feature-match-check.spec.js`, the cockpit tests (a pair measured by itself with every button off while the run is held, its zip read back entry by entry and the next pair coming up; pairs kept for Download all; the packing state and a failed pack that loses nothing; the guide, Before you start and the first visit; the photo test settings; photo B taking itself from synthetic `devicemotion` readings, and the fall-back to the tap when they stop and with "At a tap" set; the light check with its retake; the numbering across a reload, after a single-file download and with storage blocked; and the dock's layout at 412x915, 915x412, 800x360 and 880x790, positions and gaps with room for the taller Linux fonts of CI).
