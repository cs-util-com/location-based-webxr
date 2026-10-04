/**
 * The sun through clouds (round-3 plan 2026-09-27-0532, stream D;
 * DEC-FB3-6): how the sun DISC and the light scattered FORWARD out of a
 * cloud look when a cloud is in front of the sun. CPU twins and their GLSL.
 *
 * - **The disc dims much faster than the sky behind the cloud.** The disc is
 *   ~15 000 times brighter than the sky around it, so dimming it only as much
 *   as the diffuse sky (by the cloud's opacity) left a blazing disc behind
 *   every cloud: a pixel stays white until the disc is dimmed ~1e-5. The disc
 *   passes e^(-k·τ) = T^k of the column's optical depth τ along the view
 *   (`cloud-column.ts`), with k the extinction exponent (0 = off).
 * - **Thin cloud glows around the sun.** Light scattered once on its way
 *   through a cloud leaves it mostly forward: the share is τ·e^(-τ) (none in
 *   the clear, none through a thick cloud, most at τ = 1), spread by a
 *   forward phase of two lobes: a narrow aureole around the sun and a broad
 *   one that makes thin, backlit cloud edges brighter (the silver lining).
 *
 * @see cloud-sun.ts.md
 */

import { glslFloat } from '../../utils/glsl-float.js';

/** The forward-scattering model's constants. */
export const CLOUD_SUN = {
  /** The narrow lobe's asymmetry: the aureole, a few degrees around the sun. */
  aureoleG: 0.9,
  /** The broad lobe's: the silver lining, thin edges up to ~30° away. */
  silverG: 0.6,
  /** The aureole's share of the phase (the rest is the silver lining's). */
  aureoleShare: 0.5,
} as const;

/** One lobe: a normalised single-lobe phase of asymmetry g, per steradian. */
function lobe(cosTheta: number, g: number): number {
  const g2 = g * g;
  return (1 - g2) / (4 * Math.PI * Math.pow(1 + g2 - 2 * g * cosTheta, 1.5));
}

/**
 * The forward phase, per steradian, integrating to 1 over the sphere: the
 * aureole's lobe and the silver lining's, mixed by `aureoleShare`. GLSL
 * twin: `atmForwardPhase`.
 *
 * @throws RangeError for a cosine outside [-1, 1] or not finite.
 */
export function cloudForwardPhase(cosTheta: number): number {
  if (!(Number.isFinite(cosTheta) && Math.abs(cosTheta) <= 1)) {
    throw new RangeError(`cos θ must be in [-1, 1], got ${cosTheta}`);
  }
  const s = CLOUD_SUN.aureoleShare;
  return (
    s * lobe(cosTheta, CLOUD_SUN.aureoleG) +
    (1 - s) * lobe(cosTheta, CLOUD_SUN.silverG)
  );
}

/**
 * The share of the sun a cloud of optical depth τ (along the view) scatters
 * once toward the viewer: τ·e^(-τ). 0 in the clear and through a thick
 * cloud, at most 1/e (at τ = 1). GLSL twin: `atmForwardShare`.
 *
 * @throws RangeError for a negative or non-finite τ.
 */
export function cloudForwardShare(tau: number): number {
  if (!(Number.isFinite(tau) && tau >= 0)) {
    throw new RangeError(`optical depth must be finite and ≥ 0, got ${tau}`);
  }
  return tau * Math.exp(-tau);
}

/**
 * The forward phase with each lobe at its own strength (the aureole's and
 * the silver lining's; 0 = off, 1 = the model): at (1, 1) it is
 * `cloudForwardPhase`. GLSL twin: `atmForwardPhase(cosTheta, strengths)`.
 *
 * @throws RangeError for a negative or non-finite strength, and as the
 *   phase does.
 */
export function cloudForwardPhaseOf(
  cosTheta: number,
  aureole: number,
  silverLining: number
): number {
  for (const strength of [aureole, silverLining]) {
    if (!(Number.isFinite(strength) && strength >= 0)) {
      throw new RangeError(`strength must be finite and ≥ 0, got ${strength}`);
    }
  }
  cloudForwardPhase(cosTheta); // validates the cosine
  const s = CLOUD_SUN.aureoleShare;
  return (
    s * aureole * lobe(cosTheta, CLOUD_SUN.aureoleG) +
    (1 - s) * silverLining * lobe(cosTheta, CLOUD_SUN.silverG)
  );
}

/**
 * The forward-scattered radiance of a cloud, for a sun of illuminance
 * `sunIlluminance` at the cloud: E · phase(cos θ) · τ·e^(-τ), each lobe at
 * its own strength (0 = off, 1 = the model). Added to the cloud's own
 * light, in the units of E per steradian. GLSL twin:
 * `atmCloudForwardRadiance`.
 *
 * @throws RangeError as `cloudForwardPhaseOf` and the share do.
 */
export function cloudForwardRadiance(
  sunIlluminance: number,
  cosTheta: number,
  tau: number,
  aureole: number,
  silverLining: number
): number {
  return (
    sunIlluminance *
    cloudForwardPhaseOf(cosTheta, aureole, silverLining) *
    cloudForwardShare(tau)
  );
}

/**
 * The share of the sun DISC that passes a cloud of optical depth τ along the
 * view: e^(-k·τ), 1 at k = 0 (off). GLSL twin: the sky's
 * `atmCloudDiscTransmittance`.
 *
 * @throws RangeError for a negative or non-finite τ or exponent.
 */
export function cloudDiscTransmittance(tau: number, exponent: number): number {
  if (!(Number.isFinite(tau) && tau >= 0)) {
    throw new RangeError(`optical depth must be finite and ≥ 0, got ${tau}`);
  }
  if (!(Number.isFinite(exponent) && exponent >= 0)) {
    throw new RangeError(
      `disc exponent must be finite and ≥ 0, got ${exponent}`
    );
  }
  return Math.exp(-exponent * tau);
}

/**
 * `atmForwardPhase(cosTheta, strengths)` (x the aureole's, y the silver
 * lining's) and `atmForwardShare`: self-contained (no uniform) and
 * include-guarded, like the column's chunk.
 */
export const CLOUD_SUN_GLSL = /* glsl */ `
#ifndef ATM_CLOUD_SUN_GLSL
#define ATM_CLOUD_SUN_GLSL
const float ATM_FORWARD_AUREOLE_G = ${glslFloat(CLOUD_SUN.aureoleG)};
const float ATM_FORWARD_SILVER_G = ${glslFloat(CLOUD_SUN.silverG)};
const float ATM_FORWARD_AUREOLE_SHARE = ${glslFloat(CLOUD_SUN.aureoleShare)};

float atmForwardLobe(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.141592653589793 * pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-6), 1.5));
}

// Twin of cloudForwardPhaseOf: each lobe at its own strength.
float atmForwardPhase(float cosTheta, vec2 strengths) {
  return ATM_FORWARD_AUREOLE_SHARE * strengths.x * atmForwardLobe(cosTheta, ATM_FORWARD_AUREOLE_G)
    + (1.0 - ATM_FORWARD_AUREOLE_SHARE) * strengths.y * atmForwardLobe(cosTheta, ATM_FORWARD_SILVER_G);
}

// Twin of cloudForwardShare.
float atmForwardShare(float tau) {
  return tau * exp(-tau);
}
#endif
`;
