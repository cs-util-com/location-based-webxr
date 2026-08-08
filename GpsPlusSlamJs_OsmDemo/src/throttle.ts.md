# `src/throttle.ts`

## Purpose

Samples a continuous stream of events down to one call per interval. Exists for
the camera target in the URL (DEC-R13-7): `MapControls` fires `change` while the
camera moves, and without this the demo would call `history.replaceState` on
every frame of a pan.

The session asked for exactly this and named both candidate shapes: _"das müsste
man so ein bisschen **abwarten, beziehungsweise sampeln**, dass da sich nicht
alle paar Millisekunden die URL ändern muss"_.

## Public API

- `throttle(run, everyMs) → Throttled` — the returned function forwards to `run`
  at most once every `everyMs`, with the latest arguments.
- `Throttled.cancel()` — drops any pending call.

## Sampling, not waiting — and the difference is not academic

**This was a debounce first, and it never fired once in a real browser.**

`enableDamping` keeps easing the camera after the pointer is released, and this
view renders **on demand** (DEC-R3-9). So each `change` requests a frame, the
frame calls `controls.update()`, damping moves the camera a little and fires
`change` again. Measured in Playwright, that self-sustaining loop produced an
event roughly **every 200 ms** for as long as the damping took to converge — so a
400 ms quiet period never arrived and the URL was never written.

A debounce assumes bursts **end**. This stream **trails off** instead.

Hence the rule: at most one call per interval while events keep coming, **and
always one final call after the last one**. The URL tracks a pan as it happens
and is correct once it stops.

## Invariants & assumptions

- **The deadline is fixed at the first call, not pushed back by later ones.**
  That single line is the whole difference from a debounce, and it is what makes
  this fire against a stream that never goes quiet.
- **Trailing, never leading.** The value worth keeping is where the camera has
  got to, not where it was when the pan started.
- **Only the latest arguments survive.** Earlier ones are dropped rather than
  queued: this is for "where are you now", not "everything you did".
- **The last event is never lost.** Sampling that dropped the final value would
  leave the URL describing a viewpoint the user has since left, which is the
  failure the feature exists to prevent.
- **`cancel()` exists because a timer outlives its scheduler**, and it clears the
  pending arguments as well as the timer — the same reason every listener in
  `building-view.ts` is held rather than anonymous.
- **A non-finite or negative interval is clamped to 0, not rejected.** The
  failure mode of an `Infinity` interval is a URL that never updates: silent, and
  indistinguishable from the feature not being wired up.

## Not `latest-only.ts`, and both exist for a reason

- `latestOnly` runs **every** call and discards stale **results** — what an async
  pipeline needs, because the work was asked for.
- `throttle` never runs the intermediate calls at all — what a **side effect**
  needs.

Throttling a fetch would drop work the user asked for; latest-only-ing a URL
write would still write on every frame.

## Examples

```ts
const writeCameraView = throttle((view: CameraView) => {
  writeCamera(placeUrl, {
    target: frame.toLatLng(/* … */),
    distanceM: view.distanceM,
  });
}, 400);
```

## Tests

`throttle.test.ts` (fake timers): nothing runs before the interval elapses; **it
still fires while events keep arriving inside the window** — the case a debounce
fails and the reason this module is not one; a burst collapses to one call
carrying the LAST arguments; a final call always follows the last event;
`cancel()` drops a pending call, is safe when nothing is pending and leaves the
function usable; a non-finite or negative interval fires immediately instead of
never.

`playwright-tests/boot-and-shell.spec.js` › "remembers where the camera was
looking" is the end-to-end half, and is what caught the debounce.
