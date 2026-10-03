# sun-clouds.js

## Purpose

The look-dev page's probes of the clouds in front of the sun (round-3 plan
`GpsPlusSlamJs_Docs/docs/2026-09-27-0532-owner-feedback-round-3-plan.md`,
stream D): where the framework's CPU twins put the clouds, so a smoke test
picks a sky with a cloud of a known thickness in front of the sun (or over
a ground point) and measures the shader against the no-effect baseline at
the same pixels. Page-side test support only; the model lives in the
framework (`cloud-column.ts`, `cloud-sun.ts`).

## Public API

- `PAGE_DISC_EXPONENT` (4): the disc exponent the page opens with (page
  policy; the framework's default is 0).
- `createSunCloudProbe()` → `{ atSun, shadowAt }`, reading the sky's LIVE noise
  texture (`cloudUniforms.atmCloudTexture`'s data and width) with
  `cloudNoiseSample`.
  - `atSun(atmosphere, cameraPosition, sun)` → `{ tau, drawn, noise }`: the
    column's optical depth along the sun, the share of it the sky DRAWS
    there (the dome's horizon fade, or the sheet's and slab's far fade,
    times the aerial melt), and the noise read. The dome's clouds are
    camera-centred at the origin, the sheet's and slab's in the world: the
    same anchors the sky's disc reads. `{ tau: 0, drawn: 0, noise: null }`
    for a sun at or below the horizon or a clear sky.
  - `shadowAt(atmosphere, point)` → the share of the sun reaching a world
    point through the clouds, the same from every viewpoint: the cloud
    shadow patch's CPU twin (`SkyAtmosphere.cloudShadowToward`; owner bug
    report 2026-09-28, the shadows no longer depend on the camera).

## Invariants & assumptions

- The GPU reads the noise with mips; the disc's read is at level 0 (the
  twin's bilinear), the lit materials' at the level their derivatives
  pick, so `shadowAt` is exact near the camera and approximate far away.
- `drawn` is the framework's `cloudColumnDrawn`, the twin of the disc's
  GLSL weight. The cloud shadows carry no such weight: a ground point's
  shadow is its column toward the sun, whatever the camera sees.

## Example

```js
const probe = createSunCloudProbe();
probe.atSun(atmosphere, camera.position, sunVector()); // { tau, drawn, noise }
```

## Tests

- `sun-clouds.smoke.spec.mjs`: the offsets it picks give the disc and glow
  measurements their cloud (a wrong twin finds no offset, or measures the
  wrong sky, and the bounds fail).
