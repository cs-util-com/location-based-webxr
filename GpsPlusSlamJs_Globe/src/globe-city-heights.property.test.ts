/**
 * Properties of the city's heights spec.
 *
 * Why this test matters: the worker hands the spec straight to the Osm
 * library, so every zoom the relief can name (1-15) and every template
 * carrying the three tokens must come through unchanged, and nothing else
 * may: a spec the library cannot read fails the build in the worker, far
 * from the cause.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CITY_HEIGHTS_ZOOM, cityHeights } from "./globe-city-heights.js";

/** URL text without braces, so no token is made or hidden by accident. */
const part = fc.stringMatching(/^[a-z0-9/.:_-]{0,12}$/);
const template = fc
  .tuple(part, part, part, part)
  .map(([a, b, c, d]) => `${a}{z}${b}{x}${c}{y}${d}`);

describe("cityHeights (properties)", () => {
  it("carries any template with the tokens at any zoom 1-15", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: CITY_HEIGHTS_ZOOM.min, max: CITY_HEIGHTS_ZOOM.max }),
        template,
        (zoom, url) => {
          expect(cityHeights(zoom, url)).toEqual({ urlTemplates: [url], zoom });
        },
      ),
    );
  });

  it("refuses every zoom outside 1-15", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ max: CITY_HEIGHTS_ZOOM.min - 1 }),
          fc.integer({ min: CITY_HEIGHTS_ZOOM.max + 1 }),
          fc.double({ noInteger: true }),
        ),
        template,
        (zoom, url) => {
          expect(() => cityHeights(zoom, url)).toThrow(RangeError);
        },
      ),
    );
  });

  it("refuses a template missing any one token", () => {
    fc.assert(
      fc.property(
        template,
        fc.constantFrom("{z}", "{x}", "{y}"),
        (url, token) => {
          expect(() => cityHeights(12, url.replaceAll(token, ""))).toThrow(
            RangeError,
          );
        },
      ),
    );
  });
});
