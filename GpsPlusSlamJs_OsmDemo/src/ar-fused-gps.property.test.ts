import { describe, expect, it } from "vitest";

import fc from "fast-check";

import { fusedGpsFrom } from "./ar-fused-gps.js";

/**
 * The NUE→ENU axis mapping holds for ANY pose and ANY origin latitude.
 *
 * **Why this test matters.** `ar-fused-gps.test.ts` pins the mapping with four
 * hand-picked poses, all of them at one origin (Cologne) and all of them with
 * one horizontal term zeroed. That leaves the case the examples cannot reach:
 * the frame's longitude scale is latitude-DEPENDENT (metres per degree of
 * longitude shrinks with `cos(lat)`), so a transposed implementation produces
 * an error that changes size with latitude and vanishes entirely near the
 * equator, where the two scales nearly agree. A table of examples at one
 * latitude can therefore agree with a wrong implementation.
 *
 * The properties below are deliberately about INDEPENDENCE rather than about
 * the arithmetic: asserting that the output equals `toLatLng({x: z, y: x})`
 * would restate the implementation and prove nothing. What matters to a reader
 * of the readout is that the two axes cannot contaminate each other.
 */

/** The flat-earth inverse the OSM package provides, parameterised by origin. */
function frameAt(lat: number, lng: number) {
  const perDegLat = 111_320;
  const perDegLng = perDegLat * Math.cos((lat * Math.PI) / 180);
  return {
    toLatLng(point: { x: number; y: number }) {
      return { lat: lat + point.y / perDegLat, lng: lng + point.x / perDegLng };
    },
  };
}

/**
 * Poles excluded: `cos(lat)` reaches 0 there and the longitude scale diverges,
 * which is a property of the flat-earth frame rather than of this mapping.
 */
const origin = fc.record({
  lat: fc.double({ min: -70, max: 70, noNaN: true }),
  lng: fc.double({ min: -179, max: 179, noNaN: true }),
});

/** Metres, at the scale an AR session actually reaches. */
const metres = fc.double({ min: -2000, max: 2000, noNaN: true });

/** A northward step big enough to be a real movement — see the floor note. */
const stepMetres = fc.double({ min: 0.01, max: 2000, noNaN: true });

describe("fusedGpsFrom, as a property", () => {
  it("lets NOTHING but the north term move latitude, at any origin latitude", () => {
    // A transposed implementation fails here the moment `z` differs, and the
    // random origin latitude is what stops it hiding near the equator.
    fc.assert(
      fc.property(origin, metres, metres, metres, (o, north, east, up) => {
        const frame = frameAt(o.lat, o.lng);

        const a = fusedGpsFrom(frame, { x: north, y: up, z: east });
        const b = fusedGpsFrom(frame, { x: north, y: -up, z: -east });

        expect(a?.lat).toBe(b?.lat);
      }),
    );
  });

  it("lets NOTHING but the east term move longitude, at any origin latitude", () => {
    fc.assert(
      fc.property(origin, metres, metres, metres, (o, north, east, up) => {
        const frame = frameAt(o.lat, o.lng);

        const a = fusedGpsFrom(frame, { x: north, y: up, z: east });
        const b = fusedGpsFrom(frame, { x: -north, y: -up, z: east });

        expect(a?.lng).toBe(b?.lng);
      }),
    );
  });

  it("moves latitude the same way the north term moves, everywhere", () => {
    // Monotonicity, but over arbitrary origins and with a non-zero east term
    // present — the example-based version walks one meridian at `z: 0`.
    //
    // THE STEP HAS A FLOOR, AND THE FIRST DRAFT WITHOUT ONE FAILED. A bare
    // `step > 0` admits denormal doubles, and latitude is
    // `origin + step / 111320`, so a step of 5e-324 m cannot move a latitude
    // of ~50 whatever the implementation does — the property was false as
    // stated, not violated by the code. One centimetre is below anything GPS
    // or SLAM resolves and still ~1e7 times the double spacing at that
    // magnitude, so the assertion is strict rather than approximate.
    fc.assert(
      fc.property(
        origin,
        metres,
        stepMetres,
        metres,
        (o, north, step, east) => {
          const frame = frameAt(o.lat, o.lng);

          const here = fusedGpsFrom(frame, { x: north, y: 0, z: east });
          const further = fusedGpsFrom(frame, {
            x: north + step,
            y: 0,
            z: east,
          });

          expect(further?.lat).toBeGreaterThan(here?.lat ?? Number.NaN);
        },
      ),
    );
  });

  it("reports nothing for a non-finite horizontal term, and a position for a non-finite height", () => {
    // The readout's rule stated as a property: unmeasured is omitted, never
    // rendered — but height is a different source and must not suppress a good
    // horizontal fix. `y` is the one term allowed to be garbage.
    const broken = fc.constantFrom(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    );

    fc.assert(
      fc.property(origin, metres, broken, (o, good, bad) => {
        const frame = frameAt(o.lat, o.lng);

        expect(fusedGpsFrom(frame, { x: bad, y: 0, z: good })).toBeUndefined();
        expect(fusedGpsFrom(frame, { x: good, y: 0, z: bad })).toBeUndefined();
        expect(fusedGpsFrom(frame, { x: good, y: bad, z: good })).toBeDefined();
      }),
    );
  });
});
