/**
 * Tests for the terrain lab's comparison plan and metric helpers (globe
 * round-5 plan 2026-10-01-0945 §3.3 "Judged end to end").
 *
 * Why this file matters: the comparison page's numbers are what the owner
 * picks a colour approach by, and they are logged, not asserted. So the
 * pieces under them are pinned here: every row is a style the lab has, the
 * plan captures what §3.3 names (300, 100, 30 and 10 km, a day and a low
 * sun, the 150 km hand-over), the ground grids sit where the fly-in looks,
 * and the statistics are the textbook ones.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { farWeights } from "./terrain-far-field.js";
import { readTerrainParams } from "./terrain-params.js";
import {
  COMPARE_PLAN,
  COMPARE_VARIANTS,
  captureHash,
  groundGrid,
  onCanvas,
  quantile,
  stats,
} from "./terrain-compare.js";

describe("the comparison's rows and plan", () => {
  it("has the rows §3.3 names, each a style the lab reads", () => {
    assert.deepEqual(
      COMPARE_VARIANTS.map((v) => v.id),
      ["A", "B", "C", "C1-d0", "C1-d0.5", "C3"],
    );
    for (const v of COMPARE_VARIANTS) {
      const p = readTerrainParams(new URLSearchParams(v.hash).toString());
      assert.equal(p.style, v.hash.style, v.id);
      assert.deepEqual(p.notes, [], v.id);
    }
    assert.equal(new Set(COMPARE_VARIANTS.map((v) => v.id)).size, COMPARE_VARIANTS.length);
  });

  it("captures 300, 100, 30 and 10 km at a day and a low sun, with the 150 km hand-over", () => {
    assert.deepEqual([...COMPARE_PLAN.altitudesKm], [300, 100, 30, 10]);
    assert.deepEqual(COMPARE_PLAN.suns.map((s) => s.id), ["day", "low"]);
    assert.equal(COMPARE_PLAN.handOverKm, 150);
    for (const s of COMPARE_PLAN.suns) assert.ok(Number.isFinite(Date.parse(s.time)), s.id);
  });

  // The far field is on in every capture only so every row has the
  // globe's imagery for its hand-over reference: it must change no capture.
  it("keeps the far field's weight at 0 at every capture altitude", () => {
    const p = readTerrainParams(
      new URLSearchParams(COMPARE_PLAN.shared).toString(),
    );
    assert.equal(p.farOn, true);
    for (const km of [...COMPARE_PLAN.altitudesKm, COMPARE_PLAN.handOverKm]) {
      const w = farWeights(km * 1000, {
        on: true,
        highKm: p.farHigh,
        lowKm: p.farLow,
      });
      assert.equal(w.near, 1, `${km} km`);
    }
  });

  it("writes a capture's hash the lab reads back exactly", () => {
    const variant = COMPARE_VARIANTS.find((v) => v.id === "C1-d0.5");
    const sun = COMPARE_PLAN.suns[1];
    const hash = captureHash(variant, sun, { altitudeM: 30_000, tiltDeg: 52.5, headingDeg: 351.25 });
    const p = readTerrainParams(hash);
    assert.equal(p.place, "alps");
    assert.equal(p.style, "globe-albedo");
    assert.equal(p.detail, 0.5);
    assert.equal(p.light, 1);
    assert.deepEqual(p.camera, { altitudeM: 30_000, tiltDeg: 52.5, headingDeg: 351.25 });
    assert.equal(new URLSearchParams(hash).get("time"), sun.time);
  });
});

describe("groundGrid", () => {
  it("is posts x posts points stepM apart, centred on the origin", () => {
    const g = groundGrid(3, 1000);
    assert.equal(g.length, 9);
    assert.deepEqual(g[0], { x: -1000, y: -1000 });
    assert.deepEqual(g[4], { x: 0, y: 0 });
    assert.deepEqual(g[8], { x: 1000, y: 1000 });
    assert.equal(groundGrid(11, 1000).length, 121);
  });
  it("refuses a bad size or step", () => {
    assert.throws(() => groundGrid(0, 10), RangeError);
    assert.throws(() => groundGrid(3, 0), RangeError);
    assert.throws(() => groundGrid(2.5, 10), RangeError);
  });
});

describe("the statistics", () => {
  it("are the population mean and standard deviation over the finite values", () => {
    const s = stats([2, 4, 4, 4, 5, 5, 7, 9, Number.NaN]);
    assert.equal(s.mean, 5);
    assert.equal(s.std, 2);
    assert.equal(s.n, 8);
    assert.ok(Number.isNaN(stats([]).mean));
  });
  it("takes the nearest-rank quantile", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(quantile(v, 0.95), 95);
    assert.equal(quantile(v, 0), 1);
    assert.equal(quantile(v, 1), 100);
    assert.ok(Number.isNaN(quantile([], 0.5)));
  });
  it("keeps only points on the canvas", () => {
    assert.equal(onCanvas([0.5, 0.5]), true);
    assert.equal(onCanvas([-0.01, 0.5]), false);
    assert.equal(onCanvas([0.5, 1.2]), false);
  });
});
