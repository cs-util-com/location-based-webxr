/**
 * A planned house turned into triangles.
 *
 * Why this file matters: the shell is one mesh with one-sided faces, so a
 * flipped triangle is a hole in a roof, and a gap between roof and wall is a
 * slit of sky. Both are invisible in a unit of the planner and obvious on the
 * page; they are pinned here on a shape that has every kind of face.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  ShapeUtils,
  Vector2,
} from "../../../../GpsPlusSlamJs_AppFramework/node_modules/three/build/three.module.js";

import { appendHouse } from "./house-shell.js";
import { offsetRing } from "./roofscape-rules.js";
import { orientRings, roofSkeleton } from "./roof-skeleton.js";

const vectors = (ring) => ring.map((p) => new Vector2(p.x, p.y));
const triangulate = (contour, holes) =>
  ShapeUtils.triangulateShape(vectors(contour), holes.map(vectors));

const wobble = (ring) =>
  ring.map(([x, y], i) => ({
    x: x + Math.sin(i * 12.9898 + x) * 0.002,
    y: y + Math.sin(i * 78.233 + y) * 0.002,
  }));

const colours = { wall: "wall", roof: "roof" };
const rgb = (name) => (name === "wall" ? [1, 1, 1] : [0, 0, 0]);

function shell(given) {
  const plan = { roofRings: given.rings, ...given };
  const sink = { positions: [], colours: [] };
  appendHouse(plan, sink, { triangulate, rgb });
  const triangles = [];
  for (let i = 0; i < sink.positions.length; i += 9) {
    const p = sink.positions.slice(i, i + 9);
    const u = [p[3] - p[0], p[4] - p[1], p[5] - p[2]];
    const v = [p[6] - p[0], p[7] - p[1], p[8] - p[2]];
    triangles.push({
      p,
      normal: [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ],
      wall: sink.colours[i] === 1,
    });
  }
  return triangles;
}

const closingCheck = (triangles) => {
  // Every edge of a closed shell is walked once each way.
  const key = (x, y, z) => [x, y, z].map((n) => n.toFixed(4)).join(",");
  const open = new Map();
  for (const { p } of triangles) {
    const at = [
      key(p[0], p[1], p[2]),
      key(p[3], p[4], p[5]),
      key(p[6], p[7], p[8]),
    ];
    for (let i = 0; i < 3; i++) {
      const a = at[i];
      const b = at[(i + 1) % 3];
      const back = `${b}|${a}`;
      if (open.has(back)) open.delete(back);
      else open.set(`${a}|${b}`, true);
    }
  }
  return [...open.keys()];
};

const L_RINGS = orientRings([
  wobble([
    [0, 0],
    [14, 0],
    [14, 6],
    [6, 6],
    [6, 14],
    [0, 14],
  ]),
]);

describe("appendHouse", () => {
  it("makes every slope face up and every wall face out", () => {
    const roof = roofSkeleton(L_RINGS);
    const triangles = shell({
      rings: L_RINGS,
      roof,
      eaveM: 6,
      tan: 0.7,
      colours,
    });
    for (const t of triangles) {
      if (!t.wall) assert.ok(t.normal[1] > 0, `down at ${t.p}`);
      else assert.ok(Math.abs(t.normal[1]) < 1e-6);
    }
    // The far outer corner's two walls point east and north (render -z).
    const east = triangles.filter(
      (t) => t.wall && t.p[0] > 13.9 && t.p[3] > 13.9 && t.p[6] > 13.9,
    );
    assert.ok(east.length > 0);
    assert.ok(east.every((t) => t.normal[0] > 0));
  });

  it("joins wall and slopes without a slit along the eave", () => {
    // Why: a slit along the eave shows the sky through a house. The bottom ring
    // stays open on purpose: nobody sees under a house.
    const roof = roofSkeleton(L_RINGS);
    const open = closingCheck(
      shell({ rings: L_RINGS, roof, eaveM: 6, tan: 0.7, colours }),
    );
    assert.ok(
      open.every((edge) => edge.includes(",-0.2000,")),
      open[0],
    );
  });

  it("builds a gable as one wall from the ground to the ridge", () => {
    // Why: a seam at the eave of a gable reads as a box with a hat on.
    const rings = orientRings([
      wobble([
        [0, 0],
        [12, 0],
        [12, 8],
        [0, 8],
      ]),
    ]);
    const weights = [[1, 0, 1, 0]];
    const roof = roofSkeleton(rings, { weights });
    const triangles = shell({ rings, roof, eaveM: 6, tan: 0.7, colours });
    const top = Math.max(...triangles.flatMap((t) => [t.p[1], t.p[4], t.p[7]]));
    assert.ok(Math.abs(top - (6 + 4 * 0.7)) < 0.01);
    const gable = triangles.filter(
      (t) => t.wall && Math.max(t.p[1], t.p[4], t.p[7]) > 6.5,
    );
    assert.ok(gable.length >= 2);
    assert.equal(
      closingCheck(triangles).filter((e) => !e.includes(",-0.2000,")).length,
      0,
    );
  });

  it("closes the eave's underside when the roof reaches past the wall", () => {
    // Why: an open soffit is a slit of sky seen from the street, exactly where
    // the eave has to read as a shadow line.
    const roofRings = L_RINGS.map((ring) =>
      offsetRing(
        ring,
        ring.map(() => 0.3),
      ),
    );
    const roof = roofSkeleton(roofRings);
    const triangles = shell({
      rings: L_RINGS,
      roofRings,
      roof,
      eaveM: 6,
      tan: 0.7,
      colours,
    });
    const soffit = triangles.filter((t) => t.normal[1] < 0);
    assert.equal(soffit.length, 12);
    assert.equal(
      closingCheck(triangles).filter((e) => !e.includes(",-0.2000,")).length,
      0,
    );
  });

  it("closes a house without a roof with a flat lid at its eave", () => {
    // Why: the last step of the failure ladder must still be a whole house.
    const triangles = shell({
      rings: L_RINGS,
      roof: null,
      eaveM: 3,
      tan: 0,
      colours,
    });
    const lid = triangles.filter((t) => !t.wall);
    assert.ok(lid.length >= 4);
    assert.ok(lid.every((t) => t.p[1] === 3 && t.normal[1] > 0));
  });
});
