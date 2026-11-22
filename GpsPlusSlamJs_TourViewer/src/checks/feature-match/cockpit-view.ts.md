# cockpit-view.ts

## Purpose

The cockpit view of the feature matching page (`?ui=cockpit`): the four steps (photo A, photo B, run, save), the pair selector and spot field, "Before you start", the guide card, the light warning, Save with its offered links, and the flat target mode picked in the selector. Its rules (Steps, Camera taps, Pair names, Progress across reloads, Guidance, Light check, Save) are listed in `feature-match-check.ts.md`.

## Public API

- `cockpitVideo(root)`: the cockpit's `#video`, for the page camera.
- `startCockpitView({ root, fm, engine, camera, log, fail })`: wires the cockpit and returns its render function; it also applies the flat mode once.

## Invariants and assumptions

- A capture tap with the camera off only starts it; photo B, once taken, starts `engine.startRun("camera")`.
- Save runs only when the reducer accepted `saveStarted`; the Blob URLs and `saveFinished` go in one `put`.
- The selector and spot field are drawn only when the state moved them; the links only when `offered` changed.
- Choosing the flat mode stops the camera and opens `flat-capture.ts`; its Exit dispatches `flatExited`.

## Example

```ts
const render = startCockpitView({
  root: document,
  fm,
  engine,
  camera,
  log,
  fail,
});
store.subscribe(render);
```

## Tests

Browser-only DOM code: `playwright-tests/feature-match-check.spec.js` (the cockpit flows listed in `feature-match-check.ts.md`). The rules are unit-tested in `feature-match-slice.test.ts`, `bench-steps.test.ts` and `bench-export.test.ts`.
