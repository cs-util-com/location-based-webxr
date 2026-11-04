# frame-draw-calls.ts

## Purpose

Counts the draw calls of a whole globe frame. The frame renders several
passes (the sky, the scene, the air's composites, the interface pass), and
three.js resets `renderer.info` at every `render` by default, so read
after the frame it held only the last pass's calls (the status bar showed
the interface pass's few calls as the frame's).

## Public API

- `createFrameDrawCalls(info)` -> `{ begin(), end(), calls(), dispose() }`,
  `info` being the renderer's `info` (`RenderInfo`: `autoReset`, `reset()`,
  `render.calls`):
  - creation turns `info.autoReset` off;
  - `begin()` - at a frame's start, before its first render: resets the
    counters;
  - `end()` - after the frame's last render: keeps `info.render.calls`;
  - `calls()` - the last finished frame's total (0 before the first),
    the same mid-frame;
  - `dispose()` - `autoReset` back as it was.

## Invariants & assumptions

- With `autoReset` off nothing else resets `info`, so every caller of the
  renderer must sit between one `begin` and its `end`, or its calls count
  towards the next frame. The editor calls `begin` in the view's `update`
  seam (before the clear and the sky) and `end` at the end of its
  `afterScene` seam (after the interface pass). A paused frame runs
  neither, so `calls()` keeps the last drawn frame.
- `info.render.triangles`, `points` and `lines` are summed over the frame
  too, while the counter lives.

## Example

```ts
const drawCalls = createFrameDrawCalls(renderer.info);
// per frame
drawCalls.begin();
renderer.render(sky, camera);
renderer.render(scene, camera);
drawCalls.end();
readout.drawCalls = drawCalls.calls();
```

## Tests

- `frame-draw-calls.test.ts` - a frame of three passes summed, the last
  finished frame reported mid-frame, and `autoReset` put back on dispose.
