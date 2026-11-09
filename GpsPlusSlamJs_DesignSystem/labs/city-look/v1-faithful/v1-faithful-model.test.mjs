/**
 * The pure decisions of V1 faithful. Geometry and colour are checked here;
 * the look itself is checked by eye on the page.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULTS,
  fitRectangle,
  guessedEaveM,
  houseMesh,
  leftAlone,
  mergeParts,
  paintByNormal,
  parseColour,
  parseV1Params,
  roofColour,
  roofPlan,
  saturationOf,
  scaleHeights,
  wallColour,
} from "./v1-faithful-model.js";

const rect = (w, d, turn = 0) => {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return [
    [0, 0],
    [w, 0],
    [w, d],
    [0, d],
  ].map(([x, y]) => ({ x: x * c - y * s, y: x * s + y * c }));
};
const ell = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 5 },
  { x: 5, y: 5 },
  { x: 5, y: 12 },
  { x: 0, y: 12 },
];
// A 12 x 8 house with a 1.5 x 1.5 m notch in one corner: 2.3 % of the box.
const notched = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 6.5 },
  { x: 10.5, y: 6.5 },
  { x: 10.5, y: 8 },
  { x: 0, y: 8 },
];
const facts = (ring = rect(12, 8), extra = {}) => ({
  key: "way/1",
  ring,
  isPart: false,
  hasHoles: false,
  ...extra,
});
const yes = { building: "yes" };

// Why: the plan's sweep is reported at these tolerances, and the fit must be
// the library's own area test or the numbers cannot be compared.
test("a footprint fits only while it fills its box within the tolerance", () => {
  assert.equal(fitRectangle(rect(12, 8, 0.6), 0.02).fits, true);
  assert.equal(fitRectangle(ell, 0.1).fits, false);
  assert.equal(fitRectangle(notched, 0.02).fits, false);
  assert.equal(fitRectangle(notched, 0.05).fits, true);
});

// Why: the ridge must run along the long side whichever corner the mapper
// started from, or the same house flips its roof with the drawing direction.
test("the box's axis runs along the long side from any starting corner", () => {
  for (let i = 0; i < 4; i++) {
    const ring = rect(14, 7);
    const turned = [...ring.slice(i), ...ring.slice(0, i)];
    const { box } = fitRectangle(turned, 0.02);
    assert.ok(Math.abs(box.halfLength - 7) < 1e-9);
    assert.ok(Math.abs(box.halfWidth - 3.5) < 1e-9);
    assert.ok(Math.abs(Math.abs(box.axis.x) - 1) < 1e-9);
  }
});

// Why: the brief's first rule. A tag is the mapper's statement; every key here
// has to stop every inference, and resolveHeights cannot see an explicit flat.
test("a building carrying any shape tag is left alone", () => {
  for (const tag of [
    { "roof:shape": "flat" },
    { "roof:shape": "mansard" },
    { "roof:height": "2" },
    { "roof:levels": "1" },
    { height: "9" },
    { "building:levels": "2" },
    { min_height: "3" },
    { "building:min_level": "1" },
    { "building:part": "yes" },
  ]) {
    const tags = { ...yes, ...tag };
    assert.equal(leftAlone(tags), true, JSON.stringify(tag));
    assert.equal(roofPlan(tags, facts()), null, JSON.stringify(tag));
    assert.equal(guessedEaveM(tags, 96, "way/1"), null, JSON.stringify(tag));
  }
  assert.equal(leftAlone({ building: "roof" }), true);
  assert.equal(roofPlan({ building: "roof" }, facts()), null);
});

// Why: a courtyard must stay open and a part belongs to its building, even
// when no tag says so on the feature itself.
test("courtyards and parts get no inferred roof", () => {
  assert.equal(roofPlan(yes, facts(rect(12, 8), { hasHoles: true })), null);
  assert.equal(roofPlan(yes, facts(rect(12, 8), { isPart: true })), null);
});

// Why: V1's promise is "only where it really fits": an L stays as it is.
test("an untagged rectangle gets a roof, an L does not", () => {
  assert.equal(roofPlan(yes, facts()).shape, "gabled");
  assert.equal(roofPlan(yes, facts(ell)), null);
});

// Why: a near-square gable has no meaningful ridge direction, so its ridge
// would be an arbitrary claim; a hip makes no such claim.
test("a near-square house is hipped, a long one gabled", () => {
  assert.equal(roofPlan(yes, facts(rect(10, 9))).shape, "hipped");
  assert.equal(roofPlan(yes, facts(rect(14, 8))).shape, "gabled");
});

// Why: a garage or a sports hall under a house roof is the "confident wrong
// roof" the library's own comment warns about.
test("sheds, halls and classes that are not houses keep their roofs", () => {
  assert.equal(roofPlan(yes, facts(rect(5, 5))), null);
  assert.equal(roofPlan(yes, facts(rect(50, 30))), null);
  assert.equal(roofPlan({ building: "garage" }, facts()), null);
  assert.equal(roofPlan({ building: "kiosk" }, facts()), null);
  assert.equal(roofPlan({ building: "industrial" }, facts()), null);
});

// Why: a reload must look the same, and the seed must be the OSM id, so two
// houses differ and the same house never does.
test("guessed heights are stable, narrow and vary by id", () => {
  const seen = new Set();
  for (let id = 1; id < 60; id++) {
    const key = `way/${id}`;
    const first = guessedEaveM(yes, 96, key);
    assert.equal(first, guessedEaveM(yes, 96, key));
    assert.ok(first >= 5.2 && first <= 7.2, String(first));
    seen.add(first);
  }
  assert.ok(seen.size > 40);
});

// Why: a class must move the height, otherwise it is still "a single 6 m".
test("the class sets the height band", () => {
  assert.ok(guessedEaveM({ building: "garage" }, 30, "way/5") < 3.5);
  assert.ok(guessedEaveM({ building: "apartments" }, 300, "way/5") > 8);
  assert.ok(guessedEaveM(yes, 30, "way/5") < 3.5);
});

const planFor = (ring, over = {}, params = undefined) => ({
  ...roofPlan(yes, facts(ring), params),
  eaveM: 6,
  baseM: 0,
  colours: { wall: [1, 1, 1], roof: [0, 0, 0], soffit: [0.5, 0.5, 0.5] },
  ...over,
});

// Why: two runs on the same input must give byte-identical geometry.
test("two runs give identical meshes", () => {
  const ring = rect(12, 8, 0.4);
  assert.deepEqual(
    houseMesh(ring, planFor(ring)),
    houseMesh(ring, planFor(ring)),
  );
});

const triangles = (mesh) => {
  const out = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const v = [0, 1, 2].map((k) => {
      const at = mesh.indices[i + k] * 3;
      return [...mesh.positions.slice(at, at + 3)];
    });
    const at = mesh.indices[i] * 3;
    out.push({ v, n: [...mesh.normals.slice(at, at + 3)] });
  }
  return out;
};
const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const LOOSE = { tolerance: 0.1 };

for (const [name, ring] of [
  ["gabled", rect(14, 8, 0.7)],
  ["hipped", rect(10, 9, 0.7)],
  ["notched", notched],
]) {
  // Why: the page draws front faces only, so one wrongly wound face is a hole
  // that shows from the street and in no number.
  test(`every ${name} face is wound the way its normal points`, () => {
    const mesh = houseMesh(ring, planFor(ring, {}, LOOSE));
    for (const { v, n } of triangles(mesh)) {
      const geometric = cross(sub(v[1], v[0]), sub(v[2], v[0]));
      assert.ok(dot(geometric, n) > 0);
    }
  });

  // Why: OSM rings arrive both ways round; a clockwise ring must not turn the
  // walls inside out.
  test(`the ${name} walls face away from the house either way round`, () => {
    const centre = ring.reduce(
      (sum, p) => [sum[0] + p.x / ring.length, sum[1] + p.y / ring.length],
      [0, 0],
    );
    for (const way of [ring, [...ring].reverse()]) {
      const mesh = houseMesh(way, planFor(ring, {}, LOOSE));
      let walls = 0;
      for (const { v, n } of triangles(mesh)) {
        if (Math.abs(n[1]) > 1e-6) continue;
        if (Math.min(...v.map((p) => p[1])) > 1e-6) continue;
        walls += 1;
        const mid = [
          (v[0][0] + v[1][0] + v[2][0]) / 3,
          0,
          (v[0][2] + v[1][2] + v[2][2]) / 3,
        ];
        const outward = [mid[0] - centre[0], 0, mid[2] + centre[1]];
        // A notch's inner walls may face the centroid's side; the outer may not.
        if (name !== "notched") assert.ok(dot(outward, n) > 0);
      }
      assert.ok(walls >= ring.length * 2);
    }
  });
}

/** Vertices of the wall colour above the ground. */
const wallTops = (mesh) => {
  const tops = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (mesh.colours[i] === 1 && mesh.positions[i + 1] > 0) {
      tops.push([...mesh.positions.slice(i, i + 3)]);
    }
  }
  return tops;
};

// Why: the gable end must be the real wall running up to the ridge, not a
// triangle standing on the eaves; that is what keeps a notch from opening a gap.
test("a gable wall climbs to the ridge, split where it crosses it", () => {
  const ring = rect(14, 8);
  const plan = planFor(ring);
  const tops = wallTops(houseMesh(ring, plan));
  const highest = Math.max(...tops.map((p) => p[1]));
  assert.ok(Math.abs(highest - (6 + plan.riseM)) < 1e-5);
});

// Why: a wall in a notch stands inside the box, under the slope. If it stopped
// at the eaves there would be a slot of sky between wall and roof.
test("a wall in a notch climbs to the roof above it", () => {
  const plan = planFor(notched, {}, LOOSE);
  const tops = wallTops(houseMesh(notched, plan));
  const slope = plan.riseM / plan.box.halfWidth;
  const inner = tops.filter((p) => Math.abs(p[0] - 10.5) < 1e-5);
  assert.ok(inner.length > 0);
  // The notch's long wall runs at y = 6.5, 1.5 m in from the eave at y = 8.
  assert.ok(inner.some((p) => Math.abs(p[1] - (6 + slope * 1.5)) < 0.01));
});

// Why: the eaves are the point of the geometry. A roof that stops flush with
// the wall reads as a box with a lid; the overhang draws the line under it.
test("the roof overhangs the walls and hangs below the eave height", () => {
  const ring = rect(14, 8);
  const mesh = houseMesh(ring, planFor(ring));
  const ys = [];
  const zs = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    ys.push(mesh.positions[i + 1]);
    zs.push(mesh.positions[i + 2]);
  }
  assert.ok(Math.min(...zs) < -8 - DEFAULTS.overhangM + 1e-5);
  assert.ok(Math.min(...ys.filter((y) => y > 1)) < 6);
});

// Why: the cost rule. A house may not cost more than a small constant over
// its box, whatever its footprint.
test("a house stays under fifty triangles", () => {
  for (const ring of [rect(14, 8), rect(10, 9)]) {
    assert.ok(houseMesh(ring, planFor(ring)).indices.length / 3 < 50);
  }
});

// Why: "respect each tag": the mapper's own colour, unmuted at mute 0, and a
// part's own colour must beat its parent's, which the library loses.
test("a tagged colour wins, and a part's own beats its parent's", () => {
  const params = { mute: 0, jitter: 0 };
  const tagged = { "building:colour": "#c59d8f", building: "house" };
  assert.equal(wallColour(tagged, {}, "way/1", params), 0xc59d8f);
  assert.equal(
    wallColour({ "building:colour": "#112233" }, tagged, "way/1", params),
    0x112233,
  );
  assert.equal(wallColour({}, tagged, "way/1", params), 0xc59d8f);
});

// Why: Heidelberg's roofs say `grey` and `BurlyWood`; the library reads hex
// only, so those would silently fall through to the default.
test("CSS names are read, and junk falls through", () => {
  assert.equal(parseColour("BurlyWood"), 0xdeb887);
  assert.equal(parseColour("grey"), 0x808080);
  assert.equal(parseColour("#abc"), 0xaabbcc);
  assert.equal(parseColour("#gggggg"), undefined);
  assert.equal(parseColour("notacolour"), undefined);
  assert.equal(parseColour(undefined), undefined);
});

// Why: roof:colour must land on the roof and only there.
test("the roof reads its own tags, and never the wall's", () => {
  const params = { mute: 0, jitter: 0 };
  const tags = { "roof:colour": "#848484", "building:colour": "#ff0000" };
  assert.equal(roofColour(tags, {}, "way/1", true, params), 0x848484);
  assert.notEqual(
    roofColour({ "roof:material": "roof_tiles" }, {}, "way/1", true, params),
    roofColour({}, {}, "way/1", true, params),
  );
  assert.notEqual(
    roofColour({ "building:colour": "#ff0000" }, {}, "way/1", true, params),
    0xff0000,
  );
});

// Why: Meggen's 214 `building=yes`. Nothing there supports a hue, so walls and
// roofs must stay near-neutral, whatever the seed does.
test("an untagged house gets no invented hue", () => {
  let lightest = -Infinity;
  let darkest = Infinity;
  for (let id = 0; id < 200; id++) {
    const wall = wallColour(yes, {}, `way/${id}`);
    const roof = roofColour(yes, {}, `way/${id}`, true);
    assert.ok(saturationOf(wall) < 0.2, wall.toString(16));
    assert.ok(saturationOf(roof) < 0.12, roof.toString(16));
    const tone = wall & 0xff;
    lightest = Math.max(lightest, tone);
    darkest = Math.min(darkest, tone);
  }
  assert.ok(lightest - darkest > 4, "the seed moves the tone");
});

// Why: a tag beats a seed, so a tagged colour gets no jitter even at the
// default spread, and the same key gives the same colour.
test("the seed never moves a tagged colour", () => {
  const tags = { "building:colour": "#c59d8f" };
  assert.equal(
    wallColour(tags, {}, "way/1", { mute: 0 }),
    wallColour(tags, {}, "way/2", { mute: 0 }),
  );
  assert.equal(wallColour(yes, {}, "way/7"), wallColour(yes, {}, "way/7"));
});

// Why: the library's roof meshes are one feature colour; splitting by normal
// is what puts roof:colour on a tagged gabled roof without touching the shape.
test("a vertex with an upward normal is roof, a vertical one is wall", () => {
  const normals = [1, 0, 0, 0, 1, 0, 0.3, 0.9, 0, 0, -1, 0];
  const colours = paintByNormal(normals, [1, 1, 1], [0, 0, 0]);
  assert.deepEqual([...colours], [1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1]);
});

// Why: scaling must move only the height.
test("scaling heights leaves the plan alone", () => {
  const scaled = scaleHeights(new Float32Array([1, 6, 2, 3, 0, 4]), 0.5);
  assert.deepEqual([...scaled], [1, 3, 2, 3, 0, 4]);
});

// Why: indices must follow their vertices when parts merge into one draw call.
test("merging offsets the indices", () => {
  const part = {
    positions: new Float32Array(9),
    normals: new Float32Array(9),
    colours: new Float32Array(9),
    indices: [0, 1, 2],
  };
  const merged = mergeParts([part, part]);
  assert.deepEqual([...merged.indices], [0, 1, 2, 3, 4, 5]);
  assert.equal(merged.positions.length, 18);
});

// Why: a mistyped link must still show the page, at the defaults.
test("link parameters override defaults and bad ones are ignored", () => {
  assert.equal(parseV1Params("?tol=0.1").tolerance, 0.1);
  assert.equal(parseV1Params("?tol=abc").tolerance, DEFAULTS.tolerance);
  assert.equal(parseV1Params("?pitch=45").pitchDeg, 45);
  assert.equal(parseV1Params("").jitter, DEFAULTS.jitter);
});
