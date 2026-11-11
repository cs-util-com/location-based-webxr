import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import type { Bbox } from "../spatial/clip.js";
import { enuFrameAt } from "./enu.js";
import type { MeshData } from "./mesh-data.js";
import { buildPedestrianAreas } from "./pedestrian-areas.js";

/**
 * WHY THESE PROPERTIES MATTER. Cutting a square along the terrain's post
 * lines must not change what is covered: the cut pieces add up to the
 * polygon's own area at every spacing the sweep tries, so a square is never
 * left with a hole or doubled where a cut line runs through it, and every
 * triangle faces up (a down-facing one is culled and leaves a hole).
 *
 * Arbitraries draw integers and map them (lessons-learned: a bounded
 * `fc.double` biases toward 0 and its bounds).
 */
const FRAME = enuFrameAt({ lat: 49.41, lng: 8.69 });
const at = (x: number, y: number): { lat: number; lng: number } =>
  FRAME.toLatLng({ x, y });
const WIDE: Bbox = { south: 49.3, west: 8.6, north: 49.5, east: 8.8 };

/** Plan area and the smallest face-up value, render frame (z = -north). */
function measure(mesh: MeshData): { area: number; leastUp: number } {
  let area = 0;
  let leastUp = Number.POSITIVE_INFINITY;
  const p = (v: number, axis: number): number =>
    mesh.positions[v * 3 + axis] ?? Number.NaN;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] ?? 0;
    const b = mesh.indices[t + 1] ?? 0;
    const c = mesh.indices[t + 2] ?? 0;
    const up =
      (p(b, 2) - p(a, 2)) * (p(c, 0) - p(a, 0)) -
      (p(b, 0) - p(a, 0)) * (p(c, 2) - p(a, 2));
    area += Math.abs(up) / 2;
    leastUp = Math.min(leastUp, up);
  }
  return { area, leastUp };
}

describe("pedestrian area properties", () => {
  it("cover the polygon's own area, facing up, at any spacing", () => {
    // A random star-shaped ring around a centre: simple by construction.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 30, max: 400 }), {
          minLength: 3,
          maxLength: 12,
        }),
        fc.integer({ min: -300, max: 300 }),
        fc.integer({ min: 2, max: 48 }),
        (radii, offset, spacingM) => {
          const centre = offset / 10;
          const ring = radii.map((r, i) => {
            const angle = (i / radii.length) * Math.PI * 2;
            return {
              x: centre + (r / 10) * Math.cos(angle),
              y: centre + (r / 10) * Math.sin(angle),
            };
          });
          let twice = 0;
          ring.forEach((a, i) => {
            const b = ring[(i + 1) % ring.length] ?? a;
            twice += a.x * b.y - b.x * a.y;
          });
          const closed = [...ring, ring[0] ?? { x: 0, y: 0 }];
          const feature = {
            type: "way",
            id: 1,
            tags: { highway: "pedestrian", area: "yes" },
            geometry: closed.map((q) => at(q.x, q.y)),
          } as unknown as OsmFeature;
          const built = buildPedestrianAreas([feature], {
            frame: FRAME,
            window: WIDE,
            spacingM,
          });
          expect(built).toHaveLength(1);
          const { area, leastUp } = measure(
            (built[0] as { mesh: MeshData }).mesh,
          );
          const expected = Math.abs(twice) / 2;
          expect(Math.abs(area - expected)).toBeLessThan(
            1e-3 * expected + 0.01,
          );
          expect(leastUp).toBeGreaterThan(0);
        },
      ),
    );
  });
});
