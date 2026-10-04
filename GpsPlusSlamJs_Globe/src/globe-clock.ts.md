# globe-clock.ts - the globe's one clock

- Purpose: round-2 plan 2026-09-26-2055 M3f and round-3 plan 2026-09-27-0532
  §4 F. The scene's instant, which everything on the globe that moves with
  time reads: the sun, the cloud drift, and (stream E) the dive's hand-over,
  which passes "the globe's time" on. Pinnable from the hash, so a link
  reproduces a scene exactly.
- Public API:
  - `GLOBE_CLOCK_SCALE` - `{ min: 0, max: 100000 }`, the accepted
    `timeScale` range (standing still to about a day per second).
  - `readGlobeClockSetting(params)` → `{ startMs, scale }` from the lab's
    hash parameters. `time=<ISO>` is the pinned start (null when absent,
    empty or unparseable; a hand-typed offset's "+" that form decoding
    turned into a space is put back). `timeScale=<n>` is the scale (null
    when absent, not a plain decimal, or out of range).
  - `startGlobeClock(setting, { epochMs, monoMs })` → `{ setting, scale,
timeAt(monoMs), driftTimeAt(monoMs) }`. `epochMs` (`Date.now()`) is "now" for an unpinned
    clock; `monoMs` (`performance.now()`) is the reading `timeAt` measures
    from. The effective scale is the setting's, or 0 with a pinned start (it
    stands still, as `time=` always did) and 1 without one (the wall
    clock). `timeAt(mono) = start + (mono - monoMs) * scale`.
    `driftTimeAt(mono) = start + (mono - monoMs) * min(scale, 1)`: the time
    the clouds drift on, so a fast clock does not strobe them (at 600x the
    drift per real second equals the 1x rate); a pinned, stopped clock's
    drift stands still, so pinned links stay reproducible. A speed change
    starts a new clock from the current instant (the lab writes `time=`),
    so the clouds jump once there.
  - `sameGlobeClockSetting(a, b)` - whether a hash change needs a new clock.
- Invariants & assumptions: a pinned clock with no scale returns its pin for
  every reading, so pixel probes that pin `time=` never drift. RangeError
  for a non-finite wall reading, a non-finite start, or a scale outside the
  range; malformed hash text never throws, it reads as the default.
- Example:

  ```js
  const clock = startGlobeClock(
    readGlobeClockSetting(new URLSearchParams(location.hash.slice(1))),
    { epochMs: Date.now(), monoMs: performance.now() },
  );
  const ms = clock.timeAt(performance.now()); // the scene's instant
  ```

- Tests: `globe-clock.test.ts` (the hash forms and their defaults, pinned,
  running, pinned-and-running, a property that the clock advances at exactly
  its scale from its start, the drift time at min(scale, 1) and at 600x one
  second per real second, the refusals). The lab's
  `globe-sky.smoke.spec.mjs` checks it in the page (pinned across frames,
  an offset, `timeScale`, the plate's speed select).
