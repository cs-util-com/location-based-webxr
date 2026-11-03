# globe-approach-run.ts

## Purpose

One approach on opening a tour in the globe editor, driven by the view's
frame loop: the flight (an `ApproachDriver`; in the page the globe's own
meteor, `globe-approach-meteor.ts`), the thin accent line glued under the
top bar that fills with the camera's fall (the box), and the arrival's
pop-in and walk (`approach-arrival.ts`). No WebGL: the driver places the
camera itself (no pose passes through the run, so nothing sets the view's
frame each frame), the view asks the run for each station's growth and
tells it the camera's altitude.

## Public API

- `APPROACH_TITLE` - "Loading tour", the line's accessible name while it
  loads (no words are shown).
- `BAR_DONE_MS` - 300, how long a landed line stays a full progress bar
  before the load ends.
- `ApproachDriver` - the flight a run drives: `durationMs` (its first
  flight's length at a full pace, 0 for a cut to its end),
  `start(nowMs)` (the first drawn frame: its clock starts),
  `drive(nowMs)` (places the camera; false from the frame it lands on),
  `retarget(place, groundM)` (a new leg from the camera as it is),
  `takeOver(nowMs)` (the flight stops) and `bar(altitudeKm)` (the bar's
  value, 0 to 1, for a camera at that height).
- `createApproachRun({ box, driver, reducedMotion, onDone })`
  mounts the line in `box` and returns an `ApproachRun` (`onDone(how)`,
  optional, is called once when the load ends, a beat after a
  landing or at once after a takeover, with `how` (`ApproachEnd`,
  `"landed"` or `"taken"`), and never when disposed before):
  - `timing` - the arrival's timing (the short one under reduced
    motion), for a walk the view draws after the arrival;
  - `drive(nowMs)` - each frame before the controls: while flying the
    driver places the camera (the first call starts its clock) and true
    is returned, else false (the camera is the controls');
  - `step(nowMs, altitudeKm)` - each frame after the camera is placed:
    lands once the driver said so (the line full), else moves the line to
    the driver's `bar`, ends the load when its time has come;
  - `takeOver(nowMs)` - the creator's input in the 3D view: the flight
    stops where it is;
  - `retarget(place, groundM)` - a list pick mid-flight; false after the
    flight (the caller places the camera itself);
  - `holdsStations()`, `pop(index, nowMs)`, `walk(nowMs, stations)`,
    `finished(nowMs, stations)` (the arrival over and the load ended);
  - `stats()` - the page's checks: `phase`, `flying`, `ended`,
    `progress` (null once the load is over), `retargets` and
    `durationMs` (the driver's: 0 for a reduced-motion cut);
  - `dispose()` removes the DOM.

## DOM

- `div.approach` (the view's full width at its top, taking no pointer),
  holding only `div.approach-track` (the line, 3 px, a dark track) with an
  `.approach-fill` in the accent colour scaled on x. While it loads the
  track is `[role=progressbar][aria-label="Loading tour"]` with
  `aria-valuemin` 0, `aria-valuemax` 100 and `aria-valuenow`; once the load
  is over those go and the root gets `aria-hidden="true"` (a full line is
  decoration, not news).
- The styles live in `editor-shell.css` (the approach's section): the
  line's height is `--s-load-h`. It covers the page's own permanent
  `#load-line` (`edit.html`, the same place, always full), so when the
  view disposes the run after the arrival the line looks unchanged; the
  docks hang directly from it (`--s-dock-top`) in every 3D view.

## Invariants and assumptions

- The line's value only rises; on landing or a takeover it reads 100. A
  landed load ends `BAR_DONE_MS` later, so the finish is seen; a taken one
  at once. The line never hides: once the load is over it stays full and
  is no progress bar any more.
- What still loads (tiles, the map, stations held for upload) does not
  keep the load going: the detail line that used to name it was dropped
  (it read "Loading textures" through the whole flight and after it,
  saying nothing a creator could act on), and with it the load counts.
- Under reduced motion the short arrival is used, and the driver cuts to
  its end view: the first `drive` lands.

## Tests

- `globe-approach-run.test.ts` (jsdom, a stand-in driver) - the flight
  started on the first drive and once, its length (0 for a cut), the
  line only (no title), the landing and the load's beat after it, the
  line staying full and unannounced however much still loads, `finished`,
  the takeover (full at once), the retarget, the ARIA values,
  reduced motion, the stations held while flying, dispose.
- `playwright-tests/editor3d-globe-approach.spec.js` - in the page.
