# film-debug.ts

## Purpose

The hero film's `?debug=1` parts, for measuring the frame budget on a
phone, where no test runs: the readout's text and the quality knobs read
from the page's address. Pure.

## Public API

- `debugQuality(search, base): SceneQuality`: `base` with the knobs of
  the address `search` applied:
  - `film-dpr`: the pixel ratio cap, above 0 and at most 3;
  - `film-shadows`, `film-eye` (the phone screen's 3D pass), `film-aa`
    (antialiasing): `0` or `1`.
  - A knob it cannot read (`film-dpr=0`, `=4`, `=abc`, empty, a flag
    other than 0 or 1) is ignored, never guessed.
- `createRunCounts()`: `{ push(ms), counts() }`, every frame interval
  of a run and those strictly over 50 and 100 ms (the live ring of
  `utils/frame-times` keeps only the last 600). `push` ignores a
  non-finite or negative value.
- `filmReadout(input): string`: one fact a line:
  - `3d, dpr 2, shadows eye aa, build 322 ms` (the settings only for 3D,
    the parts that are on; the build only once there was one);
  - `playing 12.3 / 70.1 s`;
  - `p50 16.7 p95 18.0 max 70.0 ms` (the last frames, once there are any);
  - `4122 frames: 5 over 50 ms, 1 over 100` (the whole run, once it ran).

## Invariants

- The knobs act only when the film's `?debug=1` is on
  (`landing-film.ts` `browserEnv`); a visitor's address never changes
  the scene.
- The readout names everything a phone result rests on: the renderer,
  the pixel ratio and quality actually used, and the whole run's slow
  frames, not only a window of them.

## Example

```ts
const q = debugQuality("?debug=1&film-shadows=0&film-dpr=1.5", FULL_QUALITY);
// { pixelRatioCap: 1.5, shadows: false, eyePass: true, antialias: true }
```

## Tests

`film-debug.test.ts`: the knobs (each one, and the ones it ignores), the
run counts, the readout's lines and what it leaves out.
`landing-film.test.ts` ("the debug readout"): the knobs' quality reaches
the scene and the readout shows the run's slow frames.
