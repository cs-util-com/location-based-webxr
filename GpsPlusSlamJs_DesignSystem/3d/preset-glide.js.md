# preset-glide.js - the look presets' glide

- Purpose: round-3 plan 2026-09-27-0532, feedback 1 (the owner: the look
  presets should not jump; the sun and the look glide to the new values over
  about 5 s, so one can step through the modes). The interpolation and the
  frame-by-frame controller behind the page's preset buttons. Pure (no
  three, no DOM, no clock of its own), so `node --test` runs it and a test
  pins the time.
- Public API:
  - `GLIDE_MS` - 5000, the owner's number.
  - `presetLook(preset)` - a framework `LookPreset` as the page's state
    keys `{ elevation, azimuth, visibility, exposureEv, clouds }`.
  - `shortestArcDeg(fromDeg, toDeg)` - the signed short-way turn in
    (-180, 180]; exactly opposite directions turn +180.
  - `lerpLook(from, to, s)` - the look a fraction `s` (already eased) of
    the way. `RangeError` for a missing or non-finite value, a visibility
    <= 0, or a non-finite `s`.
  - `createPresetGlide({ ease, durationMs?, rebuildEvery? })` - the
    controller. `TypeError` without `ease`; `RangeError` for a duration <= 0
    or a `rebuildEvery` that is not a positive integer.
    - `start({ from, to, id, nowMs })` - begin, or retarget: `from` is the
      look the scene shows now. Validated before any change.
    - `tick(nowMs)` - null while idle, else
      `{ look, done, rebuild, id, t }`. `RangeError` for a non-finite time.
    - `cancel()`, `active`, `id` (the target's while gliding, else null).
- Invariants & assumptions:
  - Every preset value moves together, on one eased curve (round-3 plan
    §2): no value arrives before another.
  - The azimuth turns the short way (golden hour 265° to dawn 75° is 170°
    through north, not 190° through the south; plan §8 finding 8) and is
    reported in [0, 360).
  - The visibility moves evenly on the page's slider scale, which is
    logarithmic (`5 * 60^v`): the half-way value is the geometric mean. It
    is computed as a power of the ratio, so `s = 0` returns the start
    exactly.
  - A retarget starts from the look passed as `from`: the page passes what
    the scene shows (with a rebuild interval above one frame, that is the
    last rebuilt look, not the controller's clock position), so a new click
    turns from where the scene is (plan §2).
  - The settling frame returns a copy of the target, not an interpolation:
    the final state equals the preset exactly (435° never survives as an
    azimuth, and a visibility never ends at 30.000000000000004).
  - `rebuild` is true on the first frame after a start (a retarget too), on
    every `rebuildEvery`-th frame after it, and on the settling frame. The
    page applies a look only on those frames; the count is FRAMES, as the
    plan's sweep asked (every 1, 2, 4, 8 frames).
  - A clock that runs backwards holds the glide at its start (t clamped to
    [0, 1]).
- Examples:

  ```js
  import { smoothstep } from "/osm/easing.js";
  const glide = createPresetGlide({ ease: smoothstep, rebuildEvery: 2 });
  glide.start({
    from: lookOf(state),
    to: presetLook(noon),
    id: "noon",
    nowMs: performance.now(),
  });
  // per frame:
  const step = glide.tick(performance.now());
  if (step?.rebuild) Object.assign(state, step.look);
  ```

- Tests: `preset-glide.test.mjs` (the easing seen at t = 0.25, every value
  on one curve, the short arc, the exact end, the retarget, the rebuild
  frames, the refusals, and a 200-trial seeded property check that a glide
  stays between its ends, never turns the azimuth more than its short arc,
  and settles exactly).
