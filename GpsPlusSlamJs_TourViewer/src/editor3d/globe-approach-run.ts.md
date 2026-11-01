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
- `BAR_DONE_MS` - 300, how long a landed bar stays full before it goes.
- `LINE_CAP_MS` - 10 000, the line's end after the arrival however much
  still loads (weighed over 5 to 20 s in the source's comment; not
  measured on a device).
- `createApproachRun({ box, flight, startMs, reducedMotion, lineCapMs })`
  mounts the bar and the line in `box` and returns an `ApproachRun`
  (`startMs` is optional: without it the flight's clock starts at the first
  `start`; `lineCapMs`, also optional, replaces `LINE_CAP_MS` for the
  page's checks, which render slowly in software):
  - `timing` - the arrival's timing (the short one under reduced
    motion), for a walk the view draws after the arrival;
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
  - `div.approach-title[aria-hidden]`, "Loading tour" (the bar's label
    says it to a screen reader), hidden with the track;
  - `div.approach-track[role=progressbar]` with `aria-valuemin` 0,
    `aria-valuemax` 100 and `aria-valuenow`, and an `.approach-fill`
    scaled on x;
  - `div.approach-line[role=status][aria-live=polite]`.
- The styles live in `editor-shell.css` (the approach's section).

## Invariants and assumptions

- The bar's value only rises; on landing it reads 100 and the track and
  title go `BAR_DONE_MS` later, so the finish is seen. A takeover hides
  them at once without filling the bar. `data-phase` turns "arrived" when
  they go.
- While flying the line names what is pending, or nothing. After the
  arrival it keeps its last words while anything loads, and fades only
  once nothing has been pending for `LINE_HOLD_MS` (a single frame of
  zero counts does not end it); a load during the fade cancels it. At
  `LINE_CAP_MS` after the arrival it fades whatever still loads. It never
  fades while the bar shows. Once hidden it never comes back: what loads
  later as the creator moves about is no part of the opening.
- Under reduced motion the short arrival is used and the line goes
  without a fade.

## Tests

- `globe-approach-run.test.ts` (jsdom) - the landing and the bar's beat
  after it, the takeover, the retarget, the title and the detail line,
  the line's hold and fade, a single quiet frame, a cancelled fade, the
  cap, the ARIA values, the stations held while flying.
- `playwright-tests/editor3d-globe-approach.spec.js` - in the page.
