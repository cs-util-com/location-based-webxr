import { DEFAULT_CITY_COLOUR_SCHEME } from "gps-plus-slam-osm";
import { describe, expect, it, vi } from "vitest";

import {
  COLOUR_SCHEME_NAMES,
  COLOUR_SCHEMES,
  DEFAULT_COLOUR_SCHEME,
  colourSchemeBuildFailure,
  colourSchemeOf,
  failedColourSchemeOf,
  isColourSchemeName,
  resolveColourScheme,
  validateColourScheme,
  type ColourScheme,
} from "./colour-schemes.js";
import { DEFAULT_GROUND_SLOPE_COLOURS } from "./ground-slope-colours.js";
import { PLATE_COLOUR } from "./surface-colours.js";

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

describe("the build-failure message", () => {
  it("names the scheme so the dropdown can tell its failure from others", () => {
    // Why this test matters: only the message crosses the RPC boundary; the
    // dropdown reverts only for its own scheme's build (plan 4.4).
    const message = colourSchemeBuildFailure("today", "out of memory");
    expect(failedColourSchemeOf(message)).toBe("today");
    expect(failedColourSchemeOf("Overpass answered 429")).toBeUndefined();
    expect(failedColourSchemeOf(`x ${message}`)).toBeUndefined();
  });
});
