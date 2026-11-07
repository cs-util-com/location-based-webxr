import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ROAD_PARAMS,
  SIDEWALK_RGB,
  buildRibbons,
  junctionKeys,
  rankOf,
  streetColour,
  turnDegrees,
  wedgeGapM,
} from "./street-roads.js";

const widthOf = (tags) => (tags.highway === "footway" ? 2 : 6);
const colourOf = () => 0xa0a3a8;
const way = (id, tags, points) => ({ key: `way/${id}`, tags, points });

const straight = (n, dx = 10) =>
  Array.from({ length: n }, (_, i) => ({ x: i * dx, y: 0 }));

/** Triangles per vertex attribute stride: positions are 3 floats a vertex. */
const triangleCount = (built) => built.positions.length / 9;

// Why: at threshold 0 the builder must equal today's library (a quad per
// segment plus an 8-triangle disc at every point), so every saving reported
// against today is measured from the same geometry, not from a different one.
test("threshold 0 reproduces today's quad-plus-disc count", () => {
  const ways = [way(1, { highway: "residential" }, straight(5))];
  const built = buildRibbons(ways, { widthOf, colourOf, straightDeg: 0 });
  assert.equal(triangleCount(built), 4 * 2 + 5 * ROAD_PARAMS.discSegments);
  assert.equal(built.stats.discsDropped, 0);
});

// Why: the whole saving is here - a straight interior point loses its disc,
// the two ends keep their round caps (DEC-R2-13 round joins and caps stay).
test("a straight way keeps only its two end discs", () => {
  const ways = [way(1, { highway: "residential" }, straight(5))];
  const built = buildRibbons(ways, { widthOf, colourOf, straightDeg: 10 });
  assert.equal(triangleCount(built), 4 * 2 + 2 * ROAD_PARAMS.discSegments);
  assert.equal(built.stats.discsDropped, 3);
  assert.equal(built.stats.maxGapM, 0);
});

// Why: a real bend must keep its round join, or the outer wedge opens as a
// visible notch of bare ground; the threshold is the only thing deciding it.
test("a bend above the threshold keeps its disc, below it loses it", () => {
  const bend = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 10 * Math.tan((40 * Math.PI) / 180) },
  ];
  const ways = [way(1, { highway: "residential" }, bend)];
  const kept = buildRibbons(ways, { widthOf, colourOf, straightDeg: 30 });
  assert.equal(kept.stats.discsDropped, 0);
  const dropped = buildRibbons(ways, { widthOf, colourOf, straightDeg: 45 });
  assert.equal(dropped.stats.discsDropped, 1);
  assert.ok(Math.abs(dropped.stats.maxGapM - wedgeGapM(3, 40)) < 1e-9);
});

// Why: a T-junction meets a straight interior point of the through road; that
// point is shared with another way and keeps its disc, as the brief requires.
test("a straight point shared with another way keeps its disc", () => {
  const through = way(1, { highway: "residential" }, straight(3));
  const side = way(2, { highway: "residential" }, [
    { x: 10, y: 0 },
    { x: 10, y: 20 },
  ]);
  const keys = junctionKeys([through, side]);
  assert.ok(keys.has("10.00,0.00"));
  const built = buildRibbons([through, side], {
    widthOf,
    colourOf,
    straightDeg: 10,
  });
  assert.equal(built.stats.discsDropped, 0);
});

// Why: the material is single-sided, so a triangle wound the wrong way would
// silently vanish from the street while the counter still reports it.
test("every road triangle faces up", () => {
  const ways = [
    way(1, { highway: "residential" }, straight(4)),
    way(2, { highway: "footway" }, [
      { x: 0, y: 5 },
      { x: 5, y: 9 },
      { x: 7, y: 20 },
    ]),
  ];
  const { positions } = buildRibbons(ways, {
    widthOf,
    colourOf,
    straightDeg: 10,
  });
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, , az, bx, , bz, cx, , cz] = positions.slice(i, i + 9);
    const crossY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    assert.ok(crossY > 0, `triangle ${i / 9} faces down`);
  }
});

// Why: the prototype must look the same on every reload and every device;
// nothing in the road builder may depend on order-sensitive randomness.
test("two builds are identical", () => {
  const ways = [
    way(7, { highway: "residential" }, straight(6, 7)),
    way(3, { highway: "footway", footway: "sidewalk" }, straight(4, 3)),
  ];
  const a = buildRibbons(ways, { widthOf, colourOf, straightDeg: 15 });
  const b = buildRibbons(ways, { widthOf, colourOf, straightDeg: 15 });
  assert.deepEqual(a.positions, b.positions);
  assert.deepEqual(a.colours, b.colours);
  assert.deepEqual(a.street, b.street);
});

// Why: the owner's rule is that the class wins for pedestrian ways (DEC-R7b-4);
// a sidewalk may be lighter than a path, but it stays in the warm family and
// never takes a carriageway grey.
test("a sidewalk is lighter than a footway and stays warm", () => {
  const footway = 0xb5926a;
  const sidewalk = streetColour(
    { highway: "footway", footway: "sidewalk" },
    footway,
  );
  assert.equal(sidewalk, SIDEWALK_RGB);
  const r = (sidewalk >> 16) & 0xff;
  const b = sidewalk & 0xff;
  assert.ok(r > b + 20, "sidewalk keeps a warm hue");
  assert.ok(r > ((footway >> 16) & 0xff), "sidewalk is lighter");
  assert.equal(streetColour({ highway: "footway" }, footway), footway);
  assert.equal(streetColour({ highway: "residential" }, 0x9a9ea4), 0x9a9ea4);
});

// Why: the vertical order decides who wins an overlap at a junction: a
// carriageway covers the footway crossing it, and a road's own discs sit
// under its quads so a disc rim never draws across the carriageway.
test("ranks put car roads above paths and discs below their own quads", () => {
  assert.ok(
    rankOf({ highway: "residential" }) > rankOf({ highway: "footway" }),
  );
  assert.ok(rankOf({ highway: "primary" }) > rankOf({ highway: "service" }));
  const ways = [way(1, { highway: "residential" }, straight(2))];
  const { positions } = buildRibbons(ways, {
    widthOf,
    colourOf,
    straightDeg: 0,
  });
  const ys = new Set();
  for (let i = 1; i < positions.length; i += 3) ys.add(positions[i].toFixed(4));
  assert.equal(ys.size, 2, "one height for quads, one below it for discs");
});

// Why: the reported gaps are the price of the saving, so their formula is
// pinned: the chord between the two outer quad corners at a dropped point.
test("wedge gap is the outer chord", () => {
  assert.equal(wedgeGapM(1, 0), 0);
  assert.ok(Math.abs(wedgeGapM(1, 60) - 1) < 1e-12);
  assert.ok(
    Math.abs(turnDegrees({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 }) - 45) <
      1e-9,
  );
});

// Why: an angle alone opens wide notches on wide roads (half a metre at 10
// degrees on Heidelberg's widest), so a gap limit in metres must keep the disc
// on a wide road where the same turn on a narrow path loses it.
test("a gap limit keeps the disc where the chord would be too wide", () => {
  const bent = (half) => [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 10 * Math.tan((6 * Math.PI) / 180) },
  ];
  const wide = [way(1, { highway: "residential" }, bent())];
  const narrow = [way(2, { highway: "footway" }, bent())];
  const opts = { widthOf, colourOf, straightDeg: 10, maxGapM: 0.15 };
  // 6 degrees: chord 0.31 m on the 6 m road, 0.10 m on the 2 m footway.
  assert.equal(buildRibbons(wide, opts).stats.discsDropped, 0);
  assert.equal(buildRibbons(narrow, opts).stats.discsDropped, 1);
});
