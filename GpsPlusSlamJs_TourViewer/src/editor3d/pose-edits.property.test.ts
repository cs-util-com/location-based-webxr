/**
 * Why these tests matter: a creator nudges with the arrow keys and turns
 * with Q and E many times over, and expects the way back to land where
 * they started - n nudges then n back within a millimetre, a whole turn
 * in steps back on its heading. Drift there means a station that creeps
 * a little further every session. Each property is swept over the ranges
 * the editor meets (the parameter rule): the step sizes the keys use,
 * latitudes from the equator to 80 degrees, flat and steep ground, and
 * heading-only, upright and tilted poses.
 */
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import { createTourViewerStore } from "../tour-viewer-session.js";
import { headingOfGeo, nudgedGeo, turnedGeo } from "./pose-edits.js";

// The core's geodesy runs only once a store activated it.
beforeAll(() => {
  createTourViewerStore();
});
import { angleDiffDeg } from "./gizmo-maths.js";

/** A rolling ground of amplitude `a` metres (the test's own). */
function rolling(a: number) {
  return (p: { lat: number; lon: number }) =>
    400 + a * Math.sin(p.lat * 9000) * Math.cos(p.lon * 7000);
}

/** The horizontal and vertical gap between two poses (m). */
function gap(a: QrGeoPose, b: QrGeoPose): number {
  const north = (b.lat - a.lat) * 111_320;
  const east = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(north, east, b.alt - a.alt);
}

describe("n nudges then n back", () => {
  // Swept: step 0.1 m and 1 m (the keys), n 1-200, latitude -80..80,
  // ground amplitude 0, 10 and 100 m. Verdict: identity within 1 mm across
  // the whole range.
  for (const stepM of [0.1, 1]) {
    for (const amplitude of [0, 10, 100]) {
      it(`returns within 1 mm (step ${String(stepM)} m, ground +-${String(amplitude)} m)`, () => {
        const ground = rolling(amplitude);
        fc.assert(
          fc.property(
            fc.double({ min: -80, max: 80, noNaN: true }),
            fc.double({ min: -179, max: 179, noNaN: true }),
            fc.integer({ min: 1, max: 200 }),
            fc.constantFrom(
              [1, 0] as const,
              [-1, 0] as const,
              [0, 1] as const,
              [0, -1] as const,
            ),
            fc.double({ min: 0, max: 30, noNaN: true }),
            (lat, lon, n, [e, nn], above) => {
              const start: QrGeoPose = {
                lat,
                lon,
                alt: ground({ lat, lon }) + above,
                headingDeg: 0,
              };
              let at: QrGeoPose = start;
              for (let i = 0; i < n; i++) {
                at = nudgedGeo(at, e * stepM, nn * stepM, ground);
              }
              for (let i = 0; i < n; i++) {
                at = nudgedGeo(at, -e * stepM, -nn * stepM, ground);
              }
              expect(gap(start, at)).toBeLessThan(1e-3);
            },
          ),
          { numRuns: 60 },
        );
      });
    }
  }
});

describe("a whole turn in steps", () => {
  // Swept: steps of 1, 5 and 15 degrees (the keys' 5 and 15, and the
  // knob's whole degrees); heading-only, upright-rotation and tilted
  // poses; any start heading. Verdict: back on its heading within 1e-6
  // degrees, its rotation within 1e-9.
  const poses = fc.oneof(
    fc
      .double({ min: 0, max: 359.999, noNaN: true })
      .map((h): QrGeoPose => ({ lat: 48, lon: 11, alt: 500, headingDeg: h })),
    fc.double({ min: 0, max: 359.999, noNaN: true }).map((h): QrGeoPose => {
      const half = (-h * Math.PI) / 360;
      return {
        lat: 48,
        lon: 11,
        alt: 500,
        rotation: [0, Math.sin(half), 0, Math.cos(half)],
        headingDeg: h,
      };
    }),
    fc
      .tuple(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 0.1, max: 1, noNaN: true }),
      )
      .map(([x, y, z, w]): QrGeoPose => {
        const l = Math.hypot(x, y, z, w);
        return {
          lat: 48,
          lon: 11,
          alt: 500,
          rotation: [x / l, y / l, z / l, w / l],
        };
      }),
  );
  for (const stepDeg of [1, 5, 15]) {
    it(`returns the heading after 360 degrees in ${String(stepDeg)}-degree steps`, () => {
      fc.assert(
        fc.property(poses, (start) => {
          let at = start;
          for (let i = 0; i < 360 / stepDeg; i++) at = turnedGeo(at, stepDeg);
          expect(
            Math.abs(angleDiffDeg(headingOfGeo(start), headingOfGeo(at))),
          ).toBeLessThan(1e-6);
          // A rotation stays a rotation, and comes back to itself (a
          // heading-only pose compares as the identity with itself).
          expect(at.rotation === undefined).toBe(start.rotation === undefined);
          const identity = [0, 0, 0, 1] as const;
          const before = start.rotation ?? identity;
          const after = at.rotation ?? identity;
          const dot = before.reduce((s, v, i) => s + v * (after[i] ?? 0), 0);
          expect(1 - Math.abs(dot)).toBeLessThan(1e-9);
          expect(at.lat).toBe(start.lat);
          expect(at.alt).toBe(start.alt);
        }),
        { numRuns: 80 },
      );
    });
  }
});
