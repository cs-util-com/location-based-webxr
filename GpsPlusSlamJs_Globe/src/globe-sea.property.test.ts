import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { GLOBE_SEA, seaWaveCoord, seaWavePhase } from "./globe-sea.js";

/** The distance between two coordinates on the noise's torus. */
const wrapped = (a: number, b: number) => {
  const d = Math.abs(a - b) % GLOBE_SEA.noiseCells;
  return Math.min(d, GLOBE_SEA.noiseCells - d);
};

const metres = fc.double({ min: -2e7, max: 2e7, noNaN: true });
const near = fc.double({ min: -3000, max: 3000, noNaN: true });

describe("the waves' coordinates", () => {
  // Why: this is what "the waves stay put on the sea" means. A point of
  // the sea keeps its noise coordinate however far the camera has flown,
  // though the shader only ever sees metres from the camera and a phase.
  it("hold a point of the sea still under the camera's travel", () => {
    fc.assert(
      fc.property(
        fc.tuple(metres, metres),
        fc.tuple(near, near),
        fc.tuple(near, near),
        fc.integer({ min: 0, max: 7 }),
        fc.double({ min: 0, max: 2e9, noNaN: true }),
        (camera, point, move, octave, timeS) => {
          const coord = (cam: [number, number], at: [number, number]) =>
            seaWaveCoord(at, seaWavePhase(cam, timeS, octave, 8), octave, 8);
          const before = coord(camera, point);
          const after = coord(
            [camera[0] + move[0], camera[1] + move[1]],
            [point[0] - move[0], point[1] - move[1]],
          );
          expect(wrapped(before[0], after[0])).toBeLessThan(1e-3);
          expect(wrapped(before[1], after[1])).toBeLessThan(1e-3);
        },
      ),
    );
  });

  // Why: the waves run on the wind: one second moves an octave's noise by
  // its deep-water speed over its length, so long waves pass slower cells.
  it("travel at the octave's speed with time", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 7 }), (octave) => {
        const lam = 8 * 2 ** octave;
        const speed = Math.sqrt((9.81 * lam) / (2 * Math.PI)) * 1.6;
        const a = seaWavePhase([0, 0], 100, octave, 8);
        const b = seaWavePhase([0, 0], 101, octave, 8);
        expect(wrapped(a[0] - b[0], speed / lam)).toBeLessThan(1e-6);
        expect(a[1]).toBe(b[1]);
      }),
    );
  });
});
