# then-now-fade.ts

## Purpose

Then and now's blend between the old picture and today. When a visitor
lines up with the viewpoint the old picture fades in from nothing to 55 %
over 5 s (a smooth step), and from then on the visitor's slider sets it.

## Public API

- `THEN_NOW_TIMING`: enter within 32 degrees and with the distance ramp
  above 0.6; leave past 44 degrees or below 0.3 (hysteresis); the fade
  replays only after 1.5 s off the spot; ends at 0.55 after 5 s.
- `THEN_NOW_START`: not lined up, never lined up before (`lostForS`
  infinite), no fade running, share 0.
- `stepThenNow(state, { dtS, near, offAxisDeg, shown }, timing?)`: the next
  frame's state. `near` is the distance ramp (0 to 1) of `THEN_NOW_FADE`.
  A negative or non-finite `dtS` counts as 0. Hidden (`shown` false) is
  never lined up.
- `takeOverThenNow(state, fade)`: the slider moved; the fade stops and the
  clamped value holds. A value that is not a number returns `state`.

## Invariants

- During the fade the share rises and stays within 0 to 0.55; it is 0.55
  once the clock passes 5 s, and half of it at 2.5 s.
- A wobble between the enter and the leave gate keeps the state lined up,
  the fade not replaying.
- After a take-over the visitor's value holds while lined up.

## Tests

`then-now-fade.property.test.ts` (fast-check): the timing, hysteresis, the
enter gate, the fresh-arrival rule on both sides of its threshold, hidden,
broken clock, take-over and clamping.
