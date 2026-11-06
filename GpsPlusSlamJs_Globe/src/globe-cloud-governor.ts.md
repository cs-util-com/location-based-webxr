# globe-cloud-governor.ts

Purpose: the near clouds' step-down: a device too slow for its tier first draws fewer cloud pixels, and low is the last resort.

## Public API

- `CLOUD_GOVERNOR`: the thresholds.
- `createGlobeCloudGovernor(tier, { auto = true })`: `frame(ms)` takes the time since the frame before, `state()` gives `{ pixelScale, tier }`. With `auto` false it changes nothing: a tier chosen by hand is held.

## Invariants

- The pixel scale falls by `step` per `slowS` seconds of a smoothed frame time over `slowMs`, down to `minPixelScale`. Then the tier falls to low, the scale starts over at 1 and low gets `settleS` seconds to prove itself.
- The scale comes back one step per `fastS` of frames under `fastMs`, much slower than it falls, so it does not hunt. The tier never comes back: a device that needed low once will again.
- One frame longer than `gapMs` is a gap (a background tab, a collection), not a verdict; two in a row count, or a software renderer at seconds a frame would never step down.
- It only changes the clouds, not the canvas's pixel ratio or the sea's waves: those are fixed for a view's life.
- The view only feeds it while the near clouds draw, so a slow frame at orbit does not count against them.
- **A cap is not a slow device.** A display limited to 30 Hz, or a saving mode, reads over `slowMs` for ever. The step-down therefore tests itself: when the fewest pixels saved less than `worthwhile` (15 %) of the frame time since the pixels began to fall, the pixels were not the cost, all of them come back and it rests for `restS` (300 s). A capped screen spends about 10 s on fewer pixels, every five minutes; a device that gets slower later steps down at the next try.
- **What would reverse a verdict:** `slowMs` 22 reads 45 fps as the floor. `worthwhile` 0.15 reads a device whose clouds are under about a sixth of its frame as one the clouds do not slow; 0.05 would send a device with a jittering cap down to low, 0.3 would hold a slow device at all its pixels. No phone was measured for either. After the rest a view that later turns expensive gets no step-down.

## Example

```ts
const governor = createGlobeCloudGovernor(view.quality);
governor.frame(msSinceLastFrame);
const { pixelScale, tier } = governor.state();
```

## Tests

`globe-cloud-governor.test.ts`, with a property test over arbitrary frame times.
