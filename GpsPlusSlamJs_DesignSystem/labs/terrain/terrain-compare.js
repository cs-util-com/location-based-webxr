/**
 * The terrain lab's comparison of the relief colour approaches (globe
 * round-5 plan 2026-10-01-0945 §3.3 "Judged end to end"): the variants, the
 * capture plan along the lab's fly-in onto the Alps, and the metrics the
 * comparison page logs per variant. The numbers are LOGGED, not asserted,
 * until the owner picks; `globe-albedo` is the provisional default.
 *
 * - The variants are rows; another agent's styles join by appending to
 *   `COMPARE_VARIANTS` (one line each).
 * - The captures are the fly-in's poses at fixed altitudes (300, 100, 30
 *   and 10 km), at a day and a low sun.
 * - The metrics: the colour difference to the globe's pixel at the
 *   hand-over altitude, the local contrast at 1-10 km on the ground, and
 *   the frame cost as a ratio to style A within one page load.
 *
 * Dependency-free except the far field's colour curves and CIELAB (pure
 * data and arithmetic), so it runs under `node --test`.
 *
 * @see terrain-compare.js.md
 */
import { linearToSrgb, srgbToLinear } from "./terrain-far-field.js";
import { srgbToLab } from "./terrain-globe-colour.js";

/**
 * The rows: a label and the hash keys that make the variant (on top of the
 * capture's place, pose, light and time).
 */
export const COMPARE_VARIANTS = [
  { id: "A", label: "A: Pastel atlas", hash: { style: "pastel" } },
  { id: "B", label: "B: Natural colour", hash: { style: "natural" } },
  {
    id: "C",
    label: "C: Globe blend",
    hash: { style: "globe" },
    // C IS the far field: at 300 km and below it draws exactly A, so its
    // captures sit where the blend acts (FAR_FIELD 1500 to 300 km).
    altitudesKm: Object.freeze([1500, 900, 600, 300]),
  },
  {
    id: "C1-d0",
    label: "C1: globe-albedo, detail 0",
    hash: { style: "globe-albedo", detail: 0 },
  },
  {
    id: "C1-d0.5",
    label: "C1: globe-albedo, detail 0.5",
    hash: { style: "globe-albedo", detail: 0.5 },
  },
  { id: "C3", label: "C3: globe-bands", hash: { style: "globe-bands" } },
  {
    id: "C2",
    label: "C2: globe-classes",
    hash: { style: "globe-classes" },
  },
  {
    id: "C2-w24",
    label: "C2: globe-classes, colour width 24",
    hash: { style: "globe-classes", classWidth: 24 },
  },
];

/** The capture plan (plan §3.3) and the hand-over (the globe's `handOverKm`). */
export const COMPARE_PLAN = Object.freeze({
  place: "alps",
  altitudesKm: Object.freeze([300, 100, 30, 10]),
  handOverKm: 150,
  suns: Object.freeze([
    Object.freeze({ id: "day", label: "Day", time: "2026-06-21T11:00:00Z" }),
    Object.freeze({
      id: "low",
      label: "Low sun",
      time: "2026-06-21T18:00:00Z",
    }),
  ]),
  /**
   * The ground grid the local contrast is read on: 11 x 11 posts 1 km
   * apart, the step widened per altitude until the posts are at least
   * `minPostPx` drawing pixels apart along the view (`contrastStepM`).
   */
  contrastStepM: 1000,
  contrastPosts: 11,
  minPostPx: 3,
  /** The ground grid the hand-over difference is read on: 21 x 21, 4 km apart. */
  handOverStepM: 4000,
  handOverPosts: 21,
  /**
   * The footprint-averaged hand-over: the render read on n x n points over
   * each imagery pixel's footprint and averaged in linear light.
   */
  footprintSamples: 5,
  /** Frames timed per variant for the cost (mean and spread reported). */
  costFrames: 10,
  /**
   * The keys every capture shares: a still camera, the sun, and the far
   * field on, so every row loads the globe's imagery for its hand-over
   * reference. At and below 300 km (`farLow`) the far field's weight is 0,
   * so it changes no capture of a near style. `dpr` 1 pins the drawing
   * buffer to the frame's CSS size: the contrast is read from pixels, so
   * the pixel ratio is part of the measurement (review 2026-10-01-1650 M1).
   */
  shared: Object.freeze({ light: 1, tau: 0, svf: 8, far: 1, dpr: 1 }),
});

/**
 * A square ground grid of `posts` x `posts` ENU points `stepM` apart,
 * centred on the origin (the place's centre, where the fly-in looks).
 */
export function groundGrid(posts, stepM) {
  if (!(Number.isInteger(posts) && posts >= 1) || !(stepM > 0)) {
    throw new RangeError(
      `need posts >= 1 and stepM > 0, got ${posts}, ${stepM}`,
    );
  }
  const half = ((posts - 1) * stepM) / 2;
  const out = [];
  for (let j = 0; j < posts; j++) {
    for (let i = 0; i < posts; i++) {
      out.push({ x: -half + i * stepM, y: -half + j * stepM });
    }
  }
  return out;
}

/** The hash for one capture: the plan's shared keys, the variant's, the pose. */
export function captureHash(variant, sun, pose, plan = COMPARE_PLAN) {
  const params = new URLSearchParams();
  params.set("place", plan.place);
  for (const [k, v] of Object.entries(plan.shared)) params.set(k, String(v));
  for (const [k, v] of Object.entries(variant.hash)) params.set(k, String(v));
  params.set("time", sun.time);
  params.set("alt", String(Math.round(pose.altitudeM)));
  params.set("tilt", pose.tiltDeg.toFixed(2));
  params.set("head", pose.headingDeg.toFixed(2));
  return params.toString();
}

/** Mean, standard deviation and count of the finite values. */
export function stats(values) {
  const v = values.filter(Number.isFinite);
  if (v.length === 0) return { mean: Number.NaN, std: Number.NaN, n: 0 };
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const variance = v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length;
  return { mean, std: Math.sqrt(variance), n: v.length };
}

/** The p-th quantile (0-1) of the finite values, nearest rank; NaN if none. */
export function quantile(values, p) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return Number.NaN;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))];
}

/** True for a projected point on the canvas (normalised 0-1, both axes). */
export const onCanvas = ([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1;

/** A variant's capture altitudes: its own, or the plan's. */
export const captureAltitudesKm = (variant, plan = COMPARE_PLAN) =>
  variant.altitudesKm ?? plan.altitudesKm;

/**
 * How many drawing pixels one metre of ground at the camera's target spans
 * for a pose `{ altitudeM, tiltDeg }`, a frame `heightPx` drawing pixels
 * high and a vertical field of view: `across` the view (perpendicular to
 * the heading) f / d, and `along` it f / d x cos(tilt), the foreshortening,
 * with f = heightPx / (2 tan(fov / 2)) and d the distance to the target.
 * RangeError for a frame or field of view that cannot project.
 */
export function groundPixelsPerM({ altitudeM, tiltDeg }, heightPx, fovDeg) {
  if (!(heightPx > 0) || !(fovDeg > 0 && fovDeg < 180)) {
    throw new RangeError(
      `need heightPx > 0 and 0 < fovDeg < 180, got ${heightPx}, ${fovDeg}`,
    );
  }
  const tilt = (tiltDeg * Math.PI) / 180;
  const f = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  const distance = altitudeM / Math.cos(tilt);
  const across = f / distance;
  return { across, along: across * Math.cos(tilt) };
}

/**
 * The contrast grid's step for a pose: the plan's step, widened (to a whole
 * 100 m) until neighbouring posts are `minPostPx` drawing pixels apart
 * along the view, the shorter direction (review 2026-10-01-1650 M1: at
 * 300 km in an 800 x 500 frame 1 km is 0.74 px along the view, so 1 km
 * posts read the same pixels and the spread measured the frame).
 */
export function contrastStepM(pose, heightPx, fovDeg, plan = COMPARE_PLAN) {
  const { along } = groundPixelsPerM(pose, heightPx, fovDeg);
  const needed = plan.minPostPx / along;
  return Math.max(plan.contrastStepM, Math.ceil(needed / 100) * 100);
}

/**
 * The centre of the EPSG:4326 imagery pixel (the globe's pyramid, `level`,
 * `tileSize`) that holds a position: the globe draws that one pixel there.
 */
export function imageryPixelCentre(lat, lng, level, tileSize = 256) {
  const deg = 180 / 2 ** level / tileSize;
  return {
    lat: 90 - (Math.floor((90 - lat) / deg) + 0.5) * deg,
    lng: -180 + (Math.floor((lng + 180) / deg) + 0.5) * deg,
  };
}

/**
 * `n` x `n` points over a `wx` x `wy` box centred on ENU `x`, `y`: the
 * cells' centres, row by row from the south-west. RangeError for n < 1.
 */
export function footprintPoints(x, y, wx, wy, n) {
  if (!(Number.isInteger(n) && n >= 1)) {
    throw new RangeError(`need a whole n >= 1, got ${n}`);
  }
  const out = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      out.push({
        x: x - wx / 2 + ((i + 0.5) * wx) / n,
        y: y - wy / 2 + ((j + 0.5) * wy) / n,
      });
    }
  }
  return out;
}

/**
 * The mean of sRGB colours (0-1) taken in linear light, as sRGB: a box
 * average of a render is an average of light. Null for no colour.
 */
export function linearMeanSrgb(colours) {
  if (colours.length === 0) return null;
  const sum = [0, 0, 0];
  for (const c of colours) {
    for (let i = 0; i < 3; i++) sum[i] += srgbToLinear(c[i]);
  }
  return sum.map((v) => linearToSrgb(v / colours.length));
}

/**
 * The rows repeated at every sky floor of a sweep (DEC-GL5-11): each row's
 * hash gains `sky`, its id `@sky<floor>` and its label the floor; its own
 * altitudes are kept. No floors keeps the rows as they are. RangeError for
 * a floor outside 0-1 (the lab would read it as its default, silently).
 */
export function withSkySweep(variants, skies) {
  if (skies.length === 0) return variants;
  for (const sky of skies) {
    if (!(sky >= 0 && sky <= 1)) {
      throw new RangeError(`a sky floor must be in 0-1, got ${sky}`);
    }
  }
  return variants.flatMap((v) =>
    skies.map((sky) => ({
      ...v,
      id: `${v.id}@sky${sky}`,
      label: `${v.label}, sky floor ${sky}`,
      hash: { ...v.hash, sky },
    })),
  );
}

/**
 * The darkest `share` of 8-bit RGB pixels by luminance (Rec. 709 weights on
 * the 8-bit values, as the contrast's): the luminance at that quantile
 * (`p`, nearest rank) and the mean CIELAB chroma of those pixels
 * (`chroma`): whether the shadows still carry a hue or have sunk to grey.
 * NaN for both, and `n` 0, with no pixels.
 */
export function darkTail(pixels, share) {
  const lum = (px) => 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
  const sorted = [...pixels].sort((a, b) => lum(a) - lum(b));
  const n = Math.min(
    sorted.length,
    Math.max(1, Math.ceil(share * sorted.length)),
  );
  if (sorted.length === 0) return { p: Number.NaN, chroma: Number.NaN, n: 0 };
  const dark = sorted.slice(0, n);
  const chroma =
    dark.reduce((sum, px) => {
      const [, a, b] = srgbToLab(px.slice(0, 3).map((v) => v / 255));
      return sum + Math.hypot(a, b);
    }, 0) / n;
  return { p: lum(dark[n - 1]), chroma, n };
}
