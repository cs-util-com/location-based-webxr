import { describe, expect, it } from "vitest";

import { featureKey, type OsmFeature } from "../model/osm-feature.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { CORPUS_SITES } from "../places/sites.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import { buildCity, cityGround } from "./city.js";
import { enuFrameAt } from "./enu.js";
import { barrierColour } from "./barrier-colours.js";
import {
  FLAT_ROOF_TONES,
  PITCHED_ROOF_TONES,
  allPaletteColours,
  seededBuildingColours,
} from "./building-palette.js";
import {
  DEFAULT_ROAD_COLOURS,
  buildingColour,
  parseOsmColour,
  roadColour,
  roofColour,
} from "./feature-colours.js";
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
      // THE PART FILLS ITS OUTLINE. Since the 2026-11-07 coverage rule
      // (`part-coverage.ts`) an outline is hidden only when its parts cover
      // 90 % of it; a small tower inside a large outline now draws both, and
      // `s3db-parts.test.ts` pins that case. These tests are about the filled one.
      { lat: 50.9413, lng: 6.9583 },
      { lat: 50.9413, lng: 6.9593 },
      { lat: 50.9418, lng: 6.9593 },
      { lat: 50.9418, lng: 6.9583 },
      { lat: 50.9413, lng: 6.9583 },
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

  // WHY (skeleton roof plan 2026-11-07-2130 section 9 item 3): the roof
  // colour is painted inside `chunkMeshes` (`roofOf`), and the linear
  // conversion must wrap that whole call, or the roofs stay raw sRGB next to
  // linear walls and the two-toned city returns. The red and black roof tests
  // cannot see this: 0 and 255 are the same in both spaces. Mid-grey 0x80 is
  // 0.2158605 linear and 0.5019608 raw.
  it("gives a mid-grey roof:colour to the roof vertices in linear light", () => {
    const house: OsmFeature = {
      ...outline("#000000"),
      tags: {
        building: "house",
        "building:colour": "#000000",
        "roof:colour": "#808080",
      },
    };
    const values = buildCity(
      [house],
      { frame },
      { window: W },
    ).buildings.flatMap((c) => [...(c.colors ?? [])]);
    expect(values.length).toBeGreaterThan(0);
    const grey = values.filter((v) => v !== 0);
    // Some vertices are the roof (and only the roof is grey), and every one
    // of them is linear.
    expect(grey.length).toBeGreaterThan(0);
    for (const v of grey) expect(v).toBeCloseTo(0.2158605, 6);
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

  // WHY (M4a review MINOR 4, plan section 4's rule that a look decision stays
  // switchable): an audit or a before/after page must reach the road lift and
  // the mitre through `buildCity`, the one way every app builds its roads.
  it("takes the road options through to the builder", () => {
    const heights = (roads: Parameters<typeof buildCity>[2]["roads"]) => {
      const ys: number[] = [];
      for (const chunk of buildCity(
        [ROAD, PATH],
        { frame },
        { window: W, roads },
      ).roads) {
        const p = chunk.mesh.positions;
        for (let i = 1; i < p.length; i += 3) ys.push(p[i]!);
      }
      return ys;
    };
    // The default lifts the classes off the ground; a rank step of 0 does not.
    expect(Math.max(...heights(true))).toBeGreaterThan(0);
    expect(heights({ rankStepM: 0 }).every((y) => y === 0)).toBe(true);
    expect(Math.max(...heights({ mitreLimit: 4 }))).toBeGreaterThan(0);

    // A 90 degree corner: mitred at the default limit, bevelled at 1.2.
    const corner: OsmFeature = {
      type: "way",
      id: 24,
      tags: { highway: "residential" },
      geometry: [
        { lat: 50.9412, lng: 6.958 },
        { lat: 50.9412, lng: 6.9585 },
        { lat: 50.9416, lng: 6.9585 },
      ],
    };
    const triangles = (roads: Parameters<typeof buildCity>[2]["roads"]) =>
      buildCity([corner], { frame }, { window: W, roads }).roads.reduce(
        (sum, chunk) => sum + chunk.mesh.indices.length / 3,
        0,
      );
    expect(triangles({ mitreLimit: 1.2 })).toBe(triangles(true) + 1);
    expect(triangles({})).toBe(triangles(true));
  });

  // WHY: zebras and squares are a look decision the owner can switch, and
  // buildCity is the one way every app builds roads. On by default with the
  // roads, they land in the road chunks in the scheme colour (one draw);
  // markings: false must give exactly the roads without them.
  it("draws zebras and pedestrian areas with the roads, switchable off", () => {
    const enu = (x: number, y: number) => frame.toLatLng({ x, y });
    const zebra: OsmFeature = {
      type: "way",
      id: 31,
      tags: { highway: "footway", footway: "crossing", crossing: "zebra" },
      geometry: [enu(0, -4), enu(0, 4)],
    };
    const square: OsmFeature = {
      type: "way",
      id: 32,
      tags: { highway: "pedestrian", area: "yes" },
      geometry: [enu(20, 0), enu(40, 0), enu(40, 20), enu(20, 20), enu(20, 0)],
    } as unknown as OsmFeature;
    const features = [ROAD, zebra, square];
    const on = buildCity(features, { frame }, { window: W, roads: true });
    expect(on.zebraStripeCount).toBe(8);
    expect(on.pedestrianAreaCount).toBe(1);
    const colourKeys = (city: ReturnType<typeof buildCity>) => {
      const keys = new Set<string>();
      for (const chunk of city.roads) {
        const c = chunk.colors ?? new Float32Array(0);
        for (let i = 0; i < c.length; i += 3) {
          keys.add(`${c[i]},${c[i + 1]},${c[i + 2]}`);
        }
      }
      return keys;
    };
    expect(
      colourKeys(on).has(unpacked(DEFAULT_ROAD_COLOURS.markings).join(",")),
    ).toBe(true);
    const off = buildCity(
      features,
      { frame },
      { window: W, roads: { markings: false } },
    );
    expect(off.zebraStripeCount).toBe(0);
    expect(off.pedestrianAreaCount).toBe(0);
    // Off adds nothing; on adds two triangles a stripe plus the square.
    const triangles = (city: ReturnType<typeof buildCity>) =>
      city.roads.reduce((n, c) => n + c.mesh.indices.length / 3, 0);
    expect(triangles(off)).toBe(
      triangles(
        buildCity(
          [ROAD, zebra],
          { frame },
          { window: W, roads: { markings: false } },
        ),
      ),
    );
    expect(triangles(on)).toBeGreaterThanOrEqual(triangles(off) + 2 * 8 + 2);
  });

  // WHY (r1164 delta review NIT 4): `roads` comes from a consumer's options
  // object, often parsed JSON, where an absent value is easily `null`. Read
  // as an object it threw a TypeError from the destructuring; it means "no
  // roads", as false does.
  it("treats roads: null like false", () => {
    const city = buildCity(
      [ROAD],
      { frame },
      {
        window: W,
        roads: null as unknown as Parameters<typeof buildCity>[2]["roads"],
      },
    );
    expect(city.roads).toEqual([]);
    expect(city.roadCount).toBe(0);
  });

  it("refuses invalid road options as the builder does", () => {
    expect(() =>
      buildCity([ROAD], { frame }, { window: W, roads: { mitreLimit: 0.5 } }),
    ).toThrow(RangeError);
    expect(() =>
      buildCity([ROAD], { frame }, { window: W, roads: { rankStepM: -1 } }),
    ).toThrow(RangeError);
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

/**
 * WHY (city objects plan 2026-11-07-2315 M7): the owner chose V2's look, so
 * an untagged building takes warm seeded tones from its own key, the same on
 * every reload, and the class colours stay reachable only behind
 * `palette: "class"`. Each failure here is silent on screen: a city of one
 * tone, a striped cathedral, the class greys back, a roof painted as a wall.
 */
describe("buildCity's seeded palette", () => {
  const house = (id: number, tags: Record<string, string>): OsmFeature => ({
    ...outline("#000000"),
    id,
    tags,
  });
  /** The distinct linear colours a city's building chunks carry. */
  const triples = (city: ReturnType<typeof buildCity>): Set<string> => {
    const out = new Set<string>();
    for (const chunk of city.buildings) {
      const c = chunk.colors ?? [];
      for (let i = 0; i < c.length; i += 3) {
        out.add(`${c[i]},${c[i + 1]},${c[i + 2]}`);
      }
    }
    return out;
  };
  const key = (rgb: number) => linearUnpacked(rgb).join(",");

  it("paints an untagged house's walls and flat roof from its key, by default", () => {
    const tags = { building: "house" };
    const expected = seededBuildingColours(tags, undefined, "way/9", false);
    const got = triples(buildCity([house(9, tags)], { frame }, { window: W }));
    expect(got).toEqual(new Set([key(expected.wall), key(expected.roof)]));
    expect(FLAT_ROOF_TONES).toContain(expected.roof);
  });

  it("gives a pitched roof a clay or slate tone", () => {
    const tags = { building: "house", "roof:shape": "gabled" };
    const expected = seededBuildingColours(tags, undefined, "way/9", true);
    expect(PITCHED_ROOF_TONES).toContain(expected.roof);
    const got = triples(buildCity([house(9, tags)], { frame }, { window: W }));
    expect(got).toEqual(new Set([key(expected.wall), key(expected.roof)]));
  });

  it("gives a pitched-tagged roof the ladder drew as a flat lid a flat grey", () => {
    // Why (M7 review MINOR 4): the colour follows the DRAWN roof, not the
    // tag. An L above the skeleton's corner cap whose rectangle would span
    // its yard is drawn as a prism (a flat lid at the ridge); clay on a flat
    // lid reads as a red flat roof, which V2 never drew.
    const corners: { x: number; y: number }[] = [];
    for (let i = 0; i < 300; i++) corners.push({ x: (20 * i) / 300, y: 0 });
    const ring = [
      ...corners,
      { x: 20, y: 0 },
      { x: 20, y: 8 },
      { x: 8, y: 8 },
      { x: 8, y: 20 },
      { x: 0, y: 20 },
    ];
    const geometry = [...ring, ring[0] as { x: number; y: number }].map((p) =>
      frame.toLatLng(p),
    );
    const tags = { building: "house", "roof:shape": "hipped", height: "11" };
    const city = buildCity(
      [{ type: "way", id: 9, tags, geometry }],
      { frame },
      { window: W },
    );
    expect(city.volumes[0]?.roofMethods).toEqual(["prism"]);
    const expected = seededBuildingColours(tags, undefined, "way/9", false);
    expect(FLAT_ROOF_TONES).toContain(expected.roof);
    expect(triples(city)).toEqual(
      new Set([key(expected.wall), key(expected.roof)]),
    );
  });

  it("is the same city for the same features", () => {
    const features = [1, 2, 3].map((id) => house(id, { building: "yes" }));
    expect(triples(buildCity(features, { frame }, { window: W }))).toEqual(
      triples(buildCity(features, { frame }, { window: W })),
    );
  });

  it("gives an untagged part its outline's seeded colours", () => {
    const parent = house(1, { building: "church" });
    const part = { ...tower(), tags: { "building:part": "yes", height: "20" } };
    const expected = seededBuildingColours({}, undefined, "way/1", false);
    expect(
      triples(buildCity([parent, part], { frame }, { window: W })),
    ).toEqual(new Set([key(expected.wall), key(expected.roof)]));
  });

  it("ignores building:material (owner Q3), and keeps the class colours behind palette: class", () => {
    const plain = { building: "house" };
    const brick = { building: "house", "building:material": "brick" };
    expect(
      triples(buildCity([house(9, brick)], { frame }, { window: W })),
    ).toEqual(triples(buildCity([house(9, plain)], { frame }, { window: W })));
    const classic = triples(
      buildCity([house(9, brick)], { frame }, { window: W, palette: "class" }),
    );
    expect(classic).toEqual(new Set([key(buildingColour(brick))]));
  });

  it("refuses a palette it does not know", () => {
    expect(() =>
      buildCity([], { frame }, { window: W, palette: "loud" as "class" }),
    ).toThrow(RangeError);
  });
});

/**
 * WHY: the corpus is what the owner looks at. Heidelberg's roof-tagged
 * buildings are the ones V2's clay roofscape was chosen on; each must take a
 * palette roof unless a mapper coloured it, and no class colour may survive
 * anywhere in the default city.
 */
describe("Heidelberg under the seeded palette", () => {
  // The Osm corpus extract (src/testdata/sites), not the city-look lab's.
  const site = CORPUS_SITES.find((s) => s.id === "heidelberg-altstadt");
  if (site === undefined) throw new Error("heidelberg-altstadt not in corpus");
  const features = parseOverpassJson(loadSite(site.id).payload).features;
  const ground = { frame: enuFrameAt(site.position) };
  // INVENTED ROOFS OFF for the pinned table below: it is about the roofs the
  // map tags, measured before invented roofs existed. The invented ones are
  // checked on their own at the end of this block.
  const city = buildCity(features, ground, {
    window: loadSite(site.id).bbox,
    inventedRoofs: false,
  });
  const tagsByKey = new Map(features.map((f) => [featureKey(f), f.tags]));

  /**
   * The seeded roof of every colourless roof-tagged volume, written out
   * (r1158 review NIT 8): deriving "drawn pitched" in the test copied
   * `drawsPitchedRoof`'s predicate, so the test agreed with the code by
   * construction. Measured from the build in r1162 (2026-11-09); the flat
   * greys are the three volumes the ladder drew as a flat lid (r1155). A
   * change here changes what the owner sees, so make it on purpose.
   */
  const EXPECTED_ROOF: Readonly<Record<string, number>> = {
    "way/1186132976": 0x86604f,
    "way/1186685291": 0x7f6a60,
    "way/1186937591": 0x6b625e,
    "way/1186937594": 0x7f6a60,
    "way/171041984": 0x8c6152,
    "way/171691889": 0x5c5a5c,
    "way/171691898": 0x6b625e,
    "way/171691908": 0x7f6a60,
    "way/173307427": 0x96705f,
    "way/173307431": 0x7a7772,
    "way/179552475": 0x7c5a4e,
    "way/179632696": 0x7c5a4e,
    "way/179632697": 0x6b625e,
    "way/179632701": 0x8c6152,
    "way/180070497": 0x5c5a5c,
    "way/180108327": 0x7c5a4e,
    "way/180108329": 0x86604f,
    "way/194261904": 0x86604f,
    "way/247081690": 0x7f6a60,
    "way/247081694": 0x7c5a4e,
    "way/247081696": 0x7f6a60,
    "way/247081699": 0x7c5a4e,
    "way/247081700": 0x96705f,
    "way/247521016": 0x7f6a60,
    "way/247521018": 0x96705f,
    "way/247521026": 0x7f6a60,
    "way/247521032": 0x7f6a60,
    "way/247521039": 0x8c6152,
    "way/247521041": 0x7f6a60,
    "way/247521047": 0x6b625e,
    "way/247521048": 0x86604f,
    "way/247521050": 0x8c6152,
    "way/247521051": 0x86604f,
    "way/247530220": 0x6b625e,
    "way/247530235": 0x96705f,
    "way/247530242": 0x7c5a4e,
    "way/247530258": 0x7f6a60,
    "way/247530267": 0x7f6a60,
    "way/247530268": 0x5c5a5c,
    "way/247530277": 0x5c5a5c,
    "way/247530879": 0x96705f,
    "way/247844774": 0x96705f,
    "way/247844780": 0x86604f,
    "way/249335947": 0x86604f,
    "way/249335949": 0x7c5a4e,
    "way/249335950": 0x6b625e,
    "way/249335951": 0x96705f,
    "way/249335953": 0x7c5a4e,
    "way/249335959": 0x96705f,
    "way/249335960": 0x86604f,
    "way/312573949": 0x8c6152,
    "way/312575197": 0x96705f,
    "way/312575198": 0x6b625e,
    "way/32200572": 0x96705f,
    "way/402203251": 0x5c5a5c,
    "way/402203255": 0x7f6a60,
    "way/402203257": 0x8c6152,
    "way/402203261": 0x7f6a60,
    "way/402203265": 0x6b625e,
    "way/402203267": 0x5c5a5c,
    "way/402203270": 0x8c6152,
    "way/432183120": 0x8c6152,
    "way/436749608": 0x7f6a60,
    "way/575939606": 0x8a8782,
    "way/91529284": 0x7a7772,
    "way/92139230": 0x8c6152,
    "way/92139255": 0x7c5a4e,
    "way/92139269": 0x86604f,
    "way/95012506": 0x86604f,
  };
  const FLAT_LID = new Set(["way/173307431", "way/575939606", "way/91529284"]);

  /**
   * Whether the chunks carry `roof` (linear) at this volume's first roof
   * vertex, found by its position. True for a volume with no roof vertices.
   */
  const roofCarried = (
    volume: (typeof city.volumes)[number],
    roof: number,
  ): boolean => {
    const r = volume.roofVertexRanges[0];
    if (r === undefined || r.end <= r.start) return true;
    const p = volume.mesh.positions;
    const at = [p[r.start * 3], p[r.start * 3 + 1], p[r.start * 3 + 2]];
    const want = linearUnpacked(roof);
    return city.buildings.some((chunk) => {
      const q = chunk.mesh.positions;
      const c = chunk.colors ?? [];
      for (let i = 0; i < q.length; i += 3) {
        if (
          q[i] === at[0] &&
          q[i + 1] === at[1] &&
          q[i + 2] === at[2] &&
          c[i] === want[0] &&
          c[i + 1] === want[1] &&
          c[i + 2] === want[2]
        )
          return true;
      }
      return false;
    });
  };

  it("roofs every roof-tagged building from the palette unless it is colour-tagged", () => {
    let pitched = 0;
    let tagged = 0;
    let palette = 0;
    let flatLid = 0;
    for (const volume of city.volumes) {
      if (volume.heights.roofShape === "flat") continue;
      pitched += 1;
      const tags = tagsByKey.get(volume.feature) ?? {};
      const outlineTags =
        volume.parentFeature === undefined
          ? undefined
          : tagsByKey.get(volume.parentFeature);
      if (roofColour(tags, outlineTags) !== undefined) {
        tagged += 1;
        continue;
      }
      const roof = EXPECTED_ROOF[volume.feature];
      expect(roof, `${volume.feature} has an expected roof`).toBeDefined();
      if (roof === undefined) continue;
      const flat = FLAT_LID.has(volume.feature);
      expect(flat ? FLAT_ROOF_TONES : PITCHED_ROOF_TONES).toContain(roof);
      if (flat) flatLid += 1;
      // The roof vertices carry it.
      expect(roofCarried(volume, roof), `${volume.feature} roof`).toBe(true);
      palette += 1;
    }
    // Counted in VOLUMES (parts count singly): 150 pitched volumes of 93
    // buildings; 81 volumes (24 buildings) carry a roof:colour, 69 volumes
    // (69 buildings) take the palette (2026-11-08); 3 of those 69 the ladder
    // drew as a flat lid, so they take a flat grey (r1155).
    expect({ pitched, tagged, palette, flatLid }).toEqual({
      pitched: 150,
      tagged: 81,
      palette: 69,
      flatLid: 3,
    });
  });

  /**
   * Every colour drawn at each position of `chunks`: a gable's apex and the
   * top of a wall share positions with roof vertices and carry the wall
   * colour, so one position can hold several.
   */
  const coloursByPosition = (
    chunks: ReturnType<typeof buildCity>["buildings"],
  ): Map<string, Set<string>> => {
    const coloursAt = new Map<string, Set<string>>();
    for (const chunk of chunks) {
      const q = chunk.mesh.positions;
      const c = chunk.colors ?? [];
      for (let i = 0; i < q.length; i += 3) {
        const k = `${q[i]},${q[i + 1]},${q[i + 2]}`;
        const set = coloursAt.get(k) ?? new Set<string>();
        set.add(`${c[i]},${c[i + 1]},${c[i + 2]}`);
        coloursAt.set(k, set);
      }
    }
    return coloursAt;
  };

  /** The position of a volume's highest roof vertex, as `x,y,z`. */
  const highestRoofVertex = (volume: (typeof city.volumes)[number]): string => {
    const r = volume.roofVertexRanges[0] ?? { start: 0, end: 0 };
    const p = volume.mesh.positions;
    let at = r.start * 3;
    for (let v = r.start; v < r.end; v++) {
      if ((p[v * 3 + 1] as number) > (p[at + 1] as number)) at = v * 3;
    }
    return `${p[at]},${p[at + 1]},${p[at + 2]}`;
  };

  it("paints every invented roof in a pitched palette tone", () => {
    // Why: an invented roof is drawn by the skeleton, so the city must colour
    // its surfaces as a pitched roof (not as wall or flat lid); a roof
    // painted in the wall colour reads as a grey box from above.
    const roofed = buildCity(features, ground, {
      window: loadSite(site.id).bbox,
    });
    const tones = new Set(
      PITCHED_ROOF_TONES.map((rgb) => linearUnpacked(rgb).join(",")),
    );
    const coloursAt = coloursByPosition(roofed.buildings);
    const invented = roofed.volumes.filter((v) => v.roofIsInvented);
    expect(invented.length).toBeGreaterThan(100);
    let palette = 0;
    for (const volume of invented) {
      const r = volume.roofVertexRanges[0];
      expect(r !== undefined && r.end > r.start).toBe(true);
      // A `roof:colour` is no keep reason (only shape, height and levels
      // are), so a colour-tagged roof can be invented: it keeps its colour.
      const tagged = roofColour(tagsByKey.get(volume.feature) ?? {}, undefined);
      const drawn = [...(coloursAt.get(highestRoofVertex(volume)) ?? [])];
      const want =
        tagged === undefined
          ? drawn.some((c) => tones.has(c))
          : drawn.includes(linearUnpacked(tagged).join(","));
      if (tagged === undefined) palette += 1;
      expect(want, volume.feature).toBe(true);
    }
    expect(palette).toBeGreaterThan(100);
  });

  it("gives the AR shell one value per vertex with invented roofs on", () => {
    // Why: the AR shell reads height01 and featureRand per vertex. Invented
    // roofs add vertices (soffits, gables) to many volumes; an attribute
    // sized from anything but the merged vertex count shifts every later
    // building's glow and pulse, which renders without an error.
    const roofed = buildCity(features, ground, {
      window: loadSite(site.id).bbox,
    });
    expect(roofed.volumes.some((v) => v.roofIsInvented)).toBe(true);
    for (const chunk of roofed.buildings) {
      const vertices = chunk.mesh.positions.length / 3;
      expect(chunk.height01?.length).toBe(vertices);
      expect(chunk.featureRand?.length).toBe(vertices);
      expect(chunk.colors?.length).toBe(vertices * 3);
      for (const h of chunk.height01 ?? []) {
        expect(h >= 0 && h <= 1).toBe(true);
      }
    }
  });

  it("draws no class colour that the palette, a tag or a barrier did not give", () => {
    const allowed = new Set<string>(
      allPaletteColours().map((rgb) => linearUnpacked(rgb).join(",")),
    );
    for (const f of features) {
      for (const tag of ["building:colour", "roof:colour"]) {
        const rgb = parseOsmColour(f.tags[tag]);
        if (rgb !== undefined) allowed.add(linearUnpacked(rgb).join(","));
      }
      if (f.tags.barrier !== undefined) {
        allowed.add(linearUnpacked(barrierColour(f.tags)).join(","));
      }
    }
    const stray: string[] = [];
    for (const chunk of city.buildings) {
      const c = chunk.colors ?? [];
      for (let i = 0; i < c.length; i += 3) {
        const k = `${c[i]},${c[i + 1]},${c[i + 2]}`;
        if (!allowed.has(k)) stray.push(k);
      }
    }
    expect(new Set(stray)).toEqual(new Set());
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

  // WHY (r1158 review MINOR 4): a multipolygon building has one outer ring
  // per polygon, and the exclusion took only the first, so woods grew inside
  // every other part of it. Two halls in the forest, one relation.
  it("keeps them out of every outer ring of a multipolygon building", () => {
    const rect = (lat: number, lng: number) => [
      { lat, lng },
      { lat, lng: lng + 0.0007 },
      { lat: lat + 0.0004, lng: lng + 0.0007 },
      { lat: lat + 0.0004, lng },
      { lat, lng },
    ];
    const halls = [rect(50.9502, 6.9603), rect(50.9505, 6.9612)];
    const twoHalls: OsmFeature = {
      type: "relation",
      id: 22,
      tags: { type: "multipolygon", building: "yes" },
      members: halls.map((geometry, i) => ({
        type: "way" as const,
        ref: 31 + i,
        role: "outer",
        geometry,
      })),
    };
    const city = buildCity([forest, twoHalls], { frame }, { window: W });
    expect(city.volumes).toHaveLength(1);
    const without = buildCity([forest], { frame }, { window: W });
    for (const hall of halls) {
      const ring = hall.map((p) => frame.toEnu(p));
      const xs = ring.map((p) => p.x);
      const ys = ring.map((p) => p.y);
      const inside = (t: { position: { x: number; y: number } }) =>
        t.position.x > Math.min(...xs) &&
        t.position.x < Math.max(...xs) &&
        t.position.y > Math.min(...ys) &&
        t.position.y < Math.max(...ys);
      // The forest alone grows trees there, so an empty hall is the exclusion.
      expect(without.cosmeticTrees.filter(inside).length).toBeGreaterThan(0);
      expect(city.cosmeticTrees.filter(inside)).toEqual([]);
    }
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

describe("buildCity, street furniture", () => {
  // WHY THIS MATTERS. The city builds the furniture its consumers draw: all
  // four kinds by default (the globe and the harness have no POI layer), only
  // the kinds asked for (OsmDemo's POI layer already draws benches and bins),
  // none for an empty list (the globe, which draws none), and within withinM
  // like every other object.
  const lamp: OsmFeature = {
    type: "node",
    id: 40,
    tags: { highway: "street_lamp" },
    position: { lat: 50.9414, lng: 6.9584 },
  };
  const bench: OsmFeature = {
    type: "node",
    id: 41,
    tags: { amenity: "bench" },
    position: { lat: 50.9415, lng: 6.9585 },
  };
  const far: OsmFeature = {
    type: "node",
    id: 42,
    tags: { barrier: "bollard" },
    position: { lat: 50.98, lng: 6.9583 },
  };

  it("builds every kind by default", () => {
    const city = buildCity([lamp, bench, far, TREE], { frame }, { window: W });
    expect(city.furniture.map((f) => f.kind)).toEqual([
      "lamp",
      "bench",
      "bollard",
    ]);
  });

  it("builds only the kinds asked for, and none for an empty list", () => {
    const some = buildCity(
      [lamp, bench],
      { frame },
      {
        window: W,
        furniture: ["lamp", "bollard"],
      },
    );
    expect(some.furniture.map((f) => f.key)).toEqual(["node/40"]);
    const none = buildCity(
      [lamp, bench],
      { frame },
      {
        window: W,
        furniture: [],
      },
    );
    expect(none.furniture).toEqual([]);
  });

  it("keeps it within withinM", () => {
    const city = buildCity(
      [lamp, far],
      { frame },
      {
        window: W,
        withinM: 500,
      },
    );
    expect(city.furniture.map((f) => f.key)).toEqual(["node/40"]);
  });

  it("leaves the buildings, trees and roads unchanged", () => {
    const features = [...[lamp, bench, far], TREE, WALL, tower()];
    const withIt = buildCity(features, { frame }, { window: W, roads: true });
    const without = buildCity(
      features,
      { frame },
      {
        window: W,
        roads: true,
        furniture: [],
      },
    );
    expect(withIt.buildings).toEqual(without.buildings);
    expect(withIt.trees).toEqual(without.trees);
    expect(withIt.roads).toEqual(without.roads);
    expect(withIt.barriers).toEqual(without.barriers);
  });
});
