/**
 * The globe atmosphere's numbers and its frame (round-4 plan 2026-09-28-2105
 * DEC-GL4-4), kept free of imports so they are unit-tested under Node.
 *
 * @see globe-atmosphere-frame.js.md
 */

/**
 * The pass's look defaults (lab hash keys `atmoSteps`, `atmoStrength`,
 * `atmoThickness`) and their ranges:
 * - `steps`: samples per ray (2-64), a shader constant. 12 from the round-4
 *   sweep of 6-24 against a 64-sample reference: no count showed a ring
 *   (extra step at most 1.6 levels), the error against 64 flattens from
 *   12 on (limb 10.9 / 10.1 / 10.1 at 12 / 16 / 24, radial 5.4 / 4.6 /
 *   5.1), and 16 costs 15-40 % more frame time than 12.
 * - `coarseSteps`: the default on a coarse pointer (a phone, review B5):
 *   8, where the march cost x3.9 against x4.6 at 12 (phone tier, pixel
 *   ratio 2, SwiftShader) with no ring measured.
 * - `strength`: a scale on the physical light (0-4), 1 = as computed for
 *   the scene's sun.
 * - `thickness`: how many times thicker than the real air the shell is
 *   drawn (1-10), its steps weighted so a ray keeps the real air's
 *   optical depth (`grazingCompensation`), so the colours stay and only
 *   the band and the halo widen. 1 = the real 100 km. 6 by
 *   default (owner decision DEC-GL4-11: as wide as the reference image,
 *   the slider back down to physical): a 600 km shell, about the depth of
 *   the reference's bright inner band (10 % of the radius); the halo then
 *   fades to 12 levels by 300 km out, against 0 by 150 km at 1.
 * - `visibilityKm`: the air's clarity for the aerosol density, the
 *   framework's own default (60 km).
 */
export const GLOBE_ATMOSPHERE = {
  steps: 12,
  coarseSteps: 8,
  strength: 1,
  thickness: 6,
  visibilityKm: 60,
};

/**
 * The default samples per ray for a device: `coarseSteps` where the
 * primary pointer is coarse (a touch screen), `steps` otherwise.
 */
export const defaultAtmosphereSteps = (coarsePointer) =>
  coarsePointer ? GLOBE_ATMOSPHERE.coarseSteps : GLOBE_ATMOSPHERE.steps;

const RANGES = {
  steps: [2, 64],
  strength: [0, 4],
  thickness: [1, 10],
};

/**
 * The look, each value from `input` or the default, the steps rounded.
 * RangeError for a value outside its range or not a finite number (the
 * steps become a loop bound in the shader, so a bad one must not reach it).
 */
export function atmosphereLook(input) {
  const look = {};
  for (const key of Object.keys(RANGES)) {
    const raw = input[key] ?? GLOBE_ATMOSPHERE[key];
    const value = key === "steps" ? Math.round(raw) : raw;
    const [min, max] = RANGES[key];
    if (!(Number.isFinite(value) && value >= min && value <= max)) {
      throw new RangeError(
        `atmosphere ${key} must be ${min}-${max}, got ${raw}`,
      );
    }
    look[key] = value;
  }
  return look;
}

/**
 * Chapman's grazing-incidence function in its common approximation,
 * 1 / (mu + 1 / sqrt(pi x / 2)): the optical depth of a ray through an
 * exponential layer, in units of the layer's vertical depth, for x = the
 * radius over the scale height and mu the ray's zenith cosine where it
 * is lowest (0 at the limb). Exact at mu = 0 (sqrt(pi x / 2)), 1 / mu for
 * a steep ray.
 */
export const chapman = (x, mu) =>
  1 / (Math.max(mu, 0) + 1 / Math.sqrt((Math.PI * x) / 2));

/** Ch(x, mu) / Ch(x / k, mu): the unnormalised ratio. */
const chapmanRatio = (k, mu, x) => chapman(x, mu) / chapman(x / k, mu);

/**
 * How much more optical depth a ray needs in a shell drawn k times thicker
 * (scale height k H, density 1 / k) to match the real air's (review B2):
 * Ch(x, mu) / Ch(x / k, mu), with x = R / H, NORMALISED by its value
 * straight down (review m3: the approximation is 1-3 % off for a vertical
 * ray, which would otherwise read as a 1.04-1.06 weight). Exactly 1 at
 * k = 1 and for a vertical ray; about sqrt(k) at the limb (2.36 at k = 6);
 * monotonic between. `mu` is the ray's zenith cosine at its LOWEST point
 * in the air (`lowestPointMu`); Rayleigh and Mie each use their own x.
 */
export const grazingCompensation = (k, mu, x) =>
  chapmanRatio(k, mu, x) / chapmanRatio(k, 1, x);

/**
 * The zenith cosine (unsigned) of a ray where it is lowest within its
 * span [tEnter, tEnd] (review M1): at the point nearest the centre,
 * clamped into the span. From space that is the limb's tangent point (0)
 * or the ground hit (its slant); from inside the shell a ray going up is
 * lowest at the camera, where it climbs (1 straight up). `o` and `dir`
 * are [x, y, z] from the centre, `dir` a unit vector.
 */
export function lowestPointMu(o, dir, tEnter, tEnd) {
  const b = o[0] * dir[0] + o[1] * dir[1] + o[2] * dir[2];
  const t = Math.min(tEnd, Math.max(tEnter, -b));
  const p = [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t];
  const len = Math.hypot(p[0], p[1], p[2]);
  return Math.abs(p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2]) / len;
}

/**
 * The GLSL twins of `chapman`, `grazingCompensation` and
 * `lowestPointMu` (the pass's march includes them).
 */
export const CHAPMAN_GLSL = /* glsl */ `
float atmChapman( float x, float mu ) {
  return 1.0 / ( max( mu, 0.0 ) + inversesqrt( 0.5 * 3.141592653589793 * x ) );
}
float atmChapmanRatio( float k, float mu, float x ) {
  return atmChapman( x, mu ) / atmChapman( x / k, mu );
}
float atmGrazingCompensation( float k, float mu, float x ) {
  return atmChapmanRatio( k, mu, x ) / atmChapmanRatio( k, 1.0, x );
}
float atmLowestPointMu( vec3 o, vec3 dir, float tEnter, float tEnd ) {
  float t = clamp( -dot( o, dir ), tEnter, tEnd );
  return abs( dot( dir, normalize( o + dir * t ) ) );
}`;

/**
 * Per-axis factors from ECEF metres to the model's frame in km, in which
 * the ellipsoid (radii `[a, b, c]` in metres) IS the model's ground sphere
 * of `groundKm`: x by groundKm / a, y by groundKm / b, z by groundKm / c.
 * An affine map keeps rays straight, so the pass can intersect spheres
 * analytically; the lengths it distorts differ by the flattening (0.34 %),
 * far below the look's tolerance. RangeError for a radius that is not a
 * positive finite number.
 */
export function ellipsoidToModel([a, b, c], groundKm) {
  for (const r of [a, b, c, groundKm]) {
    if (!(r > 0 && Number.isFinite(r))) {
      throw new RangeError(
        `ellipsoid radii and ground must be positive, got ${[a, b, c]}, ${groundKm}`,
      );
    }
  }
  return [groundKm / a, groundKm / b, groundKm / c];
}
