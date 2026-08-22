import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { enuFrameAt } from "gps-plus-slam-osm";

import {
  QUEST_BEACON_HOVER_M,
  questBeaconPlacements,
} from "./quest-beacon-placement.js";
import { type Heightfield } from "./heightfield.js";

/**
 * The beacon's frame holds for ANY origin and ANY quest position.
 *
 * **Why this test matters, and why examples were not enough.** The example
 * suite pins the transform at one origin near 51° N. The ENU frame's longitude
 * scale is latitude-dependent, so a transposed or mirrored implementation makes
 * an error that changes size with latitude and shrinks toward the equator — it
 * can agree with a table of examples taken at a single place. The fifteenth
 * session's review made exactly this point about `ar-fused-gps.ts`, and this
 * module has the same shape.
 *
 * The properties are about INDEPENDENCE and MONOTONICITY rather than about the
 * arithmetic: asserting the output equals `toEnu` with the axes swapped would
 * restate the implementation and prove nothing.
 */

const origin = fc.record({
  // Poles excluded: `cos(lat)` reaches 0 there and the frame's longitude scale
  // diverges — a property of the flat-earth frame, not of this mapping.
  lat: fc.double({ min: -70, max: 70, noNaN: true }),
  lng: fc.double({ min: -179, max: 179, noNaN: true }),
});

/** Degrees, small enough to stay inside a sane local frame. */
const offsetDeg = fc.double({ min: -0.02, max: 0.02, noNaN: true });

/** A field wide enough that nothing in these properties falls outside it. */
function wideField(relief: number): Heightfield {
  return {
    heights: new Float32Array(),
    side: 0,
    extentM: 1e9,
    centreEnu: { x: 0, y: 0 },
    hasData: true,
    heightAt: () => relief,
  } as unknown as Heightfield;
}

describe("quest beacon placement, as a property", () => {
  it("lets NOTHING but latitude move the north axis, at any origin", () => {
    fc.assert(
      fc.property(origin, offsetDeg, offsetDeg, (o, dLat, dLng) => {
        const frame = enuFrameAt(o);
        const field = wideField(0);

        const a = questBeaconPlacements(
          [{ position: { lat: o.lat + dLat, lng: o.lng + dLng } }],
          frame,
          field,
        );
        const b = questBeaconPlacements(
          [{ position: { lat: o.lat + dLat, lng: o.lng - dLng } }],
          frame,
          field,
        );

        // Mirroring the LONGITUDE offset must not touch `z`, which is north.
        expect(a[0]?.z).toBeCloseTo(b[0]?.z ?? Number.NaN, 9);
      }),
    );
  });

  it("lets NOTHING but longitude move the east axis, at any origin", () => {
    fc.assert(
      fc.property(origin, offsetDeg, offsetDeg, (o, dLat, dLng) => {
        const frame = enuFrameAt(o);
        const field = wideField(0);

        const a = questBeaconPlacements(
          [{ position: { lat: o.lat + dLat, lng: o.lng + dLng } }],
          frame,
          field,
        );
        const b = questBeaconPlacements(
          [{ position: { lat: o.lat - dLat, lng: o.lng + dLng } }],
          frame,
          field,
        );

        expect(a[0]?.x).toBeCloseTo(b[0]?.x ?? Number.NaN, 9);
      }),
    );
  });

  it("moves north to -z monotonically, everywhere", () => {
    fc.assert(
      fc.property(
        origin,
        // A FLOOR ON THE STEP, and the reason is a lesson from this repo's own
        // history: a bare `> 0` admits denormal doubles, which cannot move a
        // metre-scale value at all, and the property would be false as stated
        // rather than violated by the code.
        fc.double({ min: 0.0001, max: 0.02, noNaN: true }),
        (o, step) => {
          const frame = enuFrameAt(o);
          const field = wideField(0);

          const here = questBeaconPlacements([{ position: o }], frame, field);
          const further = questBeaconPlacements(
            [{ position: { lat: o.lat + step, lng: o.lng } }],
            frame,
            field,
          );

          expect(further[0]?.z).toBeLessThan(here[0]?.z ?? Number.NaN);
        },
      ),
    );
  });

  it("always hovers exactly the same height above whatever ground it found", () => {
    // The invariant the connecting line depends on: `y - groundY` is the hover,
    // whether the ground was measured or assumed. A beacon whose icon and line
    // disagreed would draw a stalk that misses its own marker.
    fc.assert(
      fc.property(
        origin,
        offsetDeg,
        fc.double({ min: -400, max: 4000, noNaN: true }),
        (o, d, relief) => {
          const placements = questBeaconPlacements(
            [{ position: { lat: o.lat + d, lng: o.lng + d } }],
            enuFrameAt(o),
            wideField(relief),
          );

          const placed = placements[0];
          expect(placed).toBeDefined();
          expect((placed?.y ?? 0) - (placed?.groundY ?? 0)).toBeCloseTo(
            QUEST_BEACON_HOVER_M,
            9,
          );
        },
      ),
    );
  });
});
