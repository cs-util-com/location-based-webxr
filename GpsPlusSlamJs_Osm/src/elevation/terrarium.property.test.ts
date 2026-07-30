/**
 * The Web Mercator pixel projection, as a property.
 *
 * WHY THIS FILE EXISTS. `fromWorldPixel`'s docstring claims it is "the inverse
 * rather than an approximation" of `toWorldPixel`, and cites this file as what
 * pins that — but the file did not exist. Raised in review on PR #231, which is
 * the right call twice over: a doc pointing at a missing test is a claim with no
 * evidence, and "exact inverse" is precisely the kind of statement an
 * example-based test cannot make. `terrarium.test.ts` pins one round trip; a
 * property pins the class.
 *
 * WHAT DEPENDS ON IT. `terrain-field.ts` keys its lattice by INTEGER pixel index
 * and then has to ask an elevation provider for those posts — the provider's API
 * is lat/lng, so the round trip has to close. An approximate inverse drifts the
 * lattice off the DEM's own pixel centres, which reintroduces exactly the
 * resampling the pixel lattice exists to avoid, and the symptom is a terrain
 * surface that is subtly, consistently wrong rather than obviously broken.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fromWorldPixel, toWorldPixel } from "./terrarium.js";

/**
 * Web Mercator is undefined at the poles and conventionally clipped near
 * ±85.051129°. Beyond that `log((1 + sin) / (1 - sin))` runs away and the
 * inverse cannot be expected to close — testing there would assert a property
 * the projection does not have.
 */
const LAT_LIMIT = 85;

const latitude = fc.double({
  min: -LAT_LIMIT,
  max: LAT_LIMIT,
  noNaN: true,
  noDefaultInfinity: true,
});
/** `180` is the same meridian as `-180`, so the range is half-open. */
const longitude = fc.double({
  min: -180,
  max: 179.999999,
  noNaN: true,
  noDefaultInfinity: true,
});
/** The zooms a Terrarium consumer plausibly uses. */
const zoom = fc.integer({ min: 0, max: 20 });

describe("toWorldPixel / fromWorldPixel are exact inverses", () => {
  it("returns the original position for any lat/lng and zoom", () => {
    fc.assert(
      fc.property(latitude, longitude, zoom, (lat, lng, z) => {
        const back = fromWorldPixel(toWorldPixel({ lat, lng }, z), z);
        // 1e-9 degrees is ~0.1 mm of ground. The tolerance is for float64
        // round-off in `atan(sinh(...))`, not for approximation: an inverse that
        // was merely close would drift by orders of magnitude more than this.
        expect(back.lat).toBeCloseTo(lat, 9);
        expect(back.lng).toBeCloseTo(lng, 9);
      }),
      { numRuns: 300 },
    );
  });

  it("closes the round trip from PIXEL space too, which is the direction the lattice uses", () => {
    // `terrain-field.ts` starts from an integer pixel index, not from a
    // coordinate — so this is the direction that actually runs in production,
    // and it is not the same statement as the one above.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 8, max: 16 }),
        (x, y, z) => {
          const scale = 2 ** z * 256;
          // Only pixels inside the projected world are meaningful.
          fc.pre(x < scale && y < scale);
          const pixel = { x, y };
          const back = toWorldPixel(fromWorldPixel(pixel, z), z);
          expect(back.x).toBeCloseTo(pixel.x, 6);
          expect(back.y).toBeCloseTo(pixel.y, 6);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("is MONOTONIC: north is up and east is right, at every zoom", () => {
    // The property an inverse test cannot catch. A projection with both signs
    // flipped is still its own exact inverse, and would put the whole lattice
    // upside down — the terrain would be self-consistent and wrong.
    fc.assert(
      fc.property(latitude, longitude, zoom, (lat, lng, z) => {
        fc.pre(lat < LAT_LIMIT - 1 && lng < 179);
        const here = toWorldPixel({ lat, lng }, z);
        // Web Mercator pixel y INCREASES southward.
        expect(toWorldPixel({ lat: lat + 0.5, lng }, z).y).toBeLessThan(here.y);
        expect(toWorldPixel({ lat, lng: lng + 0.5 }, z).x).toBeGreaterThan(
          here.x,
        );
      }),
      { numRuns: 200 },
    );
  });

  it("doubles the pixel scale for each zoom step", () => {
    // The relationship the whole tile scheme rests on. Stated as a property
    // rather than a spot check because an off-by-one in the exponent is exactly
    // the sort of error that looks right at one zoom.
    fc.assert(
      fc.property(
        latitude,
        longitude,
        fc.integer({ min: 0, max: 19 }),
        (lat, lng, z) => {
          const low = toWorldPixel({ lat, lng }, z);
          const high = toWorldPixel({ lat, lng }, z + 1);
          expect(high.x).toBeCloseTo(low.x * 2, 6);
          expect(high.y).toBeCloseTo(low.y * 2, 6);
        },
      ),
      { numRuns: 200 },
    );
  });
});
