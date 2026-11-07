/**
 * The pure decisions of V3: which building gets an inferred roof, how tall its
 * storeys are, what tone and finish its tags earn. Node's runner, no browser.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { seededRandom } from "../city-look-model.js";
import {
  ROOF_TOLERANCE,
  fitRectangle,
  lookFor,
  parseColour,
  roofPlanFor,
  storeyFor,
  tagsForMesh,
} from "./v3-model-rules.js";

/** A 14 x 9 m rectangle, closed, as a footprint in ENU metres. */
const RECT = [
  { x: 0, y: 0 },
  { x: 14, y: 0 },
  { x: 14, y: 9 },
  { x: 0, y: 9 },
  { x: 0, y: 0 },
];
/** An L: the box's far quarter is missing. */
const ELL = [
  { x: 0, y: 0 },
  { x: 14, y: 0 },
  { x: 14, y: 4 },
  { x: 7, y: 4 },
  { x: 7, y: 9 },
  { x: 0, y: 9 },
  { x: 0, y: 0 },
];
const way = (tags = { building: "yes" }, id = 42) => ({
  type: "way",
  id,
  tags,
});
const plan = (feature, ring = RECT, tolerance = ROOF_TOLERANCE) =>
  roofPlanFor(feature, ring, {
    random: seededRandom(`way/${feature.id}`),
    tolerance,
  });

// Why: the roof is cosmetic only if the fit is right; a wrong fit lays a roof
// over air. The rotated case is every real street: nothing is axis aligned.
test("fitRectangle finds a rotated rectangle and refuses to call an L one", () => {
  const turn = (p) => ({
    x: p.x * Math.cos(0.6) - p.y * Math.sin(0.6),
    y: p.x * Math.sin(0.6) + p.y * Math.cos(0.6),
  });
  const box = fitRectangle(RECT.map(turn));
  assert.ok(Math.abs(box.halfLength - 7) < 1e-9);
  assert.ok(Math.abs(box.halfWidth - 4.5) < 1e-9);
  assert.ok(Math.abs(box.fill - 1) < 1e-9);
  assert.ok(fitRectangle(ELL).fill < 0.8);
  assert.equal(fitRectangle([{ x: 0, y: 0 }]), null);
});

// Why: the binding data rule. Every tag below is a mapper's statement, and the
// `flat` case is the one resolveHeights cannot see.
test("a tagged building is left unchanged", () => {
  const tagged = [
    { building: "yes", "roof:shape": "flat" },
    { building: "yes", "roof:shape": "gabled" },
    { building: "yes", "roof:shape": "mansard" },
    { "building:part": "yes" },
    { building: "yes", "building:part": "yes" },
    { building: "roof" },
    { building: "yes", min_height: "3" },
    { building: "yes", "building:min_level": "1" },
    { building: "yes", height: "9" },
    { building: "yes", "roof:height": "2" },
    { building: "yes", "roof:levels": "1" },
    { building: "office" },
  ];
  for (const tags of tagged) {
    assert.equal(plan(way(tags)), null, JSON.stringify(tags));
    assert.equal(tagsForMesh(tags, 300), tags, JSON.stringify(tags));
  }
});

// Why: a relation is how a courtyard arrives; a roof over one is the classic
// wrong roof, and non-rectangles are out of this variant.
test("no roof on a relation, an L, a wide hall, a garage or a tall block", () => {
  assert.equal(plan({ ...way(), type: "relation" }), null);
  assert.equal(plan(way(), ELL), null);
  const hall = RECT.map((p) => ({ x: p.x * 3, y: p.y * 3 }));
  assert.equal(plan(way(), hall), null);
  assert.equal(plan(way({ building: "garage" })), null);
  assert.equal(plan(way({ building: "yes", "building:levels": "7" })), null);
});

// Why: the fit tolerance is the parameter the plan asks to be stated: a shape
// 6 % short of its box is out at 5 % and in at 10 %.
test("the tolerance decides a slightly notched footprint", () => {
  const notch = [
    { x: 0, y: 0 },
    { x: 14, y: 0 },
    { x: 14, y: 6.8 },
    { x: 10.4, y: 6.8 },
    { x: 10.4, y: 9 },
    { x: 0, y: 9 },
    { x: 0, y: 0 },
  ];
  assert.equal(plan(way(), notch, 0.05), null);
  assert.notEqual(plan(way(), notch, 0.1), null);
});

// Why: "a reload looks the same" is a binding rule, and the id, not an index,
// must be what moves the result.
test("the plan is stable and keyed on the id", () => {
  assert.deepEqual(plan(way()), plan(way()));
  const shapes = new Set();
  const rises = new Set();
  for (let id = 1; id < 60; id++) {
    const p = plan(way({ building: "yes" }, id));
    shapes.add(p.shape);
    rises.add(p.riseM.toFixed(3));
  }
  assert.ok(shapes.has("gabled") && shapes.has("hipped"));
  assert.ok(rises.size > 10);
});

// Why: a square footprint has no long axis, so a ridge along it is a coin flip
// a viewer sees as an error; a hip has no such problem.
test("a nearly square footprint gets a hip and rises stay plausible", () => {
  const square = RECT.map((p) => ({ x: p.x * 0.7, y: p.y }));
  for (let id = 1; id < 40; id++) {
    const p = plan(way({ building: "yes" }, id), square);
    assert.equal(p.shape, "hipped");
    assert.ok(p.riseM >= 1.2 && p.riseM <= 5.5, String(p.riseM));
  }
});

// Why: 6 m on a 20 m2 shed is the tallest lie in a suburb without any height
// tags, and it must not touch a building that says how tall it is.
test("only an unmeasured small building or shed drops to one level", () => {
  assert.equal(tagsForMesh({ building: "yes" }, 24)["building:levels"], "1");
  const shed = tagsForMesh({ building: "garage" }, 300);
  assert.equal(shed["building:levels"], "1");
  const big = { building: "yes" };
  assert.equal(tagsForMesh(big, 200), big);
  const told = { building: "yes", "building:levels": "3" };
  assert.equal(tagsForMesh(told, 24), told);
});

// Why: the whole reason for metres. Lines must divide the real wall into its
// real levels, not a normalised height.
test("storeys come from real metres and real levels", () => {
  const heights = { minHeightM: 0, eaveHeightM: 13.5 };
  assert.deepEqual(
    storeyFor({ building: "apartments", "building:levels": "5" }, heights),
    { storeyM: 2.7 },
  );
  // No level tag: the nearest whole count of 3.2 m storeys, fitted to the wall.
  assert.deepEqual(storeyFor({ building: "yes" }, heights), { storeyM: 3.375 });
  assert.equal(
    storeyFor({ building: "yes" }, { ...heights, eaveHeightM: 2 }).storeyM,
    0,
  );
  // A part from 6 to 15 m with levels 5, min_level 2: three storeys of 3 m.
  assert.equal(
    storeyFor(
      {
        "building:part": "yes",
        "building:levels": "5",
        "building:min_level": "2",
      },
      { minHeightM: 6, eaveHeightM: 15 },
    ).storeyM,
    3,
  );
  // A church has no storeys; a hall tagged one level 12 m high neither.
  assert.equal(storeyFor({ building: "church" }, heights).storeyM, 0);
  assert.equal(
    storeyFor(
      { building: "yes", "building:levels": "1" },
      { minHeightM: 0, eaveHeightM: 12 },
    ).storeyM,
    0,
  );
});

// Why: names occur in real tags (`grey`, `BurlyWood`), and junk must fall back
// to the paper, not to black.
test("parseColour reads hex, short hex and the names in the data", () => {
  assert.deepEqual(parseColour("#ff0000"), [1, 0, 0]);
  assert.deepEqual(parseColour("#f00"), [1, 0, 0]);
  assert.ok(parseColour("BurlyWood")[0] > 0.8);
  assert.deepEqual(parseColour("grey"), parseColour("gray"));
  assert.equal(parseColour("sort of red"), null);
  assert.equal(parseColour(undefined), null);
});

const toSrgb = (v) =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;

/** HSV saturation as a viewer sees it, from a linear tone. */
const saturation = (rgb) => {
  const shown = rgb.map(toSrgb);
  const max = Math.max(...shown);
  return (max - Math.min(...shown)) / max;
};

// Why: the owner's "leichte Farbakzente" and the heat ramp as the loudest
// colour. Even a screaming tag must stay a tint.
test("accents stay accents: no tag makes a loud building", () => {
  for (const tags of [
    { building: "yes", "building:colour": "#ff0000", "roof:colour": "#00ff00" },
    { building: "yes", "building:material": "brick", "roof:colour": "red" },
    { building: "church" },
    { building: "yes", "building:material": "glass" },
  ]) {
    const look = lookFor(tags);
    assert.ok(saturation(look.wall) < 0.35, JSON.stringify(look));
    assert.ok(saturation(look.roof) < 0.35, JSON.stringify(look));
  }
  assert.deepEqual(lookFor({ building: "yes" }), lookFor({ building: "yes" }));
});

// Why: matte against shiny is a tag decision. Plaster must be matte, glass and
// metal must read shinier, and a part's own tag must beat its parent's.
test("the finish follows the material tag", () => {
  const finish = (tags) => lookFor(tags).wallFinish;
  assert.ok(finish({ "building:material": "glass" }) > 0.8);
  assert.ok(finish({ "building:material": "metal" }) > 0.6);
  assert.ok(finish({ "building:material": "plaster" }) < 0.1);
  assert.ok(finish({ building: "office" }) > finish({ building: "house" }));
  assert.ok(lookFor({ "roof:material": "copper" }).roofFinish > 0.5);
  const own = lookFor(
    { "building:part": "yes", "roof:colour": "#848484" },
    { building: "yes", "roof:colour": "#F5BCA9" },
  );
  assert.deepEqual(own, lookFor({ building: "yes", "roof:colour": "#848484" }));
});
