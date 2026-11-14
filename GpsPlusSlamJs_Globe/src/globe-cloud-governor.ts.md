# globe-cloud-governor.ts

Purpose: the near clouds' step-down: a device too slow for its tier first draws fewer cloud pixels, and low is the last resort.

## Public API

- `CLOUD_GOVERNOR`: the thresholds.
- `createGlobeCloudGovernor(tier, { auto = true })`: `frame(ms)` takes the time since the frame before, `state()` gives `{ pixelScale, tier }`. With `auto` false it changes nothing: a tier chosen by hand is held.

## Invariants

- The pixel scale falls by `step` per `slowS` seconds of a smoothed frame time over `slowMs`, down to `minPixelScale`. Then the tier falls to low, the scale starts over at 1 and low gets `settleS` seconds to prove itself.
- The scale comes back one step per `fastS` of frames under `fastMs`, much slower than it falls. The tier never comes back: a device that needed low once will again.
- **A step given back that is slow again at once rests.** When the next step down lands on the rung a step was just given back from, that step is not offered again for `restS`. Without it a device whose clouds sit at the line (fast at one rung, slow at the next, or vsync rounding to 16.7 / 33.3 ms) got a step back every `fastS` and lost it 2 s later: up to 42 give-backs in ten minutes (57 of 256 swept devices had more than 2), against at most 2 (one per `restS`) with it. A device that gets faster later waits up to `restS` for that step.
- One frame longer than `gapMs` is a gap (a background tab, a collection), not a verdict; two in a row count, or a software renderer at seconds a frame would never step down. A counted frame enters the average at its whole length but credits the verdicts' seconds (slow, fast and the rest) at most `gapMs`. Capping the average too was tried and rejected: frames over `gapMs` at every pixel scale then read the same average, the worthwhile test judged the fewest pixels worthless, and a device at 0.6 s a frame or slower never reached low. With the seconds capped a slow device still reaches low (0.6 / 1 / 2.6 s a frame: after about 22 / 37 / 96 s), and a pair of hitches (0.4-10 s) between frames under `slowMs` makes no verdict by itself.
- It only changes the clouds, not the canvas's pixel ratio or the sea's waves: those are fixed for a view's life.
- The view only feeds it while the near clouds draw, so a slow frame at orbit does not count against them.
- **The governor drives the near clouds only** (`startNearClouds` in `globe-view-clouds.ts`), which are experimental in the Tour Viewer's editor (`clouds=new`); the old clouds have no step-down.
- **A step that bought its time skips the worthwhile test at the fewest pixels.** A rung has bought its time once `fastS` of credited time under `slowMs` added up there; the count starts over at every change of the pixel scale. A slow verdict at the fewest pixels with `bought` set falls to low. Without it a device that ran well at the fewest pixels for minutes and got slow later (a denser deck, a phone heating up) was judged against the average from before the steps, read as a capped screen, got every pixel back and rested `restS`.
  - `fastS` and not one frame: a single smoothed frame under `slowMs` between janky ones (a phone starting up) marked the rung as bought, and a 3 s burst of slow frames later sent a fast phone to low for the view's life (startup sweep below: 12 of 360 scenarios, none with the count).
  - The baseline (`slowAt`) is taken only when the pixels begin to fall. A middle rung that bought its time does not re-take it: a baseline from the last rung or two would read a slowdown the pixels do not cause as worthless steps, where the full baseline sends the device to low.
  - **A stale baseline is measured again, not trusted for a rest.** When a middle rung had bought its time and the fewest pixels then look worthless against the full baseline, that baseline is from before the device changed: a phone that heats up multiplies every frame, so the fewest pixels look like nothing against the cool baseline although they save as much as ever. Every pixel comes back without the rest, and the next step down takes a new baseline at every pixel. Over the heat sweep below 75 of 169 cases where the fewest pixels pay were not at low after 100 s (each rested 300 s at every pixel); with it none, the last at about 20 s. Keeping the full baseline and adding one taken at the middle rung (low when the fewest pixels saved `worthwhile` against either) was measured too and left 30 of them. The cost: a slowdown the pixels really do not cause, after a middle rung bought its time, walks down the rungs once more (about 12 s) before it rests.
  - **Once bought, only slow frames fill a slow verdict.** A frame credits a slow verdict only when it is over `slowMs` itself. A run of hitches (3 or more frames of 1.7 s or longer, 5-8 of 0.3-0.8 s, 1.5 s of 100-250 ms frames) leaves the average over `slowMs` for many short frames while it comes back down; credited, those frames made the verdict, and at the fewest pixels it cost the tier (76 of 125 swept runs, 6 before the bought rule, none with this). Before a rung has bought its time every frame counts as before: credited only for slow frames everywhere, startup jank walked down more slowly, more phones reached the fewest pixels with a baseline from the jank, and a burst after it sent 6 of 600 of them to low.
  - At low with the fewest pixels no rung is left, so the worthwhile test runs as always: the fewest pixels still pay against low's full ones and stay.
  - **The trade at the fewest pixels:** a frame cap that arrives after the pixels bought their time (a 40, 30 or 25 Hz saving mode switching on: 25 / 33 / 40 ms) reads as a slow device and costs the tier, low for the view's life, where before it gave every pixel back and rested. The governor cannot tell the two apart from frame times; a device that slows down is the more harmful one to leave alone.
- **A cap is not a slow device.** A display limited to 30 Hz, or a saving mode, reads over `slowMs` for ever. The step-down therefore tests itself: when the fewest pixels saved less than `worthwhile` (15 %) of the frame time since the pixels began to fall, the pixels were not the cost, all of them come back and it rests for `restS` (300 s). A capped screen spends about 10 s on fewer pixels, every five minutes; a device that gets slower later steps down at the next try.
- **Known limit: a baseline from startup jank.** The baseline is the smoothed average at the first verdict. Taken in a heavy jank (20-50 % of frames at 50-150 ms for about 12 s, so the descent reaches the fewest pixels just as the jank ends) it is high, and a short burst of slow frames later reads as the fewest pixels paying: a fast phone falls to low (4 of 600 such scenarios, the same 4 before the bought rule). A mean over the verdict as the baseline was tried and sent more capped devices to low; a robust baseline needs its own design.
- **What would reverse a verdict:** `slowMs` 22 reads 45 fps as the floor. `worthwhile` 0.15 reads a device whose clouds are under about a sixth of its frame as one the clouds do not slow; 0.05 would send a device with a jittering cap down to low, 0.3 would hold a slow device at all its pixels. No phone was measured for either. After the rest the step-down tests itself again.

## Example

```ts
const governor = createGlobeCloudGovernor(view.quality);
governor.frame(msSinceLastFrame);
const { pixelScale, tier } = governor.state();
```

## Tests

`globe-cloud-governor.test.ts`, with a property test over arbitrary frame times. The sweeps:

- Bought at the fewest pixels: baselines 24-30 ms, bought at 19-21 ms, later 23-27 ms (each above where the old rule rested) fall to low.
- A flat slowdown after a rung bought its time: baselines 22.5-40 ms, rungs 1-5, bought at 19 and 21 ms, later 18-30 ms for a minute end as the full baseline judges (low at or under `baseline * 0.85`, every pixel back above; low at the fewest pixels; nothing under `slowMs`).
- A phone heating up: frame = k (fixed + clouds scale^a), a 1 and 2, baselines 24-40 ms, fixed share 0-0.6, k 1.2-2.5 after 120 s at k 1: wherever the fewest pixels pay under the heat it reaches low within 100 s.
- Startup jank: 10, 25 and 50 % janky frames of 17-150 ms for 4-20 s, 5 s calm, then a 3 s burst of 40-80 ms frames, eight seeds each: the burst sends no phone to low.
- Hitches at the fewest pixels after they bought their time: two of 0.4-10 s, and runs of 3-6 of 1.7-10 s, 5-8 of 0.3-0.8 s and 1.5 s of 100-250 ms frames, between frames of 16.7-21.8 ms: the tier stays.
- At low with the fewest pixels, later 22.5-30 ms against a 30 ms baseline: the fewest pixels stay under 25.5 ms and every pixel comes back over it, already after the first verdict (the check that the skip does not run at low).
- Hunting: frame = fixed + clouds scale^a with and without vsync rounding, a 1 and 2, baselines 22.5-60 ms, fixed share 0-0.6: at most one give-back per `restS` in the ten minutes after settling.
- The 2.6 s-frame case reaches low within the time derived from `CLOUD_GOVERNOR` (six verdicts of `slowS / gapMs` frames at each pixel scale) plus one frame.
