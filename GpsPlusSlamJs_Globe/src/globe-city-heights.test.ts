/**
 * The city's heights follow the relief's source (tour editor plan
 * 2026-10-17-1816 §13, G1 step 1d), moved out of the globe lab.
 *
 * Why this test matters: the city worker read a height template fixed in
 * its own code (AWS Terrarium), so with the Mapterhorn relief the city
 * stood on other heights than the ground it was drawn on, up to 12 m apart
 * in towns (the G0 spikes). The spec the worker hands the Osm library must
 * carry the template it was given, and refuse one it cannot read.
 */
import { describe, expect, it } from "vitest";

import { CITY_HEIGHTS_ZOOM, cityHeights } from "./globe-city-heights.js";

const AWS =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const MAPTERHORN = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";

describe("cityHeights", () => {
  it("reads the template it is given, at the relief's zoom", () => {
    expect(cityHeights(12, MAPTERHORN)).toEqual({
      urlTemplates: [MAPTERHORN],
      zoom: 12,
    });
    expect(cityHeights(12, AWS)).toEqual({ urlTemplates: [AWS], zoom: 12 });
  });

  it("refuses a zoom outside 1-15 or not an integer", () => {
    for (const zoom of [0, 16, 12.5, Number.NaN, undefined]) {
      expect(() => cityHeights(zoom as number, AWS)).toThrow(RangeError);
    }
    expect(CITY_HEIGHTS_ZOOM).toEqual({ min: 1, max: 15 });
    expect(Object.isFrozen(CITY_HEIGHTS_ZOOM)).toBe(true);
  });

  it("refuses a template without {z}, {x} and {y}", () => {
    for (const url of ["", "https://x/{z}/{x}.png", undefined, 42]) {
      expect(() => cityHeights(12, url as string)).toThrow(RangeError);
    }
  });
});
