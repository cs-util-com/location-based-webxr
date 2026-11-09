# v1-faithful.js

## Purpose

The page of the V1 faithful look: joins the library's buildings, the decisions of `v1-faithful-model.js` and the shared harness. A throwaway prototype, linked only from the gallery.

## Public API

No exports. It starts the page with `startCityLook` and sets `window.__cityLookV1`: `{ scene, params, candidates, fits, roofed }`. `fits` counts the footprints that fit at 2, 5 and 10 %, whatever the link's own tolerance; `roofed` counts what got a roof at the link's tolerance.

Link parameters beyond the harness's: `tol`, `pitch`, `cap`, `over`, `jitter`, `mute`, `band`, `roof=warm`, `ao=off` (see `parseV1Params`).

## Invariants and assumptions

- Every volume takes one of three paths: an inferred house, a height-scaled copy of the library's mesh, or the library's mesh repainted. A tagged building only ever takes the last one.
- Height scaling assumes the library's flat base at y = 0, which holds for the flat-ground fixtures; a tagged `min_height` is never scaled because `leftAlone` keeps it out.
- A feature whose rings cannot be read counts as having holes, so it keeps its own shape.
- All buildings merge per map chunk into one draw call, so the count stays comparable with V0. No per-frame work, and no pass beyond the harness's GTAO.
- Colours go in as linear values through `linearRgb`.
- Light, sky, cameras and ground stay the harness's.

## Example

`http://127.0.0.1:4801/labs/city-look/v1-faithful/index.html?scene=heidelberg&view=landing&split=off&tol=0.1`

## Tests

The decisions are covered by `v1-faithful-model.test.mjs`. The page itself was checked by screenshots in all three views of both fixtures.
