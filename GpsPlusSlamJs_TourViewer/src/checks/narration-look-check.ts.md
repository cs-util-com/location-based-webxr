# `checks/narration-look-check.ts` - the narration circle's check page

## Purpose

Draws one narration circle (`narrationLook`) in the narration prototype's
bright square from the prototype's eye, for `narration-look-check.html`, and
measures what the circle costs a frame.

## Public API

- `startNarrationLookCheck(host)` - the renderer in `host`, the square, a
  6 m circle titled "The old well", idle, drawn every animation frame.
- `window.__narrationLookCheck`:
  - `show({ radiusM?, mode? })` - a new circle (`play` or `edit`);
  - `state(state, inside)` - the voice's state for the look;
  - `hold(seconds | null)` - hold the page clock (null: run);
  - `cost(frames = 300)` -> `{ frames, withMs, withoutMs, tickMs, draws }`:
    the mean frame time with the circle drawn and hidden (each frame
    waits for the GPU, `gl.finish`), the mean `tick` + `face` time, and
    the draws the circle adds; after a 20-frame warm-up;
  - `stop()` - stop drawing.

## Invariants & assumptions

- The scene's numbers are the prototype's: sky `#dfe3e6`, ground
  `#c9ccc7` over the grid paving, walls, a bench, a post and five figures,
  hemisphere light 2.2 and sun 1.1, a 62 degree camera at 1.6 m, 20 m
  south, 0.2 rad down.
- `cost` is a desktop figure: a phone's must be taken on the phone.

## Examples

```js
window.__narrationLookCheck.state("playing", true);
window.__narrationLookCheck.cost(300);
```

## Tests

None: a check page. Its numbers are read in the side-by-side check.
