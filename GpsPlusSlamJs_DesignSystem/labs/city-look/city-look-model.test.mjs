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
  freeOrbitLimits,
  parseCameraOverride,
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
      {
        scene: "heidelberg",
        view: "street",
        split: 0.25,
        heat: true,
        roofs: false,
        cam: null,
      },
    );
  });

  it("falls back to the page's defaults for a missing or mistyped value", () => {
    assert.deepEqual(
      parseCityLookParams("?scene=atlantis&view=moon&split=wide", {
        defaultSplit: 0.5,
      }),
      {
        scene: "lucerne",
        view: "landing",
        split: 0.5,
        heat: false,
        roofs: false,
        cam: null,
      },
    );
    assert.equal(parseCityLookParams("", { defaultSplit: null }).split, null);
  });

  it("draws today's side with the library's invented roofs only when the link asks", () => {
    // Why this test matters: today's side is the baseline the variants were
    // drawn against, so it keeps flat tops by default; `roofs=library` puts
    // the library's invented roofs on it, so a variant and the library can be
    // compared at one pose and in one light. Anything else reads as off.
    assert.equal(parseCityLookParams("?roofs=library", {}).roofs, true);
    for (const other of ["", "?roofs=on", "?roofs=1", "?roofs=LIBRARY"]) {
      assert.equal(parseCityLookParams(other, {}).roofs, false, other);
    }
    assert.doesNotMatch(
      cityLookSearch({
        scene: "lucerne",
        view: "street",
        split: null,
        heat: false,
      }),
      /roofs=/,
    );
  });

  it("takes split=off as the full view and clamps a number", () => {
    assert.equal(
      parseCityLookParams("?split=off", { defaultSplit: 0.5 }).split,
      null,
    );
    assert.equal(parseCityLookParams("?split=7", {}).split, clampSplit(7));
  });

  it("round-trips through the search string it writes", () => {
    const state = {
      scene: "lucerne",
      view: "bird",
      split: null,
      heat: true,
      roofs: true,
      cam: null,
    };
    assert.deepEqual(
      parseCityLookParams(cityLookSearch(state), { defaultSplit: 0.5 }),
      state,
    );
  });
});

describe("the camera override in the link", () => {
  // Why this test matters: the owner judges a variant from a link that shows
  // the objects in question up close, so `cam=` must bring the camera back
  // exactly, survive the page's own reloads, and never turn a mistyped link
  // into an error page.
  it("reads six numbers as eye and target, commas plain or encoded", () => {
    const pose = {
      position: [-12.5, 1.7, 40],
      target: [3, 2, -8.25],
    };
    assert.deepEqual(parseCameraOverride("-12.5,1.7,40,3,2,-8.25"), pose);
    assert.deepEqual(
      parseCityLookParams("?cam=-12.5%2C1.7%2C40%2C3%2C2%2C-8.25", {}).cam,
      pose,
    );
    assert.deepEqual(parseCameraOverride(" -12.5, 1.7,40 ,3,2,-8.25 "), pose);
  });

  it("ignores anything that is not a usable pose, without throwing", () => {
    for (const bad of [
      null,
      undefined,
      42,
      {},
      "",
      "1,2,3,4,5",
      "1,2,3,4,5,6,7",
      "1,2,3,4,5,x",
      "1,2,3,4,5,",
      "1,2,3,NaN,5,6",
      "1,2,3,Infinity,5,6",
      "1e9,2,3,4,5,6",
      "1,2,3,1,2,3",
    ]) {
      assert.equal(parseCameraOverride(bad), null, String(bad));
    }
    const state = parseCityLookParams("?scene=reuss&view=bird&cam=1,2,3", {});
    assert.equal(state.cam, null);
    assert.equal(state.scene, "reuss");
    assert.equal(state.view, "bird");
  });

  it("round-trips through the search string, with plain commas", () => {
    const state = {
      scene: "heidelberg",
      view: "street",
      split: 0.5,
      heat: false,
      roofs: false,
      cam: { position: [10.4, 1.7, -20], target: [30, 3.5, -61.2] },
    };
    const search = cityLookSearch(state);
    assert.match(search, /cam=10\.4,1\.7,-20,30,3\.5,-61\.2(&|$)/);
    assert.deepEqual(parseCityLookParams(search, {}), state);
    assert.doesNotMatch(cityLookSearch({ ...state, cam: null }), /cam=/);
  });

  it("rounds a written pose to 10 cm", () => {
    const search = cityLookSearch({
      scene: "lucerne",
      view: "landing",
      split: null,
      heat: false,
      cam: { position: [1.234, 5.678, -0.04], target: [0, 0, 9.999] },
    });
    assert.deepEqual(parseCityLookParams(search, {}).cam, {
      position: [1.2, 5.7, 0],
      target: [0, 0, 10],
    });
  });
});

describe("freeOrbitLimits", () => {
  // Why this test matters: OrbitControls clamps the camera into its limits
  // on the first update, so limits that exclude the linked pose would move
  // the camera away from what the link promises; and a close pose must still
  // be able to orbit and zoom in.
  const polar = ({ position: [x, y, z], target: [tx, ty, tz] }) =>
    Math.acos((y - ty) / Math.hypot(x - tx, y - ty, z - tz));
  const distance = ({ position, target }) =>
    Math.hypot(...position.map((v, i) => v - target[i]));
  const poses = {
    street: { position: [0, 1.7, 0], target: [0, 3, -30] },
    close: { position: [0, 4, 6], target: [0, 1, 0] },
    aerial: { position: [-40, 60, 50], target: [0, 0, 0] },
    far: { position: [-900, 700, 900], target: [0, 0, 0] },
  };
  for (const [name, pose] of Object.entries(poses)) {
    it(`keeps the ${name} pose inside its own limits`, () => {
      const limits = freeOrbitLimits(pose);
      assert.ok(limits.minDistance <= distance(pose));
      assert.ok(limits.maxDistance >= distance(pose));
      assert.ok(limits.maxPolarAngle >= polar(pose));
      assert.ok(limits.maxPolarAngle < Math.PI);
    });
  }

  it("lets a close pose zoom in and a street pose look up", () => {
    assert.ok(freeOrbitLimits(poses.close).minDistance <= 1);
    assert.ok(freeOrbitLimits(poses.street).maxPolarAngle > Math.PI / 2);
    assert.ok(freeOrbitLimits(poses.aerial).maxPolarAngle <= Math.PI / 2);
  });

  it("returns finite limits for a broken pose rather than NaN", () => {
    const limits = freeOrbitLimits({ position: [0, 0, 0], target: [0, 0, 0] });
    for (const value of Object.values(limits)) {
      assert.ok(Number.isFinite(value));
    }
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

describe("the fixed views over the real scenes", () => {
  // Why this test matters: a fixed camera is a number picked once, and a
  // tower 325 m tall makes the shared landing pose stand next to a wall. Only
  // a person looking at the page would notice, so the fixtures are checked:
  // no tagged building near a fixed camera reaches up to it.
  const scenes = {
    lucerne: "lucerne-meggen.json",
    heidelberg: "heidelberg-altstadt.json",
    midtown: "nyc-midtown.json",
    parkslope: "nyc-park-slope.json",
    reuss: "lucerne-reuss.json",
    woodland: "woodland-hinterzarten.json",
  };
  for (const [scene, file] of Object.entries(scenes)) {
    it(`keeps ${scene}'s landing and bird clear of every tagged building`, () => {
      const { payload, centre } = JSON.parse(
        readFileSync(join(FIXTURES, file), "utf8"),
      );
      const k = Math.cos((centre.lat * Math.PI) / 180);
      const tall = payload.elements.filter(
        (e) => e.type === "way" && e.geometry && Number(e.tags?.height) > 0,
      );
      for (const view of ["landing", "bird"]) {
        const {
          position: [x, y, z],
        } = cameraPose(view, null, scene);
        for (const e of tall) {
          const near = e.geometry.some(
            (p) =>
              Math.hypot(
                (p.lon - centre.lng) * 111320 * k - x,
                (p.lat - centre.lat) * 110540 + z,
              ) < 120,
          );
          if (near)
            assert.ok(Number(e.tags.height) < y - 30, `${view} way/${e.id}`);
        }
      }
    });
  }
});

describe("the street views over the real scenes", () => {
  // Why this test matters: the street camera stands on the road nearest the
  // centre and knows nothing about buildings, so in Heidelberg it looked at a
  // wall 4 m away. Each scene's street view must look down open space: the
  // ray along the view meets no mapped building outline for 30 m.
  const CLEAR_M = 30;
  for (const scene of SCENES) {
    const file = sceneFile(scene);
    it(`looks down an open street in ${scene}`, () => {
      const { payload, centre } = JSON.parse(
        readFileSync(join(FIXTURES, file), "utf8"),
      );
      const k = Math.cos((centre.lat * Math.PI) / 180);
      const fixtureFrame = {
        toEnu: (p) => ({
          x: (p.lng - centre.lng) * 111320 * k,
          y: (p.lat - centre.lat) * 110540,
        }),
      };
      const ways = payload.elements
        .filter((e) => e.type === "way" && e.geometry)
        .map((e) => ({
          type: "way",
          id: e.id,
          tags: e.tags ?? {},
          geometry: e.geometry.map((p) => ({ lat: p.lat, lng: p.lon })),
        }));
      const {
        position: [x, , z],
        target: [tx, , tz],
      } = cameraPose("street", streetCamera(ways, fixtureFrame), scene);
      const length = Math.hypot(tx - x, tz - z);
      const dir = { x: (tx - x) / length, y: -(tz - z) / length };
      const eye = { x, y: -z };
      let clear = Infinity;
      for (const way of ways) {
        const building = way.tags.building;
        if (!building || building === "no") continue;
        const points = way.geometry.map((p) => fixtureFrame.toEnu(p));
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1];
          const ex = points[i].x - a.x;
          const ey = points[i].y - a.y;
          const det = dir.x * ey - dir.y * ex;
          if (Math.abs(det) < 1e-9) continue;
          const t = ((a.x - eye.x) * ey - (a.y - eye.y) * ex) / det;
          const u = ((a.x - eye.x) * dir.y - (a.y - eye.y) * dir.x) / det;
          if (t > 0 && u >= 0 && u <= 1) clear = Math.min(clear, t);
        }
      }
      assert.ok(
        clear >= CLEAR_M,
        `${scene}: a building ${clear.toFixed(1)} m ahead`,
      );
    });
  }
});

/** The fixture file of a scene, as the harness names it. */
function sceneFile(scene) {
  return {
    lucerne: "lucerne-meggen.json",
    heidelberg: "heidelberg-altstadt.json",
    midtown: "nyc-midtown.json",
    parkslope: "nyc-park-slope.json",
    reuss: "lucerne-reuss.json",
    woodland: "woodland-hinterzarten.json",
  }[scene];
}

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

  for (const name of [
    "heidelberg-altstadt.json",
    "lucerne-meggen.json",
    "nyc-midtown.json",
    "nyc-park-slope.json",
    "lucerne-reuss.json",
    "woodland-hinterzarten.json",
  ]) {
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
