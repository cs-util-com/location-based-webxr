/**
 * Exposure for a physical sky: how much light falls on the scene, and how a
 * camera would expose for it.
 *
 * WHY THIS EXISTS. The first look-dev screenshots (2026-09-23) showed that no
 * fixed exposure works: daylight spans ~6 orders of magnitude between noon and
 * blue hour, so the presets came out murky, black or blown out. A physical sky
 * needs what a camera has, an exposure that follows the light.
 *
 * WHAT IS MEASURED: the illuminance on a HORIZONTAL surface, i.e. the direct
 * sun (from the CPU model) plus the sky's irradiance, integrated from the
 * sky-view LUT that the GPU has just rendered. That LUT is read back once per
 * sun change anyway (for the horizon colour), so the measurement is free.
 *
 * PARTIAL ADAPTATION: exposure ∝ E^(−α) with α < 1, not E^(−1). A camera or an
 * eye that fully adapted would render blue hour as bright as noon, and it
 * would stop reading as twilight. α is a taste parameter, swept on the page.
 *
 * Units: everything here is RELATIVE to the sun at the reference elevation
 * (`SkyAtmosphere`'s `sunIntensity` = 1). A caller in scene units divides by
 * its sun intensity first.
 *
 * @see atmosphere-exposure.ts.md
 */

import {
  skyViewParamsToUv,
  skyViewUvToParams,
  texelToUnit,
  unitToTexel,
} from './atmosphere-lut-mapping.js';
import { EARTH_ATMOSPHERE, type Rgb } from './atmosphere-model.js';

/** Auto-exposure parameters. Chosen on the look-dev page; see the sidecar. */
export const AUTO_EXPOSURE = {
  /** Scene-linear value a mid-grey (18 %) surface renders at, ÷ 0.18. */
  key: 1,
  /** Illuminance (relative) at which exposure is exactly π · key / E. */
  referenceIlluminance: 1,
  /** 0 = fixed exposure, 1 = full adaptation. */
  adaptation: 0.75,
  /** Floor on the illuminance, so darkness gives a large finite exposure. */
  minimumIlluminance: 1e-7,
} as const;

/** Unit-space edges of texel `i` of `size`, clamped to `[lo, hi]`. */
function edges(
  i: number,
  size: number,
  lo: number,
  hi: number
): [number, number] {
  const a = texelToUnit(i / size, size);
  const b = texelToUnit((i + 1) / size, size);
  return [Math.min(hi, Math.max(lo, a)), Math.min(hi, Math.max(lo, b))];
}

/**
 * Irradiance on a horizontal surface from the sky-view LUT, per channel, in
 * the LUT's radiance units.
 *
 * Each texel covers a band between two zenith angles and two azimuths, and
 * the cosine-weighted solid angle of such a band is exact:
 * ∫∫ cos z · sin z dz da = Δa · (sin² z₁ − sin² z₀) / 2. Summing exact bands
 * (rather than centre × area) is what makes a uniform sky integrate to π · L
 * despite the LUT's quadratic spacing. The LUT covers azimuth [0, π] (the sky
 * is symmetric about the sun's plane), so every band counts twice. Only the
 * rows above the horizon (v < 0.5) and zenith angles up to 90° contribute.
 */
export function skyIrradiance(
  rgba: Float32Array,
  width: number,
  height: number,
  r: number
): Rgb {
  const e = [0, 0, 0];
  for (let y = 0; y < height / 2; y++) {
    const [v0, v1] = edges(y, height, 0, 0.5);
    const z0 = Math.min(Math.PI / 2, skyViewUvToParams(r, 0, v0).viewZenithRad);
    const z1 = Math.min(Math.PI / 2, skyViewUvToParams(r, 0, v1).viewZenithRad);
    const band = (Math.sin(z1) ** 2 - Math.sin(z0) ** 2) / 2;
    if (band <= 0) continue;
    for (let x = 0; x < width; x++) {
      const [u0, u1] = edges(x, width, 0, 1);
      const da = 2 * Math.PI * (u1 * u1 - u0 * u0);
      const i = (y * width + x) * 4;
      e[0]! += rgba[i]! * band * da;
      e[1]! += rgba[i + 1]! * band * da;
      e[2]! += rgba[i + 2]! * band * da;
    }
  }
  return [e[0]!, e[1]!, e[2]!];
}

/**
 * The sky at the horizon the screen shows, averaged over azimuth, in LUT
 * units: at dir.y = `horizonClampDirY`, the height the visible sky and the
 * haze clamp to, so `scene.fog` gets the colour actually drawn there.
 * (Reading the row nearest the geometric horizon instead was 2...2.8x off the
 * drawn horizon at dawn and blue hour.) That height falls between two rows,
 * which are blended linearly. Columns are weighted by the azimuth they span:
 * they are spaced as u², denser toward the sun, and an unweighted mean would
 * over-count the bright sun side.
 *
 * @param r observer radius, km (the LUT mapping depends on it).
 */
export function horizonAverage(
  rgba: Float32Array,
  width: number,
  height: number,
  r: number
): Rgb {
  const zenith = Math.acos(EARTH_ATMOSPHERE.horizonClampDirY);
  const v = unitToTexel(skyViewParamsToUv(r, zenith, 0).v, height);
  const row = Math.min(height - 1, Math.max(0, v * height - 0.5));
  const below = Math.floor(row);
  const above = Math.min(height - 1, below + 1);
  const t = row - below;
  const sum = [0, 0, 0];
  let total = 0;
  for (let x = 0; x < width; x++) {
    const [u0, u1] = edges(x, width, 0, 1);
    const weight = u1 * u1 - u0 * u0;
    const a = (below * width + x) * 4;
    const b = (above * width + x) * 4;
    for (let c = 0; c < 3; c++) {
      sum[c]! += (rgba[a + c]! * (1 - t) + rgba[b + c]! * t) * weight;
    }
    total += weight;
  }
  return total > 0
    ? [sum[0]! / total, sum[1]! / total, sum[2]! / total]
    : [0, 0, 0];
}

/**
 * The exposure a partially adapting camera picks for a horizontal
 * illuminance (relative units, see the header).
 *
 * At the reference illuminance, a mid-grey horizontal surface renders at
 * `0.18 · key`. Away from it, exposure scales as E^(−α).
 */
export function autoExposure(illuminance: number): number {
  const a = AUTO_EXPOSURE;
  const e = Math.max(
    Number.isFinite(illuminance) ? illuminance : 0,
    a.minimumIlluminance
  );
  const base = (Math.PI * a.key) / a.referenceIlluminance;
  return base * (a.referenceIlluminance / e) ** a.adaptation;
}
