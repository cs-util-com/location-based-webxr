/**
 * `globe-albedo`'s detail as a grid of light factors over the terrain
 * lab's region (globe round-5 F1): the form in which the globe's relief
 * tiles, drawn from the 3D-tiles library rather than the lab's mesh, read
 * it. The fine luminance is style B's cover at each of the lab's posts,
 * the coarse one its mean over an imagery pixel's footprint, and the
 * factor `detailRatio` of the two: the lab's own functions, so the globe
 * and the terrain lab cannot drift apart. Dependency-free, so it runs
 * under `node --test`.
 *
 * @see terrain-detail-grid.js.md
 */
import { FAR_FIELD } from "./terrain-far-field.js";
import {
  GLOBE_ALBEDO,
  detailRatio,
  footprintLuminanceGrid,
  footprintM,
  linearLuminance,
} from "./terrain-globe-colour.js";
import { NATURAL, naturalBaseColour } from "./terrain-styles.js";

/**
 * Style B's cover luminance (linear) at every post of the lab's fields
 * (`height` datum-relative, `gx`, `gy`, `reliefSmall`, `reliefStd`; row 0
 * south), at the shade of open flat ground. `cover` takes the lab's line
 * offsets (`treeOffsetM`, `snowOffsetM`, `aspectSnowM`, `rockSlopeDeg`).
 *
 * @param {{ height: ArrayLike<number>, gx: ArrayLike<number>,
 *   gy: ArrayLike<number>, reliefSmall: ArrayLike<number>,
 *   reliefStd: ArrayLike<number> }} fields
 * @param {{ datum: number, latDeg: number, cover?: object }} o
 * @returns {Float64Array}
 */
export function fineLuminanceGrid(fields, { datum, latDeg, cover = {} }) {
  const fine = new Float64Array(fields.height.length);
  for (let i = 0; i < fine.length; i++) {
    fine[i] = linearLuminance(
      naturalBaseColour(
        {
          heightM: fields.height[i] + datum,
          gx: fields.gx[i],
          gy: fields.gy[i],
          smallM: fields.reliefSmall[i],
          spreadM: fields.reliefStd[i],
          latDeg,
        },
        cover,
        NATURAL,
        1,
      ),
    );
  }
  return fine;
}

/**
 * The fine luminance's mean over the far field's imagery pixel around
 * each texel centre of `GLOBE_ALBEDO.side` x `GLOBE_ALBEDO.side` over the
 * drawn region (`spec.halfExtentM`): the coarse grid the lab's shader
 * divides by.
 *
 * @param {ArrayLike<number>} fineLum
 * @param {{ side: number, spacingM: number, extentM: number,
 *   halfExtentM: number }} spec
 * @param {number} latDeg
 */
export function coarseLuminanceGrid(fineLum, spec, latDeg) {
  return footprintLuminanceGrid({
    fineLum,
    grid: { side: spec.side, spacingM: spec.spacingM, extentM: spec.extentM },
    halfM: spec.halfExtentM,
    side: GLOBE_ALBEDO.side,
    footprint: footprintM(FAR_FIELD.level, latDeg),
  });
}

/**
 * Bilinear read of a `side` x `side` scalar grid over +-`halfM` (texel
 * centres at `-halfM + (i + 0.5) x 2 halfM / side`, row 0 south) at ENU
 * metres, clamped at the edge, as a linearly filtered texture reads.
 */
export function scalarAt(grid, side, halfM, x, y) {
  const step = (2 * halfM) / side;
  const clamp = (v) => Math.min(side - 1, Math.max(0, v));
  const gx = clamp((x + halfM) / step - 0.5);
  const gy = clamp((y + halfM) / step - 0.5);
  const x0 = Math.min(side - 2, Math.floor(gx));
  const y0 = Math.min(side - 2, Math.floor(gy));
  const fx = gx - x0;
  const fy = gy - y0;
  const v = (c, r) => grid[r * side + c];
  return (
    (v(x0, y0) * (1 - fx) + v(x0 + 1, y0) * fx) * (1 - fy) +
    (v(x0, y0 + 1) * (1 - fx) + v(x0 + 1, y0 + 1) * fx) * fy
  );
}

/**
 * The detail factor at every post of the lab's fields: `detailRatio` of
 * the fine luminance to the coarse one read there, 1 outside the drawn
 * region (+-`spec.halfExtentM`; the coarse grid covers only that) and
 * everywhere when `detail` is 0. Returns the grid with its placement
 * (`side` posts per row, post 0 at -`extentM`, drawn over +-`halfM`).
 * RangeError when the fields do not have `spec.side`^2 posts.
 *
 * @param {{ fields: object, spec: { side: number, spacingM: number,
 *   extentM: number, halfExtentM: number }, datum: number, latDeg: number,
 *   detail?: number, cover?: object }} input
 * @returns {{ ratio: Float32Array, side: number, extentM: number,
 *   halfM: number }}
 */
export function detailRatioGrid({
  fields,
  spec,
  datum,
  latDeg,
  detail = GLOBE_ALBEDO.detail,
  cover = {},
}) {
  const { side, spacingM, extentM, halfExtentM: halfM } = spec;
  if (fields.height.length !== side * side) {
    throw new RangeError(
      `the fields have ${fields.height.length} posts, the spec ${side * side}`,
    );
  }
  const ratio = new Float32Array(side * side).fill(1);
  if (detail > 0) {
    const fine = fineLuminanceGrid(fields, { datum, latDeg, cover });
    const coarse = coarseLuminanceGrid(fine, spec, latDeg);
    for (let r = 0; r < side; r++) {
      const y = -extentM + r * spacingM;
      if (Math.abs(y) > halfM) continue;
      for (let c = 0; c < side; c++) {
        const x = -extentM + c * spacingM;
        if (Math.abs(x) > halfM) continue;
        const i = r * side + c;
        ratio[i] = detailRatio(
          fine[i],
          scalarAt(coarse, GLOBE_ALBEDO.side, halfM, x, y),
          detail,
        );
      }
    }
  }
  return { ratio, side, extentM, halfM };
}
