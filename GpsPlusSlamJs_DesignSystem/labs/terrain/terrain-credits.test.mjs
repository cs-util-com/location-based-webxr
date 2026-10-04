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

  // T0/T1 review finding 10: the list is joerd's text VERBATIM (its own
  // punctuation and en dashes), not a paraphrase. The oracle is the source
  // block itself, pasted below as fetched; the bullets are joined across
  // their wrapped lines.
  it("is joerd's hosted-service list, verbatim and in order", () => {
    const bullets = JOERD_HOSTED_BLOCK.split(/\n(?=\* )/).map((b) =>
      b.replace(/^\* /, "").replace(/\n\s+/g, " ").trim(),
    );
    assert.deepEqual([...TERRAIN_CREDITS], bullets);
  });

  it("cites the commit the list was copied from", () => {
    const joerd = TERRAIN_CREDIT_LINKS.find((l) => /joerd/.test(l.href));
    assert.match(joerd.href, /d8f587b73d26e0a0c42cdccd9ae8c55de4197763/);
  });
});

/**
 * tilezen/joerd `docs/attribution.md`, "Required attribution when using
 * Mapzen's hosted service", at commit d8f587b7 (2017-11-14, the file's last
 * change; fetched 2026-09-28). The AWS Terrain Tiles are that hosted
 * service's tiles, moved to AWS Open Data.
 */
const JOERD_HOSTED_BLOCK = `* Mapzen
* ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and
  funded under National Science Foundation awards 1043681, 1559691, and 1542736;
* Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017;
* Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM)
  Österreich;
* Canada terrain data contains information licensed under the Open Government
  Licence – Canada;
* Europe terrain data produced using Copernicus data and information funded by the
  European Union - EU-DEM layers;
* Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration
* Mexico terrain data source: INEGI, Continental relief, 2016;
* New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New
  Zealand and the New Zealand Government (All rights reserved);
* Norway terrain data © Kartverket;
* United Kingdom terrain data © Environment Agency copyright and/or database right
  2015. All rights reserved;
* United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data
  courtesy of the U.S. Geological Survey.`;
