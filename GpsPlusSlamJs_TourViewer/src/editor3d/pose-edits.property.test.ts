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
import * as THREE from "three";
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
  // knob's whole degrees); heading-only, upright-rotation, tilted and
  // near-vertical poses; any start heading. Verdict: back on its heading
  // within `turnBound` scaled by `reach`, its rotation within 1e-9.
  //
  // The heading is ill-conditioned, the rotation is not. A rotation's
  // heading is the bearing of its x axis's shadow on the ground, and that
  // shadow is `reach` long, so a rounding of e moves the bearing by
  // e / reach. A pose standing 3.7e-8 rad off vertical came back after 72
  // steps of 5 degrees with its rotation 1.5e-15 rad away (8.6e-14 degrees,
  // 1.5e-13 m at 100 m), and its heading read 1.1e-6 degrees away. So what
  // is judged is the shadow's tip, the heading error times `reach`. For an
  // upright pose that bound is about 4e-12 degrees, where a flat 1e-6 could
  // not have seen a real drift of a million times the rounding.
  //
  // The bound, from the arithmetic: one turn rounds a Hamilton product and
  // a normalise (a heading-only pose: a sum near 360, 2.2 EPS in radians),
  // at most 4 EPS of angle. The two readings of the heading add their
  // rotation of a vector, an atan2 and the degrees near 360: 32 EPS.
  // Swept at 20,000 poses for 24, 72, 360 and 720 steps, 200 to 2,000 for
  // 3,600 to 36,000, half near vertical (reach 3e-9 to 1): worst 16.9 EPS
  // at 24 steps, 16.5 at 72, 33.7 at 360, 117 at 720, 252 at 3,600, 483 at
  // 7,200, 1,546 at 36,000, about 0.04 EPS a step. A bound with under 17
  // EPS for the readings, or under 0.05 EPS a step, would be false.
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
    // The x axis up to 3e-9 rad off straight up or down, any way round:
    // the plain draws above almost never come here.
    fc
      .tuple(
        fc.double({ min: 0, max: 8.5, noNaN: true }),
        fc.constantFrom(1, -1),
        fc.double({ min: 0, max: 7, noNaN: true }),
        fc.double({ min: 0, max: 7, noNaN: true }),
      )
      .map(([tens, side, yaw, roll]): QrGeoPose => {
        const pitch = side * (Math.PI / 2 - 10 ** -tens);
        const q = new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
          .multiply(
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 0, 1),
              pitch,
            ),
          )
          .multiply(
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(1, 0, 0),
              roll,
            ),
          );
        return { lat: 48, lon: 11, alt: 500, rotation: [q.x, q.y, q.z, q.w] };
      }),
  );
  /** How long the shadow of a pose's x axis is on the ground, 1 for a
   *  heading-only pose. */
  const reach = (pose: QrGeoPose): number => {
    if (pose.rotation === undefined) return 1;
    const x = new THREE.Vector3(1, 0, 0).applyQuaternion(
      new THREE.Quaternion(...pose.rotation),
    );
    return Math.hypot(x.x, x.z);
  };
  /** Below this no heading is judged: `headingOfGeo` says 0 for a shadow
   *  under 1e-9, so one side of that edge reads a heading, the other 0. */
  const MIN_REACH = 3e-9;
  /** See above: rad of the shadow's tip, rounding only, after `steps`. */
  const turnBound = (steps: number): number =>
    (4 * steps + 32) * Number.EPSILON;
  // Seed 1321291551's counterexample: standing 3.7e-8 rad off vertical.
  const STANDING_ON_END: QrGeoPose = {
    lat: 48,
    lon: 11,
    alt: 500,
    rotation: [0, 0, 0.7071067682518813, 0.7071067941212137],
  };
  for (const stepDeg of [1, 5, 15]) {
    it(`returns the heading after 360 degrees in ${String(stepDeg)}-degree steps`, () => {
      fc.assert(
        fc.property(poses, (start) => {
          let at = start;
          const steps = 360 / stepDeg;
          for (let i = 0; i < steps; i++) at = turnedGeo(at, stepDeg);
          const shadow = reach(start);
          const offDeg = angleDiffDeg(headingOfGeo(start), headingOfGeo(at));
          const tipOff =
            shadow < MIN_REACH
              ? 0
              : (Math.abs(offDeg) * Math.PI * shadow) / 180;
          expect(tipOff).toBeLessThan(turnBound(steps));
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
        { numRuns: 80, examples: [[STANDING_ON_END]] },
      );
    });
  }
});
