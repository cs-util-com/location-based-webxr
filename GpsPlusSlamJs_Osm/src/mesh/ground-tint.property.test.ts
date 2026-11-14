import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import { enuFrameAt, type EnuPoint } from "./enu.js";
import {
  buildGroundTint,
  DEFAULT_GROUND_RGB,
  DEFAULT_LAND_USE_RGB,
  GROUND_CLASS_NAMES,
  GROUND_CLASS_TIERS,
  type GroundClass,
} from "./ground-tint.js";

const centre = { lat: 47.0, lng: 8.0 };
const frame = enuFrameAt(centre);
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((47 * Math.PI) / 180));
const HALF = 40;
const window = {
  south: centre.lat - HALF * M_LAT,
  west: centre.lng - HALF * M_LNG,
  north: centre.lat + HALF * M_LAT,
  east: centre.lng + HALF * M_LNG,
};
const options = {
  frame,
  window,
  texelM: 2,
  ground: DEFAULT_GROUND_RGB,
  landUse: DEFAULT_LAND_USE_RGB,
};
const tagsOf: Partial<Record<GroundClass, Record<string, string>>> = {
  residential: { landuse: "residential" },
  park: { leisure: "park" },
  water: { natural: "water" },
  pitch: { leisure: "pitch" },
};
const CLASSES = Object.keys(tagsOf) as GroundClass[];

/** A random simple-or-not polygon: a star around a centre, vertices in metres. */
const polygon = fc
  .record({
    cx: fc.double({ min: -60, max: 60, noNaN: true }),
    cy: fc.double({ min: -60, max: 60, noNaN: true }),
    radii: fc.array(fc.double({ min: 3, max: 50, noNaN: true }), {
      minLength: 3,
      maxLength: 9,
    }),
    cls: fc.constantFrom(...CLASSES),
  })
  .map(({ cx, cy, radii, cls }) => ({
    cls,
    ring: radii.map((r, i) => {
      const a = (2 * Math.PI * i) / radii.length;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    }),
  }));

function toFeature(
  id: number,
  p: { cls: GroundClass; ring: { x: number; y: number }[] },
): OsmFeature {
  const geometry = [...p.ring, p.ring[0] ?? { x: 0, y: 0 }].map((q) => ({
    lat: centre.lat + q.y * M_LAT,
    lng: centre.lng + q.x * M_LNG,
  }));
  return { type: "way", id, tags: tagsOf[p.cls] ?? {}, geometry };
}

/** Even-odd point in ring: an oracle independent of the scanline fill. */
function inside(ring: readonly EnuPoint[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as EnuPoint;
    const b = ring[j] as EnuPoint;
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    ) {
      hit = !hit;
    }
  }
  return hit;
}

function area(ring: readonly EnuPoint[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as EnuPoint;
    const q = ring[(i + 1) % ring.length] as EnuPoint;
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

describe("buildGroundTint, properties", () => {
  // WHY: the scanline fill is the code most likely to be subtly wrong (edge
  // rows, the half-open rule, row order). An independent point-in-ring test
  // at every texel centre, with the same priority rule (tier, then larger
  // first, then key), must agree everywhere except on a texel centre lying
  // within a hair of an edge, where either answer is right.
  it("matches a point-in-ring oracle at every texel centre", () => {
    fc.assert(
      fc.property(
        fc.array(polygon, { minLength: 1, maxLength: 5 }),
        (polys) => {
          const features = polys.map((p, i) => toFeature(i + 1, p));
          const tint = buildGroundTint(features, options);
          const rings = features.map((f) =>
            (
              f as unknown as { geometry: { lat: number; lng: number }[] }
            ).geometry
              .slice(0, -1)
              .map((g) => frame.toEnu(g)),
          );
          const order = polys
            .map((p, i) => ({ i, cls: p.cls, a: area(rings[i] ?? []) }))
            .sort(
              (u, v) =>
                (GROUND_CLASS_TIERS.get(u.cls) ?? 0) -
                  (GROUND_CLASS_TIERS.get(v.cls) ?? 0) ||
                v.a - u.a ||
                (`way/${u.i + 1}` < `way/${v.i + 1}` ? -1 : 1),
            );
          let disagreements = 0;
          for (let r = 0; r < tint.height; r++) {
            for (let c = 0; c < tint.width; c++) {
              const x = tint.originX + (c + 0.5) * tint.texelM;
              const y = tint.originY + (r + 0.5) * tint.texelM;
              let want = 0;
              for (const o of order) {
                if (inside(rings[o.i] ?? [], x, y)) {
                  want = GROUND_CLASS_NAMES.indexOf(o.cls) + 1;
                }
              }
              if (tint.classes[r * tint.width + c] !== want) disagreements++;
            }
          }
          // A degenerate texel centre exactly on an edge is ambiguous; random
          // doubles make that vanishingly rare, so allow none.
          expect(disagreements).toBe(0);
        },
      ),
      { numRuns: 60 },
    );
  });

  // WHY: Overpass returns features in an order nobody controls; the ground
  // must not change with it.
  it("is invariant under input permutation", () => {
    fc.assert(
      fc.property(
        fc.array(polygon, { minLength: 2, maxLength: 5 }),
        fc.integer({ min: 1, max: 1000 }),
        (polys, seed) => {
          const features = polys.map((p, i) => toFeature(i + 1, p));
          const shuffled = [...features].sort(
            (a, b) => ((a.id * seed) % 97) - ((b.id * seed) % 97),
          );
          expect(buildGroundTint(shuffled, options).classes).toEqual(
            buildGroundTint(features, options).classes,
          );
        },
      ),
      { numRuns: 40 },
    );
  });

  // WHY: polygons reach far outside the window; the raster holds exactly the
  // window, and its painted share can never exceed it.
  it("covers exactly the window and nothing outside it", () => {
    fc.assert(
      fc.property(
        fc.array(polygon, { minLength: 1, maxLength: 5 }),
        (polys) => {
          const tint = buildGroundTint(
            polys.map((p, i) => toFeature(i + 1, p)),
            options,
          );
          expect(tint.classes.length).toBe(tint.width * tint.height);
          expect(tint.width * tint.texelM).toBeGreaterThanOrEqual(
            2 * HALF - 1e-6,
          );
          expect(tint.width * tint.texelM).toBeLessThan(2 * HALF + tint.texelM);
          const sum = Object.values(tint.shares).reduce((a, b) => a + b, 0);
          expect(sum).toBeLessThanOrEqual(1 + 1e-12);
        },
      ),
      { numRuns: 40 },
    );
  });
});
