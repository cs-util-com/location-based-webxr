import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import type { Bbox } from "../spatial/clip.js";
import { buildCosmeticTrees } from "./cosmetic-trees.js";
import { enuFrameAt, signedArea2, type EnuPoint } from "./enu.js";

/**
 * WHY THESE PROPERTIES MATTER. The three promises the module makes are
 * statistical or global, so examples cannot prove them: a wood is as dense as
 * asked whatever its shape; the same wood gives the same trees in any frame
 * and in any input order (OsmDemo re-anchors, the globe frames each city
 * differently); and no tree is ever placed outside the fetched window.
 *
 * Arbitraries draw integers and map them (lessons-learned: a bounded
 * `fc.double` is not the bound it reads as).
 */
const BASE = { lat: 47.903, lng: 8.107 };
const WIDE: Bbox = { south: 47.0, west: 7.0, north: 49.0, east: 9.0 };

/** A star-shaped (so simple) polygon around the base, radii in metres. */
const starPolygon = fc
  .array(fc.integer({ min: 60, max: 160 }), { minLength: 5, maxLength: 14 })
  .map((radii) =>
    radii.map((r, k) => {
      const a = (2 * Math.PI * k) / radii.length;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    }),
  );

const ringOf = (points: readonly EnuPoint[], origin: LatLng): LatLng[] => {
  const frame = enuFrameAt(origin);
  const ring = points.map((p) => frame.toLatLng(p));
  return [...ring, ring[0]!];
};

const woodOf = (ring: LatLng[], id: number): OsmFeature => ({
  type: "way",
  id,
  tags: { natural: "wood" },
  geometry: ring,
});

/** A frame origin up to 5 km from the base, in whole metres. */
const offsetOrigin = fc
  .record({
    dx: fc.integer({ min: -5000, max: 5000 }),
    dy: fc.integer({ min: -5000, max: 5000 }),
  })
  .map(({ dx, dy }) => enuFrameAt(BASE).toLatLng({ x: dx, y: dy }));

describe("cosmetic trees, properties", () => {
  it("fills a simple polygon above 1 ha within 10 % of the target density", () => {
    fc.assert(
      fc.property(
        starPolygon,
        fc.constantFrom(0.005, 0.01, 0.02),
        (star, d) => {
          const areaM2 = Math.abs(signedArea2(star)) / 2;
          fc.pre(areaM2 > 10_000);
          const frame = enuFrameAt(BASE);
          const trees = buildCosmeticTrees([woodOf(ringOf(star, BASE), 1)], {
            frame,
            window: WIDE,
            densityPerM2: d,
            cap: Number.POSITIVE_INFINITY,
          });
          const ratio = trees.length / (areaM2 * d);
          expect(ratio).toBeGreaterThan(0.9);
          expect(ratio).toBeLessThan(1.1);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("places the same trees in any frame, to 1 mm", () => {
    fc.assert(
      fc.property(starPolygon, offsetOrigin, (star, origin) => {
        const wood = [woodOf(ringOf(star, BASE), 7)];
        const a = enuFrameAt(BASE);
        const b = enuFrameAt(origin);
        const inA = buildCosmeticTrees(wood, { frame: a, window: WIDE });
        const inB = buildCosmeticTrees(wood, { frame: b, window: WIDE });
        expect(inB.map((t) => t.key)).toEqual(inA.map((t) => t.key));
        const mPerDegLat = 111_000;
        inA.forEach((t, k) => {
          const p = a.toLatLng(t.position);
          const q = b.toLatLng(inB[k]!.position);
          const mPerDegLng = mPerDegLat * Math.cos((p.lat * Math.PI) / 180);
          expect(Math.abs(p.lat - q.lat) * mPerDegLat).toBeLessThan(0.001);
          expect(Math.abs(p.lng - q.lng) * mPerDegLng).toBeLessThan(0.001);
        });
      }),
      { numRuns: 40 },
    );
  });

  it("does not depend on the order the features arrive in", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            star: starPolygon,
            dx: fc.integer({ min: -150, max: 150 }),
            dy: fc.integer({ min: -150, max: 150 }),
          }),
          { minLength: 2, maxLength: 4 },
        ),
        fc.integer({ min: 0, max: 1_000_000 }),
        (woods, seed) => {
          const frame = enuFrameAt(BASE);
          // Overlapping woods, so the shared cells are what is at stake.
          const features = woods.map(({ star, dx, dy }, k) =>
            woodOf(
              ringOf(
                star.map((p) => ({ x: p.x + dx, y: p.y + dy })),
                BASE,
              ),
              k + 1,
            ),
          );
          const shuffled = [...features].sort(
            (x, y) =>
              ((x.id * 7919 + seed) % 101) - ((y.id * 7919 + seed) % 101),
          );
          const forward = buildCosmeticTrees(features, { frame, window: WIDE });
          const other = buildCosmeticTrees(shuffled, { frame, window: WIDE });
          expect(other).toEqual(forward);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("never places a tree outside the window", () => {
    fc.assert(
      fc.property(
        starPolygon,
        fc.record({
          x0: fc.integer({ min: -200, max: 100 }),
          y0: fc.integer({ min: -200, max: 100 }),
          w: fc.integer({ min: 5, max: 300 }),
          h: fc.integer({ min: 5, max: 300 }),
        }),
        (star, { x0, y0, w, h }) => {
          const frame = enuFrameAt(BASE);
          const sw = frame.toLatLng({ x: x0, y: y0 });
          const ne = frame.toLatLng({ x: x0 + w, y: y0 + h });
          const window = {
            south: sw.lat,
            west: sw.lng,
            north: ne.lat,
            east: ne.lng,
          };
          const trees = buildCosmeticTrees(
            [
              woodOf(ringOf(star, BASE), 1),
              {
                type: "way",
                id: 2,
                tags: { natural: "tree_row" },
                geometry: [
                  frame.toLatLng({ x: -300, y: 0 }),
                  frame.toLatLng({ x: 300, y: 10 }),
                ],
              },
            ],
            { frame, window },
          );
          for (const t of trees) {
            const p = frame.toLatLng(t.position);
            expect(p.lat).toBeGreaterThanOrEqual(window.south - 1e-12);
            expect(p.lat).toBeLessThanOrEqual(window.north + 1e-12);
            expect(p.lng).toBeGreaterThanOrEqual(window.west - 1e-12);
            expect(p.lng).toBeLessThanOrEqual(window.east + 1e-12);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
