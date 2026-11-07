import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bayCount,
  bayWidthM,
  facadeFor,
  parseLook,
  perimeterOf,
  roofRgb,
  storeyHeightM,
  wallRgb,
} from "./v4-facade.js";

/** One wall quad of 8 m at y 2..8, then one flat roof triangle. */
function boxMesh() {
  return {
    positions: new Float32Array([
      0, 2, 0, 8, 2, 0, 8, 8, 0, 0, 8, 0, 0, 8, 0, 8, 8, 0, 8, 8, -8,
    ]),
    normals: new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    ]),
  };
}

const SPEC = {
  baseY: 2,
  storeyM: 3,
  bayM: 2.6,
  wall: 0x808080,
  roof: 0x404040,
};

// Why: the owner's rule is that a mapper's colour is never changed; the seeded
// tone must only ever touch what was inferred.
test("a tagged wall colour stays exactly as tagged, whatever the id", () => {
  const tags = { building: "yes", "building:colour": "#c59d8f" };
  assert.equal(wallRgb(tags, "way/1"), 0xc59d8f);
  assert.equal(wallRgb(tags, "way/2"), 0xc59d8f);
});

// Why: Heidelberg tags `grey`, `white` and `BurlyWood`; the library reads hex
// only, so these would silently fall back to a class colour.
test("named colours are read, in any case", () => {
  assert.equal(wallRgb({ "building:colour": "White" }, "way/1"), 0xffffff);
  assert.equal(roofRgb({ "roof:colour": "BurlyWood" }, "way/1"), 0xdeb887);
  assert.equal(roofRgb({ "roof:colour": "grey" }, "way/1"), 0x808080);
});

// Why: a roof's own tag was unreachable in the library, so this is the whole
// point of giving roofs a colour of their own.
test("a tagged roof colour is exact, a roof material beats the inference", () => {
  assert.equal(roofRgb({ "roof:colour": "#848484" }, "way/1"), 0x848484);
  const slate = roofRgb({ "roof:material": "slate" }, "way/1");
  assert.equal(slate, roofRgb({ "roof:material": "slate" }, "way/2"));
  assert.notEqual(slate, roofRgb({ "addr:street": "A" }, "way/2"));
});

// Why: a reload must look the same, and the seed must be the OSM id so a
// change elsewhere in the data cannot repaint a house.
test("inferred colours are stable and differ only a little between neighbours", () => {
  const tags = { building: "yes", "addr:street": "Meggenstrasse" };
  assert.equal(wallRgb(tags, "way/1"), wallRgb(tags, "way/1"));
  const channel = (rgb) => (rgb >> 8) & 0xff;
  const tones = [1, 2, 3, 4, 5, 6, 7, 8].map((id) =>
    channel(wallRgb(tags, `way/${id}`)),
  );
  assert.ok(new Set(tones).size > 1, "some variation");
  assert.ok(Math.max(...tones) - Math.min(...tones) < 30, "muted variation");
});

// Why: "Farben ... die einen Sinn ergeben basierend auf ihren Tags": the only
// tag most Meggen buildings carry is an address, and a house without one reads
// as an outbuilding.
test("an address makes a dwelling tone, no tag at all a neutral one", () => {
  const blue = (rgb) => rgb & 0xff;
  const red = (rgb) => (rgb >> 16) & 0xff;
  const dwelling = wallRgb({ building: "yes", "addr:street": "A" }, "way/1");
  assert.ok(red(dwelling) > blue(dwelling) + 8, "a warm plaster");
  const unknown = wallRgb({ building: "yes" }, "way/1");
  assert.ok(Math.abs(red(unknown) - blue(unknown)) < 12, "a neutral");
});

// Why: storey lines are the variant's claim to real metres; a tagged level
// count has to set them, not a constant.
test("the storey height comes from tagged levels, in metres", () => {
  const tags = { building: "apartments", "building:levels": "4" };
  assert.equal(storeyHeightM(tags, tags, 14), 3.5);
});

// Why: a typo in `building:levels` must not draw 40 cm storeys.
test("implausible levels fall back to the class height", () => {
  const tags = { building: "apartments", "building:levels": "20" };
  assert.equal(storeyHeightM(tags, tags, 14), 3);
});

// Why: a shed with storey lines is a lie that reads as a mistake.
test("buildings that have no storeys get none", () => {
  for (const building of ["garage", "church", "roof", "warehouse", "shed"]) {
    const tags = { building };
    assert.equal(storeyHeightM(tags, tags, 12), 0, building);
  }
  assert.equal(storeyHeightM({ building: "yes" }, { building: "yes" }, 6), 0);
});

// Why: a Meggen house without an address tag is still a house; a blank wall
// beside the street camera is the Kloetzchen the variant is meant to answer.
test("a bare building counts as a house once it is house-sized", () => {
  const tags = { building: "yes" };
  assert.equal(storeyHeightM(tags, tags, 6, 40), 3);
  assert.equal(storeyHeightM(tags, tags, 6, 20), 0);
});

test("the perimeter sums the wall quads and skips the roof", () => {
  assert.equal(perimeterOf(boxMesh()), 8);
});

// Why: a part's own level count describes that part, its parent's does not.
test("a part reads its own levels and its parent's class", () => {
  const parent = { building: "church", "building:levels": "3" };
  assert.equal(storeyHeightM(parent, { "building:part": "yes" }, 12), 0);
  const house = { building: "apartments", "building:levels": "3" };
  assert.equal(storeyHeightM(house, { "building:part": "yes" }, 12), 3);
  assert.equal(
    storeyHeightM(
      house,
      { "building:part": "yes", "building:levels": "3" },
      12,
    ),
    4,
  );
});

// Why: an integer bay count is what keeps a window from being cut by a corner.
test("a wall holds a whole number of bays, none when it is too short", () => {
  assert.equal(bayCount(12, 3), 4);
  assert.equal(bayCount(10.4, 3), 3);
  assert.equal(bayCount(1.5, 3), 0);
});

test("the bay width is seeded from the id and stays in a house's range", () => {
  assert.equal(bayWidthM("way/1"), bayWidthM("way/1"));
  for (let id = 0; id < 50; id++) {
    const width = bayWidthM(`way/${id}`);
    assert.ok(width >= 2.7 && width <= 3.6, String(width));
  }
});

// Why: the whole variant rests on these four numbers reaching the shader.
test("walls carry metres above the ground, the storey, whole bays and the top", () => {
  const { facade } = facadeFor(boxMesh(), SPEC);
  assert.deepEqual([...facade.slice(0, 4)], [0, 3, 0, 6]);
  assert.deepEqual([...facade.slice(4, 8)], [0, 3, 3, 6]);
  assert.deepEqual([...facade.slice(8, 12)], [6, 3, 3, 6]);
  assert.deepEqual([...facade.slice(12, 16)], [6, 3, 0, 6]);
});

// Why: the darkening keys on `h`; a part floating at `min_height` must read as
// high up, or its underside edge would get a wall foot in mid-air.
test("a floating part keeps its height above the ground", () => {
  const { facade } = facadeFor(boxMesh(), { ...SPEC, baseY: -10 });
  assert.equal(facade[0], 12);
});

// Why: top = 0 is the shader's "no facade here", so a roof can never receive
// storey lines or a wall foot.
test("roofs carry no facade and take the roof colour", () => {
  const { facade, colours } = facadeFor(boxMesh(), SPEC);
  assert.equal(facade[4 * 4 + 3], 0);
  assert.equal(facade[4 * 6 + 3], 0);
  // Linear light of the display colours #404040 and #808080.
  assert.ok(Math.abs(colours[3 * 4] - 0.0513) < 1e-3);
  assert.ok(Math.abs(colours[0] - 0.2158) < 1e-3);
});

// Why: V4 adds no geometry: that is the phone argument, and the footprint of
// every tagged building stays what the library built.
test("the geometry is left alone and two runs give identical buffers", () => {
  const mesh = boxMesh();
  const before = [...mesh.positions];
  const first = facadeFor(mesh, SPEC);
  const second = facadeFor(mesh, SPEC);
  assert.deepEqual([...mesh.positions], before);
  assert.deepEqual([...first.facade], [...second.facade]);
  assert.deepEqual([...first.colours], [...second.colours]);
});

// Why: a mistyped link must still show a page, not a black city.
test("the look's link values are clamped, junk takes the default", () => {
  const look = parseLook("?foot=9&footh=abc&line=0.2");
  assert.equal(look.footStrength, 0.8);
  assert.equal(look.footHeightM, parseLook("").footHeightM);
  assert.equal(look.lineStrength, 0.2);
});
