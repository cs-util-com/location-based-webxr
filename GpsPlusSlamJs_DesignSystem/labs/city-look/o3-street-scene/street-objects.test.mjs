import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FURNITURE_PARAMS,
  MARK_PARAMS,
  furnitureOf,
  isZebraTags,
  nearWithin,
  zebraStripes,
} from "./street-objects.js";

const rand = (key) => (key.length % 10) / 10;
const node = (id, tags, x = 0, y = 0) => ({
  key: `node/${id}`,
  type: "node",
  tags,
  x,
  y,
});

// Why: "nothing invented on the street" - only mapped nodes become furniture,
// a way tagged like furniture (a bollard line) is not guessed into posts.
test("only mapped furniture nodes are placed", () => {
  const items = furnitureOf(
    [
      node(1, { highway: "street_lamp" }),
      node(2, { amenity: "bench" }),
      node(3, { amenity: "waste_basket" }),
      node(4, { barrier: "bollard" }),
      node(5, { amenity: "cafe" }),
      { key: "way/6", type: "way", tags: { barrier: "bollard" }, x: 0, y: 0 },
    ],
    rand,
  );
  assert.deepEqual(
    items.map((i) => i.kind),
    ["lamp", "bench", "bin", "bollard"],
  );
});

// Why: a tagged height is a mapped fact and wins; an untagged lamp gets the
// default and says so, so a later build can keep guesses apart.
test("tagged heights win, defaults are flagged as guessed", () => {
  const [tagged, untagged] = furnitureOf(
    [
      node(1, { highway: "street_lamp", height: "7 m" }),
      node(2, { highway: "street_lamp" }),
    ],
    rand,
  );
  assert.equal(tagged.heightM, 7);
  assert.ok(!tagged.guessed.includes("height"));
  assert.equal(untagged.heightM, FURNITURE_PARAMS.lampHeightM);
  assert.ok(untagged.guessed.includes("height"));
});

// Why: a wall lamp has no mast; drawing a 5 m pole in the street for it would
// put a post where there is none.
test("wall and suspended lamps have no mast", () => {
  const items = furnitureOf(
    [
      node(1, { highway: "street_lamp", lamp_mount: "wall" }),
      node(2, { highway: "street_lamp", lamp_mount: "suspended" }),
    ],
    rand,
  );
  assert.deepEqual(
    items.map((i) => i.kind),
    ["lamp-wall", "lamp-suspended"],
  );
});

// Why: the yaw is invented when no direction is mapped, so it must be seeded
// from the OSM id (stable across reloads) and flagged; a mapped direction wins.
test("yaw is seeded from the id unless a direction is mapped", () => {
  const a = furnitureOf([node(11, { amenity: "bench" })], rand)[0];
  const b = furnitureOf([node(11, { amenity: "bench" })], rand)[0];
  assert.equal(a.yawRad, b.yawRad);
  assert.ok(a.guessed.includes("yaw"));
  const mapped = furnitureOf(
    [node(12, { amenity: "bench", direction: "90" })],
    rand,
  )[0];
  assert.ok(!mapped.guessed.includes("yaw"));
  assert.ok(Math.abs(mapped.yawRad + Math.PI / 2) < 1e-12);
});

// Why: zebra paint is drawn only where a mapper says there is one; an
// unmarked or signal-only crossing gets no stripes.
test("zebra tags: markings, crossing=zebra and crossing_ref", () => {
  assert.ok(isZebraTags({ "crossing:markings": "zebra" }));
  assert.ok(isZebraTags({ "crossing:markings": "ladder" }));
  assert.ok(isZebraTags({ crossing: "zebra" }));
  assert.ok(isZebraTags({ crossing_ref: "zebra" }));
  assert.ok(!isZebraTags({ crossing: "unmarked" }));
  assert.ok(!isZebraTags({ crossing: "traffic_signals" }));
  assert.ok(!isZebraTags({ "crossing:markings": "no" }));
});

// Why: stripes follow the mapped crossing way and stay on it, centred, at the
// fixed pitch; a stripe hanging past the way's ends would paint the pavement.
test("stripes along a crossing way stay inside it", () => {
  const stripes = zebraStripes(
    [
      {
        key: "way/1",
        tags: { highway: "footway", footway: "crossing", crossing: "zebra" },
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 7 },
        ],
      },
    ],
    [],
    [],
  );
  assert.equal(stripes.length, Math.floor(7 / MARK_PARAMS.pitchM));
  for (const s of stripes) {
    assert.ok(s.cy - MARK_PARAMS.barM / 2 >= -1e-9);
    assert.ok(s.cy + MARK_PARAMS.barM / 2 <= 7 + 1e-9);
    assert.equal(s.lengthM, MARK_PARAMS.zebraWidthM);
  }
});

// Why: a zebra node with no crossing way still marks the road it sits on,
// across that road's width; one that lies on a striped way is not drawn twice.
test("a zebra node on a road stripes across it, once", () => {
  const road = {
    key: "way/9",
    tags: { highway: "residential" },
    points: [
      { x: -20, y: 0 },
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ],
    widthM: 6,
  };
  const lone = zebraStripes(
    [],
    [node(5, { highway: "crossing", "crossing:markings": "zebra" }, 0, 0)],
    [road],
  );
  assert.equal(lone.length, Math.floor(6 / MARK_PARAMS.pitchM));
  for (const s of lone) assert.ok(Math.abs(s.cx) < 1e-9);
  const crossingWay = {
    key: "way/2",
    tags: { footway: "crossing", "crossing:markings": "zebra" },
    points: [
      { x: 0, y: -3 },
      { x: 0, y: 0 },
      { x: 0, y: 3 },
    ],
  };
  const both = zebraStripes(
    [crossingWay],
    [node(5, { highway: "crossing", "crossing:markings": "zebra" }, 0, 0)],
    [road],
  );
  assert.equal(both.length, Math.floor(6 / MARK_PARAMS.pitchM));
});

// Why: the distance cut decides what a phone draws at street level; it must
// keep exactly the items within the radius, measured in plan.
test("nearWithin keeps the items inside the cut", () => {
  const items = [
    { x: 0, y: 0 },
    { x: 30, y: 40 },
    { x: 100, y: 0 },
  ];
  assert.deepEqual(nearWithin(items, { x: 0, y: 0 }, 50), [0, 1]);
  assert.deepEqual(nearWithin(items, { x: 0, y: 0 }, 49), [0]);
});
