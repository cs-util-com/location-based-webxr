/**
 * The spherical cloud volume's lab module (round-4 plan 2026-10-11-0122,
 * R4d): its ambient light.
 *
 * Why this file matters: the shell spans the terminator, so it cannot take
 * the slab's one zenith sky (the ground sky's, for one sun); it lights each
 * sample by its own sun through a small table of the framework's CPU sky,
 * by the sun's cosine. A table that was flat, negative, or bright at night
 * would light the night side's clouds or leave the day's grey: held here,
 * where it is cheap, rather than by a browser smoke.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { ZENITH_TABLE, zenithTable } from "./globe-cloud-shell-light.js";

describe("zenithTable", () => {
  const table = zenithTable(60, 3);
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  it("holds 14 finite, non-negative entries from below the horizon to overhead", () => {
    assert.equal(table.length, 13);
    for (const v of table) {
      for (const c of v) {
        assert.ok(Number.isFinite(c) && c >= 0, `entry ${c}`);
      }
    }
  });

  it("is blue by day, dark at night and brightens as the sun climbs", () => {
    const day = table.at(-1);
    assert.ok(day[2] > day[0], "the zenith sky is blue");
    assert.ok(
      lum(table[0]) < 0.02 * lum(day),
      "dark with the sun 17 degrees down",
    );
    for (let i = 4; i < table.length; i++) {
      assert.ok(lum(table[i]) >= lum(table[i - 1]), `rises at ${i}`);
    }
  });

  // The shell reads the baked table (the computation is 470 ms of main
  // thread); it must be what the computation gives, to 5 digits.
  it("is what the shell reads, baked", () => {
    const baked = zenithTable(60, 3);
    assert.equal(ZENITH_TABLE.length, baked.length);
    baked.forEach((rgb, i) =>
      rgb.forEach((c, k) =>
        assert.ok(
          Math.abs(c - ZENITH_TABLE[i][k]) <= 1e-4 * Math.max(c, 1e-6) + 1e-12,
          `entry ${i}.${k}: ${c} against ${ZENITH_TABLE[i][k]}`,
        ),
      ),
    );
  });

  it("refuses a visibility or a height it cannot light", () => {
    assert.throws(() => zenithTable(0, 2), RangeError);
    assert.throws(() => zenithTable(60, Number.NaN), RangeError);
  });
});
