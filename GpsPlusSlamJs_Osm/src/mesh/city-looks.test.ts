import { describe, expect, it, vi } from "vitest";

import type { OsmFeature } from "../model/osm-feature.js";
import { FOUR_LOOKS } from "../test-utils/rule-looks.js";
import { buildBuildings } from "./buildings.js";
import { buildCity, MAX_CITY_LOOKS, type CityOptions } from "./city.js";
import {
  DEFAULT_CITY_COLOUR_SCHEME,
  type CityColourScheme,
} from "./colour-scheme.js";
import { enuFrameAt } from "./enu.js";
import type * as BuildingsModule from "./buildings.js";

// The real building pass, counted: "geometry once" below.
vi.mock("./buildings.js", async (importOriginal) => {
  const actual: typeof BuildingsModule = await importOriginal();
  return { ...actual, buildBuildings: vi.fn(actual.buildBuildings) };
});

/**
 * WHY THESE TESTS MATTER. `looks` is read at the library boundary from a
 * caller (a worker message among them), so a malformed list must fail loudly
 * before any geometry is built, never draw a half-coloured city. The
 * per-look colours themselves are held by `city-looks.property.test.ts`.
 */

const CENTRE = { lat: 50.94, lng: 6.96 };
const WINDOW = {
  south: 50.939,
  north: 50.941,
  west: 6.959,
  east: 6.961,
};

/** One square building near the centre. */
const HOUSE: OsmFeature = {
  type: "way",
  id: 1,
  tags: { building: "yes" },
  geometry: [
    { lat: 50.94, lng: 6.96 },
    { lat: 50.9401, lng: 6.96 },
    { lat: 50.9401, lng: 6.9601 },
    { lat: 50.94, lng: 6.9601 },
    { lat: 50.94, lng: 6.96 },
  ],
};

function build(extra: Partial<CityOptions>) {
  return buildCity(
    [HOUSE],
    { frame: enuFrameAt(CENTRE) },
    {
      window: WINDOW,
      ...extra,
    },
  );
}

const OTHER: CityColourScheme = {
  ...DEFAULT_CITY_COLOUR_SCHEME,
  walls: [0x123456],
};

describe("buildCity looks validation", () => {
  it("refuses an empty list: a looks build without a look has no colours", () => {
    expect(() => build({ looks: [] })).toThrow(RangeError);
  });

  it(`refuses more than ${MAX_CITY_LOOKS} looks`, () => {
    // WHY 4: a renderer mixes the looks by one vec4 of weights and one
    // vertex attribute per look; WebGL 2 guarantees only 16 attributes.
    expect(MAX_CITY_LOOKS).toBe(4);
    const five = Array.from({ length: 5 }, () => DEFAULT_CITY_COLOUR_SCHEME);
    expect(() => build({ looks: five })).toThrow(/at most 4/);
  });

  it("refuses a list that is not an array", () => {
    expect(() =>
      build({ looks: DEFAULT_CITY_COLOUR_SCHEME as unknown as [] }),
    ).toThrow(RangeError);
  });

  it("refuses a malformed look, naming its index", () => {
    const broken = { ...DEFAULT_CITY_COLOUR_SCHEME, walls: [] };
    expect(() =>
      build({ looks: [DEFAULT_CITY_COLOUR_SCHEME, broken] }),
    ).toThrow(/looks\[1\].*walls/);
  });

  it("refuses colours that are not looks[0]", () => {
    // WHY: `colors` is look 0's; a different `colours` would make the
    // single-look buffer and look 0 disagree.
    expect(() =>
      build({ colours: OTHER, looks: [DEFAULT_CITY_COLOUR_SCHEME] }),
    ).toThrow(/looks\[0\]/);
  });

  it("accepts colours that are looks[0], and builds one buffer per look", () => {
    const city = build({
      colours: OTHER,
      looks: [OTHER, DEFAULT_CITY_COLOUR_SCHEME],
    });
    expect(city.buildings.length).toBeGreaterThan(0);
    for (const chunk of city.buildings) {
      const vertices = chunk.mesh.positions.length / 3;
      expect(chunk.lookColours).toHaveLength(2);
      for (const codes of chunk.lookColours!) {
        expect(codes).toBeInstanceOf(Uint8Array);
        expect(codes.length).toBe(vertices * 3);
      }
    }
  });
});

describe("buildCity looks: geometry once", () => {
  // WHY THIS TEST MATTERS. The point of baking looks into one build is that
  // the geometry (the costliest part of a city) is built ONCE, and only the
  // colour picks repeat per look. A regression that ran the building pass
  // per look would still pass every colour test and only show as a slower
  // build, inside the bench's run-to-run noise; this counts the pass.
  it("runs the building pass once for four looks, as for one scheme", () => {
    const pass = vi.mocked(buildBuildings);
    pass.mockClear();
    build({});
    expect(pass).toHaveBeenCalledTimes(1);
    pass.mockClear();
    const city = build({ looks: FOUR_LOOKS });
    expect(pass).toHaveBeenCalledTimes(1);
    expect(city.buildings[0]?.lookColours).toHaveLength(4);
  });
});
