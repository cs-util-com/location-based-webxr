/**
 * Tests for the terrain lab's credits (terrain plan 2026-09-27-0605 §3;
 * research 2026-09-27-0600 §5.4).
 *
 * Why this file matters: the tile set's licence terms ask for every source
 * to be credited, and the Osm library's own attribution constant is known to
 * miss them (plan §8). A tidy-up that shortened this list would pass every
 * other check; the Blue Ridge is USGS data, the oceans NOAA's, the Alps
 * (T3) Copernicus', so those must stay named.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  TERRAIN_CREDITS,
  TERRAIN_CREDIT_LINKS,
  TERRAIN_CREDIT_SHORT,
} from "./terrain-credits.js";

describe("the terrain credits", () => {
  const all = [
    ...TERRAIN_CREDITS,
    ...TERRAIN_CREDIT_LINKS.map((l) => l.text),
  ].join("\n");

  for (const needed of [
    "Mapzen",
    "courtesy of the U.S. Geological Survey",
    "National Oceanic and Atmospheric Administration",
    "Copernicus",
    "Kartverket",
    "registry.opendata.aws/terrain-tiles",
  ]) {
    it(`names ${needed}`, () =>
      assert.match(all, new RegExp(needed.replace(/[.]/g, "\\."))));
  }

  it("says in the short line where the sources are", () => {
    assert.match(TERRAIN_CREDIT_SHORT, /USGS/);
    assert.match(TERRAIN_CREDIT_SHORT, /NOAA/);
  });

  it("links only https pages", () => {
    for (const { href } of TERRAIN_CREDIT_LINKS)
      assert.match(href, /^https:\/\//);
  });
});
