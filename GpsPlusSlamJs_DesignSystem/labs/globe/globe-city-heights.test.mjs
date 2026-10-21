/**
 * The city's heights follow the relief's source (tour editor plan
 * 2026-10-17-1816 §13, G1 step 1d).
 *
 * Why this test matters: the city worker read a height template fixed in
 * its own code (AWS Terrarium), so with the Mapterhorn relief the city
 * stood on other heights than the ground it was drawn on, up to 12 m apart
 * in towns (the G0 spikes). The spec the worker hands the Osm library must
 * carry the template it was given, and refuse one it cannot read.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CITY_HEIGHTS_ZOOM, cityHeights } from "./globe-city-heights.js";

const AWS =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const MAPTERHORN = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";

describe("cityHeights", () => {
  it("reads the template it is given, at the relief's zoom", () => {
    assert.deepEqual(cityHeights(12, MAPTERHORN), {
      urlTemplates: [MAPTERHORN],
      zoom: 12,
    });
    assert.deepEqual(cityHeights(12, AWS), { urlTemplates: [AWS], zoom: 12 });
  });

  it("refuses a zoom outside 1-15 or not an integer", () => {
    for (const zoom of [0, 16, 12.5, Number.NaN, undefined]) {
      assert.throws(
        () => cityHeights(/** @type {number} */ (zoom), AWS),
        RangeError,
      );
    }
    assert.equal(CITY_HEIGHTS_ZOOM.min, 1);
    assert.equal(CITY_HEIGHTS_ZOOM.max, 15);
  });

  it("refuses a template without {z}, {x} and {y}", () => {
    for (const url of ["", "https://x/{z}/{x}.png", undefined, 42]) {
      assert.throws(
        () =>
          cityHeights(12, /** @type {string} */ (/** @type {unknown} */ (url))),
        RangeError,
      );
    }
  });
});
