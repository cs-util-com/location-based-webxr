/**
 * The terrain lab's exaggeration, view width and slope boost (terrain plan
 * 2026-09-27-0605 DEC-TR-4, §6, §9 findings 9, 10 and 19).
 *
 * - The slider sets E directly, 1-10, 3 by default (the owner's look value,
 *   globe round-5 DEC-GL5-5; 2 before).
 * - "Auto" is a SWITCH, off by default (the owner rejected "auto on by
 *   default"). On, E = slider x autoFactor(W): the FACTOR is capped at 3,
 *   the product is not, so slider 2 at 250 km reads 5.3x.
 * - W, the view width, comes from the camera's altitude with a fixed
 *   reference view (portrait, 50° vertical field of view): W = 0.43 x
 *   altitude. It is driven by a SMOOTHED altitude, because Mapbox saw
 *   flicker when exaggeration followed the zoom (research §7.2).
 * - The slope boost is the shading's gain, separate from E (plan §9 finding
 *   20: E never enters the shading normal).
 *
 * @see terrain-exaggeration.js.md
 */

/** The slider (DEC-TR-4). */
export const EXAGGERATION = Object.freeze({ min: 1, max: 10, fallback: 3 });

/** E = slider x clamp((W / 10 km)^0.3, 1, 3) with auto on (DEC-TR-4). */
export const AUTO_RULE = Object.freeze({
  refWidthM: 10_000,
  exponent: 0.3,
  cap: 3,
});

/** boost = clamp((W / 5 km)^0.3, 1, 5) (plan §9 finding 19; MapLibre's 0.3). */
export const SLOPE_BOOST = Object.freeze({
  refWidthM: 5_000,
  exponent: 0.3,
  cap: 5,
});

/** W per metre of altitude: portrait phone, 50° vertical field of view. */
export const VIEW_WIDTH_PER_ALTITUDE = 0.43;

/** The reference view's width at an altitude, metres (never negative). */
export function viewWidthM(altitudeM) {
  return Math.max(0, VIEW_WIDTH_PER_ALTITUDE * altitudeM);
}

/** clamp((W / ref)^exponent, 1, cap): a power law between two floors. */
function clampedPower(widthM, { refWidthM, exponent, cap }) {
  if (!(widthM > 0)) return 1;
  return Math.min(cap, Math.max(1, (widthM / refWidthM) ** exponent));
}

/** The auto rule's factor at a view width. */
export function autoFactor(widthM, rule = AUTO_RULE) {
  return clampedPower(widthM, rule);
}

/** The shading's slope gain at a view width. */
export function slopeBoost(widthM, rule = SLOPE_BOOST) {
  return clampedPower(widthM, rule);
}

/**
 * The exaggeration the terrain is drawn with. A slider value outside 1-10
 * reads as its nearest end, a non-number as the default.
 *
 * @param {{ slider: number, auto: boolean, altitudeM: number, rule?: typeof AUTO_RULE }} input
 */
export function effectiveExaggeration({
  slider,
  auto,
  altitudeM,
  rule = AUTO_RULE,
}) {
  const s = Number.isFinite(slider)
    ? Math.min(EXAGGERATION.max, Math.max(EXAGGERATION.min, slider))
    : EXAGGERATION.fallback;
  return auto ? s * autoFactor(viewWidthM(altitudeM), rule) : s;
}

/**
 * One step of the altitude smoothing: exponential in LOG altitude (the
 * fly-in spans 600 km to 20 km), time constant `tauS`. Never overshoots; a
 * time constant of 0 jumps to the target.
 */
export function smoothAltitude(currentM, targetM, dtS, tauS) {
  if (!(tauS > 0) || !(currentM > 0) || !(targetM > 0)) return targetM;
  const k = 1 - Math.exp(-Math.max(0, dtS) / tauS);
  return Math.exp(
    Math.log(currentM) + (Math.log(targetM) - Math.log(currentM)) * k,
  );
}
