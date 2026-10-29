/**
 * The spherical cloud volume's ambient light (round-4 plan 2026-10-11-0122,
 * R4d; `globe-cloud-shell-volume-pass.ts`): the zenith sky's radiance seen
 * from the cloud deck, by the sun's cosine, from the framework's CPU sky.
 * The slab lights its clouds with ONE zenith (the ground sky's, for one
 * sun); the shell spans the terminator, so each of its samples reads this
 * table at its own sun. No three.js. Moved out of the globe lab as a pure
 * refactor.
 *
 * @see globe-cloud-shell-light.ts.md
 */
import { ATMOSPHERE_RADIANCE_SCALE } from "gps-plus-slam-app-framework/visualization/atmosphere/atmosphere-glsl";
import { psiLookupFor } from "gps-plus-slam-app-framework/visualization/atmosphere/atmosphere-fallback";
import { EARTH_ATMOSPHERE } from "gps-plus-slam-app-framework/visualization/atmosphere/atmosphere-model";
import { skyRadiance } from "gps-plus-slam-app-framework/visualization/atmosphere/atmosphere-scattering";

/** An [r, g, b] radiance in the sky-view table's units. */
export type ZenithRgb = readonly [number, number, number];

/** The table's sun cosines: from below the horizon to overhead. */
export const ZENITH_MU = Object.freeze({ from: -0.3, to: 0.9, entries: 13 });

/**
 * `zenithTable(60, 3)` baked: the lab's air (visibility 60 km) seen from
 * the cloud deck's 3 km. Computing it costs about 470 ms on the main thread
 * (the multi-scattering's first use), far over the 50 ms frame rule, so the
 * shell reads this; a unit test holds it to the computation. Below the
 * horizon the sky goes dark; from 0.9 up (64 degrees of sun) it is held
 * there, since the zenith direction then looks into the sun's aureole.
 */
export const ZENITH_TABLE: readonly ZenithRgb[] = Object.freeze(
  (
    [
      [0, 0, 0],
      [1.8568e-8, 2.0595e-9, 8.751e-12],
      [0.0099642, 0.0066702, 0.017295],
      [1.0226, 1.0934, 2.0675],
      [1.8252, 3.1659, 6.8948],
      [2.2112, 4.3498, 10.154],
      [2.5629, 5.284, 12.666],
      [2.8984, 6.092, 14.703],
      [3.2683, 6.9214, 16.695],
      [3.7164, 7.87, 18.884],
      [4.2253, 8.8749, 21.096],
      [4.9164, 10.088, 23.572],
      [6.3132, 12.033, 26.881],
    ] as const
  ).map((rgb): ZenithRgb => Object.freeze([rgb[0], rgb[1], rgb[2]] as const)),
);

/**
 * The zenith sky's radiance at `heightKm` over the ground, for an air of
 * `visibilityKm`, at each of `ZENITH_MU`'s sun cosines: [r, g, b] in the
 * sky-view table's units (a sun of ATMOSPHERE_RADIANCE_SCALE), the units
 * the slab's `atmCloudLit` adds its zenith in.
 *
 * @throws RangeError for a visibility that is not positive or a height
 *   that is not finite and >= 0.
 */
export function zenithTable(
  visibilityKm: number,
  heightKm: number,
): [number, number, number][] {
  if (!(visibilityKm > 0 && Number.isFinite(visibilityKm))) {
    throw new RangeError(
      `the visibility must be positive, got ${visibilityKm}`,
    );
  }
  if (!(heightKm >= 0 && Number.isFinite(heightKm))) {
    throw new RangeError(`the height must be finite and >= 0, got ${heightKm}`);
  }
  const params = { visibilityKm };
  const psi = psiLookupFor(params);
  const r = EARTH_ATMOSPHERE.groundRadiusKm + heightKm;
  const out: [number, number, number][] = [];
  for (let i = 0; i < ZENITH_MU.entries; i++) {
    const mu =
      ZENITH_MU.from +
      ((ZENITH_MU.to - ZENITH_MU.from) * i) / (ZENITH_MU.entries - 1);
    const [cr, cg, cb] = skyRadiance(r, 0, 0, mu, params, psi);
    out.push([
      cr * ATMOSPHERE_RADIANCE_SCALE,
      cg * ATMOSPHERE_RADIANCE_SCALE,
      cb * ATMOSPHERE_RADIANCE_SCALE,
    ]);
  }
  return out;
}
