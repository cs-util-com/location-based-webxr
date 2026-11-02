# globe-approach-run.ts

## Purpose

One approach on opening a tour in the globe editor, driven by the view's
frame loop: the flight (an `ApproachDriver`; in the page the globe's own
meteor, `globe-approach-meteor.ts`), the bar glued under the top bar with
its "Loading tour" tab hanging from the middle (the box), and the arrival's
pop-in and walk (`approach-arrival.ts`). No WebGL: the driver places the
camera itself (no pose passes through the run, so nothing sets the view's
frame each frame), the view asks the run for each station's growth and
tells it the camera's altitude.

## Public API

- `APPROACH_TITLE` - "Loading tour", the box's title and the bar's
  accessible name.
- `BAR_DONE_MS` - 300, how long a landed bar stays full before the box
  goes.
- `ApproachDriver` - the flight a run drives: `durationMs` (its first
  flight's length at a full pace, 0 for a cut to its end),
  `start(nowMs)` (the first drawn frame: its clock starts),
  `drive(nowMs)` (places the camera; false from the frame it lands on),
  `retarget(place, groundM)` (a new leg from the camera as it is),
  `takeOver(nowMs)` (the flight stops) and `bar(altitudeKm)` (the bar's
  value, 0 to 1, for a camera at that height).
- `createApproachRun({ box, driver, reducedMotion, onDone })`
  mounts the box in `box` and returns an `ApproachRun` (`onDone(how)`, optional, is called once when the box goes, a beat after a
  landing or at once after a takeover, with `how` (`ApproachEnd`,
  `"landed"` or `"taken"`), and never when disposed before):
  - `timing` - the arrival's timing (the short one under reduced
    motion), for a walk the view draws after the arrival;
  - `drive(nowMs)` - each frame before the controls: while flying the
    driver places the camera (the first call starts its clock) and true
    is returned, else false (the camera is the controls');
  - `step(nowMs, altitudeKm)` - each frame after the camera is placed:
    lands once the driver said so, else moves the bar to the driver's
    `bar`, hides the box when its time has come;
  - `takeOver(nowMs)` - the creator's input in the 3D view: the flight
    stops where it is;
  - `retarget(place, groundM)` - a list pick mid-flight; false after the
    flight (the caller places the camera itself);
  - `holdsStations()`, `pop(index, nowMs)`, `walk(nowMs, stations)`,
    `finished(nowMs, stations)` (the arrival over and the box gone);
  - `stats()` - the page's checks: `phase`, `flying`, `ended`,
    `progress` (null once the box is gone), `retargets` and
    `durationMs` (the driver's: 0 for a reduced-motion cut);
  - `dispose()` removes the DOM.

## DOM

- `div.approach` (the view's full width at its top, taking no pointer),
  holding only, in this order
  - `div.approach-track[role=progressbar]` (the bar, 5 px) with
    `aria-valuemin` 0, `aria-valuemax` 100 and `aria-valuenow`, and an
    `.approach-fill` scaled on x;
  - `div.approach-title[aria-hidden]`, "Loading tour", the rounded tab
    centred under the bar (the bar's label says it to a screen reader).
- The styles live in `editor-shell.css` (the approach's section): the
  bar's and tab's heights are `--s-load-h` and `--s-load-tab-h`, and in the
  globe view (`#view3d[data-globe]`) the docks begin under them
  (`--s-dock-top`).

## Invariants and assumptions

- The bar's value only rises; on landing it reads 100 and the whole box
  goes `BAR_DONE_MS` later, so the finish is seen. A takeover hides it at
  once without filling the bar. Once hidden it never comes back.
- What still loads (tiles, the map, stations held for upload) does not
  keep the box: the detail line that used to name it was dropped by the
  owner (it read "Loading textures" through the whole flight and after
  it, saying nothing he could act on), and with it the load counts.
- Under reduced motion the short arrival is used, and the driver cuts to
  its end view: the first `drive` lands.

## Tests

- `globe-approach-run.test.ts` (jsdom, a stand-in driver) - the flight
  started on the first drive and once, its length (0 for a cut), the
  title and bar only, the
  landing and the box's beat after it, the box gone however much still
  loads, `finished`, the takeover, the retarget, the ARIA values,
  reduced motion, the stations held while flying, dispose.
- `playwright-tests/editor3d-globe-approach.spec.js` - in the page.
