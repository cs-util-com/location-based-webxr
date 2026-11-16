# reduced-motion.ts

## Purpose

Answers "did the visitor ask for less motion?" for code that asks every
frame (a world part's `env.reduceMotion`, the walk radar's draw), without
making a new media query each time.

## Public API

- `reducedMotionReader(win)` returns `() => boolean`.
  - `win` is anything with an optional `matchMedia` (a `Window`), or
    null / undefined.
  - The first call makes the `(prefers-reduced-motion: reduce)` query;
    every call reads its `matches`, which the browser keeps current, so a
    change of the setting while the page is open is followed.
- `MotionWindow`: the part of a window the reader needs.

## Invariants and assumptions

- `matchMedia` is called at most once per reader, and not before the
  first ask (a reader made for a page that never asks costs nothing).
- No window, or a window without `matchMedia` (an older engine, a test
  double), answers false and never throws.

## Example

```ts
const env = worldEnv("play", assets, load, {
  reduceMotion: reducedMotionReader(globalThis),
});
```

## Tests

- `reduced-motion.test.ts`: the query is made once and its answer is
  followed; no window or no `matchMedia` answers false.
