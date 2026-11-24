# `ar-anchors-check.html` - on-phone WebXR anchors check

## Purpose

A test page that answers one question on a real phone: when ARCore's world
jumps (a relocalization or frame switch) or drifts, what does a WebXR anchor
do? It requests the `anchors` feature, places one anchor plus a plain
(non-anchored) marker at a hit-test spot, and logs every camera jump with the
anchor's pose before and after, so the log itself says whether the anchor
followed the jump (a frame switch) or kept its coordinates (a drift
correction).

It is **linked from nothing** (not from the recorder's `index.html`, not from
`ar-hittest-test.html` or `alignment-timing.html`) and is reached by typing
its URL. `src/anchors-check/anchors-check-isolation.test.ts` asserts that.

## Where it is served

- Site build and branch previews: `/recorder/ar-anchors-check.html`.
- Dev server: `/ar-anchors-check.html`.

## On the phone

1. Android Chrome with ARCore. Mark a spot on the floor (tape, a coin).
2. Open the page and press **Start AR**. If the browser has no WebXR AR, or
   the session does not grant `anchors`, the status line says so plainly.
3. Aim at the mark until the white ring sits on it, then tap: a green box
   (the anchor) and a red ring (the marker, never moved) appear there.
4. Walk an indoor loop of at least 50 m, several laps. A jump is a camera
   step of more than 0.25 m or 5 deg that your own walking and turning do not
   explain: smooth turns, even quick ones, are fine. One that comes with a
   stutter (a frame over 3 times the one before) is listed as "long frame"
   and not counted.
5. If no jump is listed after a few laps, make a tracking loss: stand still
   for 2 s, cover the camera for a few seconds while keeping still, uncover
   it and stay still for 2 s more. A loss taken while moving (over 0.02 m or
   1 deg per frame just before it) is listed as "moving" and not counted.
6. Each jump and loss is judged over 2 s (anchor read at 0, 100, 300, 1000
   and 2000 ms); walk on calmly. A second one inside those 2 s cuts the first
   short ("truncated", not counted). Keep going until the counts line shows
   2 or more judged; it also lists what was not counted (moving, long frame,
   no anchor, truncated). Return to the mark and note whether the green box
   still sits on it.
7. Press **Copy log** (it works during AR; the panel takes taps away from the
   scene). If the copy fails, the log appears in a text box to copy by hand.

Nothing is uploaded or stored.

## What it shows and logs

- On screen, one line per event:
  `Jump n: <verdict> (<verdict per delay>); unexplained <m> / <deg>, <band>`,
  the same for tracking losses and frame gaps with their `raw step`, with
  `settling`, `truncated`, `moving`, `long frame` or `no anchor` where it
  applies. Placements, failed anchors, frame errors and the session lines
  also show. A counts line shows the judged jumps and losses by verdict and
  the not counted ones by reason.
- The log (see `src/anchors-check/anchor-jump-report.ts.md`): device and
  feature lines, the limits and tolerances, the frame dt and per-frame step
  distributions, the jump counts and bands, the anchor and marker now, then
  every event in full.

## Limits

- Free-space anchors only: the anchor comes from `frame.createAnchor` at the
  hit pose, not from a hit-test result's `createAnchor`. A plane-attached
  anchor may behave differently and is not measured here.
- For a tracking loss, a frame gap or a jump on a frame with no rate, `D`
  is uncompensated, so its verdict holds only while the camera stays still
  across it. Only the step just before it is checked (and a jump on a frame
  with no rate has none, so it never counts); keeping still after the loss
  is up to the walker.

## Structure

- Markup and inline CSS here; the `#ac-overlay` element is the WebXR
  dom-overlay root, so the panel stays visible over the camera image.
- `src/anchors-check/anchors-check-main.ts` (entry, three.js scene),
  `anchors-check-session.ts` (WebXR wiring), `anchors-check-page.ts` (DOM),
  `anchor-jump-tracker.ts` and `anchor-jump-report.ts` (pure logic).
- A build entry in `config/vite.config.ts`.

## Invariants

- Element ids are the contract with `anchors-check-page.ts`, whose jsdom test
  reads this file.
- All CSS inline, no third-party host.

## Tests

- `src/anchors-check/*.test.ts` (unit, property, jsdom against this markup,
  isolation).
- No e2e: a WebXR AR session cannot run headless, and `ar-hittest-test.html`
  has no e2e either. The page's behaviour up to WebXR is covered by the jsdom
  and session tests with fakes.
