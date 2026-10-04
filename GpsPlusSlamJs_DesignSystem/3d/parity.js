/**
 * GPU/CPU parity for the atmosphere's look-up tables (plan 2026-09-23-0048
 * §5, review finding 9).
 *
 * The LUT shaders cannot be tested in CI's Node (no GPU), and a wrong shader
 * does not error, it just draws a subtly wrong sky. So the page reads a
 * handful of texels back from each LUT and compares them with the framework's
 * CPU twin of the same computation. This is the only check that the GLSL
 * computes what the tested TypeScript computes.
 *
 * Expected differences, and why the tolerances are not zero:
 * - the LUTs are half floats (~0.1 % precision);
 * - the GPU reads transmittance and Ψ from LUTs bilinearly, where the CPU
 *   computes them exactly.
 *
 * Page-side test support only; nothing here ships in the framework.
 *
 * @see parity.js.md
 */
import { ATMOSPHERE_RADIANCE_SCALE } from "/fw/visualization/atmosphere/atmosphere-glsl.js";
import {
  MULTI_SCATTERING_LUT_SIZE,
  SKY_VIEW_LUT_SIZE,
  TRANSMITTANCE_LUT_SIZE,
  multiScatteringUvToParams,
  skyViewUvToParams,
  texelToUnit,
  transmittanceUvToParams,
} from "/fw/visualization/atmosphere/atmosphere-lut-mapping.js";
import {
  EARTH_ATMOSPHERE,
  transmittanceToTop,
} from "/fw/visualization/atmosphere/atmosphere-model.js";
import {
  multiScattering,
  skyRadiance,
} from "/fw/visualization/atmosphere/atmosphere-scattering.js";

const unit = (texel, size) => texelToUnit((texel + 0.5) / size, size);

/**
 * Relative error with a floor, so a texel whose true value is ~0 (a ray
 * grazing the planet) does not turn a harmless absolute error into infinity.
 */
function relativeError(gpu, cpu) {
  let worst = 0;
  for (let c = 0; c < 3; c++) {
    const floor = Math.max(Math.abs(cpu[c]), 1e-3 * Math.max(...cpu), 1e-6);
    worst = Math.max(worst, Math.abs(gpu[c] - cpu[c]) / floor);
  }
  return worst;
}

/** Compare sample texels of all three LUTs; returns the worst error per LUT. */
export function lutParity(atmosphere, { sunCosZenith }) {
  const params = {
    visibilityKm: atmosphere.visibilityKm,
    observerAltitudeKm: EARTH_ATMOSPHERE.defaultObserverAltitudeKm,
  };
  const samples = [];
  const check = (lut, x, y, cpu) => {
    const gpu = atmosphere.readLutTexel(lut, x, y);
    samples.push({ lut, x, y, gpu, cpu, error: relativeError(gpu, cpu) });
  };

  const T = TRANSMITTANCE_LUT_SIZE;
  for (const [x, y] of [
    [32, 16],
    [128, 32],
    [200, 48],
    [250, 8],
  ]) {
    const { r, mu } = transmittanceUvToParams(
      unit(x, T.width),
      unit(y, T.height),
    );
    check("transmittance", x, y, transmittanceToTop(r, mu, params));
  }

  const M = MULTI_SCATTERING_LUT_SIZE;
  const ground = EARTH_ATMOSPHERE.groundRadiusKm;
  const top = EARTH_ATMOSPHERE.topRadiusKm;
  for (const [x, y] of [
    [32, 2],
    [64, 10],
    [96, 4],
    [112, 20],
  ]) {
    const p = multiScatteringUvToParams(unit(x, M.width), unit(y, M.height));
    const r = Math.min(Math.max(p.r, ground + 0.001), top - 0.001);
    const psi = multiScattering(r, p.sunCosZenith, params).psi;
    check(
      "multiScattering",
      x,
      y,
      psi.map((v) => v * ATMOSPHERE_RADIANCE_SCALE),
    );
  }

  const S = SKY_VIEW_LUT_SIZE;
  const observer = ground + params.observerAltitudeKm;
  const psiLookup = (r, mu) => multiScattering(r, mu, params).psi;
  for (const [x, y] of [
    [30, 20],
    [96, 40],
    [150, 50],
    [60, 80],
  ]) {
    const v = skyViewUvToParams(observer, unit(x, S.width), unit(y, S.height));
    const radiance = skyRadiance(
      observer,
      v.viewZenithRad,
      v.deltaAzimuthRad,
      sunCosZenith,
      params,
      psiLookup,
    );
    check(
      "skyView",
      x,
      y,
      radiance.map((c) => c * ATMOSPHERE_RADIANCE_SCALE),
    );
  }

  const worst = (lut) =>
    Math.max(...samples.filter((s) => s.lut === lut).map((s) => s.error));
  return {
    transmittance: worst("transmittance"),
    multiScattering: worst("multiScattering"),
    skyView: worst("skyView"),
    samples,
  };
}

/** One linear channel → 8-bit sRGB, as the canvas stores it. */
function toSrgb8(linear) {
  const x = Math.min(1, Math.max(0, linear));
  const encoded = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return encoded * 255;
}

/**
 * The 8-bit sRGB colour the sky pass SHOULD draw in `direction`, from the CPU
 * model: sky radiance × the atmosphere's scene scale, no tone mapping.
 *
 * This is the only check of the sky pass's LOOKUP path (view direction →
 * sky-view LUT coordinate), its scale and its colour space; `lutParity` only
 * checks what the LUTs contain (M1 milestone review, finding 6).
 */
export function skyPixelExpected(atmosphere, { direction, sunDirection }) {
  const params = {
    visibilityKm: atmosphere.visibilityKm,
    observerAltitudeKm: EARTH_ATMOSPHERE.defaultObserverAltitudeKm,
  };
  const observer = EARTH_ATMOSPHERE.groundRadiusKm + params.observerAltitudeKm;
  const clamp = (x) => Math.min(1, Math.max(-1, x));
  const zenith = Math.acos(clamp(direction.y));
  const flat =
    Math.hypot(direction.x, direction.z) *
    Math.hypot(sunDirection.x, sunDirection.z);
  const deltaAzimuth =
    flat > 1e-9
      ? Math.acos(
          clamp(
            (direction.x * sunDirection.x + direction.z * sunDirection.z) /
              flat,
          ),
        )
      : 0;
  const psi = (r, mu) => multiScattering(r, mu, params).psi;
  const radiance = skyRadiance(
    observer,
    zenith,
    deltaAzimuth,
    sunDirection.y,
    params,
    psi,
  );
  const scale = ATMOSPHERE_RADIANCE_SCALE * atmosphere.radianceToScene;
  return radiance.map((c) => toSrgb8(c * scale));
}
