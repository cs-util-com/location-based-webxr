import { describe, expect, it } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import { buildCity, cityGround } from "./city.js";
import { enuFrameAt } from "./enu.js";
import { barrierColour } from "./barrier-colours.js";
import { buildingColour, roadColour } from "./feature-colours.js";
import { srgbToLinear } from "./srgb.js";

/**
 * `buildCity` is the city a renderer draws: buildings (with their parts and
 * the barriers drawn among them), coloured per feature, chunked, and trees.
 * It was assembled inline in OsmDemo's worker until the globe became the
 * library's second consumer (globe city plan 2026-10-05-0040 §14 L3), so
 * these tests pin what both apps now share.
 */
const ORIGIN = { lat: 50.9413, lng: 6.9583 };
const frame = enuFrameAt(ORIGIN);
/** The fetched window every build is given: wide enough for every test feature. */
const W = { south: 50.9, west: 6.9, north: 51.0, east: 7.0 };

function outline(colour: string): OsmFeature {
  return {
    type: "way",
    id: 1,
    tags: { building: "cathedral", "building:colour": colour },
    geometry: [
      { lat: 50.9413, lng: 6.9583 },
      { lat: 50.9413, lng: 6.9593 },
      { lat: 50.9418, lng: 6.9593 },
      { lat: 50.9418, lng: 6.9583 },
      { lat: 50.9413, lng: 6.9583 },
    ],
  };
}

function tower(tags: Record<string, string> = {}): OsmFeature {
  return {
    type: "way",
    id: 2,
    tags: { "building:part": "yes", height: "157", ...tags },
    geometry: [
      { lat: 50.94145, lng: 6.95845 },
      { lat: 50.94145, lng: 6.95865 },
      { lat: 50.94165, lng: 6.95865 },
      { lat: 50.94165, lng: 6.95845 },
      { lat: 50.94145, lng: 6.95845 },
    ],
  };
}

const WALL: OsmFeature = {
  type: "way",
  id: 3,
  tags: { barrier: "wall", height: "3" },
  geometry: [
    { lat: 50.9411, lng: 6.9581 },
    { lat: 50.9411, lng: 6.9586 },
  ],
};

const TREE: OsmFeature = {
  type: "node",
  id: 4,
  tags: { natural: "tree" },
  position: { lat: 50.9409, lng: 6.959 },
};

const colours = (city: ReturnType<typeof buildCity>) =>
  [...city.buildings.flatMap((c) => [...(c.colors ?? [])])].slice(0, 3);

/** A packed 0xrrggbb as the chunk stores it: 0-1 per channel. */
const unpacked = (c: number) =>
  [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff].map((v) =>
    Math.fround(v / 255),
  );

/**
 * A packed 0xrrggbb as a BUILDING chunk stores it: linear light, 0-1 per
 * channel (plan 2026-11-07-2315 section 7; roads stay raw, see `unpacked`).
 */
const linearUnpacked = (c: number) =>
  [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff].map((v) =>
    Math.fround(srgbToLinear(v / 255)),
  );

describe("buildCity", () => {
  it("builds the volumes, the barriers among them and the trees", () => {
    const city = buildCity(
      [outline("#cc2200"), tower(), WALL, TREE],
      {
        frame,
      },
      { window: W },
    );
    // The outline with a part is drawn through its part only.
    expect(city.volumes.map((v) => v.feature)).toEqual(["way/2"]);
    expect(city.barriers).toHaveLength(1);
    expect(city.trees).toHaveLength(1);
    expect(city.buildings.length).toBeGreaterThan(0);
  });

  // WHY: a `building:part` takes its PARENT's colour (the parts of one
  // building are one building; colouring them separately stripes a cathedral
  // by whichever part carried a tag). OsmDemo's worker did this inline.
  it("colours a part by its parent", () => {
    const underRed = colours(
      buildCity([outline("#cc2200"), tower()], { frame }, { window: W }),
    );
    const underBlue = colours(
      buildCity([outline("#0044cc"), tower()], { frame }, { window: W }),
    );
    // Exactly the parent's colour (its type counts too, not only its tag).
    expect(underRed).toEqual(
      linearUnpacked(buildingColour(outline("#cc2200").tags)),
    );
    expect(underRed).not.toEqual(underBlue);
  });

  // WHY (city objects plan 2026-11-07-2315 M1): a barrier drawn among the
  // buildings takes its own muted kind colour, not a building's grey; before,
  // every wall, hedge and fence went through `buildingColour`.
  it("colours a barrier by its kind, in linear light like the buildings", () => {
    const city = buildCity([WALL], { frame }, { window: W });
    expect(colours(city)).toEqual(linearUnpacked(barrierColour(WALL.tags)));
    expect(barrierColour(WALL.tags)).not.toBe(buildingColour(WALL.tags));
  });

  it("stands on the ground it is given", () => {
    const city = buildCity(
      [outline("#cc2200"), tower()],
      {
        frame,
        groundHeightM: () => 500,
      },
      { window: W },
    );
    let minY = Infinity;
    for (const chunk of city.buildings) {
      const p = chunk.mesh.positions;
      for (let i = 1; i < p.length; i += 3) minY = Math.min(minY, p[i]!);
    }
    expect(minY).toBeCloseTo(500, 3);
  });

  // WHY: the AR shell shader's phase per feature must not re-shuffle on a
  // rebuild, or the city visibly re-randomises whenever a tile loads.
  it("gives each feature a stable shell phase in [0, 1)", () => {
    const a = buildCity(
      [outline("#cc2200"), tower(), WALL],
      { frame },
      { window: W },
    );
    const b = buildCity(
      [outline("#cc2200"), tower(), WALL],
      { frame },
      { window: W },
    );
    const ra = a.buildings.flatMap((c) => [...(c.featureRand ?? [])]);
    const rb = b.buildings.flatMap((c) => [...(c.featureRand ?? [])]);
    expect(ra.length).toBeGreaterThan(0);
    expect(ra).toEqual(rb);
    for (const r of ra) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });

  it("builds nothing from nothing", () => {
    const city = buildCity([], { frame }, { window: W });
    expect(city.volumes).toEqual([]);
    expect(city.buildings).toEqual([]);
    expect(city.trees).toEqual([]);
  });
});

describe("cityGround", () => {
  it("is flat (no sampler) without a field", () => {
    const ground = cityGround(frame, undefined);
    expect(ground.frame).toBe(frame);
    expect(ground.groundHeightM).toBeUndefined();
  });

  // WHY: the ground sampler is the field read at the frame's ENU position of
  // a lat/lng; deriving it twice is how two layers ended up on two surfaces.
  it("reads the field at the position's ENU metres", () => {
    const seen: { x: number; y: number }[] = [];
    const ground = cityGround(frame, {
      heightAt: (p) => {
        seen.push(p);
        return 42;
      },
    });
    const there = { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng };
    expect(ground.groundHeightM?.(there)).toBe(42);
    expect(seen[0]?.y).toBeCloseTo(frame.toEnu(there).y, 9);
  });
});

// WHY (globe city plan 2026-10-05-0040 §12.4 R12): a city's heights are
// sampled in a window around its origin (2.4 km in each direction), and
// outside it the field clamps the edge heights outward, so a building there
// stands on made-up ground. OsmDemo hides it with its far plane; the globe
// sees it from 30 km. `withinM` keeps only what stands inside the window.
describe("buildCity within a window", () => {
  const near = outline("#cc2200");
  // About 3.3 km north of the origin.
  const far: OsmFeature = {
    type: "way",
    id: 9,
    tags: { building: "house" },
    geometry: [
      { lat: 50.9713, lng: 6.9583 },
      { lat: 50.9713, lng: 6.9585 },
      { lat: 50.9715, lng: 6.9585 },
      { lat: 50.9715, lng: 6.9583 },
      { lat: 50.9713, lng: 6.9583 },
    ],
  };
  const farTree: OsmFeature = {
    type: "node",
    id: 8,
    tags: { natural: "tree" },
    position: { lat: 50.9713, lng: 6.959 },
  };

  // A wall about 3.3 km north, beside the far house.
  const farWall: OsmFeature = {
    type: "way",
    id: 7,
    tags: { barrier: "wall", height: "3" },
    geometry: [
      { lat: 50.9711, lng: 6.9581 },
      { lat: 50.9711, lng: 6.9586 },
    ],
  };

  it("drops volumes, barriers and trees whose position lies outside the window", () => {
    const city = buildCity(
      [near, far, TREE, farTree, WALL, farWall],
      { frame },
      { window: W, withinM: 2400 },
    );
    expect(city.volumes.map((v) => v.feature)).toEqual(["way/1"]);
    expect(city.barriers.map((b) => b.feature)).toEqual(["way/3"]);
    expect(city.trees.map((t) => t.feature)).toEqual(["node/4"]);
  });

  it("keeps everything without a window", () => {
    const city = buildCity(
      [near, far, TREE, farTree],
      { frame },
      { window: W },
    );
    expect(city.volumes).toHaveLength(2);
    expect(city.trees).toHaveLength(2);
  });

  it("refuses a window that is not a positive number", () => {
    for (const withinM of [0, -1, Number.NaN]) {
      expect(() =>
        buildCity([near], { frame }, { window: W, withinM }),
      ).toThrow(RangeError);
    }
  });
});

// WHY (round-4 plan 2026-10-11-0122 DEC-R4-7, the owner: the globe's city
// "misses the roads" OsmDemo draws): the roads and paths are part of the
// city both apps draw, built and coloured once here (OsmDemo's worker
// chunked and coloured them inline), and only when asked, so a consumer
// that draws none builds none.
describe("buildCity with roads", () => {
  const ROAD: OsmFeature = {
    type: "way",
    id: 20,
    tags: { highway: "residential", surface: "asphalt" },
    geometry: [
      { lat: 50.9412, lng: 6.958 },
      { lat: 50.9412, lng: 6.9595 },
    ],
  };
  const PATH: OsmFeature = {
    type: "way",
    id: 21,
    tags: { highway: "footway" },
    geometry: [
      { lat: 50.9416, lng: 6.958 },
      { lat: 50.9418, lng: 6.959 },
    ],
  };
  const FAR_ROAD: OsmFeature = {
    type: "way",
    id: 22,
    tags: { highway: "residential" },
    geometry: [
      { lat: 50.9712, lng: 6.958 },
      { lat: 50.9712, lng: 6.9595 },
    ],
  };
  const TUNNEL: OsmFeature = {
    type: "way",
    id: 23,
    tags: { highway: "primary", tunnel: "yes" },
    geometry: [
      { lat: 50.9414, lng: 6.958 },
      { lat: 50.9414, lng: 6.9595 },
    ],
  };

  it("builds no roads unless asked", () => {
    const city = buildCity([ROAD, PATH], { frame }, { window: W });
    expect(city.roads).toEqual([]);
    expect(city.roadCount).toBe(0);
  });

  it("builds the roads and the paths, chunked and coloured by class and surface, never a tunnel", () => {
    const city = buildCity(
      [ROAD, PATH, TUNNEL],
      { frame },
      { window: W, roads: true },
    );
    expect(city.roadCount).toBe(2);
    expect(city.roads.length).toBeGreaterThan(0);
    const colours = new Set<string>();
    for (const chunk of city.roads) {
      const c = chunk.colors ?? new Float32Array(0);
      for (let i = 0; i < c.length; i += 3) {
        colours.add(`${c[i]},${c[i + 1]},${c[i + 2]}`);
      }
    }
    const asKey = (rgb: number) => unpacked(rgb).join(",");
    expect(colours).toEqual(
      new Set([asKey(roadColour(ROAD.tags)), asKey(roadColour(PATH.tags))]),
    );
  });

  it("drapes the roads on the ground it is given", () => {
    const city = buildCity(
      [ROAD],
      { frame, groundHeightM: (p) => 400 + (p.lng - 6.958) * 10_000 },
      { window: W, roads: true },
    );
    const ys: number[] = [];
    for (const chunk of city.roads) {
      const p = chunk.mesh.positions;
      for (let i = 1; i < p.length; i += 3) ys.push(p[i]!);
    }
    // A road 105 m long rising 15 m: a ribbon follows it, a box would not.
    expect(Math.min(...ys)).toBeLessThan(402);
    expect(Math.max(...ys)).toBeGreaterThan(413);
  });

  it("keeps only the roads inside the window", () => {
    const city = buildCity(
      [ROAD, FAR_ROAD],
      { frame },
      { window: W, roads: true, withinM: 2400 },
    );
    expect(city.roadCount).toBe(1);
  });
});

// WHY (city objects plan 2026-11-07-2315 M2a): the invented trees of woods,
// orchards and tree rows are part of the city both apps draw, on by default
// (the owner) and switchable off; they must never mix with the mapped trees,
// and the build must refuse to run without the fetched window that bounds
// every invention.
describe("buildCity, cosmetic trees", () => {
  const forest: OsmFeature = {
    type: "way",
    id: 20,
    tags: { landuse: "forest" },
    geometry: [
      { lat: 50.95, lng: 6.96 },
      { lat: 50.95, lng: 6.962 },
      { lat: 50.951, lng: 6.962 },
      { lat: 50.951, lng: 6.96 },
      { lat: 50.95, lng: 6.96 },
    ],
  };
  // A house inside the forest.
  const house: OsmFeature = {
    type: "way",
    id: 21,
    tags: { building: "house" },
    geometry: [
      { lat: 50.9503, lng: 6.9605 },
      { lat: 50.9503, lng: 6.9612 },
      { lat: 50.9507, lng: 6.9612 },
      { lat: 50.9507, lng: 6.9605 },
      { lat: 50.9503, lng: 6.9605 },
    ],
  };

  it("invents them by default, in their own field, never among the mapped trees", () => {
    const city = buildCity([forest, TREE], { frame }, { window: W });
    expect(city.trees.map((t) => t.feature)).toEqual(["node/4"]);
    expect(city.cosmeticTrees.length).toBeGreaterThan(100);
    for (const t of city.cosmeticTrees) {
      expect(t.cosmetic).toBe(true);
      expect(t.feature).toBe("way/20");
    }
  });

  it("builds none when switched off", () => {
    const city = buildCity(
      [forest, TREE],
      { frame },
      { window: W, cosmeticTrees: false },
    );
    expect(city.cosmeticTrees).toEqual([]);
    expect(city.trees).toHaveLength(1);
  });

  it("keeps them out of the buildings it builds", () => {
    const city = buildCity([forest, house], { frame }, { window: W });
    const ring = city.volumes[0]!.footprint;
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    const inHouse = city.cosmeticTrees.filter(
      (t) =>
        t.position.x > Math.min(...xs) &&
        t.position.x < Math.max(...xs) &&
        t.position.y > Math.min(...ys) &&
        t.position.y < Math.max(...ys),
    );
    expect(inHouse).toEqual([]);
    const without = buildCity([forest], { frame }, { window: W });
    expect(without.cosmeticTrees.length).toBeGreaterThan(
      city.cosmeticTrees.length,
    );
  });

  it("keeps them within withinM like everything else", () => {
    const city = buildCity([forest], { frame }, { window: W, withinM: 800 });
    expect(city.cosmeticTrees).toEqual([]);
  });

  it("refuses to build without a window", () => {
    expect(() => buildCity([forest], { frame }, {} as never)).toThrow(
      RangeError,
    );
    expect(() => buildCity([forest], { frame }, undefined as never)).toThrow();
  });
});
