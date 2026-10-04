/**
 * Tests for `globe-albedo`'s detail as a grid of light factors, the form
 * the globe's relief tiles read it in (globe round-5 F1: the imagery
 * colour plus the detail on the library's terrain tiles).
 *
 * Why this file matters: the globe draws the relief from the library's
 * tiles, not from the terrain lab's mesh, so it cannot run the lab's
 * per-fragment style B. It reads the same detail factor, computed here
 * at the lab's own posts from the lab's own functions (`naturalBaseColour`,
 * `footprintLuminanceGrid`, `detailRatio`), so the two pages cannot drift
 * apart. The checks: the fine luminance is style B's at every post; the
 * factor is exactly 1 where the land is uniform, outside the drawn region
 * and with the detail off; it brightens what style B draws brighter than
 * its footprint and darkens the rest, within the ratio's clamp.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  coarseLuminanceGrid,
  detailRatioGrid,
  fineLuminanceGrid,
  scalarAt,
} from "./terrain-detail-grid.js";
import { FAR_FIELD } from "./terrain-far-field.js";
import {
  GLOBE_ALBEDO,
  footprintLuminanceGrid,
  footprintM,
  linearLuminance,
} from "./terrain-globe-colour.js";
import { NATURAL, naturalBaseColour } from "./terrain-styles.js";

/** A small region: 41 posts every 500 m over +-10 km, drawn +-8 km. */
const SPEC = Object.freeze({
  side: 41,
  spacingM: 500,
  extentM: 10_000,
  halfExtentM: 8_000,
});
const LAT = 46.5;

/** Fields over SPEC from a height function of ENU metres (flat slopes). */
function fieldsOf(heightAt, spec = SPEC) {
  const n = spec.side * spec.side;
  const f = {
    height: new Float32Array(n),
    gx: new Float32Array(n),
    gy: new Float32Array(n),
    reliefSmall: new Float32Array(n),
    reliefStd: new Float32Array(n),
  };
  for (let r = 0; r < spec.side; r++) {
    for (let c = 0; c < spec.side; c++) {
      const x = -spec.extentM + c * spec.spacingM;
      const y = -spec.extentM + r * spec.spacingM;
      f.height[r * spec.side + c] = heightAt(x, y);
    }
  }
  return f;
}

describe("fineLuminanceGrid", () => {
  it("is style B's cover luminance at every post, the datum added back", () => {
    const fields = fieldsOf((x) => (x < 0 ? 400 : 2600));
    fields.gx[5] = 0.3;
    fields.reliefSmall[7] = -40;
    fields.reliefStd[9] = 150;
    const cover = { treeOffsetM: 100, snowOffsetM: -200 };
    const fine = fineLuminanceGrid(fields, { datum: 300, latDeg: LAT, cover });
    for (const i of [0, 5, 7, 9, 30, fields.height.length - 1]) {
      const expected = linearLuminance(
        naturalBaseColour(
          {
            heightM: fields.height[i] + 300,
            gx: fields.gx[i],
            gy: fields.gy[i],
            smallM: fields.reliefSmall[i],
            spreadM: fields.reliefStd[i],
            latDeg: LAT,
          },
          cover,
          NATURAL,
          1,
        ),
      );
      assert.equal(fine[i], expected, `post ${i}`);
    }
  });
});

describe("coarseLuminanceGrid", () => {
  it("is the footprint mean the terrain lab builds, at the far field's level", () => {
    const fields = fieldsOf((x, y) => 1000 + x / 20 + y / 40);
    const fine = fineLuminanceGrid(fields, { datum: 0, latDeg: LAT });
    const coarse = coarseLuminanceGrid(fine, SPEC, LAT);
    const expected = footprintLuminanceGrid({
      fineLum: fine,
      grid: {
        side: SPEC.side,
        spacingM: SPEC.spacingM,
        extentM: SPEC.extentM,
      },
      halfM: SPEC.halfExtentM,
      side: GLOBE_ALBEDO.side,
      footprint: footprintM(FAR_FIELD.level, LAT),
    });
    assert.deepEqual(coarse, expected);
  });
});

describe("scalarAt", () => {
  // The coarse grid is read as the shader reads its texture: bilinear
  // between texel centres, clamped at the edge.
  it("reads a grid bilinearly between texel centres, clamped at the edge", () => {
    const grid = Float32Array.from([0, 1, 2, 3]);
    assert.equal(scalarAt(grid, 2, 10, -5, -5), 0);
    assert.equal(scalarAt(grid, 2, 10, 5, 5), 3);
    assert.equal(scalarAt(grid, 2, 10, 0, -5), 0.5);
    assert.equal(scalarAt(grid, 2, 10, 0, 0), 1.5);
    assert.equal(scalarAt(grid, 2, 10, -50, -50), 0);
    assert.equal(scalarAt(grid, 2, 10, 50, 50), 3);
  });
});

describe("detailRatioGrid", () => {
  it("is 1 everywhere on uniform land", () => {
    const g = detailRatioGrid({
      fields: fieldsOf(() => 800),
      spec: SPEC,
      datum: 0,
      latDeg: LAT,
    });
    assert.equal(g.ratio.length, SPEC.side * SPEC.side);
    for (const v of g.ratio) assert.ok(Math.abs(v - 1) < 1e-12, `${v}`);
  });

  it("brightens what style B draws brighter than its footprint, darkens the rest, within the clamp", () => {
    // Forest to the west, snow to the east (a 5,000 m step at x = 0).
    const fields = fieldsOf((x) => (x < 0 ? 900 : 5000));
    const g = detailRatioGrid({ fields, spec: SPEC, datum: 0, latDeg: LAT });
    const at = (x, y) => {
      const c = Math.round((x + SPEC.extentM) / SPEC.spacingM);
      const r = Math.round((y + SPEC.extentM) / SPEC.spacingM);
      return g.ratio[r * SPEC.side + c];
    };
    // Next to the step (the snow starts at x = 0), each side's footprint
    // (about 1.7 km east-west at 46.5 N) mixes in the other.
    assert.ok(at(-500, 0) < 1, `forest ${at(-500, 0)}`);
    assert.ok(at(0, 0) > 1, `snow ${at(0, 0)}`);
    // Far from it, each footprint is uniform.
    assert.ok(Math.abs(at(-5000, 0) - 1) < 1e-12, `${at(-5000, 0)}`);
    assert.ok(Math.abs(at(5000, 0) - 1) < 1e-12, `${at(5000, 0)}`);
    const [lo, hi] = GLOBE_ALBEDO.ratioRange;
    for (const v of g.ratio) assert.ok(v >= lo && v <= hi, `${v}`);
  });

  it("is exactly 1 outside the drawn region and with the detail off", () => {
    const fields = fieldsOf((x) => (x < 0 ? 900 : 5000));
    const g = detailRatioGrid({ fields, spec: SPEC, datum: 0, latDeg: LAT });
    // Post 0 is at -10 km, outside the +-8 km drawn region.
    assert.equal(g.ratio[0], 1);
    assert.equal(g.ratio[SPEC.side * SPEC.side - 1], 1);
    const off = detailRatioGrid({
      fields,
      spec: SPEC,
      datum: 0,
      latDeg: LAT,
      detail: 0,
    });
    for (const v of off.ratio) assert.equal(v, 1);
  });

  it("carries the grid's placement: posts, spacing and the drawn half extent", () => {
    const g = detailRatioGrid({
      fields: fieldsOf(() => 800),
      spec: SPEC,
      datum: 0,
      latDeg: LAT,
    });
    assert.equal(g.side, SPEC.side);
    assert.equal(g.extentM, SPEC.extentM);
    assert.equal(g.halfM, SPEC.halfExtentM);
  });

  it("refuses fields that do not match the spec's grid", () => {
    assert.throws(
      () =>
        detailRatioGrid({
          fields: fieldsOf(() => 800, { ...SPEC, side: 11, extentM: 2_500 }),
          spec: SPEC,
          datum: 0,
          latDeg: LAT,
        }),
      RangeError,
    );
  });
});
