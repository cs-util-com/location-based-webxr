# sun-driver.ts

## Purpose

The sun's two drivers, the ways it moves without a hand on the time
controls: the real clock (`?now=1`) and the timelapse
(`?timelapse=<seconds>`). A driver moves the store's sun (`sunMoved`,
`osm-store.ts`) and nothing else; the view, the controls and the look
weights follow the store as they do for the slider.

## Public API

- `SUN_DRIVER` - the rules: the clock steps every 10 s; the timelapse plays
  from 12 degrees on the setting limb to civil dusk (-6 degrees, the clock's
  floor); a link's length is clamped to 5-3600 s.
- `clockInstant(nowMs, place)` - the real sun while at or above civil
  twilight; below it, held at the night's edge (civil dusk before solar
  midnight, civil dawn after it); in polar night the date's boot sun.
  `RangeError` for a non-finite instant.
- `timelapseSpan(instantMs, place)` - the span on the instant's solar date:
  from the sun at 12 degrees setting (solar noon where it never climbs that
  high) to civil dusk (the date's last stop in a white night). Null in polar
  night.
- `parseTimelapseSeconds(text, warn?)` - null when absent; a positive number
  clamped to the range; null with one warning for anything else.
- `chooseSunDriver({time, timelapse, now}, warn?)` - `{kind: "none"}`,
  `{kind: "clock"}` or `{kind: "timelapse", seconds}`. A pinned `?time=` wins
  over both drivers, the timelapse over the clock; each key that loses is
  named in a warning.
- `followClock(options)` and `playTimelapse(options)` (injectable `now`,
  `every` / `frame` and `warn`; the timelapse needs `seconds`) - each returns a `SunDriver`, `(dispatch, getState) => stop`.
  `playTimelapse` throws `RangeError` for a length that is not positive.

## Invariants & assumptions

- Drivers dispatch only `sunMoved`; the store's reducer validates the
  instant. The timers (`setInterval`, `requestAnimationFrame`) are the
  driver's resources, injectable for the tests; `stop` ends them.
- The clock reads the store's place on every tick, and the timelapse finds
  its span again when the place changes (a re-anchor), so neither keeps a
  second copy of where the sun is.
- The timelapse loops; where there is no span (polar night) it stops itself
  with a warning instead of dispatching.
- `main.ts` stops the driver as soon as a hand moves the sun, and computes
  the boot sun from the chosen driver so the first frame does not jump.

## Examples

```ts
const choice = chooseSunDriver({ time, timelapse, now });
const stop =
  choice.kind === "timelapse"
    ? playTimelapse({ seconds: choice.seconds })(store.dispatch, store.getState)
    : followClock()(store.dispatch, store.getState);
```

## Tests

`sun-driver.test.ts`: the clock's hold at dusk and dawn and in polar night,
the timelapse span at Cologne, at a high-latitude winter date and in polar
night, the precedence and warnings of the three link keys, the length
parsing, and both timers driven by fake clocks (every dispatch, the loop,
stop, a new place, polar night).
