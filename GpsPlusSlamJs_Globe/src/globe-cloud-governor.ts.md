# globe-cloud-governor.ts

Purpose: the near clouds' step-down: a device too slow for its tier first draws fewer cloud pixels, and low is the last resort.

## Public API

- `CLOUD_GOVERNOR`: the thresholds.
- `createGlobeCloudGovernor(tier, { auto = true })`: `frame(ms)` takes the time since the frame before, `state()` gives `{ pixelScale, tier }`. With `auto` false it changes nothing: a tier chosen by hand is held.

## Invariants

- The pixel scale falls by `step` per `slowS` seconds of a smoothed frame time over `slowMs`, down to `minPixelScale`. Then the tier falls to low, the scale starts over at 1 and low gets `settleS` seconds to prove itself.
- The scale comes back one step per `fastS` of frames under `fastMs`, much slower than it falls, so it does not hunt. The tier never comes back: a device that needed low once will again.
- A frame longer than `gapMs` is a gap (a background tab, a collection), not a verdict.
- It only changes the clouds, not the canvas's pixel ratio or the sea's waves: those are fixed for a view's life.
- The view only feeds it while the near clouds draw, so a slow frame at orbit does not count against them.
- **What would reverse a verdict:** `slowMs` 22 reads 45 fps as the floor. A display limited to 30 Hz is read as slow and steps down to low although nothing would help; the price is a softer picture, not a broken one. No phone was measured for this value.

## Example

```ts
const governor = createGlobeCloudGovernor(view.quality);
governor.frame(msSinceLastFrame);
const { pixelScale, tier } = governor.state();
```

## Tests

`globe-cloud-governor.test.ts`, with a property test over arbitrary frame times.
