/**
 * Which house gets which invented roof, wall and height.
 *
 * Why this file matters: everything this variant invents is cosmetic, so it has
 * to be stable (a reload looks the same) and it has to stop dead at a tag (a
 * tagged building is never changed). A wrong call here changes real data on
 * screen without any visual hint that it did.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { appendHouse } from "./house-shell.js";
import {
  coloursFor,
  eaveHeightM,
  keepReason,
  offsetRing,
  planCity,
  prepareRing,
  sharedWalls,
  simplifyRing,
} from "./roofscape-rules.js";

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

const pt = (x, y) => ({ x, y });
const box = (x, y, w, h) => [
  pt(x, y),
  pt(x + w, y),
  pt(x + w, y + h),
  pt(x, y + h),
];

/** The raw fixture as the planner's entries, on a plain equirectangular frame. */
function fixtureEntries(name) {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, "..", "fixtures", `${name}.json`);
  const { payload, centre } = JSON.parse(readFileSync(file, "utf8"));
  const k = Math.cos((centre.lat * Math.PI) / 180);
  const enu = (p) => ({
    x: (p.lon - centre.lng) * 111320 * k,
    y: (p.lat - centre.lat) * 110540,
  });
  return payload.elements
    .filter((e) => e.type === "way" && e.geometry && e.tags)
    .filter((e) => e.tags.building || e.tags["building:part"])
    .map((e) => ({
      key: `way/${e.id}`,
      tags: e.tags,
      rings: [e.geometry.slice(0, -1).map(enu)],
    }));
}

describe("keepReason", () => {
  const low = { hasParts: false, heightLimitM: 14 };

  it("gives a roof only to a low house nothing says anything about", () => {
    assert.equal(keepReason({ building: "yes" }, low), null);
    assert.equal(keepReason({ building: "house" }, low), null);
    assert.equal(
      keepReason({ building: "yes", "building:levels": "2" }, low),
      null,
    );
  });

  it("leaves every tagged case alone", () => {
    // Why: `resolveHeights` cannot tell an absent roof from an explicit flat
    // one, so the tag itself is read; `flat` must stay flat.
    const cases = [
      { building: "yes", "roof:shape": "flat" },
      { building: "yes", "roof:shape": "gabled" },
      { building: "yes", "roof:height": "2" },
      { building: "yes", min_height: "3" },
      { building: "yes", "building:min_level": "1" },
      { building: "roof" },
      { "building:part": "yes" },
    ];
    for (const tags of cases) assert.ok(keepReason(tags, low), tags);
  });

  it("leaves a building with parts alone", () => {
    const tags = { building: "church" };
    assert.equal(keepReason(tags, { ...low, hasParts: true }), "parts");
  });

  it("moves the tall line with the limit, never with an unknown height", () => {
    const tall = { building: "yes", height: "16" };
    assert.equal(keepReason(tall, { ...low, heightLimitM: 14 }), "tall");
    assert.equal(keepReason(tall, { ...low, heightLimitM: 20 }), null);
    assert.equal(keepReason({ building: "yes" }, low), null);
  });
});

describe("the invented values", () => {
  it("are stable and depend on the id, not on an index", () => {
    const a = coloursFor({ building: "yes" }, "way/1");
    assert.deepEqual(a, coloursFor({ building: "yes" }, "way/1"));
    const walls = new Set();
    const roofs = new Set();
    for (let id = 0; id < 200; id++) {
      const c = coloursFor({ building: "yes" }, `way/${id}`);
      walls.add(c.wall);
      roofs.add(c.roof);
    }
    // A few related tones, never one and never a toy box.
    assert.ok(walls.size >= 3 && walls.size <= 8);
    assert.ok(roofs.size >= 3 && roofs.size <= 8);
  });

  it("keep a colour the map does carry", () => {
    const tags = {
      building: "yes",
      "roof:colour": "#804020",
      "building:colour": "white",
    };
    const c = coloursFor(tags, "way/1");
    assert.equal(c.roof, "#804020");
    assert.equal(c.wall, "white");
  });

  it("put a garage lower than a house and a tagged level count first", () => {
    const eave = (tags, area) => eaveHeightM(tags, area, "way/7");
    assert.ok(eave({ building: "garage" }, 30) < 3.5);
    assert.ok(eave({ building: "yes" }, 120) > 5);
    assert.equal(eave({ building: "yes", "building:levels": "3" }, 120), 9);
  });
});

describe("the footprint", () => {
  it("loses a point on a straight wall, keeps a real corner", () => {
    const ring = [pt(0, 0), pt(5, 0.01), pt(10, 0), pt(10, 8), pt(0, 8)];
    assert.equal(simplifyRing(ring, 0.05).length, 4);
    assert.equal(simplifyRing(ring, 0.001).length, 5);
  });

  it("is jittered by millimetres, the same way twice", () => {
    const ring = box(0, 0, 10, 8);
    const once = prepareRing(ring, 0.05, "way/1", 0);
    assert.deepEqual(once, prepareRing(ring, 0.05, "way/1", 0));
    once.forEach((p, i) => {
      assert.ok(Math.hypot(p.x - ring[i].x, p.y - ring[i].y) < 0.005);
    });
  });
});

describe("offsetRing", () => {
  it("moves slopes out and leaves a gable wall where it stands", () => {
    // Why: a shared wall stays on its line, or the eave would grow into the
    // neighbour; the front eave still runs on to the corner.
    const ring = box(0, 0, 10, 8);
    const out = offsetRing(ring, [0.3, 0, 0.3, 0.3]);
    assert.ok(Math.abs(out[1].x - 10) < 1e-9);
    assert.ok(Math.abs(out[1].y + 0.3) < 1e-9);
    assert.ok(Math.abs(out[3].x + 0.3) < 1e-9);
  });

  it("refuses a corner it cannot follow", () => {
    // Two collinear walls with different offsets have no corner to stand on.
    const ring = [pt(0, 0), pt(5, 0), pt(10, 0), pt(10, 8), pt(0, 8)];
    assert.equal(offsetRing(ring, [0.3, 0, 0.3, 0.3, 0.3]), null);
  });
});

describe("sharedWalls", () => {
  it("finds a wall two houses stand against each other", () => {
    // Why: in a closed row a hip towards the neighbour digs a valley between
    // every two houses; a shared wall takes a gable and the ridge runs on.
    const a = box(0, 0, 10, 8);
    const b = box(10.1, 0, 10, 8);
    const c = box(40, 0, 10, 8);
    const segments = [
      ...[a, b, c].flatMap((ring, owner) =>
        ring.map((p, i) => ({ a: p, b: ring[(i + 1) % 4], owner })),
      ),
    ];
    assert.deepEqual(sharedWalls(a, 0, segments), [false, true, false, false]);
    assert.deepEqual(sharedWalls(c, 2, segments), [false, false, false, false]);
  });
});

describe("planCity on the real fixtures", () => {
  const options = { triangulate, heightLimitM: 14 };

  it("gives identical results on two runs", () => {
    // Why: the owner compares a reload with a reload.
    const entries = fixtureEntries("heidelberg-altstadt");
    const once = planCity(entries, options);
    const twice = planCity(entries, options);
    assert.deepEqual(
      once.plans.map((p) => [p.key, p.eaveM, p.tan, p.style]),
      twice.plans.map((p) => [p.key, p.eaveM, p.tan, p.style]),
    );
  });

  it("does not touch Heidelberg's church or any part", () => {
    // Why: the brief's named case. The church's detail is its parts.
    const entries = fixtureEntries("heidelberg-altstadt");
    const { plans } = planCity(entries, options);
    const roofed = new Set(plans.map((p) => p.key));
    for (const entry of entries) {
      const { tags, key } = entry;
      if (tags["building:part"] && !tags.building) {
        assert.equal(roofed.has(key), false, key);
      }
      if (tags["roof:shape"]) assert.equal(roofed.has(key), false, key);
      if (tags.building === "church") assert.equal(roofed.has(key), false, key);
    }
  });

  it("never lets an eave reach past its neighbour's wall line", () => {
    // Why: a roof that overlaps the house next door flickers along the seam.
    const { plans } = planCity(fixtureEntries("heidelberg-altstadt"), options);
    const overhung = plans.filter((p) => p.roofRings !== p.rings);
    assert.ok(overhung.length > plans.length * 0.8);
    for (const plan of overhung) {
      plan.rings[0].forEach((p, i) => {
        const q = plan.roofRings[0][i];
        assert.ok(Math.hypot(q.x - p.x, q.y - p.y) < 1.3, plan.key);
      });
    }
  });

  it("leaves no crack in any real house above its foot", () => {
    // Why: near-parallel walls in real data leave corners on ridges that the
    // synthetic shapes never produce; each was a pinhole of sky on the page.
    for (const name of ["lucerne-meggen", "heidelberg-altstadt"]) {
      const { plans } = planCity(fixtureEntries(name), options);
      for (const plan of plans) {
        const sink = { positions: [], colours: [] };
        appendHouse(plan, sink, { triangulate, rgb: () => [0, 0, 0] });
        const open = new Set();
        const at = (i) => sink.positions.slice(i, i + 3).join(",");
        for (let t = 0; t < sink.positions.length; t += 9) {
          const p = [at(t), at(t + 3), at(t + 6)];
          for (let i = 0; i < 3; i++) {
            const back = `${p[(i + 1) % 3]}|${p[i]}`;
            if (open.has(back)) open.delete(back);
            else open.add(`${p[i]}|${p[(i + 1) % 3]}`);
          }
        }
        const cracks = [...open].filter(
          (edge) => !edge.split("|").some((c) => c.split(",")[1] === "-0.2"),
        );
        assert.equal(cracks.length, 0, `${plan.key} ${cracks[0]}`);
      }
    }
  });

  it("roofs nearly every low house in Meggen", () => {
    const { counts } = planCity(fixtureEntries("lucerne-meggen"), options);
    assert.ok(counts.roofed / counts.candidates > 0.95, JSON.stringify(counts));
  });
});
