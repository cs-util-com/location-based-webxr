# measure-shadows-rig.ts

Purpose: the building-shadow spike's controller (`?measure=shadows`), a throwaway on a spike branch that never merges. It drives cached sun shadows on the city in two shapes, one map fitted to the whole loaded city or a near map (on the sun light, fitted to the camera distance, snapped to its light-space texel grid) plus a far map (on a zero-intensity light, over the whole city), so the spike can time each configuration.

## Public API

- `SpikeConfig`, `SPIKE_DEFAULT`: every swept knob (map sizes, near fit `k`, re-centre fraction, settle time, split frames, `sunUpdateDeg`, cadence, the elevation ramp, the depth-fade start `f`).
- `SpikeShadows`: `enable()`, `disable()` (removes the far light, so the shadow-free programs are today's), `configure(config)`, `forget()`, `bytes()`, `update(inputs)` returning which maps render in this frame and whether one waits for the next frame.
- Pure helpers: `nearHalfWidth` (exported); `rampStrength`, `snapCentre`, `casterDistance` (internal).

## Invariants

- The sun light is added before the far light, so it is shadow 0.
- `shadow.bias` is 0; the normal bias is one texel.
- Between renders the sun light follows the current sun direction at the last-rendered centre.

## Tests

None: a spike that never merges. Its numbers go into the results document; the framework controller built on them carries the tests.
