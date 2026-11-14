# `three/woods-governor.ts`

## Purpose

On a phone too slow for the invented woods, draw fewer of them: the owner's rule "above 50 ms a frame the library lowers the density on the phone automatically, the desktop stays full". Pure: no three.js, no clock of its own.

## Public API

- `WOODS_GOVERNOR`: the thresholds, frozen. `slowMs` 50, `fastMs` 36, `slowS` 2, `fastS` 12 (counted seconds), `worthwhile` 0.15, `restS` 300, `smoothing` 0.1, `gapMs` 250, `shares` `[1, 0.5, 0.25]`.
- `createWoodsGovernor({ auto = true })` returns:
  - `frame(atMs, chained)`: one frame drawn at `atMs` (a monotonic clock in ms, e.g. the rAF timestamp); `chained` when it was requested from within the previous frame's callback. A non-finite time, or one not after the last, is ignored.
  - `state()`: `{ share, mode, averageMs }`. `share` is one of the ladder; `mode` is `off` (auto off), `full`, `thinned` or `resting` (full after a step that bought nothing); `averageMs` is the smoothed counted interval, undefined before the first.
- Types `WoodsGovernor`, `WoodsGovernorState`, `WoodsGovernorMode`.

The share is applied by `applyWoodsShare` (`city-objects.ts`).

## Invariants & assumptions

- **Only chained frames are measured.** A consumer that draws on demand (OsmDemo) would otherwise read every idle pause as a slow frame and strip the woods on every phone. The first frame of a burst sets the clock and measures nothing. A consumer with a continuous loop passes `chained: true` every frame.
- **One frame longer than `gapMs` says nothing** (a hitch, a tab coming back mid-burst); two in a row do, or a device at a quarter-second a frame would never step down. A counted interval enters the average whole but credits the slow, fast and bought seconds at most `gapMs`: the second of two long hitches cannot fill the two slow seconds by itself (swept from 0.4 s to an hour; about six hours would), and a device at 300-2000 ms a frame still reads as slow as it is, so the worthwhile test sees what thinning saved. Capping the average too made every step on such a device look worthless.
- The smoothed interval above `slowMs` for `slowS` of counted frames steps one rung down; under `fastMs` for `fastS` steps one rung up. The ladder ends at 0.25: never no woods.
- **Each rung is judged by its own frames**: at a step the average starts afresh at the next counted frame. A device at a second a frame has eight counted frames a verdict, too few for the smoothing to forget the rung before.
- **The worthwhile test**: from the second slow verdict on, if the average is above `(1 - worthwhile)` of the average when the thinning began (the baseline, taken only at the full woods), the woods were not the cost; the share returns to 1 and the step-down rests `restS`. A 30 Hz cap or a saving mode therefore costs one thinning try every five minutes. On a slow device the half rung saves half the woods' share of the frame, so woods at 30 % of the frame or more thin to a quarter and at 20 % come back and rest (swept 150-2000 ms).
- **A step that bought its time**: a thinned share whose average stayed under `slowMs` for `fastS` of counted frames has bought it (one fast frame, a short pause in the scene, does not). A later slow verdict at the half is a new one: it steps on to a quarter without the test and remembers that average as a second baseline. The quarter is then worthwhile against either baseline, so a denser district (half at 70 ms, a quarter at 55, full once at 60) keeps its quarter, and a flat slowdown whatever the woods (full 70-150 ms, then 52-65 ms) stays at a quarter while the later frame is under 85 % of the full woods' and comes back with a rest above it, which is the old judgement against the full woods. A quarter that had bought its time and gets slow has no rung left and stays.
- **No popping**: a rung left for being too slow is not returned to within `restS` of leaving it. After that it is tried again (a phone that cooled down gets its woods back).
- Rests run on the clock passed in, so idle time counts toward them; the verdicts run on counted frames only.
- `auto: false` (desktop, or `woodsauto=off`) never moves the share, and still measures (`averageMs`), so a readout shows the desktop's frame time too.
- **A deliberate copy**: the rule is modelled on the near clouds' governor, `GpsPlusSlamJs_Globe/src/globe-cloud-governor.ts`, which this package cannot import. Where they agree: the smoothed interval, a lone frame over `gapMs` ignored and a pair counted, the baseline taken when the first step leaves the full set, the worthwhile test against it with a `restS` rest. Where they differ, besides what they measure (chained frames against every frame), what they step (a share against a pixel scale and a tier) and their thresholds: the woods credit a frame at most `gapMs` to the verdicts and start the average afresh at each step, and a thinned share that bought its time steps on with a second baseline; the cloud governor in this tree counts whole frames, keeps one average, and tests only at its fewest pixels against the first baseline. A change to either is weighed for the other.
- **What would reverse a verdict**: the parameters are `slowMs` 50 (the owner's number), `fastMs` 36, `slowS` 2, `fastS` 12, `worthwhile` 0.15, `restS` 300 and `gapMs` 250. The sweeps in the tests show that a steady 34-49 ms never steps down and 51-300 ms steps down at 2-3 s (the average starts at the first interval, so a steady frame above the line is slow from its first counted frame); after a thinning and its rest, 16.7-35 ms (a 30 Hz cap's 33.3 ms included) gives the woods back and 37-49 ms keeps the thinned share. `fastMs` 36 sits above a 30 Hz cap and well below the 50 ms rule, so a share is not given back on a device just under the line; a value under 33.3 would strand a capped phone at the thinned share for good. No phone has been measured; the readout (`?perf=1` in OsmDemo) is what the owner reads on his.
- **Where its state lives**: the per-frame state (the average, the slow and fast seconds, the baseline) stays module-local on purpose. It changes every frame, and dispatching it to the app's Redux store would cost the frame time the governor exists to save. Only its outward result (`share`, `mode`) would belong in the store, once a real HUD control shows it; that is deferred to the HUD redesign.

## Examples

```ts
import { applyWoodsShare, createWoodsGovernor } from "gps-plus-slam-osm/three";

const governor = createWoodsGovernor({
  auto: matchMedia("(pointer: coarse)").matches,
});
let share = 1;
// in the frame callback, before the render:
governor.frame(timestamp, chained);
const next = governor.state().share;
if (next !== share) applyWoodsShare(group.children, (share = next));
```

## Tests

- `woods-governor.test.ts`: steady 60 ms steps down after about 2 s; on to a quarter while each step buys time; not worthwhile brings the woods back and rests; a half that had bought its time and gets slow later steps to a quarter, and a quarter in that case stays a quarter; a quarter that pays against the half's later slowness stays; a share has bought its time only after `fastS` under the line; two long frames credit at most `gapMs` each while the average sees them whole; a 30 Hz phone gets the woods back after the rest; a single 250 ms frame and a single 3 s chained frame do nothing; idle gaps between 60 fps bursts never step down while a slow burst does; unchained frames measure nothing; no re-entry within the rest, re-entry after it; auto off never steps; a step back after 12 s of fast frames once the rest is over; non-finite and backwards times are ignored; the step-down swept over steady 34-300 ms frames (2-3 s above the line); the step-up after a rest swept over steady 16.7-49 ms frames; slow devices swept over 150-2000 ms frames with woods 20-80 % of the frame; the half rung's later slowdown swept over full-woods baselines 60-150 ms, later frames 52-65 ms and 30 or 120 s; two hitches in a row swept from 0.4 s to an hour.
- `woods-governor.property.test.ts`: the share stays on the ladder and moves one rung or back to full; deterministic; auto off and unchained-only streams never move it.
