import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GROUND_CLASSES,
  chroma,
  landuseClassOf,
  paintColour,
  paintOrder,
  polygonAreaM2,
  rasterPlan,
} from "./painted-ground-rules.js";

describe("which land use a feature paints", () => {
  // Why this test matters: the tint must come from the tags alone, and a tag
  // the table does not know must leave the ground neutral rather than guess.
  it("reads the usual land-use tags", () => {
    assert.equal(landuseClassOf({ landuse: "residential" }), "residential");
    assert.equal(landuseClassOf({ landuse: "retail" }), "commercial");
    assert.equal(landuseClassOf({ landuse: "meadow" }), "meadow");
    assert.equal(landuseClassOf({ natural: "grassland" }), "meadow");
    assert.equal(landuseClassOf({ leisure: "park" }), "park");
    assert.equal(landuseClassOf({ landuse: "forest" }), "wood");
    assert.equal(landuseClassOf({ natural: "wood" }), "wood");
    assert.equal(landuseClassOf({ amenity: "parking" }), "parking");
    assert.equal(landuseClassOf({ amenity: "grave_yard" }), "cemetery");
    assert.equal(landuseClassOf({ landuse: "farmland" }), "farmland");
    assert.equal(landuseClassOf({ amenity: "school" }), "institutional");
  });

  it("paints water only as a still tint, from the water tags", () => {
    assert.equal(landuseClassOf({ natural: "water" }), "water");
    assert.equal(landuseClassOf({ natural: "water", water: "river" }), "water");
    assert.equal(landuseClassOf({ landuse: "basin" }), "water");
    assert.equal(landuseClassOf({ waterway: "riverbank" }), "water");
    assert.equal(landuseClassOf({ leisure: "swimming_pool" }), "water");
  });

  it("tells a grass pitch from a hard court by its surface", () => {
    assert.equal(landuseClassOf({ leisure: "pitch" }), "pitch");
    assert.equal(
      landuseClassOf({ leisure: "pitch", surface: "grass" }),
      "pitch",
    );
    assert.equal(
      landuseClassOf({ leisure: "pitch", surface: "asphalt" }),
      "court",
    );
  });

  it("paints a pedestrian square, but never a street", () => {
    assert.equal(
      landuseClassOf({ highway: "pedestrian", area: "yes" }),
      "square",
    );
    assert.equal(landuseClassOf({ place: "square" }), "square");
    assert.equal(landuseClassOf({ highway: "pedestrian" }), null);
    assert.equal(landuseClassOf({ highway: "residential" }), null);
  });

  it("leaves buildings, boundaries, unknown values and no tags alone", () => {
    assert.equal(
      landuseClassOf({ building: "yes", landuse: "residential" }),
      null,
    );
    assert.equal(landuseClassOf({ building: "yes" }), null);
    assert.equal(landuseClassOf({ boundary: "place" }), null);
    assert.equal(landuseClassOf({ leisure: "nature_reserve" }), null);
    assert.equal(landuseClassOf({ landuse: "something_new" }), null);
    assert.equal(landuseClassOf({}), null);
    assert.equal(landuseClassOf(undefined), null);
  });

  it("lets the water tag win over the land use it sits in", () => {
    assert.equal(
      landuseClassOf({ landuse: "reservoir", natural: "water" }),
      "water",
    );
  });
});

describe("the paint order", () => {
  const entry = (key, cls, area) => ({ key, cls, area });

  // Why this test matters: a pitch inside a park inside a residential zone is
  // the everyday case. Painted last wins, so the most specific use must come
  // last whatever the order of the data.
  it("paints a pitch over a park over a residential zone", () => {
    const order = paintOrder([
      entry("way/1", "pitch", 900),
      entry("way/2", "residential", 200000),
      entry("way/3", "park", 12000),
    ]).map((e) => e.cls);
    assert.deepEqual(order, ["residential", "park", "pitch"]);
  });

  it("paints the smaller of two uses of the same kind last", () => {
    const order = paintOrder([
      entry("way/1", "wood", 400),
      entry("way/2", "meadow", 40000),
    ]).map((e) => e.cls);
    assert.deepEqual(order, ["meadow", "wood"]);
  });

  it("puts water above open land and below what is built over it", () => {
    const order = paintOrder([
      entry("way/1", "square", 300),
      entry("way/2", "water", 90000),
      entry("way/3", "park", 2000),
    ]).map((e) => e.cls);
    assert.deepEqual(order, ["park", "water", "square"]);
  });

  // Why this test matters: a reload must look the same; equal areas fall
  // back to the OSM key, never to the order the data arrived in.
  it("gives the same order for any input order", () => {
    const list = [
      entry("way/9", "grass", 100),
      entry("way/4", "grass", 100),
      entry("way/7", "parking", 50),
      entry("relation/2", "residential", 9000),
    ];
    const a = paintOrder(list).map((e) => e.key);
    const b = paintOrder([...list].reverse()).map((e) => e.key);
    assert.deepEqual(a, b);
    assert.deepEqual(a, ["relation/2", "way/4", "way/9", "way/7"]);
  });
});

describe("the palette", () => {
  // Why this test matters: the owner's rule is muted ground and the heat
  // ramp (chroma 80 and up) as the loudest colour. 45 is the cap the research
  // proposed, between today's plate (26) and today's tree (62).
  it("keeps every class under chroma 45", () => {
    for (const [name, { colour }] of Object.entries(GROUND_CLASSES)) {
      assert.ok(chroma(colour) < 45, `${name}: ${chroma(colour)}`);
    }
  });

  it("measures chroma as the largest channel minus the smallest", () => {
    assert.equal(chroma(0x6b7280), 0x80 - 0x6b);
    assert.equal(chroma(0xffffff), 0);
  });

  it("mixes towards the neutral ground by the strength", () => {
    const neutral = 0x6b7280;
    assert.equal(paintColour("meadow", 0, neutral), neutral);
    assert.equal(
      paintColour("meadow", 1, neutral),
      GROUND_CLASSES.meadow.colour,
    );
    const half = paintColour("water", 0.5, 0x000000);
    const full = GROUND_CLASSES.water.colour;
    assert.equal(half >> 16, Math.round((full >> 16) / 2));
  });
});

describe("geometry helpers", () => {
  it("measures a square with a hole", () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const hole = [
      { x: 2, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 4 },
      { x: 2, y: 4 },
    ];
    assert.equal(polygonAreaM2([outer]), 100);
    assert.equal(polygonAreaM2([outer, hole]), 96);
  });

  // Why this test matters: the texture is the whole cost of this look, so its
  // size must follow the texel and never run away on a large scene.
  it("sizes the texture by the texel and caps it", () => {
    const box = { minX: -320, minY: -320, maxX: 320, maxY: 320 };
    assert.deepEqual(
      [rasterPlan(box, 1).width, rasterPlan(box, 1).height],
      [640, 640],
    );
    assert.equal(rasterPlan(box, 2).width, 320);
    const capped = rasterPlan(box, 0.1);
    assert.equal(capped.width, 2048);
    assert.ok(capped.texelM > 0.3);
    assert.equal(rasterPlan(box, 1).bytes, 640 * 640 * 4);
  });
});
