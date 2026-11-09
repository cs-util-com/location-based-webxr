# v4-phone-ar.js

## Purpose

The V4 page: the look for the phone and AR, where no screen-space pass can run. `postprocess: "none"`; the wall-foot darkening is the labelled look being tested.

## Public API

None; a page entry. Link values on top of the harness's: `foot`, `footh`, `line`, `win`, `eave`.

## Invariants and assumptions

- Regroups the library's volumes and barriers by its own chunk key, so draw calls and triangles equal V0.
- One shared material for all chunks.
- Tags: a part's own over its parent's for colour and class, its own only for levels.
- Controls change uniforms only.
- Only this page shows the wall-foot darkening.

## Example

`/labs/city-look/v4-phone-ar/index.html?scene=heidelberg&view=street&foot=0.3&footh=1.6`

## Tests

Pure parts in `v4-facade.test.mjs`; the page is checked by screenshots against V0.
