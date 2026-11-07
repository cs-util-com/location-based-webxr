/**
 * The roof over any footprint.
 *
 * Why this file matters: the variant's one promise is that a roof fills its
 * real footprint and nothing else: no overhang over air, no roof across a
 * courtyard, L, T and U shapes closed. Those are geometric facts, so they are
 * pinned here rather than left to a person spotting them on a screenshot.
 */
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import {
  hasGable,
  orientRings,
  planArea,
  ringArea,
  roofSkeleton,
  triangularEnds,
  triangulateFace,
} from "./roof-skeleton.js";

// three is loaded by its path, as labs/terrain's test does: the design
// system lists no dependency on it, the page is served the framework's copy.
const { ShapeUtils, Vector2 } = await import(
  pathToFileURL(
    join(
      import.meta.dirname,
      "../../../../GpsPlusSlamJs_AppFramework/node_modules/three/build/three.module.js",
    ),
  ).href
);

const vectors = (ring) => ring.map((p) => new Vector2(p.x, p.y));
const triangulate = (contour, holes) =>
  ShapeUtils.triangulateShape(vectors(contour), holes.map(vectors));

/** Tiny fixed offsets, so exact parallels never meet exactly. */
const wobble = (ring) =>
  ring.map(([x, y], i) => ({
    x: x + Math.sin(i * 12.9898 + x) * 0.002,
    y: y + Math.sin(i * 78.233 + y) * 0.002,
  }));

const pointInRing = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
};

/** Every roof triangle's centroid, in plan. */
const centroids = (roof) => {
  const out = [];
  for (const face of roof.faces) {
    if (face.vertical) continue;
    for (const [a, b, c] of triangulateFace(face, triangulate)) {
      out.push({
        x: (a.x + b.x + c.x) / 3,
        y: (a.y + b.y + c.y) / 3,
        t: (a.t + b.t + c.t) / 3,
      });
    }
  }
  return out;
};

const RECT = [
  [0, 0],
  [12, 0],
  [12, 8],
  [0, 8],
];
const L_SHAPE = [
  [0, 0],
  [14, 0],
  [14, 6],
  [6, 6],
  [6, 14],
  [0, 14],
];
const T_SHAPE = [
  [0, 0],
  [18, 0],
  [18, 6],
  [12, 6],
  [12, 14],
  [6, 14],
  [6, 6],
  [0, 6],
];
const U_SHAPE = [
  [0, 0],
  [16, 0],
  [16, 12],
  [10, 12],
  [10, 6],
  [6, 6],
  [6, 12],
  [0, 12],
];

describe("roofSkeleton", () => {
  it("gives a rectangle one ridge, half its width high in time", () => {
    const rings = orientRings([wobble(RECT)]);
    const roof = roofSkeleton(rings);
    assert.ok(Math.abs(roof.ridgeT - 4) < 0.01);
    assert.ok(Math.abs(planArea(roof, triangulate) - 96) < 0.05);
  });

  for (const [name, ring] of Object.entries({ L_SHAPE, T_SHAPE, U_SHAPE })) {
    it(`fills the ${name} exactly and overhangs nothing`, () => {
      // Why: the bounding rectangle's roof is the failure this variant exists
      // to remove; on these shapes it would roof the air in the notch.
      const rings = orientRings([wobble(ring)]);
      const roof = roofSkeleton(rings);
      const area = ringArea(rings[0]);
      assert.ok(Math.abs(planArea(roof, triangulate) - area) < area * 0.002);
      for (const c of centroids(roof)) {
        assert.ok(pointInRing(c, rings[0]), `outside at ${c.x},${c.y}`);
      }
    });
  }

  it("leaves a courtyard open and slopes down to it", () => {
    // Why: a roof across a courtyard is the second failure the brief names.
    const outer = wobble([
      [0, 0],
      [30, 0],
      [30, 24],
      [0, 24],
    ]);
    const yard = wobble([
      [10, 8],
      [10, 16],
      [20, 16],
      [20, 8],
    ]);
    const rings = orientRings([outer, yard]);
    const roof = roofSkeleton(rings);
    const area = ringArea(rings[0]) - Math.abs(ringArea(rings[1]));
    assert.ok(Math.abs(planArea(roof, triangulate) - area) < area * 0.002);
    for (const c of centroids(roof)) {
      assert.equal(pointInRing(c, rings[1]), false);
    }
    assert.ok(roof.ridgeT < 5.1);
  });

  it("stops at a height limit and closes the rest with a flat top", () => {
    // Why: a wide hall must not grow a roof of invented metres.
    const rings = orientRings([wobble(RECT)]);
    const roof = roofSkeleton(rings, { maxT: 2 });
    assert.equal(roof.ridgeT, 2);
    assert.equal(roof.caps.length, 1);
    assert.ok(Math.abs(planArea(roof, triangulate) - 96) < 0.05);
  });

  it("turns an end into a vertical gable when its weight is zero", () => {
    // Why: a gable is what makes a roof read as a house from the street, and
    // a weight of zero is how the same code gets one on any footprint.
    const rings = orientRings([wobble(RECT)]);
    const hip = roofSkeleton(rings);
    const ends = triangularEnds(hip);
    assert.equal(ends.length, 2);
    const weights = rings[0].map((_, i) => (ends.includes(i) ? 0 : 1));
    const gable = roofSkeleton(rings, { weights: [weights] });
    assert.equal(gable.faces.filter((f) => f.vertical).length, 2);
    assert.ok(Math.abs(gable.ridgeT - 4) < 0.01);
    assert.ok(Math.abs(planArea(gable, triangulate) - 96) < 0.05);
    assert.equal(hasGable(gable), true);
  });

  it("gives the same answer twice", () => {
    // Why: a reload must look the same.
    const rings = orientRings([wobble(U_SHAPE)]);
    assert.deepEqual(roofSkeleton(rings), roofSkeleton(rings));
  });
});
