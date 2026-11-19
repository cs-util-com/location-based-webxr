# `then-now-check.ts` - then and now's check page

## Purpose

The code of `then-now-check.html` (`then-now-check.html.md`): one
`thenNow` picture block with the production part
(`kinds/picture/viewpoint-world.ts`) in a plain scene, the camera on its
viewpoint looking along it, its screen the page's `#narration-card-root`,
so Swipe can be tried and the e2e can drag the line and read the cut.

## Public API

- `startThenNowCheck(host, screenHost)` - builds the renderer under
  `host`, the part (its picture painted on a canvas and read as a PNG
  through the production decoder), its screen in `screenHost`, installs
  `window.__thenNowCheck` and draws every frame (updating the part with
  the camera) until `stop()`.
- The hook `window.__thenNowCheck`: `state()` (the shader's
  `{ on, split }` from `material.userData.thenNowSwipe`, null until the
  picture stands), `sample(xShare, yShare)` (the colour drawn at a share
  of the canvas from its top left, drawn afresh for the reading; throws
  on a share that is not finite), `stop()`.

## Invariants & assumptions

- The camera sees 66 degrees across, a little more than the picture's 60,
  so the picture's soft edges stay on screen in any aspect.
- Today is `#3d7ab8`, the old picture `#c0392b`: a pixel tells them apart.
- A part that cannot stand (no part for the block) throws at start; a
  picture that fails to load is logged and `state()` stays null.

## Tests

`playwright-tests/then-now-check.spec.js`.
