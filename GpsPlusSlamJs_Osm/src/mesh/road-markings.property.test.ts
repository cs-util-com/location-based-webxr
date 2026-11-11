import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import { enuFrameAt } from "./enu.js";
import { ZEBRA_PARAMS, zebraCrossings } from "./road-markings.js";

/**
 * WHY THESE PROPERTIES MATTER. Paint is a claim about the ground a walker can
 * check: every stripe must lie on its crossing (never past its ends), the
 * stripes must never touch or overlap at any pitch the sweep tries, and a
 * crossing mapped both as a way and as its node must be painted once
 * whatever the order the features arrive in.
 *
 * Arbitraries draw integers and map them (lessons-learned: a bounded
 * `fc.double` biases toward 0 and its bounds).
 */
const FRAME = enuFrameAt({ lat: 49.41, lng: 8.69 });
const at = (x: number, y: number): { lat: number; lng: number } =>
  FRAME.toLatLng({ x, y });

function crossing(
  points: readonly { x: number; y: number }[],
  id: number,
): OsmFeature {
  return {
    type: "way",
    id,
    tags: { highway: "footway", footway: "crossing", crossing: "zebra" },
    geometry: points.map((p) => at(p.x, p.y)),
  } as unknown as OsmFeature;
}

const coordinate = fc.integer({ min: -4000, max: 4000 }).map((v) => v / 100);
const point = fc.record({ x: coordinate, y: coordinate });
const pitch = fc.integer({ min: 6, max: 20 }).map((v) => v / 10);

describe("zebra stripes properties", () => {
  it("lie on their straight crossing, a whole pitch apart, as many as fit", () => {
    fc.assert(
      fc.property(point, point, pitch, (a, b, pitchM) => {
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        fc.pre(length > 0.01);
        const stripes = zebraCrossings([crossing([a, b], 1)], FRAME, {
          pitchM,
        }).flatMap((c) => c.stripes);
        // Projection round trips cost micrometres; a pitch is a metre.
        expect(Math.abs(stripes.length - length / pitchM)).toBeLessThan(1.001);
        const dx = (b.x - a.x) / length;
        const dy = (b.y - a.y) / length;
        stripes.forEach((s) => {
          const along = (s.cx - a.x) * dx + (s.cy - a.y) * dy;
          const off = (s.cx - a.x) * -dy + (s.cy - a.y) * dx;
          expect(Math.abs(off)).toBeLessThan(1e-3);
          expect(along).toBeGreaterThanOrEqual(ZEBRA_PARAMS.barM / 2 - 1e-3);
          expect(along).toBeLessThanOrEqual(
            length - ZEBRA_PARAMS.barM / 2 + 1e-3,
          );
          // Perpendicular to the walk, unit length.
          expect(Math.abs(s.ux * dx + s.uy * dy)).toBeLessThan(1e-3);
          expect(Math.hypot(s.ux, s.uy)).toBeCloseTo(1, 6);
        });
        // Neighbours a whole pitch apart, never touching.
        stripes.slice(1).forEach((next, i) => {
          const s = stripes[i] as (typeof stripes)[number];
          const gap = Math.hypot(next.cx - s.cx, next.cy - s.cy);
          expect(gap).toBeCloseTo(pitchM, 3);
          expect(gap).toBeGreaterThan(s.widthM);
        });
      }),
    );
  });

  it("paint a crossing mapped as a way and its node once, in any order", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 30 }),
        fc.integer({ min: 0, max: 2 }),
        (span, insert) => {
          const street = {
            type: "way",
            id: 10,
            tags: { highway: "residential" },
            geometry: [at(-40, 0), at(0, 0), at(40, 0)],
          } as unknown as OsmFeature;
          const way = crossing(
            [
              { x: 0, y: -span / 2 },
              { x: 0, y: 0 },
              { x: 0, y: span / 2 },
            ],
            11,
          );
          const node = {
            type: "node",
            id: 12,
            position: at(0, 0),
            tags: { crossing: "zebra" },
          } as OsmFeature;
          const features: OsmFeature[] = [street, way];
          features.splice(insert, 0, node);
          const crossings = zebraCrossings(features, FRAME);
          expect(crossings.map((c) => c.feature)).toEqual(["way/11"]);
        },
      ),
    );
  });
});
