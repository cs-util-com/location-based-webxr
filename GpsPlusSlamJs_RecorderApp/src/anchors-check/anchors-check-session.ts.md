# `anchors-check-session.ts`

## Purpose

The WebXR wiring of the anchors check: starts the AR session asking for
`anchors`, keeps the hit-test reticle, places an anchor and a marker on a
tap, feeds each frame to the tracker and keeps the log's environment lines.

## Public API

- `createAnchorsCheck(deps)` returns `{ checkSupport(), toggle(), log() }`.
  `deps`: `xr` (or undefined), `overlayRoot`, `scene`
  (`AnchorsCheckScene`), `view` (`AnchorsCheckView`), `makeTransform`,
  `environment`, `nowIso`.
- Structural WebXR types: `XrSystemLike`, `XrSessionLike`, `XrFrameLike`,
  `XrAnchorLike`, `XrTransformLike`; `StartState`; `MESSAGES` (every
  user-facing sentence).

## Behaviour

- `checkSupport`: no `navigator.xr` or no `immersive-ar` gives a plain
  message and the `unavailable` start state.
- `toggle` while idle requests `immersive-ar` with `requiredFeatures:
['hit-test']`, `optionalFeatures: ['anchors', 'dom-overlay']` and the
  overlay root. The request is the click's first await, so it keeps the
  user gesture. While running, `toggle` ends the session.
- Anchors are usable when `enabledFeatures` lists `anchors`; when the list is
  not reported, the first frame's `createAnchor` decides. Not usable: a
  plain on-screen message, camera jumps still logged, taps refused.
- A tap (`select`) creates the anchor with `frame.createAnchor` at the last
  hit pose in the `local` space (a free-space anchor, not a hit-result
  anchor), puts the marker at the same pose, deletes the previous anchor and
  records the placement. In progress: "Placing the anchor..."; failure: the
  cause, and the next tap tries again.
- Per frame: viewer pose (`null` when absent or `emulatedPosition`), hit
  pose, anchor pose (`null` when untracked), all into the tracker; the view
  gets the events when any closed.
- Session end: the anchor and marker are cleared (an anchor dies with its
  session), the pending jump is closed, the log is kept.
- A failure after the session started ends it first, then shows the cause.

## State

Session, anchor, hit source and the last hit are WebXR handles and live in
the closure for the page's lifetime; the measurement page has no Redux store
(it has no document, no undo and one view).

## Tests

`anchors-check-session.test.ts` with fake XR objects: support check, the
requested features, a refused session, anchors not granted, the
`createAnchor` fallback, placement at the hit pose, a failed placement and
retry, no hit, anchor replacement, a jump end to end, an emulated pose as a
loss, the stop toggle, and a failure after start.
