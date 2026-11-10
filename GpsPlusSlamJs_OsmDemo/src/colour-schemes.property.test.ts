import fc from "fast-check";
import { DEFAULT_CITY_COLOUR_SCHEME } from "gps-plus-slam-osm";
import { describe, expect, it } from "vitest";

import {
  COLOUR_SCHEME_NAMES,
  COLOUR_SCHEMES,
  colourSchemeBuildFailure,
  failedColourSchemeOf,
  isColourSchemeName,
  resolveColourScheme,
} from "./colour-schemes.js";

describe("colour schemes, properties", () => {
  it("resolves any link value to a name in the table", () => {
    // Why this test matters: whatever a link carries, the worker must be
    // asked for a scheme it has.
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), (raw) => {
        const name = resolveColourScheme(raw, () => {});
        expect(COLOUR_SCHEME_NAMES).toContain(name);
        expect(isColourSchemeName(name)).toBe(true);
      }),
    );
  });

  it("reads back the scheme of any build-failure message, whatever the cause", () => {
    // Why this test matters: the cause is an arbitrary error text and may
    // itself contain quotes or the phrase; the name must still come back.
    fc.assert(
      fc.property(
        fc.string().filter((s) => s !== "" && !s.includes('"')),
        fc.string(),
        (scheme, cause) => {
          expect(
            failedColourSchemeOf(colourSchemeBuildFailure(scheme, cause)),
          ).toBe(scheme);
        },
      ),
    );
  });
});

describe("the ten schemes, properties", () => {
  it("resolves every table name from a link to itself, silently", () => {
    // Why this test matters: a link the dropdown wrote must boot the same
    // scheme without a warning, for every name, not only the default.
    fc.assert(
      fc.property(fc.constantFrom(...COLOUR_SCHEME_NAMES), (name) => {
        const warnings: string[] = [];
        expect(resolveColourScheme(name, (m) => warnings.push(m))).toBe(name);
        expect(warnings).toEqual([]);
      }),
    );
  });

  it("gives every road class and land-use class of every scheme a colour", () => {
    // Why this test matters: the looks rebuild each map from the default's
    // keys; a class the default gains later must reach every scheme.
    fc.assert(
      fc.property(fc.constantFrom(...COLOUR_SCHEME_NAMES), (name) => {
        const city = COLOUR_SCHEMES[name].city;
        for (const key of DEFAULT_CITY_COLOUR_SCHEME.roads.keys()) {
          expect(city.roads.has(key)).toBe(true);
        }
        for (const key of DEFAULT_CITY_COLOUR_SCHEME.landUse.keys()) {
          expect(city.landUse.has(key)).toBe(true);
        }
      }),
    );
  });
});
