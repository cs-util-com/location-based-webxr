import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import type { Bbox } from "../spatial/clip.js";
import { enuFrameAt } from "./enu.js";
import {
  buildStreetFurniture,
  furnitureWithinCut,
} from "./street-furniture.js";

/**
 * WHY THESE PROPERTIES MATTER. The cut decides what the renderer packs, so
 * it must keep exactly the items within the cut (a kept item outside it is a
 * lamp popping in too early; a dropped one inside it is a hole in the street),
 * and building must be a pure function of the nodes (the same placements on
 * every rebuild and in any input order, or the street flickers on refresh).
 *
 * Arbitraries draw integers and map them (lessons-learned: a bounded
 * `fc.double` biases toward 0 and its bounds and is not the bound it reads as).
 */
const point = fc.record({
  x: fc.integer({ min: -2000, max: 2000 }).map((v) => v / 10),
  y: fc.integer({ min: -2000, max: 2000 }).map((v) => v / 10),
});

describe("furnitureWithinCut properties", () => {
  it("keeps exactly the items within the cut", () => {
    fc.assert(
      fc.property(
        fc.array(point, { maxLength: 40 }),
        point,
        fc.integer({ min: 1, max: 3000 }).map((v) => v / 10),
        (positions, eye, cutM) => {
          const items = positions.map((position) => ({ position }));
          const kept = new Set(furnitureWithinCut(items, eye, cutM));
          positions.forEach((p, i) => {
            const d = Math.hypot(p.x - eye.x, p.y - eye.y);
            expect(kept.has(i)).toBe(d <= cutM);
          });
        },
      ),
    );
  });
});

describe("buildStreetFurniture properties", () => {
  const origin = { lat: 49.41, lng: 8.69 };
  const frame = enuFrameAt(origin);
  const window: Bbox = { south: 49.0, west: 8.0, north: 50.0, east: 9.0 };
  const kinds: readonly Readonly<Record<string, string>>[] = [
    { highway: "street_lamp" },
    { highway: "street_lamp", lamp_mount: "wall" },
    { barrier: "bollard" },
    { amenity: "bench" },
    { amenity: "waste_basket", direction: "135" },
  ];
  const nodes = fc
    .array(
      fc.record({
        p: point,
        kind: fc.integer({ min: 0, max: kinds.length - 1 }),
      }),
      { maxLength: 30 },
    )
    .map((list) =>
      list.map(({ p, kind }, i): OsmFeature => ({
        type: "node",
        id: i + 1,
        position: frame.toLatLng(p),
        tags: kinds[kind] ?? {},
      })),
    );

  it("gives each node the same placement in any input order", () => {
    fc.assert(
      fc.property(nodes, (features) => {
        const forward = buildStreetFurniture(features, { frame, window });
        const backward = buildStreetFurniture([...features].reverse(), {
          frame,
          window,
        });
        const byKey = new Map(backward.map((item) => [item.key, item]));
        expect(backward).toHaveLength(forward.length);
        for (const item of forward) expect(byKey.get(item.key)).toEqual(item);
      }),
    );
  });
});
