# `three/woods-governor.ts`

## Purpose

On a phone too slow for the invented woods, draw fewer of them: the owner's rule "above 50 ms a frame the library lowers the density on the phone automatically, the desktop stays full" (city objects plan 2026-11-07-2315, M2b; toggles plan 2026-11-10-1902, T5). Pure: no three.js, no clock of its own.

## Public API

- `WOODS_GOVERNOR`: the thresholds, frozen. `slowMs` 50, `fastMs` 33, `slowS` 2, `fastS` 12 (counted seconds), `worthwhile` 0.15, `restS` 300, `smoothing` 0.1, `gapMs` 250, `shares` `[1, 0.5, 0.25]`.
- `createWoodsGovernor({ auto = true })` returns:
  - `frame(atMs, chained)`: one frame drawn at `atMs` (a monotonic clock in ms, e.g. the rAF timestamp); `chained` when it was requested from within the previous frame's callback. A non-finite time, or one not after the last, is ignored.
  - `state()`: `{ share, mode, averageMs }`. `share` is one of the ladder; `mode` is `off` (auto off), `full`, `thinned` or `resting` (full after a step that bought nothing); `averageMs` is the smoothed counted interval, undefined before the first.
- Types `WoodsGovernor`, `WoodsGovernorState`, `WoodsGovernorMode`.

The share is applied by `applyWoodsShare` (`city-objects.ts`).

## Invariants & assumptions

- **Only chained frames are measured.** A consumer that draws on demand (OsmDemo) would otherwise read every idle pause as a slow frame and strip the woods on every phone. The first frame of a burst sets the clock and measures nothing. A consumer with a continuous loop passes `chained: true` every frame.
- **One frame longer than `gapMs` says nothing** (a hitch, a tab coming back mid-burst); two in a row do, or a device at a quarter-second a frame would never step down.
- The smoothed interval above `slowMs` for `slowS` of counted frames steps one rung down; under `fastMs` for `fastS` steps one rung up. The ladder ends at 0.25: never no woods.
- **The worthwhile test**: from the second slow verdict on, if the average is above `(1 - worthwhile)` of the average when the thinning began, the woods were not the cost; the share returns to 1 and the step-down rests `restS`. A 30 Hz cap or a saving mode therefore costs one thinning try every five minutes.
- **No popping**: a rung left for being too slow is not returned to within `restS` of leaving it. After that it is tried again (a phone that cooled down gets its woods back).
- Rests run on the clock passed in, so idle time counts toward them; the verdicts run on counted frames only.
- `auto: false` (desktop, or `woodsauto=off`) never moves the share, and still measures (`averageMs`), so a readout shows the desktop's frame time too.
- **DEC-H3, a deliberate copy**: the rule is modelled on the near clouds' governor, `GpsPlusSlamJs_Globe/src/globe-cloud-governor.ts`. This package cannot import the globe package, and the two differ in what they measure (chained frames against every frame), in what they step (a share against a pixel scale and a tier) and in their thresholds, so they are kept as two copies, each naming the other.
- **What would reverse a verdict**: `slowMs` 50 is the owner's number. The sweep in the tests shows that a steady 34-49 ms never steps, 51 ms steps within 30 s (the average creeps up to the line), and 55-300 ms within 6 s. `fastMs` 33 sits well below the 50 ms rule so a share is not given back on a device just under the line. No phone has been measured; the readout (`?perf=1` in OsmDemo) is what the owner reads on his.

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

- `woods-governor.test.ts`: steady 60 ms steps down after about 2 s; on to a quarter while each step buys time; not worthwhile brings the woods back and rests; a single 250 ms frame and a single 3 s chained frame do nothing; idle gaps between 60 fps bursts never step down while a slow burst does; unchained frames measure nothing; no re-entry within the rest, re-entry after it; auto off never steps; a step back after 12 s of fast frames once the rest is over; non-finite and backwards times are ignored; the step-down swept over steady 34-300 ms frames.
- `woods-governor.property.test.ts`: the share stays on the ladder and moves one rung or back to full; deterministic; auto off and unchained-only streams never move it.
