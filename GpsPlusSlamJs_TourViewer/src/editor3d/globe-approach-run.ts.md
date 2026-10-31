# globe-approach-run.ts

## Purpose

One approach on opening a tour in the globe editor, driven by the view's
frame loop: the flight (`globe-approach-flight.ts`), the bar and the line
over the view (`approach-status.ts`), and the arrival's pop-in and walk
(`approach-arrival.ts`). No WebGL: the view asks it for the camera's pose
and each station's growth, and tells it the camera's altitude and what is
still loading.

## Public API

- `LINE_FADE_MS` - 400, the line's fade (as its CSS transition).
- `createApproachRun({ box, flight, startMs, reducedMotion })` mounts the
  bar and the line in `box` and returns an `ApproachRun` (`startMs` is
  optional: without it the flight's clock starts at the first `start`):
  - `start(nowMs)` - the first drawn frame starts the clock (later calls
    do nothing); before it the flight is at its first pose;
  - `poseAt(nowMs)` - the camera's pose while flying, else null;
  - `step(nowMs, altitudeKm, pending)` - each frame after the camera is
    placed: lands at the flight's end, moves the bar, holds or fades the
    line;
  - `takeOver(nowMs)` - the creator's input in the 3D view: the flight
    stops where it is;
  - `retarget(nowMs, now, goal, groundM)` - a list pick mid-flight; false
    after the flight;
  - `holdsStations()`, `pop(index, nowMs)`, `walk(nowMs, stations)`,
    `finished(nowMs, stations)`;
  - `stats()` - the page's checks: `phase`, `flying`, `ended`,
    `progress`, `line`, `retargets` and `durationMs`;
  - `dispose()` removes the DOM.

## DOM

- `div.approach[data-phase]`, holding
  - `div.approach-track[role=progressbar]` with `aria-valuemin` 0,
    `aria-valuemax` 100 and `aria-valuenow`, and an `.approach-fill`
    scaled on x;
  - `div.approach-line[role=status][aria-live=polite]`.
- The styles live in `editor-shell.css` (the approach's section).

## Invariants and assumptions

- The bar's value only rises; on landing it reads 100 and the track goes.
  A takeover hides the track without filling it.
- The line stays while anything loads, fades once nothing does, and once
  hidden never comes back: what loads later as the creator moves about is
  no part of the opening.
- Under reduced motion the short arrival is used and the line goes
  without a fade.

## Tests

- `globe-approach-run.test.ts` (jsdom) - the landing, the takeover, the
  retarget, the line's hold and fade, the ARIA values, the stations held
  while flying.
- `playwright-tests/editor3d-globe-approach.spec.js` - in the page.
