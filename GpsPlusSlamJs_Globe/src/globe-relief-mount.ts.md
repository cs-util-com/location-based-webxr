# globe-relief-mount.ts

- Purpose: the relief mounted under the globe's surface - the band
  between the two carriers of the ground, its release, the stencil fill,
  who is drawn and updated, and the cloud shell's share - as one
  implementation for every page that draws both carriers: the globe lab
  (`labs/globe/globe-lab.js`) and the Tour Viewer's editor on the globe
  (`editor3d/editor3d-globe.ts`). Moved out of the lab, which drew the
  same frames before the move.

## Public API

- `GLOBE_RELIEF_BAND` - the band's defaults (the lab's): `highM`
  2,000 km and `lowM` 1,200 km (`GLOBE_FLIGHT.bandHighM` / `bandLowM`),
  `gate` and `sharp` true, `releaseMs` 5,000, `drainTiles` 8,
  `fillErrorTarget` 1e6.
- `mountGlobeRelief({ globe, relief, fill, log?, mark? })` returns a
  `GlobeReliefMount`:
  - `step(nowMs, frame)` - the band's share at `frame.altitudeM` (a
    negative altitude counts as 0; `fixedShare` in its place where
    given), written to `globe.surfaceUniforms.uCarrierShare`; then the
    release (held while `frozen`). Returns the share. Every other field
    defaults to `GLOBE_RELIEF_BAND`; `lowM` is kept under `highM`.
  - `draw({ camera, renderer, updateRelief, errorTarget?,
fillErrorTarget?, reliefHidden? })` - after `step`:
    - the globe's group visible with `fill` or a share under 1;
    - with `fill`, the globe's error target is `fillErrorTarget` while
      the relief has every pixel and the altitude wants it to (share and
      target both 1), else `errorTarget` (default: the one it had when
      mounted);
    - `globe.update` where the globe draws or the altitude wants it to,
      and always with `fill`; `updateRelief()` where the relief has a
      share or the altitude wants one; neither while frozen;
    - the relief's group visible with a share and not `reliefHidden`.
  - `shareClouds(on, flat)` - `globe.setCloudShellShare(on ? share : 0,
flat)`; returns that share (the page's cloud shadow is scaled by it).
  - `share()`, `target()` - the band's drawn share (1 before the first
    step) and the altitude's share before the gate.
  - `release` - the live `BandRelease` (`released`, `outOfBand`,
    `settled()`) for a page's readers.
  - `reliefSettled()` - nothing of the relief loading or queued.
  - `dispose()` - takes the stencil fill's `load-model` listeners off.

## Invariants and assumptions

- With `fill` the relief's group gets `renderOrder` -1 (it draws first)
  and every mesh either carrier loads from then on gets its stencil role
  (`asStencilWriter` on the relief, `asStencilFill` on the globe). Mount
  before either loads, and before any other `load-model` patch that must
  run after the roles (the cloud shadow, the haze). The page's renderer
  needs a stencil buffer (`createGlobeView({ stencil: true })`), and the
  surface must be made with `band: true` (its tiles discard by
  `uCarrierShare`).
- A drain keeps a carrier's coarsest tiles (depth 0 and 1) and any tile
  its last update used, so a carrier that comes back has its top level
  at once and a drain never unloads what is drawn.
- The share is the band's only owner: pages read it through `share()`,
  never keep a copy.
- Defensive: the band and the release validate their own inputs
  (`globe-band-step.ts`); the mount adds no state a frame can corrupt
  beyond `frozen`, which each `step` sets again. What the tiles
  renderer's typings (3d-tiles-renderer 0.5.3) leave out is checked once,
  when mounted, for both carriers: a TypeError naming the missing member
  if `frameCount` is not a number, or the cache's `cachedBytes` is not a
  number or its `itemList` not an array. So `GlobeReliefTiles` declares
  only what the typings declare, and the library's `TilesRenderer` is
  passed as it is.

## Example

```ts
const mount = mountGlobeRelief({ globe, relief: terrain, fill: true });
// each frame
mount.step(now, { altitudeM });
mount.draw({
  camera,
  renderer,
  updateRelief: () => ground.update(camera, renderer, now),
});
mount.shareClouds(true, flat);
```

## Tests

- `globe-relief-mount.test.ts`: the refusal of tiles without a frame
  count or cache list, the share swept over 6,000 to 0 km
  against `carrierShareAt`, the band's edges, the gated start, the
  stencil roles and their dispose, the draw and update table with and
  without the fill at 6,000, 1,600 and 10 km, the error targets, frozen
  and hidden frames, `shareClouds`, a drain keeping depths 0 and 1, and
  `reliefSettled`.
- The lab's own smokes and e2e (`labs/globe`) cover the mount in a
  browser; the Tour Viewer's `editor3d-globe.test.ts` covers the
  editor's wiring.
