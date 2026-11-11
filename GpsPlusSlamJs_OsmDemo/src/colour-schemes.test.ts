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

describe("the ten schemes", () => {
  it("are the plan's ten, in its order", () => {
    // Why this test matters: the dropdown order and the link names are the
    // owner's vocabulary for rating them (D5); a renamed key breaks every
    // `?scheme=` link he has sent.
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
    expect(honouring).toEqual(["today", "mediterranean", "nordic"]);
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
