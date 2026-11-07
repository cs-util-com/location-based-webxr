/**
 * The city look lab's pure logic, and its committed fixtures.
 *
 * Why this file matters: the owner judges variants next to today from a link,
 * so the link's parameters, the fixed cameras and the stable seeds must not
 * depend on anything a reload changes. The street camera is computed from
 * real data and a wrong pick would stand it inside a house, which only a
 * person looking at the page would otherwise notice.
 */
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  EYE_HEIGHT_M,
  SCENES,
  cameraPose,
  clampSplit,
  cityLookSearch,
  parseCityLookParams,
  seededRandom,
  smoothedFrameMs,
  standInFraction,
  streetCamera,
} from "./city-look-model.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** A frame good enough for the tests: degrees times 1000 are metres. */
const frame = { toEnu: (p) => ({ x: p.lng * 1000, y: p.lat * 1000 }) };
const way = (id, highway, points, extra = {}) => ({
  type: "way",
  id,
  tags: { highway, ...extra },
  geometry: points.map(([lng, lat]) => ({ lat, lng })),
});

describe("parseCityLookParams", () => {
  it("reads every parameter of a link", () => {
    assert.deepEqual(
      parseCityLookParams("?scene=heidelberg&view=street&split=0.25&heat=1", {
        defaultSplit: 0.5,
      }),
      { scene: "heidelberg", view: "street", split: 0.25, heat: true },
    );
  });

  it("falls back to the page's defaults for a missing or mistyped value", () => {
    assert.deepEqual(
      parseCityLookParams("?scene=atlantis&view=moon&split=wide", {
        defaultSplit: 0.5,
      }),
      { scene: "lucerne", view: "landing", split: 0.5, heat: false },
    );
    assert.equal(parseCityLookParams("", { defaultSplit: null }).split, null);
  });

  it("takes split=off as the full view and clamps a number", () => {
    assert.equal(
      parseCityLookParams("?split=off", { defaultSplit: 0.5 }).split,
      null,
    );
    assert.equal(parseCityLookParams("?split=7", {}).split, clampSplit(7));
  });

  it("round-trips through the search string it writes", () => {
    const state = { scene: "lucerne", view: "bird", split: null, heat: true };
    assert.deepEqual(
      parseCityLookParams(cityLookSearch(state), { defaultSplit: 0.5 }),
      state,
    );
  });
});

describe("seededRandom", () => {
  it("is stable, in range, and differs by key", () => {
    const a = seededRandom("way/123");
    assert.equal(a, seededRandom("way/123"));
    assert.ok(a >= 0 && a < 1);
    assert.notEqual(a, seededRandom("way/124"));
  });

  it("spreads neighbouring ids over the whole range", () => {
    const values = Array.from({ length: 1000 }, (_, i) =>
      seededRandom(`way/${1000 + i}`),
    );
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    assert.ok(Math.abs(mean - 0.5) < 0.05, `mean ${mean}`);
    assert.ok(Math.min(...values) < 0.02 && Math.max(...values) > 0.98);
  });
});

describe("cameraPose", () => {
  it("puts the landing view about 150 m up and the bird about 400 m", () => {
    assert.equal(cameraPose("landing", null).position[1], 150);
    assert.equal(cameraPose("bird", null).position[1], 400);
  });

  it("is steeper from the bird than from the landing", () => {
    const pitch = ({ position: [x, y, z], target: [tx, , tz] }) =>
      Math.atan2(y, Math.hypot(x - tx, z - tz));
    assert.ok(
      pitch(cameraPose("bird", null)) > pitch(cameraPose("landing", null)),
    );
  });

  it("hands the street view through, and refuses an unknown view", () => {
    const street = {
      position: [1, EYE_HEIGHT_M, 2],
      target: [1, EYE_HEIGHT_M, 3],
    };
    assert.deepEqual(cameraPose("street", street), street);
    assert.throws(() => cameraPose("moon", null), RangeError);
    assert.throws(() => cameraPose("street", null), RangeError);
  });
});

describe("streetCamera", () => {
  it("stands at eye height on the road segment nearest the centre", () => {
    const pose = streetCamera(
      [
        way(1, "residential", [
          [-0.1, 0.2],
          [0.1, 0.2],
        ]),
        way(2, "residential", [
          [-0.1, 0.05],
          [0.1, 0.05],
        ]),
      ],
      frame,
    );
    assert.deepEqual(pose.position, [0, EYE_HEIGHT_M, -50]);
    assert.equal(pose.target[1], EYE_HEIGHT_M);
  });

  it("ignores footways, tunnels and bridges, and maps north to minus z", () => {
    const pose = streetCamera(
      [
        way(1, "footway", [
          [-0.1, 0],
          [0.1, 0],
        ]),
        way(
          2,
          "residential",
          [
            [-0.1, 0.01],
            [0.1, 0.01],
          ],
          { tunnel: "yes" },
        ),
        way(
          3,
          "residential",
          [
            [-0.1, 0.02],
            [0.1, 0.02],
          ],
          { bridge: "yes" },
        ),
        way(4, "tertiary", [
          [-0.1, 0.1],
          [0.1, 0.1],
        ]),
      ],
      frame,
    );
    assert.equal(pose.position[2], -100);
  });

  it("looks along the road, towards its longer part", () => {
    const pose = streetCamera(
      [
        way(1, "residential", [
          [-0.02, 0],
          [0.02, 0],
          [0.5, 0],
        ]),
      ],
      frame,
    );
    assert.ok(pose.target[0] > pose.position[0]);
    assert.equal(pose.target[2], pose.position[2]);
  });

  it("does not depend on the order of the features", () => {
    const a = way(1, "residential", [
      [-0.1, 0.05],
      [0.1, 0.05],
    ]);
    const b = way(2, "residential", [
      [-0.1, -0.05],
      [0.1, -0.05],
    ]);
    assert.deepEqual(streetCamera([a, b], frame), streetCamera([b, a], frame));
  });

  it("falls back to the centre when the data has no street", () => {
    const pose = streetCamera([], frame);
    assert.deepEqual(pose.position, [0, EYE_HEIGHT_M, 0]);
    assert.notDeepEqual(pose.target, pose.position);
  });
});

describe("standInFraction", () => {
  it("is deterministic, in range, and covers the ramp", () => {
    const values = [];
    for (let x = -300; x <= 300; x += 15) {
      for (let y = -300; y <= 300; y += 15) {
        const f = standInFraction(`cell-${x}-${y}`, { x, y });
        assert.equal(f, standInFraction(`cell-${x}-${y}`, { x, y }));
        assert.ok(f >= 0 && f <= 1);
        values.push(f);
      }
    }
    assert.ok(Math.min(...values) < 0.2 && Math.max(...values) > 0.8);
  });
});

describe("the committed fixtures", () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));

  it("has one fixture per scene, each named in the provenance", () => {
    assert.equal(files.length, SCENES.length);
    const provenance = readFileSync(join(FIXTURES, "PROVENANCE.md"), "utf8");
    for (const file of files) assert.ok(provenance.includes(file), file);
    assert.match(provenance, /OpenStreetMap contributors/);
    assert.match(provenance, /ODbL/);
  });

  for (const name of ["heidelberg-altstadt.json", "lucerne-meggen.json"]) {
    it(`keeps ${name} under 2 MiB, minified, with Overpass's shape`, () => {
      const file = join(FIXTURES, name);
      assert.ok(statSync(file).size < 2 * 1024 * 1024);
      const text = readFileSync(file, "utf8");
      // Prettier would pretty-print it unless .prettierignore holds.
      assert.equal(text.trimEnd().split("\n").length, 1);
      const fixture = JSON.parse(text);
      assert.ok(fixture.payload.elements.length > 500);
      assert.ok(fixture.centre.lat && fixture.centre.lng);
    });
  }
});

describe("smoothedFrameMs", () => {
  // Why this test matters: an animation frame's timestamp is taken at the
  // frame's start, so a clock read just before it can lie later, and the
  // preview published -351 ms a frame. The owner compares variants by this
  // number, so only the gap between two frames' own timestamps may enter it.
  it("has no value until two frames have a gap", () => {
    assert.equal(smoothedFrameMs(null, null, 1000), null);
  });

  it("starts at the first real gap", () => {
    assert.equal(smoothedFrameMs(null, 1000, 1016), 16);
  });

  it("moves a tenth of the way towards each new gap", () => {
    assert.equal(smoothedFrameMs(20, 1000, 1030), 21);
  });

  it("ignores a frame with no gap or a negative one", () => {
    assert.equal(smoothedFrameMs(20, 1000, 1000), 20);
    assert.equal(smoothedFrameMs(20, 1000, 900), 20);
  });
});
