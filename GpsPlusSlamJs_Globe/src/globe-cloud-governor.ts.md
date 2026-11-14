# globe-cloud-governor.ts

Purpose: the near clouds' step-down: a device too slow for its tier first draws fewer cloud pixels, and low is the last resort.

## Public API

- `CLOUD_GOVERNOR`: the thresholds.
- `createGlobeCloudGovernor(tier, { auto = true })`: `frame(ms)` takes the time since the frame before, `state()` gives `{ pixelScale, tier }`. With `auto` false it changes nothing: a tier chosen by hand is held.

## Invariants

- The pixel scale falls by `step` per `slowS` seconds of a smoothed frame time over `slowMs`, down to `minPixelScale`. Then the tier falls to low, the scale starts over at 1 and low gets `settleS` seconds to prove itself.
- The scale comes back one step per `fastS` of frames under `fastMs`, much slower than it falls, so it does not hunt. The tier never comes back: a device that needed low once will again.
- One frame longer than `gapMs` is a gap (a background tab, a collection), not a verdict; two in a row count, or a software renderer at seconds a frame would never step down. A counted frame enters the average at its whole length but credits the verdicts' seconds (slow, fast and the rest) at most `gapMs`. Capping the average too was tried and rejected: frames over `gapMs` at every pixel scale then read the same average, the worthwhile test judged the fewest pixels worthless, and a device at 0.6 s a frame or slower never reached low. With the seconds capped a slow device still reaches low (0.6 / 1 / 2.6 s a frame: after about 22 / 37 / 96 s), and a pair of hitches (0.4-10 s) between frames under `slowMs` makes no verdict by itself.
- It only changes the clouds, not the canvas's pixel ratio or the sea's waves: those are fixed for a view's life.
- The view only feeds it while the near clouds draw, so a slow frame at orbit does not count against them.
- **The governor drives the near clouds only** (`startNearClouds` in `globe-view-clouds.ts`), which are experimental in the Tour Viewer's editor (`clouds=new`); the old clouds have no step-down.
- **A step that bought its time skips the worthwhile test at the fewest pixels.** `bought` is set when the smoothed average goes under `slowMs` while the pixels are lowered, and cleared by the next step down. A slow verdict at the fewest pixels with `bought` set falls to low. Without it a device that ran well at the fewest pixels for minutes and got slow later (a denser deck, a phone heating up) was judged against the average from before the steps, read as a capped screen, got every pixel back and rested `restS`.
  - The baseline (`slowAt`) is taken only when the pixels begin to fall. A step that bought its time at a middle rung does not re-take it: a baseline from the last rung or two would read a slowdown the pixels do not cause as worthless steps and give every pixel back, where the full baseline sends the device to low.
  - At low with the fewest pixels no rung is left, so the worthwhile test runs as always: the fewest pixels still pay against low's full ones and stay.
  - **The trade at the fewest pixels:** a frame cap that arrives after the pixels bought their time (a 40, 30 or 25 Hz saving mode switching on: 25 / 33 / 40 ms) reads as a slow device and costs the tier, low for the view's life, where before it gave every pixel back and rested. The governor cannot tell the two apart from frame times; a device that slows down is the more harmful one to leave alone.
- **A cap is not a slow device.** A display limited to 30 Hz, or a saving mode, reads over `slowMs` for ever. The step-down therefore tests itself: when the fewest pixels saved less than `worthwhile` (15 %) of the frame time since the pixels began to fall, the pixels were not the cost, all of them come back and it rests for `restS` (300 s). A capped screen spends about 10 s on fewer pixels, every five minutes; a device that gets slower later steps down at the next try.
- **What would reverse a verdict:** `slowMs` 22 reads 45 fps as the floor. `worthwhile` 0.15 reads a device whose clouds are under about a sixth of its frame as one the clouds do not slow; 0.05 would send a device with a jittering cap down to low, 0.3 would hold a slow device at all its pixels. No phone was measured for either. After the rest the step-down tests itself again.

- **A deliberate copy (DEC-H3):** the woods governor, `GpsPlusSlamJs_Osm/src/three/woods-governor.ts`, follows this rule (smoothed interval, gap, worthwhile test, rest) for the invented trees' share. The Osm package cannot import this one, and the two differ in what they measure (chained frames only, for a view that draws on demand), in what they step and in their thresholds, so each keeps its own copy and names the other.

## Example

```ts
const governor = createGlobeCloudGovernor(view.quality);
governor.frame(msSinceLastFrame);
const { pixelScale, tier } = governor.state();
```

## Tests

`globe-cloud-governor.test.ts`, with a property test over arbitrary frame times. The bought-its-time cases are swept: baselines 24-30 ms, bought at the fewest pixels at 19-21 ms, later 23-27 ms (each above where the old rule rested) fall to low; bought at rungs 3-4 at 20 ms, later 22.5-26 ms against baselines 24-40 ms end as the full baseline judges (low at or under `baseline * 0.85`, every pixel back above); at low a later 22.5-25 ms against a 30 ms baseline stays at the fewest pixels. Two hitches of 0.4-10 s between frames of 19-21.8 ms at the fewest pixels keep the tier.
