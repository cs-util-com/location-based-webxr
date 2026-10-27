# landing/film-compile.ts

## Purpose

The film's wait for its compiled shaders: polls a readiness check and
stops the moment the scene is freed, settling in every case. It replaces
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

## Invariants

- Never calls `ready` after `stopped()` returned true.
- Never leaves a timer behind once it has settled.

## Example

```ts
const pending = new Set(renderer.compile(scene, camera));
await whenReady({
  stopped: () => released,
  ready: () => {
    for (const m of pending) if (programReady(m)) pending.delete(m);
    return pending.size === 0;
  },
});
```

## Tests

`film-compile.test.ts`: ready at once with no timer, polling until ready,
stopping (no further check, settled, no timer left), already stopped, a
throwing check, giving up after the last try. The scene's use of it
(`film-scene.ts` `prepare`) needs WebGL and is covered by the film's e2e.
