# sun-altitude-lighting.ts

## Purpose

Maps the sun's altitude angle (radians, as returned by `SunCalc.getPosition`)
to a physically motivated lighting model that mimics how real-world illumination
changes throughout the day. The module encapsulates the full altitude → light
pipeline so that rendering code never has to inline altitude thresholds or colour
maths.

Consumes `altitudeRad` from [`sun-position.ts`](sun-position.ts) and produces
three scalar/colour outputs that can be forwarded directly to a Three.js
`DirectionalLight` (or equivalent).

## Public API

```ts
/** RGB colour of the direct sunlight as a hex integer (0xRRGGBB). */
export type LightColor = number;

/** Lighting outputs derived from a single sun altitude sample. */
export interface SunLightingResult {
  /**
   * Direct-light intensity in the range [0, 1].
   * 0 = no direct light (night / below horizon);
   * 1 = full midday intensity.
   */
  readonly intensity: number;

  /**
   * Colour of the direct light as a 24-bit hex integer (for Three.js Color /
   * MeshStandardMaterial emissive).
   * Warm orange near the horizon, white at zenith, deep blue-violet during
   * astronomical twilight.
   */
  readonly color: LightColor;

  /**
   * Ambient (sky) light level in the range [0, 1].
   * Always >= intensity (sky is never darker than direct sun).
   * Represents scattered/diffuse skylight and stays elevated during civil
   * twilight even when the sun is below the horizon.
   */
  readonly ambientLevel: number;
}

/**
 * Derive a lighting model from a sun altitude angle.
 *
 * @param altitudeRad - Sun altitude in radians [-pi/2, pi/2].
 *   Negative values indicate the sun is below the horizon.
 *   Obtained from SunCalc.getPosition(date, lat, lng).altitude.
 * @returns SunLightingResult with intensity, color, and ambientLevel.
 */
export function sunAltitudeToLighting(altitudeRad: number): SunLightingResult;
```

## Altitude -> Lighting Phase Map

The function partitions the altitude domain into five named phases. Transitions
between adjacent phases are smoothly interpolated (no hard cuts).

| Phase                 | Altitude range (deg) | Altitude range (rad) | Key characteristics                                               |
| --------------------- | -------------------- | -------------------- | ----------------------------------------------------------------- |
| Night                 | < -18 deg            | < -0.314             | intensity = 0, ambient ~0.02 (star/moon glow), deep navy color    |
| Astronomical twilight | -18 deg to -6 deg    | -0.314 to -0.105     | intensity = 0, ambient ramps 0.02->0.15, blue-violet color        |
| Civil twilight / dawn | -6 deg to 0 deg      | -0.105 to 0          | intensity ramps 0->0.15, ambient 0.15->0.35, orange-red color     |
| Golden hour           | 0 deg to 6 deg       | 0 to 0.105           | intensity 0.15->0.55, ambient 0.35->0.65, warm amber/orange color |
| Daytime               | > 6 deg              | > 0.105              | intensity ramps to 1.0, ambient ramps to 1.0, white-yellow color  |

Colour temperature follows a physically based progression:

```
Night      #0a0a1e  (deep navy)
Astro twi  #1a1040  (blue-violet)
Civil twi  #ff6020  (orange-red)
Golden hr  #ffb060  (warm amber)
Daytime    #fff5e0  (warm white)
Zenith     #ffffff  (pure white)
```

## Invariants & Assumptions

- Input is in **radians** to match the `SunPositionResult.altitudeRad` field
  directly; no degree conversion is needed at the call site.
- Output `intensity` and `ambientLevel` are always in `[0, 1]`.
- `ambientLevel >= intensity` at every altitude (scattered sky is never
  darker than the direct beam).
- `color` is a 24-bit integer (`0xRRGGBB`) compatible with `THREE.Color` and
  `THREE.DirectionalLight.color.set(color)`.
- Non-finite `altitudeRad` (NaN, +/-Infinity) is treated as night
  (intensity = 0, ambientLevel = 0.02) and does not throw.
- The function is **pure** (no side-effects, no global state). Suitable for
  calling every animation frame.
- Phase boundaries use smoothstep-style interpolation so colour and intensity
  curves have zero derivative at their endpoints — no visible kinks when the sun
  crosses a boundary at low angular velocity.

## Examples

```ts
import { calculateSunPosition } from './sun-position.js';
import { sunAltitudeToLighting } from './sun-altitude-lighting.js';

const { altitudeRad } = calculateSunPosition(new Date(), 51.5, -0.1);
const { intensity, color, ambientLevel } = sunAltitudeToLighting(altitudeRad);

// Apply to a Three.js scene
directionalLight.intensity = intensity;
directionalLight.color.set(color);
ambientLight.intensity = ambientLevel;

// Midday at the equator (altitudeRad ~= 1.3)
sunAltitudeToLighting(1.3);
// => { intensity: 1.0, color: 0xffffff, ambientLevel: 1.0 }

// Sunrise (altitudeRad ~= 0.03)
sunAltitudeToLighting(0.03);
// => { intensity: ~0.20, color: 0xffb060, ambientLevel: ~0.40 }

// Night (altitudeRad = -0.5)
sunAltitudeToLighting(-0.5);
// => { intensity: 0, color: 0x0a0a1e, ambientLevel: 0.02 }
```

## Tests

- `sun-altitude-lighting.test.ts` — phase boundary values (night, astro, civil,
  golden, daytime), monotonicity of intensity and ambientLevel across the full
  altitude sweep, `ambientLevel >= intensity` invariant at every sample,
  colour channel progression (red/green/blue trends per phase), non-finite
  input defensiveness (NaN, +Infinity, -Infinity).
- `sun-altitude-lighting.property.test.ts` — property-based sweep
  over `altitudeRad in [-pi/2, pi/2]` asserting output ranges and ordering
  invariants.

## Consumers

- `GpsPlusSlamJs_SunPositionDemo` — feeds `sunAltitudeToLighting` output into a
  Three.js `DirectionalLight` to demonstrate real-time sky colour changes.
- `GpsPlusSlamJs_VisibleSunDiscDemo` — combines this module with
  `visible-sun-disc.ts` to tint the disc and scene according to altitude.
- Future sky-shader integration: `intensity` and `color` are designed to map
  directly to a Preetham / Hosek-Wilkie sky model's sun irradiance parameters.
