/**
 * Slope, aspect and normal-space isoclines — what §2's ground shader computes,
 * in JS so CI can run it.
 *
 * WHAT THE PROTOTYPE ACTUALLY DOES, because the idea is easy to misread. It does
 * NOT draw height contours. It draws lines of constant **steepness** — take the
 * surface normal, measure how far it leans, and put a line wherever that lean
 * crosses a threshold. On a uniformly tilted plane there are no lines at all,
 * because the lean never changes. On a curving hillside the lines cluster where
 * the curvature is highest, which is exactly where the shape is.
 *
 * WHY THAT ANSWERS R5-2 WHERE THE HEIGHT RAMP DOES NOT. The standing complaint
 * is that the terrain reads as flat. A height ramp recolours flat-looking ground
 * and leaves it looking flat in a different colour; contour lines of slope make
 * the SHAPE legible. And unlike the specular highlight DEC-R2-1 relies on, they
 * do not depend on where the sun is — which is what makes reversing DEC-R4-6 in
 * §1 survivable (see `sun-position.ts`).
 *
 * WHY THIS IS A PURE MODULE. jsdom cannot compile a shader and CI has no GPU, so
 * anything expressed only in GLSL is untestable — the same reason
 * `sampleTerrainTexture` exists beside the vertex shader. If the two ever
 * disagree, the GPU becomes a second source of truth for what the ground looks
 * like, which is the defect DEC-R2-21 rejected `geo-three` for.
 *
 * NORMALS COME FROM `terrainNormal` in `terrain-texture.ts`, which returns
 * `[x, up, z]` from a 4-tap finite difference over the DEM's own post pitch.
 *
 * @see terrain-slope.ts.md
 */

/**
 * How many isocline periods span the full range of steepness.
 *
 * 45 — the prototype's value, and it has to be this high for a reason specific
 * to this data rather than to taste. Steepness is `sin(slope)`, so it is bounded
 * by 1; Cologne's relief is roughly ±25 m over kilometres, which puts the
 * steepness actually in play in a narrow band near zero. A low frequency would
 * draw one band across the whole world and the ground would still read as flat —
 * which is the complaint (R5-2) this exists to answer.
 */
export const ISOCLINE_FREQUENCY = 45;

/**
 * Below this steepness the isoclines are faded out.
 *
 * Not decoration. At exactly flat, `slopeAspect` is undefined (the normal has no
 * horizontal component to take an angle of) and the isocline phase sits at zero
 * for every point at once — so a large flat area would either be uniformly
 * inside a line or uniformly outside it, flickering between the two on the
 * slightest numerical noise. Fading below a floor makes flat ground read as
 * untreated, which is honest.
 */
export const FLAT_FADE_STEEPNESS = 0.15;

/** A surface normal as `[x, up, z]`. */
export type Normal = readonly [number, number, number];

/**
 * How far the surface leans, in `0..1`.
 *
 * `length(N.xz)`, which for a unit normal is `sin(slope angle)` — 0 flat, 1
 * vertical. Bounded, unlike the gradient itself, which is what lets
 * {@link ISOCLINE_FREQUENCY} be a fixed number instead of something that has to
 * be retuned per landscape.
 *
 * A MAGNITUDE, not a direction: it must not vary as a hillside of constant
 * steepness turns, or the treatment would draw a contour where the ground merely
 * changes which way it faces.
 */
export function slopeSteepness(normal: Normal): number {
  return Math.hypot(normal[0], normal[2]);
}

/**
 * Which way the surface faces, radians in `[-π, π]`.
 *
 * The compass direction of the lean, used for a warm/cool tint so that two
 * slopes of the same steepness facing different ways are distinguishable. That
 * is the cue a single grey shading cannot give: without it, a valley and a ridge
 * of the same gradient render identically.
 *
 * UNDEFINED ON FLAT GROUND, where there is no horizontal component to take an
 * angle of. `atan2(0, 0)` is 0 rather than NaN, so this returns a value rather
 * than poisoning the shader — and {@link FLAT_FADE_STEEPNESS} is what stops that
 * arbitrary 0 being visible.
 */
export function slopeAspect(normal: Normal): number {
  return Math.atan2(normal[0], normal[2]);
}

/**
 * The isocline phase — a line is drawn wherever this crosses a half-period.
 *
 * A PURE FUNCTION OF STEEPNESS, and that is the whole design. It does not depend
 * on position or on height, so a uniformly tilted plane has one phase everywhere
 * and therefore no lines. `terrain-slope.test.ts` pins that, because an
 * implementation that had drifted into contouring HEIGHT would look completely
 * convincing in a screenshot.
 *
 * Returned in radians so the shader can take `fract(phase / 2π)`; the GLSL side
 * additionally uses `fwidth` to keep the drawn line one pixel wide at any
 * distance, which is the trick that cannot be reproduced here — see the sidecar.
 */
export function isoclinePhase(normal: Normal): number {
  return slopeSteepness(normal) * ISOCLINE_FREQUENCY;
}

/**
 * How strongly the treatment applies at this steepness, in `0..1`.
 *
 * A smoothstep from nothing to full over {@link FLAT_FADE_STEEPNESS}. Mirrors
 * the shader so the two cannot disagree about where the treatment starts.
 */
export function slopeTreatmentStrength(normal: Normal): number {
  const t = Math.min(
    1,
    Math.max(0, slopeSteepness(normal) / FLAT_FADE_STEEPNESS),
  );
  return t * t * (3 - 2 * t);
}
