# globe-cloud-march-glsl.ts

Purpose: the near clouds' shaders: one ray march through the layer between the ground and about 3 km, from the coverage by the cloud map to the aerial perspective, and the shadow's column march.

## Public API

- `CLOUD_MARCH_VERTEX`, `CLOUD_MARCH_FRAGMENT`, `CLOUD_MARCH_SHADOW_FRAGMENT`: GLSL 3 sources for `globe-cloud-march-pass.ts`.
- `CLOUD_AIR_GLSL`: the air's functions (the sun's transmittance, the sky's radiance, a segment of air), shared with the composite in `globe-cloud-shell-volume-pass.ts`. It reads only `uH`, `uSun` and `uSunCol` and must be included after those are declared; everything else that needs a uniform stays in the march's own part.

## Invariants

- Generated from the accepted check page's shader, so differences stay small. Changes here are checked side by side with `GpsPlusSlamJs_TourViewer/public/prototypes/globe-look-12-map-clouds/`.
- Works in camera-relative kilometres over a sphere of radius R, y up at the camera.
- Every limit is a uniform and the loops run to fixed bounds: no shader swap for the distance scale or a step-down.
- Premultiplied output: radiance in rgb, opacity in alpha, no tone curve. The composite tones it.
- The coverage is read per step from the map as the shell reads it, so the map decides where the clouds are.
- Depth: rays end at the scene's depth where it is given.
- The air exists once: the march and the composite include the same block, so they cannot drift.

## Example

Used only through the pass.

## Tests

`globe-cloud-march-pass.test.ts` holds the uniforms' names against the sources; a real GPU compile happens in the browser runs of the globe's cloud checks.
