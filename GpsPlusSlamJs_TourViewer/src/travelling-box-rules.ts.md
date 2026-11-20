# travelling-box-rules.ts

## Purpose

The pure rules of the travelling box. A narrated text's words are painted
on one texture. That texture stands on a plate under the reading sign when
it is big enough to read there, flies to a dock at the screen's foot when
it is not, and hides when there is nothing to follow. This module decides
which, and does the arithmetic the decision needs. It uses no three.js and
no DOM: the controller measures the plate each frame and calls these
functions, so the rules are testable without a browser and a logged walk
can be replayed offline for any knob set.

## Public API

- **Types and constants**
  - `TravelPlace`: `"plate" | "dock" | "fold" | "hidden"`. A fold is a
    small mark on the screen for a surface that wants the dock while
    another surface holds it.
  - `TravelHideWhy`: `"no voice" | "outside the station" | "sheet open"`,
    as a surface's adapter reports it.
  - `TravelWhy`: the reason `wantPlace` names, used by the log and the
    debug readout; the hide reasons, the dock reasons, `"slot taken"` and
    `"readable"`.
  - `TravelGate`: `{ kind: "letter" | "picture" | "touch", px, thr }`,
    one size the plate must reach on screen.
  - `TravelMetric`: `"min" | "h"`.
  - `TravellingBoxKnobs` and `TRAVELLING_BOX_DEFAULTS`: threshold 12 px,
    metric min, keep 0.95, holds 0.3 / 0.3 s, lock 0.3 s, angle 60
    degrees, flight 0.6 s, growth on. `travelling-box-knobs.ts` reads
    them from the address.
  - `TRAVEL_PLATE`: one em is 0.136 m. The plate's top sits 0.07 m under
    the sign's lower edge and 0.04 m in front of its plane, all scaled by
    the growth.
  - `TRAVEL_EDGE`: 0.88 to enter the plate and 0.95 to keep it. These are
    NDC limits per axis for the plate's centre.
  - `TRAVEL_MIN_W` = 0.05: the smallest clip w a corner may have before
    it counts as at the eye (`plateMetrics` and `quadOfClip` share it).
- **`plateSizeM(boxCssW, boxCssH, fontPx, emM = TRAVEL_PLATE.emM)`** gives
  the plate in metres, so the plate keeps the box's aspect exactly; one em
  is `emM` metres (another surface may choose its own). It throws a
  `RangeError` on a size or em that is not positive and finite.
- **`plateMetrics(cornersClip, centreClip, viewW, viewH, boxCssW, boxCssH, fontPx, lineHeightPx)`**
  gives `{ valid, onScreen, ndcX, ndcY, letterPxH, letterPxW, letterPx, linePx }`.
  - The corners are clip coordinates in a three.js plane's vertex order:
    TL, TR, BL, BR.
  - The letter is the em as drawn, not the cap height.
  - H is measured between the midpoints of the top and bottom edges, and W
    between the midpoints of the left and right edges. Each is scaled by
    fontPx / box size. A clip-space midpoint is the projection of the
    world midpoint, so this is exact under perspective.
  - `letterPx = min(H, W)`.
  - When any w is at or under 0.05, any number is non-finite, or a view,
    box, font or line size is not positive, the result is invalid with
    every size 0.
- **`facingAngleDeg(normalXZ, toCameraXZ)`** gives degrees from 0 to 180,
  and 0 for a zero vector.
- **`letterGate(metrics, knobs)`** gives the words' gate: the knob's
  metric picks `letterPx` or `letterPxH`, against `thr`.
- **`wantPlace(input, knobs)`** gives `{ place, why }`. The input is
  `{ travelling, hideWhy, gates, metrics, angleDeg, onPlate, slotFree, canFold }`.
  It applies the prototype's order, and the first rule that matches
  decides:
  1. not travelling: hidden;
  2. `hideWhy` set: hidden, with that reason;
  3. invalid, or the centre beyond the edge margin: dock ("out of view");
  4. the angle over the limit: dock ("turned away");
  5. any gate under its `thr` (times `keep` when on the plate): dock
     ("too small");
  6. otherwise the plate ("readable").

  A dock goes to the dock only when `slotFree`; otherwise the surface
  folds when `canFold`, else stays on its plate, both with "slot taken".
  A NaN gate size docks ("too small"): the rule reads "not at least the
  threshold".

- **`settlePlace(state, want, dtS, { fingerDown, sinceReleaseS }, knobs)`**
  gives the next `SettleState { place, pending, pendingS }`.
- **`stepToward(value, target, dtS, durationS, reduceMotion)`** is the one
  step function for the flight's `u` and the words' presence; one
  function does both.
- **`easeInOutCubic(t)`**.
- **`flightClip(srcClip, dockNdc, e, out)`** writes clip corners for eased
  progress `e` into the caller's `out` (kept from frame to frame, so a
  flight allocates nothing) and returns it.
- **`signGrowth(d, from = 4.5, max = 1.6)`**.
- **`quadOfClip(clip, viewW, viewH)`** gives screen px in polygon order
  TL, TR, BR, BL, or null when a corner's w is at or under 0.05 or not
  finite (the flight interpolates w, so a corner can reach the eye).
- **`inQuad(x, y, quad)`** answers for a convex quad, edge included; a
  quad collapsed to a line or a point has no inside.

## Invariants and assumptions

- **Settling.**
  - A want equal to the place clears the pending want.
  - Hiding, and appearing from hidden, act at once, even under a finger:
    the words go with the voice and under the sheet.
  - Between plate and dock (or fold) a want must hold `holdPlate` (to the
    plate) or `holdDock` (to the dock or the fold) seconds. The hold counts from the frame after the want first appears,
    so the move never comes early.
  - Nothing moves while a finger is down, or until `lock` seconds after it
    lifts. The hold keeps counting meanwhile, so a want that held through
    a scrub moves as soon as the lock ends.
  - The controller passes `sinceReleaseS = Infinity` when there was no
    press.
- **Hysteresis.** A plate already shown keeps up to an edge of 0.95 and
  down to `thr x keep` (11.4 px by default). A letter size in
  [thr x keep, thr) therefore never leaves the plate. The property test
  holds this.
- **Flight.**
  - x and y lerp to the dock times `wRef`, the mean w of the source.
  - w lerps to `wRef` and z to 0.
  - For a source with w > 0 and |z| <= w, each corner's NDC is a convex
    combination of its source and its dock, and |z| <= w throughout.
- **Steps.** A non-finite or negative dt counts as 0. Reduced motion, or a
  duration of 0 or less, snaps to the target.

## Examples

```ts
const m = plateMetrics(
  corners,
  centre,
  innerWidth,
  innerHeight,
  272,
  108,
  16,
  22,
);
const w = wantPlace(
  {
    travelling: true,
    hideWhy: null,
    gates: [letterGate(m, knobs)],
    metrics: m,
    angleDeg,
    onPlate: s.place === "plate",
    slotFree: true,
    canFold: false,
  },
  knobs,
);
s = settlePlace(s, w.place, dt, { fingerDown, sinceReleaseS }, knobs);
```

## Tests

- **`travelling-box-rules.test.ts`** covers:
  - every reason in order, the slot taken (fold or plate) and the gates;
  - the edge margins;
  - keep 11.4 px;
  - the angle limit and the metric;
  - the settling examples;
  - the flight's ends and the step;
  - growth at 3, 4.5, 6, 7.2 and 10 m;
  - the facing angle and the quad.
  - `plateMetrics` is checked against a closed form worked by hand for
    the build's geometry: the travel box 272 x 108 at 16 px, eye 1.6 m,
    the check page's aim, a 390 x 844 portrait at 42 degrees across, at
    3, 7 and 16 m, within 0.1 px. The test projects with three.js and
    compares with that closed form.
- **`travelling-box-rules.property.test.ts`** covers:
  - **settling:** no move under a finger or the lock; the hold time;
    hidden acts at once; the keep band;
  - **flight:** the convex corners and |z| <= w;
  - **metrics:** 1/depth, W <= H for a turned plate (at depths of 2 m or
    more, past the plate's half width x sqrt 2), the line's share;
  - **easing:** monotone.
