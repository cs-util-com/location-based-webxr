/**
 * The terrain lab's style `globe-classes` (C2; globe round-5 plan
 * 2026-10-01-0945 §3.3): the globe imagery's colour picks weights over
 * land-cover classes (forest, grass, rock, snow, and water from the
 * imagery's own water mask), and each class takes its detail from the
 * relief: within one 2.45 km imagery pixel the snow goes to the posts above
 * the snow line, the rock to the steep posts, the forest below the tree
 * line, the water to the flat ground.
 *
 * - THE COARSE WEIGHTS: the imagery's land colour (the land pixels alone,
 *   `sampleImageryLand`) against each land class's prototype colour, a
 *   Gaussian kernel on the CIE76 distance (`widthDE`), normalised; the
 *   water share is the mask's.
 * - THE FINE WEIGHTS: each coarse weight times the class's affinity for the
 *   post (from height, slope, aspect and the small relief, by style B's own
 *   lines, `naturalWeights`), floored at `floor` so the imagery's class
 *   never vanishes, renormalised.
 * - THE COLOUR: the land colour scaled per channel, in linear light, by the
 *   ratio of the fine to the coarse prototype mix (clamped), so where the
 *   fine weights equal the coarse ones the colour IS the imagery's; then
 *   mixed toward the water colour by the fine water share; then lit by the
 *   sun term, as the globe lights its pixels (`sunLitColour`).
 *
 * Unlike `globe-albedo` (C1), whose detail is luminance-only, the detail
 * here has hue: snow is white and rock grey inside an imagery pixel that
 * is, on average, a greyish green. The footprint's mean is NOT exactly the
 * imagery's: `classSweep` measures how far it drifts.
 *
 * Dependency-free except the lab's own colour curves, style B's lines and
 * the sun term (DEC-H3), so it runs under `node --test`. The shader
 * (`terrain-material.js`, `globeClasses`) mirrors `classAlbedo` line for
 * line.
 *
 * @see terrain-globe-classes.js.md
 */
import { smoothstep } from "./terrain-style.js";
import { naturalWeights } from "./terrain-styles.js";
import { linearToSrgb, srgbToLinear } from "./terrain-far-field.js";
import {
  boxMeanAt,
  deltaE76,
  srgbToLab,
  summedArea,
} from "./terrain-globe-colour.js";
import { sunLitColour } from "./terrain-sun.js";

const DEG = Math.PI / 180;

/** The land classes, in the order every weight vector uses. */
export const LAND_CLASSES = Object.freeze(["forest", "grass", "rock", "snow"]);

/** C2's defaults. */
export const GLOBE_CLASSES = Object.freeze({
  /**
   * The land classes' prototype colours as Blue Marble shows them (sRGB
   * 0-1): a starting point read off the Alps' level-5 tile, checked by the
   * smoke's per-class means (terrain-globe-classes.js.md).
   */
  prototypes: Object.freeze({
    forest: Object.freeze([0.13, 0.2, 0.09]),
    grass: Object.freeze([0.3, 0.34, 0.2]),
    rock: Object.freeze([0.45, 0.42, 0.38]),
    snow: Object.freeze([0.88, 0.9, 0.93]),
  }),
  /**
   * The water's colour (sRGB): a dark lake. The land colour is read from
   * the land pixels alone (`sampleImageryLand`), so the water's colour is
   * the class's own, one for every lake.
   */
  water: Object.freeze([0.05, 0.09, 0.15]),
  /** The colour kernel's width, CIE76 ΔE (swept 6-24). */
  widthDE: 12,
  /** The least affinity a class keeps on any post (swept 0.02-0.15). */
  floor: 0.05,
  /** Water's affinity: full on ground flatter than the first, none above the second (°). */
  waterFlatDeg: Object.freeze([1, 4]),
  /** The per-channel ratio's clamp: a class can neither black out nor bleach a pixel. */
  ratioRange: Object.freeze([0.4, 2.5]),
});

const PROTOTYPE_LIST = LAND_CLASSES.map((c) => GLOBE_CLASSES.prototypes[c]);

/** The prototypes in CIELAB and in linear light, as the shader receives them. */
export const PROTOTYPE_LAB = Object.freeze(PROTOTYPE_LIST.map(srgbToLab));
export const PROTOTYPE_LINEAR = Object.freeze(
  PROTOTYPE_LIST.map((p) => p.map(srgbToLinear)),
);
export const WATER_LINEAR = Object.freeze(
  GLOBE_CLASSES.water.map(srgbToLinear),
);

/**
 * The land classes' coarse weights for an imagery land colour (sRGB 0-1):
 * exp(-ΔE² / 2 widthDE²) per prototype, normalised to sum 1. A colour far
 * from every prototype (every kernel under 1e-6 of the sum's scale) goes
 * wholly to the nearest. RangeError for a width that is not positive.
 */
export function landClassWeights(landSrgb, widthDE = GLOBE_CLASSES.widthDE) {
  if (!(widthDE > 0)) {
    throw new RangeError(`widthDE must be positive, got ${widthDE}`);
  }
  const lab = srgbToLab(landSrgb);
  const d2 = PROTOTYPE_LAB.map(
    (p) => (lab[0] - p[0]) ** 2 + (lab[1] - p[1]) ** 2 + (lab[2] - p[2]) ** 2,
  );
  const k = d2.map((d) => Math.exp(-d / (2 * widthDE * widthDE)));
  const sum = k.reduce((a, b) => a + b, 0);
  if (sum < 1e-6) {
    const nearest = d2.indexOf(Math.min(...d2));
    return d2.map((_, i) => (i === nearest ? 1 : 0));
  }
  return k.map((v) => v / sum);
}

/**
 * Each class's affinity for a post, `floor` to 1: forest below the tree
 * line and off the rock slopes, grass wherever there is no snow and no rock
 * slope, rock on steep ground, scree and bare ground above the snow, snow
 * above the (aspect-shifted) snow line where it sticks, water on flat
 * ground (and everywhere at or below sea level, where it is the only
 * class). The lines are style B's (`naturalWeights`, with its offsets).
 *
 * @param {{ heightM: number, gx: number, gy: number, smallM: number,
 *   latDeg: number }} p
 * @param {{ treeOffsetM?: number, snowOffsetM?: number, aspectSnowM?: number,
 *   rockSlopeDeg?: number, floor?: number }} [o]
 * @returns {{ land: number[], water: number }} land in `LAND_CLASSES` order
 */
export function classAffinities(p, o = {}) {
  const floor = o.floor ?? GLOBE_CLASSES.floor;
  const lift = (v) => floor + (1 - floor) * v;
  if (p.heightM <= 0) {
    return { land: [floor, floor, floor, floor], water: 1 };
  }
  const w = naturalWeights(p, o);
  const slopeDeg = Math.atan(Math.hypot(p.gx, p.gy)) / DEG;
  const [flat0, flat1] = GLOBE_CLASSES.waterFlatDeg;
  return {
    land: [
      (1 - w.meadow) * (1 - w.rock),
      (1 - w.snow) * (1 - w.rock),
      Math.max(w.rock, w.scree, w.bareAboveSnow),
      w.snow,
    ].map(lift),
    water: lift(1 - smoothstep(flat0, flat1, slopeDeg)),
  };
}

/**
 * C2's albedo at a post (sRGB 0-1) from the imagery there (`land` its land
 * colour, null where all water; `water` the mask's share) and the post's
 * relief. Also returns the fine weights (land in `LAND_CLASSES` order,
 * then water), for the sweep.
 *
 * @param {{ land: number[] | null, water: number, point: object,
 *   o?: object, widthDE?: number }} input
 * @returns {{ albedo: number[], land: number[], water: number }}
 */
export function classAlbedo({ land, water, point, o = {}, widthDE }) {
  const a = classAffinities(point, o);
  if (land === null) {
    return { albedo: [...GLOBE_CLASSES.water], land: [0, 0, 0, 0], water: 1 };
  }
  const coarse = landClassWeights(land, widthDE);
  const raw = coarse.map((v, i) => v * a.land[i]);
  const rawSum = raw.reduce((x, y) => x + y, 0);
  const fine = raw.map((v) => v / rawSum);
  const [lo, hi] = GLOBE_CLASSES.ratioRange;
  const mixOf = (weights) =>
    [0, 1, 2].map((c) =>
      weights.reduce((s, wt, i) => s + wt * PROTOTYPE_LINEAR[i][c], 0),
    );
  const coarseMix = mixOf(coarse);
  const fineMix = mixOf(fine);
  const landLin = land.map(
    (v, c) =>
      srgbToLinear(v) *
      Math.min(hi, Math.max(lo, fineMix[c] / Math.max(coarseMix[c], 1e-4))),
  );
  // The water's fine share: its coarse share times its affinity, against
  // the land's coarse share times the land's mean affinity.
  const landAffinity = (1 - water) * rawSum;
  const waterAffinity = water * a.water;
  const wf = waterAffinity / Math.max(landAffinity + waterAffinity, 1e-6);
  const lin = landLin.map((v, c) => v + (WATER_LINEAR[c] - v) * wf);
  return {
    albedo: lin.map((v) => linearToSrgb(Math.min(1, Math.max(0, v)))),
    land: fine.map((v) => v * (1 - wf)),
    water: wf,
  };
}

/**
 * The imagery's coarse colour as C2 composes it (sRGB 0-1): the land
 * colour and the water colour mixed by the mask's share, in linear light.
 * What the footprint of the fine albedo should average to.
 */
export function coarseClassColour(land, water) {
  if (land === null) return [...GLOBE_CLASSES.water];
  const lin = land.map(
    (v, c) => srgbToLinear(v) + (WATER_LINEAR[c] - srgbToLinear(v)) * water,
  );
  return lin.map((v) => linearToSrgb(Math.min(1, Math.max(0, v))));
}

/** C2's colour: its albedo under the sun term's light, as the globe lights it. */
export function globeClassesColour(input, light, intensity) {
  return sunLitColour(classAlbedo(input).albedo, light, intensity);
}

/**
 * C2's class-threshold sweep over a region (the page's hook, on the drawn
 * relief and the loaded imagery): for each setting `{ label, o, widthDE }`,
 * the albedo at every land post, then
 *
 * - `drift`: the CIE76 difference between the fine albedo and the
 *   imagery's coarse colour (`coarseClassColour`), both averaged in
 *   linear light over the same imagery footprint around a coarse grid's
 *   texel centres: what the globe would see change at the hand-over (mean,
 *   p95), without the imagery's own variation inside the footprint. Only
 *   footprints wholly on land posts with imagery count; with none, the
 *   mean and p95 are NaN and `n` is 0;
 * - `detail`: the mean CIE76 difference between a post's fine albedo and
 *   the coarse colour at the post: how much colour the classes move;
 * - `shares`: the mean fine weight of each class over the posts.
 *
 * @param {{ posts: { side: number, spacingM: number, extentM: number,
 *   height: ArrayLike<number>, gx: ArrayLike<number>, gy: ArrayLike<number>,
 *   small: ArrayLike<number>, valid: ArrayLike<number> }, datum: number,
 *   latDeg: number, halfM: number, footprint: number[], coarseSide: number,
 *   imageryAt: (x: number, y: number) => { land: number[] | null,
 *   water: number } | null }} region
 * @param {{ label: string, o?: object, widthDE?: number }[]} settings
 */
export function classSweep(region, settings) {
  const { posts, datum, latDeg, halfM, footprint, coarseSide, imageryAt } =
    region;
  const { side, spacingM, extentM } = posts;
  // The imagery at every post inside the drawn region, once.
  const at = new Array(side * side).fill(null);
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      const x = -extentM + c * spacingM;
      const y = -extentM + r * spacingM;
      const i = r * side + c;
      if (Math.abs(x) > halfM || Math.abs(y) > halfM || !posts.valid[i]) {
        continue;
      }
      at[i] = imageryAt(x, y);
    }
  }
  // The coarse colour at every post, in linear light (the same for every
  // setting): the footprint means are compared with ITS footprint means,
  // so the imagery's own variation inside a footprint is not counted.
  const n = side * side;
  const coarseLin = [0, 1, 2].map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    if (at[i] === null) continue;
    const c = coarseClassColour(at[i].land, at[i].water);
    for (let ch = 0; ch < 3; ch++) coarseLin[ch][i] = srgbToLinear(c[ch]);
  }
  const coarseTables = coarseLin.map((values) => summedArea(values, side));
  return settings.map(({ label, o = {}, widthDE }) => {
    const lin = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
    const count = new Float64Array(n);
    const shares = [0, 0, 0, 0, 0];
    let detailSum = 0;
    let posts0 = 0;
    for (let i = 0; i < n; i++) {
      const im = at[i];
      if (im === null) continue;
      const point = {
        heightM: posts.height[i] + datum,
        gx: posts.gx[i],
        gy: posts.gy[i],
        smallM: posts.small[i],
        latDeg,
      };
      const out = classAlbedo({ ...im, point, o, widthDE });
      for (let c = 0; c < 3; c++) lin[c][i] = srgbToLinear(out.albedo[c]);
      count[i] = 1;
      out.land.forEach((v, k) => (shares[k] += v));
      shares[4] += out.water;
      detailSum += deltaE76(out.albedo, coarseClassColour(im.land, im.water));
      posts0 += 1;
    }
    // Footprint means of the fine albedo, by summed-area tables.
    const fineTables = lin.map((values) => summedArea(values, side));
    const countTable = summedArea(count, side);
    const [wx, wy] = footprint;
    const step = (2 * halfM) / coarseSide;
    const drift = [];
    for (let r = 0; r < coarseSide; r++) {
      for (let c = 0; c < coarseSide; c++) {
        const x = -halfM + (c + 0.5) * step;
        const y = -halfM + (r + 0.5) * step;
        // Only footprints wholly on land posts with imagery (every post's
        // count is 1), so each mean is over the same posts.
        const whole = boxMeanAt(countTable, posts, x, y, wx, wy);
        if (whole === null || whole < 1) continue;
        const mean = (tables) =>
          tables.map((t) =>
            linearToSrgb(boxMeanAt(t, posts, x, y, wx, wy) ?? 0),
          );
        drift.push(deltaE76(mean(fineTables), mean(coarseTables)));
      }
    }
    drift.sort((a, b) => a - b);
    return {
      label,
      posts: posts0,
      drift:
        drift.length === 0
          ? { mean: Number.NaN, p95: Number.NaN, n: 0 }
          : {
              mean: drift.reduce((s, v) => s + v, 0) / drift.length,
              p95: drift[
                Math.min(drift.length - 1, Math.floor(0.95 * drift.length))
              ],
              n: drift.length,
            },
      detail: detailSum / posts0,
      shares: Object.fromEntries(
        [...LAND_CLASSES, "water"].map((name, k) => [name, shares[k] / posts0]),
      ),
    };
  });
}

/**
 * The sweep's settings (the owner rule 2026-09-13: a verdict from one
 * value is provisional): one class threshold moved at a time around the
 * defaults, each over a plausible range.
 */
export const CLASS_SWEEP = Object.freeze([
  { label: "defaults" },
  ...[-600, -300, 300, 600].map((v) => ({
    label: `snow line ${v > 0 ? "+" : ""}${v} m`,
    o: { snowOffsetM: v },
  })),
  ...[-400, 400].map((v) => ({
    label: `tree line ${v > 0 ? "+" : ""}${v} m`,
    o: { treeOffsetM: v },
  })),
  ...[30, 34, 42, 46].map((v) => ({
    label: `rock slope ${v}°`,
    o: { rockSlopeDeg: v },
  })),
  ...[6, 18, 24].map((v) => ({ label: `colour width ${v}`, widthDE: v })),
  ...[0.02, 0.15].map((v) => ({ label: `floor ${v}`, o: { floor: v } })),
]);
