import { describe, expect, it } from "vitest";

import { fusedGpsFrom } from "./ar-fused-gps.js";

/**
 * Tests for the back-projection of the AR pose into GPS (J7, DEC-J10).
 *
 * **Why these tests matter, and why this is a module rather than three inline
 * lines.** The scene root is NUE — `x` North, `y` Up, `z` East — and the ENU
 * frame the demo already carries takes `{x: east, y: north}`. Those two are
 * transposed with respect to each other, and a silent transposition here yields
 * a coordinate that is perfectly plausible and in the wrong place: the reader
 * would see six decimals of precision pointing somewhere the user has never
 * been. `ar-scene-hierarchy.ts` records two independent readers getting this
 * frame backwards, which is the argument for pinning it.
 *
 * The frame is a STRUCTURAL stub here, matching `ar-origin.ts`'s convention of
 * not importing a type for a two-field shape.
 */

/** The flat-earth inverse the OSM package provides, in miniature. */
const METRES_PER_DEG_LAT = 111_320;

function frameAt(origin: { lat: number; lng: number }) {
  const metresPerDegLng =
    METRES_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return {
    toLatLng(point: { x: number; y: number }) {
      return {
        lat: origin.lat + point.y / METRES_PER_DEG_LAT,
        lng: origin.lng + point.x / metresPerDegLng,
      };
    },
  };
}

const COLOGNE = { lat: 50.9413, lng: 6.9583 };

describe("fusedGpsFrom", () => {
  it("returns the origin for a camera sitting on it", () => {
    const at = fusedGpsFrom(frameAt(COLOGNE), { x: 0, y: 0, z: 0 });

    expect(at?.lat).toBeCloseTo(COLOGNE.lat, 9);
    expect(at?.lng).toBeCloseTo(COLOGNE.lng, 9);
  });

  it("maps the NUE X axis to NORTH, leaving longitude alone", () => {
    // THE ASSERTION THAT PINS THE TRANSPOSITION. A swapped axis moves longitude
    // here instead of latitude, and both results look like coordinates.
    const north = fusedGpsFrom(frameAt(COLOGNE), { x: 111.32, y: 0, z: 0 });

    expect(north?.lat).toBeCloseTo(COLOGNE.lat + 0.001, 6);
    expect(north?.lng).toBeCloseTo(COLOGNE.lng, 9);
  });

  it("maps the NUE Z axis to EAST, leaving latitude alone", () => {
    const east = fusedGpsFrom(frameAt(COLOGNE), { x: 0, y: 0, z: 111.32 });

    expect(east?.lat).toBeCloseTo(COLOGNE.lat, 9);
    expect(east?.lng).toBeGreaterThan(COLOGNE.lng);
  });

  it("ignores the UP axis entirely", () => {
    // `y` is height. A version that fed it into either horizontal term would
    // move the reported position when the user raised the phone.
    const low = fusedGpsFrom(frameAt(COLOGNE), { x: 40, y: 0, z: 25 });
    const high = fusedGpsFrom(frameAt(COLOGNE), { x: 40, y: 900, z: 25 });

    expect(high).toEqual(low);
  });

  it("is monotonic northward, for any displacement", () => {
    // A property rather than a third example: the axis mapping either holds for
    // every displacement or is wrong, and a handful of literals can agree with a
    // transposed implementation by coincidence of sign.
    const frame = frameAt(COLOGNE);
    let previous = Number.NEGATIVE_INFINITY;
    for (let north = -500; north <= 500; north += 25) {
      const at = fusedGpsFrom(frame, { x: north, y: 3, z: 0 });
      const lat = at?.lat ?? Number.NaN;
      expect(lat).toBeGreaterThan(previous);
      previous = lat;
    }
  });

  it("reports NOTHING rather than a plausible wrong place for bad input", () => {
    // The same rule the rest of this readout follows: an unmeasured value is
    // omitted, never rendered. A NaN reaching the formatter would print
    // "fused gps NaN, NaN", which is at least visible — but an Infinity would
    // print a real-looking number, and this line exists to be trusted.
    const frame = frameAt(COLOGNE);

    expect(fusedGpsFrom(frame, { x: Number.NaN, y: 0, z: 0 })).toBeUndefined();
    expect(
      fusedGpsFrom(frame, { x: 0, y: 0, z: Number.POSITIVE_INFINITY }),
    ).toBeUndefined();
    // `y` is unused, and an unusable value there must NOT suppress a position
    // that is otherwise perfectly good — the height comes from a different
    // source than the horizontal terms.
    expect(fusedGpsFrom(frame, { x: 10, y: Number.NaN, z: 10 })).toBeDefined();
  });
});
