/**
 * O1 quiet greens: the pure decisions behind the trees, the woods and the
 * barriers. Run with `node --test labs/city-look/o1-quiet-greens/`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PARAMS,
  alongLine,
  barrierStyle,
  capByRank,
  chroma,
  formOf,
  lodOf,
  makeExclusion,
  orchardInArea,
  parseLengthM,
  pointInRings,
  scatterInArea,
  treeClass,
  treeColour,
  treeSize,
  trunkLayout,
} from "./quiet-greens-rules.js";

const square = (x0, y0, size) => [
  { x: x0, y: y0 },
  { x: x0 + size, y: y0 },
  { x: x0 + size, y: y0 + size },
  { x: x0, y: y0 + size },
];

describe("parseLengthM", () => {
  // Why this test matters: `height=12 m` and `height=25'` are ordinary on
  // trees, and a parse that returns NaN turns a tagged tree into a guessed one
  // with nothing on screen to say so.
  it("reads metres, a unit suffix and feet", () => {
    assert.equal(parseLengthM("12"), 12);
    assert.equal(parseLengthM("12 m"), 12);
    assert.equal(parseLengthM("12.5m"), 12.5);
    assert.ok(Math.abs(parseLengthM("25'") - 7.62) < 1e-9);
    assert.equal(parseLengthM("tall"), undefined);
    assert.equal(parseLengthM(undefined), undefined);
    assert.equal(parseLengthM("-3"), undefined);
  });
});

describe("treeClass", () => {
  // Why this test matters: the tag a mapper wrote must decide the tree, and
  // only a tagged genus may stand in for a missing leaf type. Nothing is ever
  // guessed from nothing (DEC-R4-10: no species guessing).
  it("takes leaf_type first, then wood, then the genus, else unknown", () => {
    assert.equal(
      treeClass({ leaf_type: "broadleaved", genus: "Pinus" }).leafType,
      "broadleaved",
    );
    assert.equal(treeClass({ wood: "coniferous" }).leafType, "needleleaved");
    assert.equal(treeClass({ genus: "Pinus" }).leafType, "needleleaved");
    assert.equal(
      treeClass({ species: "Tilia cordata" }).leafType,
      "broadleaved",
    );
    assert.equal(treeClass({ genus: "Larix" }).leafCycle, "deciduous");
    assert.equal(treeClass({}).leafType, "unknown");
    assert.equal(treeClass({}).source, "none");
    assert.equal(treeClass({ genus: "Nonexistentia" }).leafType, "unknown");
  });

  it("reads leaf_cycle, and keeps an area's mixed", () => {
    assert.equal(treeClass({ leaf_cycle: "evergreen" }).leafCycle, "evergreen");
    assert.equal(treeClass({ leaf_type: "mixed" }).leafType, "mixed");
  });
});

describe("treeSize", () => {
  // Why this test matters: a tagged tree is never changed. Its height and its
  // crown come from the tags, whatever the page's default height is.
  it("leaves a tagged tree exactly as tagged", () => {
    const tags = { height: "14", diameter_crown: "9", circumference: "1.57" };
    for (const defaultHeightM of PARAMS.treeHeightsM) {
      const size = treeSize(tags, "node/1", { defaultHeightM });
      assert.equal(size.heightM, 14);
      assert.equal(size.crownM, 9);
      assert.ok(Math.abs(size.trunkRadiusM - 0.25) < 0.001);
      assert.equal(size.heightTagged, true);
    }
  });

  // Why this test matters: the default height is the toggle the owner judges
  // (8, 10, 12 m); it must move the untagged trees and only them, and the
  // same tree must keep its own spread on every device.
  it("scales an untagged tree with the default, seeded and bounded", () => {
    const a = treeSize({}, "node/42", { defaultHeightM: 8 });
    const b = treeSize({}, "node/42", { defaultHeightM: 12 });
    assert.deepEqual(a, treeSize({}, "node/42", { defaultHeightM: 8 }));
    assert.ok(Math.abs(b.heightM / a.heightM - 1.5) < 1e-9);
    for (let i = 0; i < 200; i++) {
      const { heightM } = treeSize({}, `node/${i}`, { defaultHeightM: 10 });
      assert.ok(heightM >= 7.5 && heightM <= 12.5, String(heightM));
    }
  });

  it("refuses absurd tags rather than drawing them", () => {
    const size = treeSize({ height: "900", diameter_crown: "0" }, "n", {
      defaultHeightM: 8,
    });
    assert.ok(size.heightM <= 60);
    assert.ok(size.crownM > 0);
  });
});

describe("treeColour", () => {
  // Why this test matters: the owner's complaint is a saturated tree green
  // (chroma 62) against a ground of 21; the palette must stay muted for every
  // class, and stay well under the heat ramp's floor of about 80.
  it("keeps every class muted, below today's tree green", () => {
    assert.equal(chroma(0x3f7d4a), 62);
    for (const leafType of ["broadleaved", "needleleaved", "unknown"]) {
      for (const leafCycle of ["deciduous", "evergreen", "unknown"]) {
        for (let i = 0; i < 50; i++) {
          const c = treeColour({ leafType, leafCycle }, `node/${i}`);
          assert.ok(chroma(c) <= 45, `${leafType}/${leafCycle} ${chroma(c)}`);
        }
      }
    }
  });

  it("is stable per tree, and greys out as the tint goes to 0", () => {
    const cls = { leafType: "broadleaved", leafCycle: "deciduous" };
    assert.equal(treeColour(cls, "node/7"), treeColour(cls, "node/7"));
    assert.ok(chroma(treeColour(cls, "node/7", { tint: 0 })) <= 1);
    assert.ok(
      chroma(treeColour(cls, "node/7", { tint: 0.6 })) <
        chroma(treeColour(cls, "node/7", { tint: 1 })),
    );
  });

  it("tells a conifer from a broadleaf", () => {
    const broad = treeColour(
      { leafType: "broadleaved", leafCycle: "unknown" },
      "k",
      { jitter: 0 },
    );
    const needle = treeColour(
      { leafType: "needleleaved", leafCycle: "unknown" },
      "k",
      { jitter: 0 },
    );
    assert.notEqual(broad, needle);
  });
});

describe("formOf and trunkLayout", () => {
  // Why this test matters: DEC-R4-10 (owner, 2026-07-31) says an untagged
  // tree is "a neutral form", not the fir cone today draws; the broadleaved
  // crown is offered only as the page's alternative.
  it("draws an untagged tree as the neutral form by default", () => {
    assert.equal(formOf("unknown"), "neutral");
    assert.equal(formOf("unknown", { untagged: "broad" }), "broad");
    assert.equal(formOf("needleleaved"), "needle");
    assert.equal(formOf("broadleaved"), "broad");
  });

  it("stands the crown on the trunk and keeps the true height", () => {
    for (const form of ["broad", "neutral", "needle"]) {
      const { crownBaseM, crownHeightM } = trunkLayout(form, 10);
      assert.ok(crownBaseM > 0 && crownBaseM < 5);
      assert.ok(Math.abs(crownBaseM + crownHeightM - 10) < 1e-9);
    }
  });
});

describe("barrierStyle", () => {
  // Why this test matters: today a hedge, a stone wall and a fence share the
  // building grey, which is how the long pale rails in V2's Lucerne landing
  // came to be hedges. Each kind gets its own colour; tags win.
  it("gives each kind its own muted colour", () => {
    const kinds = ["hedge", "wall", "fence", "retaining_wall"];
    const colours = kinds.map((barrier) => barrierStyle({ barrier }).colour);
    assert.equal(new Set(colours).size, kinds.length);
    for (const c of colours) assert.ok(chroma(c) <= 45);
    assert.notEqual(barrierStyle({ barrier: "hedge" }).colour, 0xc8ccd8);
  });

  it("keeps the owner's 2 m for walls and hedges and lets tags win", () => {
    assert.equal(barrierStyle({ barrier: "hedge" }).heightM, 2);
    assert.equal(barrierStyle({ barrier: "wall" }).heightM, 2);
    assert.equal(
      barrierStyle({ barrier: "hedge", height: "1.1" }).heightM,
      1.1,
    );
    assert.equal(
      barrierStyle({ barrier: "fence", width: "0.3" }).thicknessM,
      0.3,
    );
    assert.ok(barrierStyle({ barrier: "fence" }).thicknessM < 0.2);
    assert.equal(barrierStyle({ historic: "citywalls" }).heightM, 6);
    assert.equal(
      barrierStyle({ barrier: "wall", colour: "red" }).taggedColour,
      "red",
    );
  });

  it("reads a material", () => {
    assert.notEqual(
      barrierStyle({ barrier: "wall", material: "brick" }).colour,
      barrierStyle({ barrier: "wall" }).colour,
    );
  });
});

describe("scatterInArea", () => {
  const rings = [square(0, 0, 100)];
  const opts = { densityPerM2: 0.01 };

  // Why this test matters: a scattered tree is invented, so it must at least
  // be stable (a reload looks the same), stay inside the mapped wood, and be
  // flagged cosmetic so a build can keep it out of navigation and scoring.
  it("is deterministic, inside, near the density, and cosmetic", () => {
    const a = scatterInArea(rings, "way/5", opts);
    assert.deepEqual(a, scatterInArea(rings, "way/5", opts));
    assert.ok(a.length > 80 && a.length <= 110, String(a.length));
    for (const p of a) {
      assert.ok(pointInRings(p, rings));
      assert.equal(p.cosmetic, true);
      assert.match(p.key, /^way\/5#/);
    }
  });

  it("leaves holes, the clip box and the exclusion empty", () => {
    const holed = [square(0, 0, 100), square(25, 25, 50)];
    for (const p of scatterInArea(holed, "w", opts)) {
      assert.ok(!(p.x > 25 && p.x < 75 && p.y > 25 && p.y < 75));
    }
    const clip = { minX: 0, minY: 0, maxX: 50, maxY: 100 };
    for (const p of scatterInArea(rings, "w", { ...opts, clip })) {
      assert.ok(p.x <= 50);
    }
    const exclude = (x) => x < 50;
    for (const p of scatterInArea(rings, "w", { ...opts, exclude })) {
      assert.ok(p.x >= 50);
    }
  });

  it("does not place a tree twice where two woods overlap", () => {
    const taken = new Set();
    const a = scatterInArea(rings, "way/1", { ...opts, taken });
    const b = scatterInArea(rings, "way/2", { ...opts, taken });
    assert.ok(a.length > 0);
    assert.equal(b.length, 0);
  });
});

describe("orchardInArea and alongLine", () => {
  // Why this test matters: an orchard is planted in rows and a tree row is a
  // line; a random scatter would misdraw both. Both are invented positions on
  // mapped areas and lines, so they are flagged cosmetic too.
  it("plants an orchard on a regular grid", () => {
    const pts = orchardInArea([square(0, 0, 60)], "way/9", { spacingM: 6 });
    assert.ok(pts.length >= 81 && pts.length <= 110, String(pts.length));
    assert.deepEqual(
      pts,
      orchardInArea([square(0, 0, 60)], "way/9", { spacingM: 6 }),
    );
    assert.ok(pts.every((p) => p.cosmetic));
  });

  it("spaces a row and keeps clear of mapped trees", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
    ];
    const free = alongLine(line, "way/3", { spacingM: 8 });
    assert.equal(free.length, 10);
    const avoid = [{ x: 4, y: 0 }];
    const kept = alongLine(line, "way/3", { spacingM: 8, avoid, clearM: 4 });
    assert.equal(kept.length, 9);
  });
});

describe("capByRank", () => {
  // Why this test matters: the scatter's cap is a documented constant; it
  // must thin the wood evenly (a seeded rank), not cut it off at one edge.
  it("keeps the cap, stably, spread over the area", () => {
    const pts = scatterInArea([square(0, 0, 200)], "w", { densityPerM2: 0.01 });
    const kept = capByRank(pts, 100);
    assert.equal(kept.length, 100);
    assert.deepEqual(kept, capByRank(pts, 100));
    assert.ok(kept.some((p) => p.x < 50) && kept.some((p) => p.x > 150));
    assert.equal(capByRank(pts, 1e9).length, pts.length);
  });
});

describe("makeExclusion", () => {
  // Why this test matters: a scattered tree standing in a house or on a road
  // through the wood is the first thing a person would see as wrong.
  it("excludes buildings and a margin around roads", () => {
    const exclude = makeExclusion({
      rings: [square(10, 10, 10)],
      segments: [{ a: { x: 0, y: 50 }, b: { x: 100, y: 50 }, halfWidthM: 3 }],
    });
    assert.equal(exclude(15, 15), true);
    assert.equal(exclude(40, 51), true);
    assert.equal(exclude(40, 60), false);
    assert.equal(exclude(-500, -500), false);
  });
});

describe("lodOf", () => {
  it("splits at the near distance", () => {
    assert.equal(lodOf(10, 120), "near");
    assert.equal(lodOf(130, 120), "far");
  });
});
