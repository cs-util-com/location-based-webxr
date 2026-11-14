import { describe, expect, it } from "vitest";

import { loadSite } from "../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { buildCity } from "./city.js";
import {
  DEFAULT_CITY_COLOUR_SCHEME,
  type CityColourScheme,
} from "./colour-scheme.js";
import { enuFrameAt } from "./enu.js";

/**
 * WHY THIS TEST MATTERS. The identity test builds every fixture site only in
 * the DEFAULT colours, so the paths only a non-default scheme takes (colour
 * tags ignored, car roads by class rather than by surface, tables remapped)
 * were never built on a real city. This builds every fixture site in such a
 * scheme, with the ground tint on, as the OSM demo's worker builds it. (The
 * demo's Heidelberg failure that prompted it was the cosmetic trees' spread
 * overflow, which no scheme causes: see cosmetic-trees.test.ts.)
 */

/** Every colour of a map moved to a different value, keys unchanged. */
function remapped<K>(map: ReadonlyMap<K, number>): ReadonlyMap<K, number> {
  return new Map([...map].map(([key, rgb]) => [key, rgb ^ 0x101010]));
}

const OTHER: CityColourScheme = {
  ...DEFAULT_CITY_COLOUR_SCHEME,
  honourColourTags: false,
  roadsBySurface: false,
  ground: DEFAULT_CITY_COLOUR_SCHEME.ground ^ 0x101010,
  walls: DEFAULT_CITY_COLOUR_SCHEME.walls.map((rgb) => rgb ^ 0x101010),
  roads: remapped(DEFAULT_CITY_COLOUR_SCHEME.roads),
  landUse: remapped(DEFAULT_CITY_COLOUR_SCHEME.landUse),
};

const SITES = [
  "heidelberg-altstadt",
  "lucerne-meggen",
  "nyc-park-slope",
  "berlin-alexanderplatz",
  "woodland-hinterzarten",
  "cologne-cathedral",
  "london-tower-bridge",
  "london-westminster",
  "manhattan-midtown",
  "sylt-westerland",
  "tokyo-shinjuku",
  "lucerne-reuss",
] as const;

describe("every fixture site builds in a non-default colour scheme", () => {
  for (const id of SITES) {
    it(`${id}`, () => {
      const site = loadSite(id);
      const features = parseOverpassJson(site.payload).features;
      const city = buildCity(
        features,
        { frame: enuFrameAt(site.centre) },
        {
          window: site.bbox,
          roads: true,
          cosmeticTrees: true,
          groundTint: true,
          colours: OTHER,
        },
      );
      expect(city.buildings.length + city.roads.length).toBeGreaterThan(0);
    });
  }
});
