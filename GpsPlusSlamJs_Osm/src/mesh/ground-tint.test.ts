import { describe, expect, it } from "vitest";

import { loadSite } from "../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import type { OsmFeature } from "../model/osm-feature.js";
import { buildCity } from "./city.js";
import { DEFAULT_CITY_COLOUR_SCHEME } from "./colour-scheme.js";
import { enuFrameAt } from "./enu.js";
import {
  buildGroundTint,
  DEFAULT_GROUND_RGB,
  DEFAULT_GROUND_TINT_TEXEL_M,
  DEFAULT_LAND_USE_RGB,
  GROUND_CLASS_NAMES,
  GROUND_CLASS_TIERS,
  groundClassOf,
  groundTintPlan,
  MAX_GROUND_TINT_SIDE,
  paintOrder,
  polygonAreaM2,
  type GroundTintEntry,
} from "./ground-tint.js";

describe("groundClassOf", () => {
  // WHY: the table is O2's, which the owner chose; each row is a decision
  // (water above its land, a hard pitch is a court, a building never paints).
  it.each([
    [{ landuse: "residential" }, "residential"],
    [{ landuse: "retail" }, "commercial"],
    [{ leisure: "park" }, "park"],
    [{ leisure: "garden" }, "park"],
    [{ natural: "water" }, "water"],
    [{ water: "river" }, "water"],
    [{ landuse: "reservoir", natural: "water" }, "water"],
    [{ landuse: "forest" }, "wood"],
    [{ leisure: "pitch" }, "pitch"],
    [{ leisure: "pitch", surface: "tartan" }, "court"],
    [{ amenity: "parking" }, "parking"],
    [{ highway: "pedestrian", area: "yes" }, "square"],
    [{ man_made: "pier" }, "square"],
  ])("%o paints %s", (tags, cls) => {
    expect(groundClassOf(tags)).toBe(cls);
  });

  it.each([
    [{ building: "yes", landuse: "residential" }],
    [{ highway: "pedestrian" }],
    [{ landuse: "constructor" }],
    [{ landuse: "toString" }],
    [{}],
  ])("%o paints nothing", (tags) => {
    expect(groundClassOf(tags)).toBeUndefined();
  });

  // WHY: tags come from external data; anything that is not an object must
  // paint nothing rather than throw in a worker.
  it.each([null, undefined, "park", 3])("tolerates %s", (tags) => {
    expect(groundClassOf(tags)).toBeUndefined();
  });

  it("keeps `building=no` areas", () => {
    expect(groundClassOf({ building: "no", leisure: "park" })).toBe("park");
  });
});

describe("tables", () => {
  // WHY: every class has a tier and a default colour; a missing entry would
  // paint in tier 0 or throw at build time.
  it("covers every class", () => {
    for (const cls of GROUND_CLASS_NAMES) {
      expect(GROUND_CLASS_TIERS.has(cls)).toBe(true);
      expect(DEFAULT_LAND_USE_RGB.has(cls)).toBe(true);
    }
    expect(GROUND_CLASS_NAMES.length).toBeLessThan(255);
  });

  // WHY: DEC-R4-5, the heat ramp stays the loudest colour; the default
  // land use must stay muted (chroma = max minus min channel).
  it("keeps every default class colour muted", () => {
    for (const rgb of DEFAULT_LAND_USE_RGB.values()) {
      const c = [16, 8, 0].map((s) => (rgb >> s) & 0xff);
      expect(Math.max(...c) - Math.min(...c)).toBeLessThan(45);
    }
  });
});

describe("paintOrder", () => {
  const sq = (s: number) => [
    [
      { x: 0, y: 0, z: 0 },
      { x: s, y: 0, z: 0 },
      { x: s, y: s, z: 0 },
      { x: 0, y: s, z: 0 },
    ],
  ];
  const e = (key: string, cls: GroundTintEntry["cls"], s: number) => ({
    key,
    cls,
    areaM2: s * s,
    polygons: [sq(s)],
  });

  // WHY: a park inside a residential district must show; a pitch inside a
  // park must show; a small park inside a large one must show.
  it("paints tier ascending, then larger first, then by key", () => {
    const order = paintOrder([
      e("way/3", "pitch", 5),
      e("way/1", "park", 50),
      e("way/2", "residential", 500),
      e("way/5", "park", 10),
      e("way/4", "park", 10),
    ]).map((x) => x.key);
    expect(order).toEqual(["way/2", "way/1", "way/4", "way/5", "way/3"]);
  });
});

describe("polygonAreaM2", () => {
  it("subtracts holes", () => {
    const ring = (a: number, b: number) => [
      { x: a, y: a, z: 0 },
      { x: b, y: a, z: 0 },
      { x: b, y: b, z: 0 },
      { x: a, y: b, z: 0 },
    ];
    expect(polygonAreaM2([ring(0, 10), ring(2, 4)])).toBeCloseTo(96, 9);
    expect(polygonAreaM2([])).toBe(0);
  });
});

describe("groundTintPlan", () => {
  // WHY: the texture is capped so every WebGL2 phone takes it; a large
  // window grows the texel instead of the texture.
  it("caps a side at MAX_GROUND_TINT_SIDE", () => {
    const plan = groundTintPlan(
      { minX: 0, minY: 0, maxX: 5000, maxY: 1000 },
      1,
    );
    expect(plan.width).toBe(MAX_GROUND_TINT_SIDE);
    expect(plan.texelM).toBeCloseTo(5000 / MAX_GROUND_TINT_SIDE, 9);
    expect(plan.height).toBe(Math.ceil(1000 / plan.texelM));
  });

  it("keeps the asked texel for a small window", () => {
    expect(
      groundTintPlan({ minX: 0, minY: 0, maxX: 300, maxY: 200 }, 1),
    ).toEqual({ width: 300, height: 200, texelM: 1 });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses texel %s",
    (t) => {
      expect(() =>
        groundTintPlan({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, t),
      ).toThrow(RangeError);
    },
  );

  it("refuses an empty window", () => {
    expect(() =>
      groundTintPlan({ minX: 0, minY: 0, maxX: 0, maxY: 1 }, 1),
    ).toThrow(RangeError);
  });
});

/** A closed way around an ENU-metre box near the frame's origin. */
const centre = { lat: 47.0, lng: 8.0 };
const frame = enuFrameAt(centre);
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((47 * Math.PI) / 180));
function wayBox(
  id: number,
  tags: Record<string, string>,
  [x0, y0, x1, y1]: [number, number, number, number],
): OsmFeature {
  const p = (x: number, y: number) => ({
    lat: centre.lat + y * M_LAT,
    lng: centre.lng + x * M_LNG,
  });
  const ring = [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1), p(x0, y0)];
  return {
    type: "way",
    id,
    tags,
    nodes: ring.map((_, i) => id * 10 + (i % 4)),
    geometry: ring,
  } as unknown as OsmFeature;
}
const window = {
  south: centre.lat - 100 * M_LAT,
  west: centre.lng - 100 * M_LNG,
  north: centre.lat + 100 * M_LAT,
  east: centre.lng + 100 * M_LNG,
};
const options = {
  frame,
  window,
  ground: DEFAULT_GROUND_RGB,
  landUse: DEFAULT_LAND_USE_RGB,
};

describe("buildGroundTint", () => {
  // WHY: the raster is what the renderer shows; a park drawn in the wrong
  // place, a hole filled, or the south edge flipped would all ship as a
  // plausible-looking but wrong ground.
  it("paints a park over a district, south at row 0", () => {
    const tint = buildGroundTint(
      [
        wayBox(1, { landuse: "residential" }, [-100, -100, 100, 100]),
        wayBox(2, { leisure: "park" }, [-50, -90, 50, -10]),
      ],
      options,
    );
    expect(tint.width * tint.texelM).toBeCloseTo(200, 0);
    const park = GROUND_CLASS_NAMES.indexOf("park") + 1;
    const res = GROUND_CLASS_NAMES.indexOf("residential") + 1;
    const at = (x: number, y: number) =>
      tint.classes[
        Math.floor((y - tint.originY) / tint.texelM) * tint.width +
          Math.floor((x - tint.originX) / tint.texelM)
      ];
    expect(at(0, -50)).toBe(park);
    expect(at(0, 50)).toBe(res);
    expect(tint.shares.park).toBeCloseTo((100 * 80) / (200 * 200), 1);
    expect(tint.palette[0]).toBe(DEFAULT_GROUND_RGB);
    expect(tint.palette[park]).toBe(DEFAULT_LAND_USE_RGB.get("park"));
    expect(tint.skipped).toBe(0);
  });

  it("counts an unclosed land-use line as skipped", () => {
    const open = wayBox(
      3,
      { landuse: "meadow" },
      [0, 0, 20, 20],
    ) as unknown as {
      geometry: unknown[];
      nodes: number[];
    };
    open.geometry = open.geometry.slice(0, 3);
    open.nodes = [1, 2, 3];
    const tint = buildGroundTint([open as unknown as OsmFeature], options);
    expect(tint.skipped).toBe(1);
    expect(tint.classes.every((v) => v === 0)).toBe(true);
  });

  it("refuses a land-use map missing a class", () => {
    const landUse = new Map(DEFAULT_LAND_USE_RGB);
    landUse.delete("wood");
    expect(() => buildGroundTint([], { ...options, landUse })).toThrow(
      RangeError,
    );
  });
});

describe("fixtures (O2's measured coverage)", () => {
  // WHY: O2 measured how much of each lab window its rules paint; the port
  // must paint at least as much, or a rule was lost on the way. The floors
  // are O2's figures; a drop below them is a regression, not noise.
  it.each([
    ["lucerne-meggen", 0.749],
    ["lucerne-reuss", 0.907],
  ])("%s paints at least %f of its window", (name, floor) => {
    const site = loadSite(name);
    const features = parseOverpassJson(site.payload).features;
    const tint = buildGroundTint(features, {
      ...options,
      frame: enuFrameAt(site.centre),
      window: site.bbox,
    });
    const painted = Object.values(tint.shares).reduce((a, b) => a + b, 0);
    expect(painted).toBeGreaterThanOrEqual(floor);
  });
});

describe("buildCity's ground tint", () => {
  const site = loadSite("lucerne-meggen");
  const features = parseOverpassJson(site.payload).features;
  const ground = { frame: enuFrameAt(site.centre) };

  // WHY: the Globe and the Tour Editor build without asking; they must not
  // pay for a raster they never draw (owner: the editor has no tint).
  it("builds none unless asked", () => {
    const city = buildCity(features, ground, { window: site.bbox });
    expect(city.groundTint).toBeUndefined();
  });

  // WHY: the tint paints in the scheme's colours (schemes plan 4.3): the
  // neutral ground and every class colour come from the scheme, so a scheme
  // switch repaints the ground with the city.
  it("paints in the scheme's ground and land-use colours", () => {
    const landUse = new Map(
      [...DEFAULT_LAND_USE_RGB.keys()].map((k, i) => [k, 0x010101 * (i + 1)]),
    );
    const city = buildCity(features, ground, {
      window: site.bbox,
      groundTint: true,
      colours: { ...DEFAULT_CITY_COLOUR_SCHEME, ground: 0x123456, landUse },
    });
    const tint = city.groundTint;
    expect(tint?.palette).toEqual([
      0x123456,
      ...GROUND_CLASS_NAMES.map((cls) => landUse.get(cls)),
    ]);
    expect(tint?.texelM).toBe(DEFAULT_GROUND_TINT_TEXEL_M);
  });
});
