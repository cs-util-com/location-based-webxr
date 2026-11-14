import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { seededBuildingColours } from "./building-palette.js";
import {
  DEFAULT_CITY_COLOUR_SCHEME,
  validateCityColourScheme,
  type CityColourScheme,
} from "./colour-scheme.js";
import { roadColour } from "./feature-colours.js";

const rgb = fc.integer({ min: 0, max: 0xffffff });

function recolour<K>(
  map: ReadonlyMap<K, number>,
  colours: readonly number[],
): Map<K, number> {
  return new Map(
    [...map.keys()].map((k, i) => [k, colours[i % colours.length] ?? 0]),
  );
}

/** A scheme with the default's shape and arbitrary colours. */
const scheme: fc.Arbitrary<CityColourScheme> = fc
  .record({
    honourColourTags: fc.boolean(),
    roadsBySurface: fc.boolean(),
    ground: rgb,
    sidewalk: rgb,
    defaultRoad: rgb,
    markings: rgb,
    walls: fc.array(rgb, { minLength: 1, maxLength: 8 }),
    pitchedRoofs: fc.array(rgb, { minLength: 1, maxLength: 8 }),
    flatRoofs: fc.array(rgb, { minLength: 1, maxLength: 8 }),
    pool: fc.array(rgb, { minLength: 1, maxLength: 30 }),
  })
  .map(({ pool, ...rest }) => {
    const d = DEFAULT_CITY_COLOUR_SCHEME;
    return {
      ...rest,
      roads: recolour(d.roads, pool),
      roadSurfaces: recolour(d.roadSurfaces, pool),
      barriers: recolour(d.barriers, pool),
      barrierMaterials: recolour(d.barrierMaterials, pool),
      trees: recolour(d.trees, pool),
      landUse: recolour(d.landUse, pool),
    };
  });

describe("colour schemes, properties", () => {
  // WHY: every scheme with the default's shape and in-range colours is
  // valid, whatever its colours; validation judges shape, never taste.
  it("any well-shaped scheme validates", () => {
    fc.assert(
      fc.property(scheme, (s) => {
        expect(validateCityColourScheme(s)).toBe(s);
      }),
    );
  });

  // WHY: with the tag flag off no tag can leak a mapper's colour into a
  // stylised scheme: every wall and roof is one of the scheme's tones.
  it("with tags painted over, every building colour is a scheme tone", () => {
    fc.assert(
      fc.property(
        scheme,
        fc.string(),
        fc.boolean(),
        fc.dictionary(
          fc.constantFrom("building:colour", "roof:colour", "building"),
          fc.constantFrom("#ff0000", "red", "#abc", "house", "junk"),
        ),
        (s, key, pitched, tags) => {
          const over = { ...s, honourColourTags: false };
          const { wall, roof } = seededBuildingColours(
            tags,
            tags,
            key,
            pitched,
            over,
          );
          expect(over.walls).toContain(wall);
          expect(pitched ? over.pitchedRoofs : over.flatRoofs).toContain(roof);
        },
      ),
    );
  });

  // WHY: a road always takes one of the scheme's road colours, never a
  // default's, so a switched scheme has no stray road from the old look.
  it("every road colour comes from the scheme", () => {
    fc.assert(
      fc.property(
        scheme,
        fc.constantFrom(
          ...DEFAULT_CITY_COLOUR_SCHEME.roads.keys(),
          "nonsense",
          "",
        ),
        fc.constantFrom(
          ...DEFAULT_CITY_COLOUR_SCHEME.roadSurfaces.keys(),
          "",
          "junk",
        ),
        fc.boolean(),
        (s, highway, surface, sidewalk) => {
          const tags: Record<string, string> = { highway, surface };
          if (sidewalk) tags["footway"] = "sidewalk";
          const allowed = [
            ...s.roads.values(),
            ...s.roadSurfaces.values(),
            s.sidewalk,
            s.defaultRoad,
          ];
          expect(allowed).toContain(roadColour(tags, s));
        },
      ),
    );
  });
});
