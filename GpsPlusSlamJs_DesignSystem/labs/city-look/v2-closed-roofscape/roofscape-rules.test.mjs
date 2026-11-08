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
  inventedRoofRefusal,
  keepReason,
  neighbourhoodPriors,
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

describe("the local roof prior", () => {
  // Why this block matters: V2 invents a pitched roof on every low house
  // nothing is tagged about. That is right in an Alpine suburb and absurd on a
  // New York brownstone row or a mall. The rule must come from the data
  // around a building, never from a city's name, so it also holds where nobody
  // has looked yet.
  const square = (cx, cy, size = 10) => [
    pt(cx, cy),
    pt(cx + size, cy),
    pt(cx + size, cy + size),
    pt(cx, cy + size),
  ];
  const town = (offsetX, count, tagsFor) =>
    Array.from({ length: count }, (_, i) => ({
      key: `way/${offsetX}${i}`,
      tags: { building: "yes", ...tagsFor(i) },
      rings: [square(offsetX + (i % 4) * 20, Math.floor(i / 4) * 20)],
    }));

  it("invents no pitched roof where most tagged roofs nearby are flat", () => {
    const entries = [
      ...town(0, 8, (i) => (i < 6 ? { "roof:shape": "flat" } : {})),
    ];
    const priors = neighbourhoodPriors(entries);
    const prior = priors.get("way/07");
    assert.equal(prior.pitched, false);
    assert.equal(prior.why, "flat roofs nearby");
  });

  it("keeps inventing where the tagged roofs nearby are pitched", () => {
    // Heidelberg's case: tall-ish old houses, most roofs tagged gabled.
    const entries = town(0, 12, (i) => ({
      "building:levels": "4",
      ...(i < 7 ? { "roof:shape": i === 0 ? "flat" : "gabled" } : {}),
    }));
    const prior = neighbourhoodPriors(entries).get("way/011");
    assert.equal(prior.pitched, true);
    assert.equal(prior.why, "pitched roofs nearby");
  });

  it("reads a tall neighbourhood with no roof tags as flat-roofed", () => {
    // Park Slope's case: every height tagged by an import, no roof shape at all.
    const entries = town(0, 12, () => ({ height: "13" }));
    const prior = neighbourhoodPriors(entries).get("way/05");
    assert.equal(prior.pitched, false);
    assert.equal(prior.why, "tall neighbourhood");
  });

  it("knows nothing, and keeps inventing, where nothing is tagged", () => {
    // Meggen's case: no height, no levels, no roof shape anywhere.
    const prior = neighbourhoodPriors(town(0, 12, () => ({}))).get("way/03");
    assert.equal(prior.pitched, true);
    assert.equal(prior.why, "no evidence");
  });

  it("is local: a flat-roofed district far away does not reach a village", () => {
    const entries = [
      ...town(0, 8, () => ({})),
      ...town(5000, 12, () => ({ "roof:shape": "flat" })),
    ];
    const priors = neighbourhoodPriors(entries);
    assert.equal(priors.get("way/03").pitched, true);
    assert.equal(priors.get("way/50003").pitched, false);
  });

  it("counts one vote per building, however many parts it has", () => {
    // Why: Park Slope has one building with four tagged skillion parts. As
    // four votes they flipped 150 flat-roofed brownstones around it to pitched.
    const rows = town(0, 12, () => ({ height: "13" }));
    const parts = [0, 1, 2, 3, 4, 5].map((i) => ({
      key: `way/9${i}`,
      tags: { "building:part": "yes", "roof:shape": "skillion" },
      rings: [square(1 + i, 1, 1)],
    }));
    const prior = neighbourhoodPriors([...rows, ...parts]).get("way/05");
    assert.equal(prior.why, "tall neighbourhood");
  });

  it("needs enough evidence before one tag decides a neighbourhood", () => {
    const entries = town(0, 12, (i) =>
      i === 0 ? { "roof:shape": "flat" } : {},
    );
    assert.equal(neighbourhoodPriors(entries).get("way/05").pitched, true);
  });
});

describe("inventedRoofRefusal", () => {
  // Why: a mall, a warehouse or a supermarket is flat almost everywhere, and a
  // pitched roof on a hall the size of a block reads as a toy.
  const pitched = { pitched: true, why: "no evidence", heights: [] };

  it("refuses an invented roof on commercial and industrial classes", () => {
    for (const building of [
      "commercial",
      "retail",
      "industrial",
      "warehouse",
    ]) {
      assert.equal(
        inventedRoofRefusal({ building }, 200, pitched),
        "flat by class",
        building,
      );
    }
  });

  it("refuses one on a large footprint, and moves with the threshold", () => {
    const tags = { building: "yes" };
    assert.equal(inventedRoofRefusal(tags, 3000, pitched), "large footprint");
    assert.equal(inventedRoofRefusal(tags, 300, pitched), null);
    assert.equal(
      inventedRoofRefusal(tags, 3000, pitched, { largeFootprintM2: 4000 }),
      null,
    );
  });

  it("leaves a church its roof, whatever the neighbourhood", () => {
    const flat = { pitched: false, why: "tall neighbourhood", heights: [] };
    assert.equal(inventedRoofRefusal({ building: "church" }, 1500, flat), null);
  });

  it("follows the neighbourhood for an ordinary house", () => {
    const flat = { pitched: false, why: "flat roofs nearby", heights: [] };
    assert.equal(
      inventedRoofRefusal({ building: "yes" }, 120, flat),
      "flat roofs nearby",
    );
    assert.equal(inventedRoofRefusal({ building: "yes" }, 120, pitched), null);
  });
});

describe("planCity with the local prior", () => {
  const options = { triangulate };
  const row = (count, tagsFor) =>
    Array.from({ length: count }, (_, i) => ({
      key: `way/${100 + i}`,
      tags: { building: "yes", ...tagsFor(i) },
      rings: [box(i * 20, 0, 8, 15)],
    }));

  it("gives a flat-roofed row flat lids at its tagged height", () => {
    const { plans, counts } = planCity(
      row(10, () => ({ height: "12.5" })),
      options,
    );
    assert.equal(counts.roofed, 0);
    assert.equal(counts.refused["tall neighbourhood"], 10);
    for (const plan of plans) {
      assert.equal(plan.roof, null);
      assert.equal(plan.eaveM, 12.5);
      assert.equal(plan.why, "tall neighbourhood");
    }
  });

  it("gives an untagged house in a tall neighbourhood its neighbours' height", () => {
    // Why: an untagged tower among 20-30 m blocks must not get a house's 9 m.
    const entries = row(11, (i) =>
      i === 10 ? {} : { height: String(20 + i), "roof:shape": "flat" },
    );
    const plan = planCity(entries, options).plans.find(
      (p) => p.key === "way/110",
    );
    assert.equal(plan.roof, null);
    assert.ok(plan.eaveM >= 22 && plan.eaveM <= 27.5, String(plan.eaveM));
  });

  it("gives a refused lid a grey, not a clay tile, unless one is tagged", () => {
    // Why: a flat roof is bitumen or gravel; a clay-red lid reads as a toy.
    const entries = row(10, (i) => ({
      height: "12.5",
      ...(i === 0 ? { "roof:colour": "#336699" } : {}),
    }));
    const { plans } = planCity(entries, options);
    const clay = ["#8c6152", "#7c5a4e", "#96705f", "#86604f", "#7f6a60"];
    for (const plan of plans.slice(1))
      assert.ok(!clay.includes(plan.colours.roof));
    assert.equal(plans[0].colours.roof, "#336699");
  });

  it("still roofs a village with no tags at all", () => {
    const { counts } = planCity(
      row(10, () => ({})),
      options,
    );
    assert.equal(counts.roofed, 10);
  });
});

describe("the four real scenes", () => {
  const options = { triangulate, heightLimitM: 14 };

  it("invents no pitched roof in Midtown or Park Slope but on a church", () => {
    // Why: the owner's question. New York's towers, walk-ups and brownstones
    // are flat-roofed; a pitched one there is the absurd roof he asked about.
    // A church keeps its roof anywhere: that one is nearly always pitched.
    for (const name of ["nyc-midtown", "nyc-park-slope"]) {
      const entries = fixtureEntries(name);
      const byKey = new Map(entries.map((e) => [e.key, e.tags]));
      const { plans } = planCity(entries, options);
      for (const plan of plans.filter((p) => p.roof)) {
        const { building } = byKey.get(plan.key);
        assert.ok(
          ["church", "chapel"].includes(building),
          `${name} ${plan.key}`,
        );
      }
    }
  });

  it("leaves Meggen and Heidelberg exactly as the owner chose them", () => {
    // Why: the owner chose V2 for how these two look. The New York rules must
    // not take a single roof there: same plans as with the refusals off.
    const pick = (r) =>
      r.plans.map((p) => [p.key, p.eaveM, p.style, p.colours]);
    for (const name of ["lucerne-meggen", "heidelberg-altstadt"]) {
      const entries = fixtureEntries(name);
      const now = planCity(entries, options);
      assert.deepEqual(now.counts.refused, {}, name);
      assert.deepEqual(
        pick(now),
        pick(planCity(entries, { ...options, refusals: false })),
      );
    }
  });

  it("is V2 as first chosen with the refusals off", () => {
    // Why: `?prior=off` is how the page shows the before state next to the
    // after one; it must give back every invented roof.
    const { counts } = planCity(fixtureEntries("nyc-park-slope"), {
      ...options,
      refusals: false,
    });
    assert.equal(counts.roofed, counts.candidates);
    assert.deepEqual(counts.refused, {});
  });

  it("decides the same way on two runs in New York", () => {
    const entries = fixtureEntries("nyc-park-slope");
    const pick = (r) => r.plans.map((p) => [p.key, p.eaveM, p.why]);
    assert.deepEqual(
      pick(planCity(entries, options)),
      pick(planCity(entries, options)),
    );
  });
});
