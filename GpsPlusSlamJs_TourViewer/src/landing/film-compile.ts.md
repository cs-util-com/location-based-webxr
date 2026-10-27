# landing/film-compile.ts

## Purpose

The film's compile-ahead and its wait for the compiled shaders: polls a
readiness check and stops the moment the scene is freed, settling in
every case, also when the compile itself throws. It replaces
three.js's `compileAsync` wait, whose timer outlives a released renderer,
reads a freed program there (an uncaught TypeError) and never settles.

## Public API

- `whenReady({ ready, stopped, later?, stepMs?, maxTries? }): Promise<void>`
  - `ready()`: true once everything is compiled. A throw counts as done
    (the first draw finishes what is left).
  - `stopped()`: true once the scene is freed; asked before every check,
    so a freed scene's programs are never read.
  - `later(cb, ms)`: the timer (default `setTimeout`); `stepMs` between
    checks (default 10, as three.js polls); `maxTries` before it gives up
    (default 500, about 5 s).
  - Settles once ready, stopped, failed or out of tries; never rejects.
    The first check runs at once, so a scene that is ready (or a browser
    without parallel compiling, whose programs report ready at once)
    needs no timer.

- `compileAhead({ compile, isReady, stopped, later? }): Promise<void>`
  - `compile()`: compiles the scene's programs and returns what it
    compiled (three.js `renderer.compile`, once per camera).
  - `isReady(item)`: whether that item's program is ready.
  - Waits by `whenReady` until every compiled item is ready. A `compile`
    that throws (a context already lost: `createShader` returns null and
    `shaderSource` throws) settles at once with no timer and never asks
    `isReady`: compiling ahead is only a head start, and the first draw,
    or the loss path, takes over. Never throws and never rejects, so the
    film never mistakes it for a renderer that will not start.

## Invariants

- Never calls `ready` after `stopped()` returned true.
- Never leaves a timer behind once it has settled.

## Example

```ts
await compileAhead({
  compile: () => renderer.compile(scene, camera),
  isReady: programReady,
  stopped: () => released,
});
```

## Tests

`film-compile.test.ts`: ready at once with no timer, polling until ready,
stopping (no further check, settled, no timer left), already stopped, a
throwing check, giving up after the last try; `compileAhead` waiting for
every compiled item, and settling at once with no timer when the compile
throws. `landing-film.test.ts` shows such a scene shown, unreported and
freed. The scene's use of it
(`film-scene.ts` `prepare`) needs WebGL and is covered by the film's e2e.
