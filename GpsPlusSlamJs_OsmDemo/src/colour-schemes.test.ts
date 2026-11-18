import { DEFAULT_CITY_COLOUR_SCHEME } from "gps-plus-slam-osm";
import { describe, expect, it, vi } from "vitest";

import {
  COLOUR_SCHEME_NAMES,
  COLOUR_SCHEMES,
  DEFAULT_COLOUR_SCHEME,
  colourSchemeOf,
  isColourSchemeName,
  resolveColourScheme,
  schemeLinkValue,
  validateColourScheme,
  type ColourScheme,
} from "./colour-schemes.js";
import { DEFAULT_GROUND_SLOPE_COLOURS } from "./ground-slope-colours.js";
import { PLATE_COLOUR, relativeLuminance } from "./surface-colours.js";

describe("the colour-scheme table", () => {
  it("has the default first and the default is today's look, by reference", () => {
    // Why this test matters: D8 keeps the default's look, and the library's
    // identity test holds the buffers only if the demo hands it the SAME
    // default scheme; the page colours must be the constants the e2e gates
    // were measured with.
    expect(COLOUR_SCHEME_NAMES[0]).toBe(DEFAULT_COLOUR_SCHEME);
    const today = COLOUR_SCHEMES[DEFAULT_COLOUR_SCHEME];
    expect(today.city).toBe(DEFAULT_CITY_COLOUR_SCHEME);
    expect(today.ground.slope).toBe(DEFAULT_GROUND_SLOPE_COLOURS);
    expect(today.ground.plates).toBe(PLATE_COLOUR);
    expect(today.brightnessTrim).toBe(1);
  });

  it("validates every entry", () => {
    // Why this test matters: the module validates at load, but a test names
    // the failing entry instead of failing every importer at once.
    for (const name of COLOUR_SCHEME_NAMES) {
      expect(() => validateColourScheme(COLOUR_SCHEMES[name])).not.toThrow();
    }
  });
});

describe("validateColourScheme", () => {
  const good = COLOUR_SCHEMES[DEFAULT_COLOUR_SCHEME];
  const bad = (patch: Partial<ColourScheme>): ColourScheme => ({
    ...good,
    ...patch,
  });

  it("refuses a trim outside 0.5-2, a bad plates colour, a bad slope colour and no label", () => {
    // Why this test matters: a scheme is data written by hand; each of these
    // would otherwise reach a uniform or a material as NaN or a wrong colour.
    for (const brightnessTrim of [0.49, 2.01, Number.NaN]) {
      expect(() => validateColourScheme(bad({ brightnessTrim }))).toThrow(
        RangeError,
      );
    }
    expect(() =>
      validateColourScheme(bad({ brightnessTrim: 0.5 })),
    ).not.toThrow();
    expect(() =>
      validateColourScheme(bad({ brightnessTrim: 2 })),
    ).not.toThrow();
    for (const plates of [-1, 0x1000000, 1.5]) {
      expect(() =>
        validateColourScheme(bad({ ground: { ...good.ground, plates } })),
      ).toThrow(RangeError);
    }
    expect(() =>
      validateColourScheme(
        bad({
          ground: {
            ...good.ground,
            slope: { ...good.ground.slope, rim: [0.2, 1.2, 0.2] },
          },
        }),
      ),
    ).toThrow(RangeError);
    expect(() => validateColourScheme(bad({ label: " " }))).toThrow(TypeError);
  });

  it("refuses a malformed city scheme through the library's validator", () => {
    // Why this test matters: the worker builds from `city`; a missing colour
    // must fail here, not as a half-switched city (plan 4.1).
    const { ground: _omitted, ...cityWithoutGround } = good.city;
    expect(() =>
      validateColourScheme(
        bad({ city: cityWithoutGround as unknown as ColourScheme["city"] }),
      ),
    ).toThrow();
  });
});

describe("names", () => {
  it("knows only the table's own names", () => {
    // Why this test matters: a link is user input; `toString` or
    // `__proto__` must not resolve to a scheme.
    expect(isColourSchemeName("today")).toBe(true);
    for (const name of ["toString", "__proto__", "", "Today", 3, null]) {
      expect(isColourSchemeName(name)).toBe(false);
    }
    expect(colourSchemeOf("toString")).toBe(COLOUR_SCHEMES.today);
    expect(colourSchemeOf(undefined)).toBe(COLOUR_SCHEMES.today);
  });

  it("names the link's value for a scheme: none for the default", () => {
    // Why this test matters: the page writes this on boot as well as on a
    // switch, so a link naming the default or an unknown scheme loses the
    // parameter at once instead of carrying a name the page does not show.
    expect(schemeLinkValue(resolveColourScheme("neon", () => {}))).toBeNull();
    expect(schemeLinkValue("today")).toBeNull();
    expect(schemeLinkValue("night")).toBe("night");
  });

  it("resolves a link's name: absent silently, unknown with one warning", () => {
    // Why this test matters: an old or mistyped link must open the default
    // and say why once, the `?grade=` rule.
    const warn = vi.fn();
    expect(resolveColourScheme(null, warn)).toBe("today");
    expect(warn).not.toHaveBeenCalled();
    expect(resolveColourScheme("today", warn)).toBe("today");
    expect(resolveColourScheme("neon", warn)).toBe("today");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('"neon"');
  });
});

/** CIE L* (0-100) of a packed sRGB colour, from the renderer's own luminance. */
function lightness(colour: number): number {
  const y = relativeLuminance(colour);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

function meanOf(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** The classes a car does not use; the rest are the streets. */
const PATH_CLASSES = new Set([
  "pedestrian",
  "footway",
  "path",
  "steps",
  "cycleway",
  "platform",
  "track",
  "bridleway",
]);

/**
 * Mean L* of the walls, of the car roads with every surface colour, and the
 * ground's. A HEX PROXY, not rendered contrast: roads render their colours
 * raw, so their hex is close to what is drawn, but walls are lit and shaded,
 * roofs are left out, and nothing here sees the light, the fog or the tint.
 */
function groupLightness(scheme: ColourScheme): {
  buildings: number;
  roads: number;
  ground: number;
} {
  // Where a scheme ranks surface first, a `surface` colour replaces the
  // class colour on a car road carrying the tag, so the surfaces are part of
  // what a street can look like.
  const streets = [
    ...[...scheme.city.roads].filter(([key]) => !PATH_CLASSES.has(key)),
    ...(scheme.city.roadsBySurface ? scheme.city.roadSurfaces : []),
  ].map(([, rgb]) => lightness(rgb));
  return {
    buildings: meanOf(scheme.city.walls.map(lightness)),
    roads: meanOf(streets),
    ground: lightness(scheme.city.ground),
  };
}

/** The smallest of the three pairwise lightness distances. */
function leastDistance(scheme: ColourScheme): number {
  const { buildings, roads, ground } = groupLightness(scheme);
  return Math.min(
    Math.abs(buildings - roads),
    Math.abs(buildings - ground),
    Math.abs(roads - ground),
  );
}

/**
 * The floor on {@link leastDistance}, in L* units. SWEPT in S5 (see
 * `colour-scheme-looks.ts.md`): today's look is the weakest scheme (walls
 * against roads), so a floor above its distance fails the default itself and
 * is the value that reverses the verdict.
 */
const MIN_LIGHTNESS_DISTANCE = 8;

/** The car-road colours a scheme can draw, by the same rule as above. */
function streetColours(scheme: ColourScheme): number[] {
  return [
    ...[...scheme.city.roads].filter(([key]) => !PATH_CLASSES.has(key)),
    ...(scheme.city.roadsBySurface ? scheme.city.roadSurfaces : []),
  ].map(([, rgb]) => rgb);
}

/** The smallest L* distance between the zebra paint and any street. */
function markingsDistance(scheme: ColourScheme): number {
  const paint = lightness(scheme.city.markings);
  return Math.min(
    ...streetColours(scheme).map((rgb) => Math.abs(lightness(rgb) - paint)),
  );
}

/**
 * The floor on {@link markingsDistance}, L* units. A HEX PROXY like the
 * groups above (paint and roads both render raw). Swept over 10 / 15 / 20 /
 * 25 on 2026-11-11: see colour-scheme-looks.ts.md for where each scheme falls.
 */
const MIN_MARKINGS_DISTANCE = 15;

describe("the schemes", () => {
  it("are the plan's ten in its order, then the later looks", () => {
    // Why this test matters: the dropdown order and the link names are the
    // vocabulary for rating them (D5); a renamed key breaks every
    // `?scheme=` link already sent, so a new look is appended, never inserted.
    expect(COLOUR_SCHEME_NAMES).toEqual([
      "today",
      "architect",
      "blueprint",
      "mediterranean",
      "nordic",
      "pastel",
      "map",
      "night",
      "mono",
      "contrast",
      "urban",
      "golden",
      "dusk",
      "bluehour",
    ]);
  });

  it("keep buildings, roads and ground apart in lightness", () => {
    // Why this test matters: a scheme whose streets match its walls or its
    // ground loses the streets (plan 4.5), and the trim scales buildings and
    // roads together, so only the colours can keep them apart.
    for (const name of COLOUR_SCHEME_NAMES) {
      const scheme = COLOUR_SCHEMES[name];
      expect(
        leastDistance(scheme),
        `${name}: ${JSON.stringify(groupLightness(scheme))}`,
      ).toBeGreaterThanOrEqual(MIN_LIGHTNESS_DISTANCE);
    }
  });

  it("keep EVERY tower wall tone apart from roads and ground", () => {
    // Why this test matters: a tower draws ONE tone of `towerWalls` on all
    // its walls, so a tone near the ground is a whole tower lost against it,
    // however comfortable the list's mean: a mean check passed while two
    // tones sat within 2 L* of urban's ground. Each tone is held to the floor
    // PLUS the scheme's wall jitter, which shifts a wall by up to
    // `wallJitterL` L* either way.
    for (const name of COLOUR_SCHEME_NAMES) {
      const { city } = COLOUR_SCHEMES[name];
      // The tower rule is off at an infinite height.
      if (!Number.isFinite(city.towerFromM)) continue;
      const { roads, ground } = groupLightness(COLOUR_SCHEMES[name]);
      for (const rgb of city.towerWalls) {
        const l = lightness(rgb);
        const least = Math.min(Math.abs(l - roads), Math.abs(l - ground));
        expect(
          least,
          `${name} tower 0x${rgb.toString(16)}: ${l.toFixed(1)} against roads ${roads.toFixed(1)}, ground ${ground.toFixed(1)}, jitter ${city.wallJitterL}`,
        ).toBeGreaterThanOrEqual(MIN_LIGHTNESS_DISTANCE + city.wallJitterL);
      }
    }
  });

  it("keep EVERY material wall tone apart from roads and ground", () => {
    // Why this test matters: a material-tagged building draws exactly ONE
    // tone, its material's, on every wall, so a mean over the materials says
    // nothing about any one building: a glass tone 2 L* from the ground hid
    // behind a comfortable group mean. Each tone is held to the floor PLUS
    // the scheme's wall jitter: every wall is shifted by up to `wallJitterL`
    // L* either way, so a tone exactly at the floor renders a building that
    // much closer to the ground.
    for (const name of COLOUR_SCHEME_NAMES) {
      const { city } = COLOUR_SCHEMES[name];
      if (!city.honourMaterialTags) continue;
      const { roads, ground } = groupLightness(COLOUR_SCHEMES[name]);
      for (const [material, rgb] of city.materialWalls) {
        const l = lightness(rgb);
        const least = Math.min(Math.abs(l - roads), Math.abs(l - ground));
        expect(
          least,
          `${name} ${material}: ${l.toFixed(1)} against roads ${roads.toFixed(1)}, ground ${ground.toFixed(1)}, jitter ${city.wallJitterL}`,
        ).toBeGreaterThanOrEqual(MIN_LIGHTNESS_DISTANCE + city.wallJitterL);
      }
    }
  });

  it("keep the zebra paint apart from every street it lies on", () => {
    // Why this test matters: paint is drawn raw on a car road; a stripe as
    // light or as dark as its street is no crossing at all. Every car-road
    // colour a scheme can draw (class, and surface when it ranks surface
    // first) is held MIN_MARKINGS_DISTANCE L* away from the paint.
    for (const name of COLOUR_SCHEME_NAMES) {
      const scheme = COLOUR_SCHEMES[name];
      expect(
        markingsDistance(scheme),
        `${name}: paint L* ${lightness(scheme.city.markings).toFixed(1)}`,
      ).toBeGreaterThanOrEqual(MIN_MARKINGS_DISTANCE);
    }
  });

  it("keep the plates lighter than the ground", () => {
    // Why this test matters: the plates mark land use on the ground and read
    // only as lighter patches (surface-colours.ts); a darker plate looks like
    // a hole.
    for (const name of COLOUR_SCHEME_NAMES) {
      const scheme = COLOUR_SCHEMES[name];
      expect(relativeLuminance(scheme.ground.plates), name).toBeGreaterThan(
        relativeLuminance(scheme.city.ground),
      );
    }
  });

  it("honour colour tags only in the realistic schemes, and the map colours roads by class", () => {
    // Why this test matters: D7 gives every scheme its own tag rule, and the
    // map's roads are its point: a surface colour would override the class.
    const honouring = COLOUR_SCHEME_NAMES.filter(
      (name) => COLOUR_SCHEMES[name].city.honourColourTags,
    );
    expect(honouring).toEqual([
      "today",
      "mediterranean",
      "nordic",
      "urban",
      "golden",
      "dusk",
      "bluehour",
    ]);
    expect(COLOUR_SCHEMES.map.city.roadsBySurface).toBe(false);
  });

  it("leave only the default on today's city colours", () => {
    // Why this test matters: D8 binds DEC-R4-5 to the default alone; another
    // scheme sharing the default's object would hide that it was never tuned.
    for (const name of COLOUR_SCHEME_NAMES.slice(1)) {
      expect(COLOUR_SCHEMES[name].city, name).not.toBe(
        DEFAULT_CITY_COLOUR_SCHEME,
      );
    }
  });

  it("trim the night up and the architect's model down", () => {
    // Why this test matters: the plan's two trims (4.5); night must read at
    // noon, the model must not glare.
    expect(COLOUR_SCHEMES.night.brightnessTrim).toBeGreaterThan(1);
    expect(COLOUR_SCHEMES.architect.brightnessTrim).toBeLessThan(1);
  });
});

describe("the urban scheme (real-albedo grey ladder)", () => {
  const urban = COLOUR_SCHEMES.urban;

  it("is a ladder of real facade, roof and asphalt reflectances", () => {
    // Why this test matters: the look's point is a value ladder at real
    // albedos (walls from dark stone to limestone, aged asphalt, a neutral
    // ground). The hex proxy pins the targets the look was designed to, so a
    // retune that drifts back to one bright beige band fails here.
    const { buildings, roads, ground } = groupLightness(urban);
    expect(buildings).toBeGreaterThan(53);
    expect(buildings).toBeLessThan(57);
    expect(roads).toBeGreaterThan(10);
    expect(roads).toBeLessThan(14);
    expect(ground).toBeGreaterThan(40);
    expect(ground).toBeLessThan(44);
    expect(leastDistance(urban)).toBeGreaterThanOrEqual(MIN_LIGHTNESS_DISTANCE);
    const walls = urban.city.walls.map(lightness);
    // A ladder, not a band: the walls span at least 30 L*.
    expect(Math.max(...walls) - Math.min(...walls)).toBeGreaterThanOrEqual(30);
  });

  it("honours colour tags, colours roads by class, and trims up for its darker walls", () => {
    // Why this test matters: the tags carry real facade colours where mapped;
    // one asphalt family needs the surface colours off; the walls' mean
    // reflectance is well below today's, so the trim compensates.
    expect(urban.city.honourColourTags).toBe(true);
    expect(urban.city.roadsBySurface).toBe(false);
    expect(urban.city.walls).toHaveLength(20);
    expect(urban.city.flatRoofs).toHaveLength(6);
    expect(urban.city.pitchedRoofs).toHaveLength(7);
    expect(urban.city.ground).toBe(0x626462);
    expect(urban.brightnessTrim).toBe(1.6);
  });

  it("tells towers from walk-ups, reads material tags and jitters each building", () => {
    // Why this test matters: a tower is not a walk-up (city look exploration
    // 2026-11-15, direction B). Towers from 40 m draw glass, dark stone,
    // limestone and steel; a mapped material picks its real albedo; a seeded
    // 3 L* jitter breaks up runs of one tone. The values are the design's, so
    // a retune is a deliberate edit here, not drift.
    const city = urban.city;
    expect(city.towerWalls).toEqual([
      0x40484c, 0x7d858b, 0x3c4146, 0x484744, 0x828487, 0xb1aaa0, 0x9d9b96,
      0x838789,
    ]);
    expect(city.towerFromM).toBe(40);
    expect(city.honourMaterialTags).toBe(true);
    expect([...city.materialWalls]).toEqual([
      ["glass", 0x3d474d],
      ["brick", 0x9f786c],
      ["concrete", 0x979692],
      ["stone", 0xb3aa9d],
      ["sandstone", 0xb39c87],
      ["granite", 0x86807d],
      ["metal", 0x888c8e],
      ["plaster", 0xbeb5a7],
      ["wood", 0x977c6a],
    ]);
    expect(city.wallJitterL).toBe(3);
  });

  it("keeps the default's land use, trees and barriers", () => {
    // Why this test matters: the look changes buildings, roads and ground
    // only; vegetation and land use stay today's, so a comparison with today
    // isolates the palette.
    expect(urban.city.landUse).toBe(DEFAULT_CITY_COLOUR_SCHEME.landUse);
    expect(urban.city.trees).toBe(DEFAULT_CITY_COLOUR_SCHEME.trees);
    expect(urban.city.barriers).toBe(DEFAULT_CITY_COLOUR_SCHEME.barriers);
  });
});
