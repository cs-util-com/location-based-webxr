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
  cause on screen and in the log, and the next tap tries again. The session
  is captured before the await: an anchor that arrives after its session
  ended is deleted and ignored. Session end clears the in-progress flag, so
  a `createAnchor` that never settles cannot block the next session's taps; an old placement that settles late
  leaves the newer one's flag alone.
- Per frame:
  - the inputs are the viewer pose (`null` when absent or
    `emulatedPosition`), the hit pose, the anchor's `getPose` result and
    `frame.trackedAnchors.has(anchor)` (`null` where the browser has no
    `trackedAnchors`);
  - all of them go into the tracker, and the view gets the events when any
    closed or when the settling episode took a reading (its first, in the
    episode's own frame, included), so a jump is on screen at once, not 2 s
    later; a frame that changes neither renders nothing;
  - an anchor that `trackedAnchors` does not hold is hidden and not judged;
  - the anchor read alone has its own try/catch: a `getPose` that throws
    on every frame costs only the anchor (taken as none), never the camera
    tracking;
  - the body runs in a try/catch, because an exception would stop the
    three.js loop for good;
  - frame errors and anchor read errors are counted apart, each with its
    own `frame errors` or `anchor read errors` line (count and first
    message). The first of each goes on screen and into the log. The error path
    itself catches a view that throws, so it cannot stop the loop either.
- The first frame of a session records `session start`.
- Session end:
  - the anchor and marker are cleared (an anchor dies with its session);
  - `session end` closes a pending episode and resets the tracker's frame
    continuity;
  - the log is kept.
- A failure after the session started ends it first, then shows the cause.
  When `end()` rejects, its 'end' event may never come, so the start path
  runs the reset itself; the reset runs once per session either way, and
  the page never stays in 'starting'.

## State

Session, anchor, hit source and the last hit are WebXR handles and live in
the closure for the page's lifetime; the measurement page has no Redux store
(it has no document, no undo and one view).

## Tests

`anchors-check-session.test.ts` with fake XR objects: support check, the
requested features, a refused session, anchors not granted, the
`createAnchor` fallback, placement at the hit pose, a failed placement and
retry, no hit, anchor replacement, a late anchor after the end, a jump end to
end, an untracked anchor, a throwing frame, an anchor read that throws (said once, counted apart),
an anchor read that throws on
every frame, a view that throws on the error path, an emulated pose as a
loss, the stop toggle with the session lines, no comparison across a
restart, a placement that never settles, an old placement settling late during a
new one, a failure after start (also with an `end()` that rejects, with
and without its end event), and a settling episode shown on each new
reading and only then.
