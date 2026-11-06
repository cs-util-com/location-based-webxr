# globe-sea.ts

- Purpose: the globe's sea. Waves, their slopes, Fresnel reflection of the
  production sky, the sun's glint and the water's own colour, drawn over the
  lit surface wherever the surface's water mask says water, from the coast
  to where the waves hand over to the flat glint with height.

- Public API:
  - `GLOBE_SEA`: the sea's table. `windMps`, `windEastNorth`, `fadeKm` (the
    height band over which the share falls), `noiseCells`, `maxOctaves`,
    the octaves' turn, stretch and speed.
  - `createGlobeSeaUniforms()`: the uniforms, spread into the surface's one
    uniforms object (`globe-surface-material.ts`).
  - `globeSeaShareAt(altitudeKm)`: 1 up to `fadeKm[0]`, 0 from `fadeKm[1]`,
    smooth between; NaN reads as 0.
  - `seaSlopeVariance(windMps)`: Cox and Munk's slope variances.
  - `seaFresnel(cosine)`: water's unpolarised Fresnel reflectance.
  - `seaWavePhase(cameraWindM, timeS, octave, shortestWaveM)` and
    `seaWaveCoord(atM, phase, octave, shortestWaveM)`: the wave coordinates,
    one in doubles on the CPU, one as the shader computes it. Together they
    are the property test's statement of "the waves stay put on the sea".
  - `GLOBE_SEA_SHADOW_GLSL`: the named shadow interface,
    `float globeSeaSunShadow( float cloudShadow )`.
  - `GLOBE_SEA_DECLARATIONS_GLSL`, `GLOBE_SEA_FRAGMENT_GLSL`: the shader, for
    the surface's patch. They need `#define GLOBE_SEA_OCTAVES n`.
  - `createGlobeSea(uniforms, options)`: a `GlobeSea`, `{ setSky, setOn,
step, state }`. Throws `RangeError` on a quality the shader cannot draw.
    `step(frame)` throws `RangeError` on a time that is not finite.

- Invariants & assumptions:
  - **The waves are noise in a frame that wraps.** The shader gets metres
    from the camera (exact in floats) and, per octave, a phase. The phase
    holds the camera's travel along the wind's frame and the waves' own run,
    computed in doubles and wrapped to the noise's period, so a far camera
    or a long clock never loses float precision. The noise is periodic in
    `noiseCells`, so the wrap shows nothing.
  - **The sky is the production atmosphere's sky-view table**, read at the
    camera's height, with the sun's plane as its azimuth. Without a sky
    (`setSky(null)`: a page with no ground sky) the sea stays off and the
    flat glint stays, since a dark sea is worse than a plain one.
  - The atmosphere's GLSL is compiled here under `seaAtm*` / `SEA_ATM_*`
    names, because the haze declares the same functions on the relief's
    programs.
  - **Cloud shadow reaches the sea only through `globeSeaSunShadow`.** The
    painted shell's shadow is what fills it today. The near clouds fill the
    same function later; the sea's code then does not change.
  - The waves' octaves come from the quality (`globe-quality.ts`): the count
    is compiled, so a tier is its own program. Octaves too short to resolve
    at a pixel fade out, and their slopes pass into the rough glint's
    variance, so the far sea keeps its energy.
  - **Height:** the share is whole up to 20 km and gone at 60 km. Inside the
    band the sea and the old flat water are mixed; the picture stays the
    air's. Measured over the open ocean at three sun heights, 200 km to
    1 km, cloud-free: the mean colour with the sea stays within 3 levels a
    channel of the flat water's above 10 km, and within 8 at 1 km.
  - The sea covers a pixel by `smoothstep( 0.5, 1.0, globeWater )`, less a
    painted cloud and less the drawn street map (`globeMapShare`, written
    by `globe-osm-overlay.ts`).
  - The framework's water (`water-surface-material.ts`, `water-polish.ts`)
    is not reused: it is a local plane of travelling waves on three's
    standard material. This one is a planet's sea in ECEF with a slope
    statistic per distance and the atmosphere's sky.

- Example:

  ```ts
  const uniforms = createGlobeSeaUniforms();
  const sea = createGlobeSea(uniforms, { waveOctaves: 8, shortestWaveM: 8 });
  sea.setSky(groundSky.atmosphere?.sharedUniforms ?? null);
  sea.step({ position, quaternion, altitudeKm, timeS, pixelRad });
  ```

  `createGlobeView` owns all of this; a page only passes `sea: false` to do
  without it, and hands it the sky (`mountGlobeViewAir` does).

- Tests:
  - `globe-sea.test.ts`: the share, the slopes, Fresnel, the sky gate, the
    switch, the ECEF rotation, the wind in the sea's plane (the pole too),
    the phase's wrap and the camera's travel.
  - `globe-sea.property.test.ts`: a point of the sea keeps its coordinate
    under any camera travel, and the waves run at their octave's speed.
  - `DesignSystem/labs/globe/globe-sea.smoke.spec.mjs`: compiles at the high
    and low tiers, waves at 2 km, gone from 60 km, land untouched.
