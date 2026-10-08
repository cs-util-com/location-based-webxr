# globe-detail.ts - the relief's detail colour

- Purpose: globe round-5 F1. The relief's tiles (`globe-terrain.ts`) wear
  the globe's imagery. This module multiplies a detail factor into that
  colour: `globe-albedo`'s high-pass of the terrain lab's style B against
  the imagery's footprint, as a grid over a region. The terrain lab
  computes the grid (`labs/terrain/terrain-detail-grid.js`); the globe lab
  sets it. The detail is off until a grid is set.
- Public API:
  - `GLOBE_DETAIL` - `metresPerDegLat` 110,946.26 and `metresPerDegLngEquator` 111,319.49 (the
    lab's `enuFrameAt`, the AR core's numbers since 2026-10-06; both were
    111,320)
    and `fadeFrom` 0.9 (the detail fades out from 90 % of the drawn half
    extent to 0 at its edge, so no step shows where it ends).
  - `createGlobeDetailUniforms()` - the uniforms every relief tile shares:
    - `uDetail`: a 1 x 1 factor of 1 until a grid is set;
    - `uDetailOn`: 0;
    - `uDetailRegion`: (centre latitude, centre longitude in degrees,
      `extentM`, `side`);
    - `uDetailHalfM`.
  - `setGlobeDetail(uniforms, grid | null, centre)` - holds `grid.ratio`
    (`side`^2 factors, row 0 south, post 0 at -`extentM`) as a half-float
    red texture, linearly filtered and clamped to its edge, and switches
    the detail on. `null` switches it off. The previous texture is
    disposed either way. RangeError for a wrong-sized grid or
    non-positive extents.
  - `detailPlace(latDeg, lngDeg, centre, grid)` -> `{ u, v, fade }`: the
    shader's mapping, for tests. Each of the lab's posts lands at its
    texel's centre. The longitude difference is taken the short way round.
  - `DETAIL_DECLARATIONS` (after `#include <common>`) and `DETAIL_FRAGMENT`
    (after `#include <map_fragment>`, with the imagery's linear colour in
    `diffuseColor`).
    - It reads the globe patch's `vGeoNormal` (the geodetic normal) and
      maps it to the lab's equirectangular ENU.
    - It multiplies the colour by the factor, faded by `uDetailOn` and the
      edge fade.
    - Multiplying the albedo is the lab's multiplying of the light: both
      are linear before the tone mapping.
- Invariants & assumptions:
  - The shader mapping must equal the lab's post placement; the twin
    `detailPlace` is tested against posts placed the lab's way.
  - The texture is half float, which filters linearly on every WebGL2
    device (a float32 texture would need OES_texture_float_linear).
- Tests: `globe-detail.test.ts` (posts at texel centres, the fade, the
  date line, the texture's format, filter and values, off and dispose,
  the size refusal, the shader's constants); `globe-terrain.test.ts` (the
  relief tiles carry the patch and share the uniforms).
