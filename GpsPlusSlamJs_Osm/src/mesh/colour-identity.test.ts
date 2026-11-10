import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { loadSite } from "../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { buildCity, type City, type CityOptions } from "./city.js";
import { DEFAULT_CITY_COLOUR_SCHEME } from "./colour-scheme.js";
import type { MeshChunk } from "./chunk-meshes.js";
import { enuFrameAt } from "./enu.js";

/**
 * WHY THIS TEST MATTERS. It is the guard that every consumer which builds a
 * city WITHOUT a colour scheme (the Globe, the Tour Editor through it, the
 * labs) draws exactly the colours it drew before colour schemes existed (OSM
 * demo colour schemes plan 2026-11-10-0841 section 4.2). The digests were
 * recorded at webxr main 7f1d01edd, BEFORE any scheme code was written, and
 * committed on their own so the history shows them passing on unchanged code.
 * A change to a colour table, the palette pick or the colour-space rule moves
 * a digest; that is a visible change to every app and needs the owner's look,
 * never a re-pin to make this green.
 *
 * INVENTED ROOFS ARE OFF HERE, deliberately (the toggles plan, M8): an
 * invented roof is new geometry, not a colour change, so it moves the
 * buildings digest by construction. Off, the city draws the buildings it
 * drew when the digests were recorded, which is what this test guards; the
 * roofs themselves are held by `site-invented-roofs.test.ts`.
 *
 * The options mirror the Globe's call (`globe-city-worker-core.ts`: roads on)
 * with the cosmetic trees ON (the Globe has them off today; on here so their
 * colours are held too) and no `withinM` (everything kept, the widest
 * coverage), under both palettes.
 */

/** sha256 of the parts of a city that carry colour, hex, first 16 chars. */
function digestChunks(chunks: readonly MeshChunk[]): string {
  const hash = createHash("sha256");
  for (const chunk of chunks) {
    hash.update(chunk.key);
    const colors = chunk.colors ?? new Float32Array(0);
    hash.update(
      new Uint8Array(colors.buffer, colors.byteOffset, colors.byteLength),
    );
  }
  return hash.digest("hex").slice(0, 16);
}

function digestTrees(city: City): string {
  const hash = createHash("sha256");
  for (const t of [...city.trees, ...city.cosmeticTrees]) {
    hash.update(`${t.feature}:${t.colour};`);
  }
  return hash.digest("hex").slice(0, 16);
}

interface Digests {
  readonly buildings: string;
  readonly roads: string;
  readonly trees: string;
}

function digestsOf(city: City): Digests {
  return {
    buildings: digestChunks(city.buildings),
    roads: digestChunks(city.roads),
    trees: digestTrees(city),
  };
}

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
  // Added with the land-use tint (S2); its digest was computed from the
  // base commit 7f1d01edd source, before any scheme code read the fixture.
  "lucerne-reuss",
] as const;

type Palette = NonNullable<CityOptions["palette"]>;

/** Recorded at 7f1d01edd (before colour schemes). Never re-pin to go green. */
const GOLDEN: Record<(typeof SITES)[number], Record<Palette, Digests>> = {
  "heidelberg-altstadt": {
    seeded: {
      buildings: "f1e8af72a308c899",
      roads: "0104b1c0ab0e4b3d",
      trees: "3a55bb83aea3509b",
    },
    class: {
      buildings: "5e9bcf6e4edb46a0",
      roads: "0104b1c0ab0e4b3d",
      trees: "3a55bb83aea3509b",
    },
  },
  "lucerne-meggen": {
    seeded: {
      buildings: "a286747d2a1d164e",
      roads: "07201ae995744723",
      trees: "820d30e0afe60964",
    },
    class: {
      buildings: "278d36f3e79e20cd",
      roads: "07201ae995744723",
      trees: "820d30e0afe60964",
    },
  },
  "nyc-park-slope": {
    seeded: {
      buildings: "cb6c2500764020dc",
      roads: "e3b9e04d329b6566",
      trees: "e3b0c44298fc1c14",
    },
    class: {
      buildings: "c624121bf9488397",
      roads: "e3b9e04d329b6566",
      trees: "e3b0c44298fc1c14",
    },
  },
  "berlin-alexanderplatz": {
    seeded: {
      buildings: "dd4e1826b50a4c55",
      roads: "9ce97c12ae476ff5",
      trees: "ededf35a632e4b5c",
    },
    class: {
      buildings: "fc11aa360aaa6d3c",
      roads: "9ce97c12ae476ff5",
      trees: "ededf35a632e4b5c",
    },
  },
  "woodland-hinterzarten": {
    seeded: {
      buildings: "cdb49d71cf51f5f7",
      roads: "ab572d65ed7dcafe",
      trees: "5dc2a86e8f20bc45",
    },
    class: {
      buildings: "309aeab739d0e06a",
      roads: "ab572d65ed7dcafe",
      trees: "5dc2a86e8f20bc45",
    },
  },
  "cologne-cathedral": {
    seeded: {
      buildings: "e88a4fea99b66a9c",
      roads: "1fb92154bcdf76dc",
      trees: "b690534dd59bc999",
    },
    class: {
      buildings: "0c9f2a43dbb86d53",
      roads: "1fb92154bcdf76dc",
      trees: "b690534dd59bc999",
    },
  },
  "london-tower-bridge": {
    seeded: {
      buildings: "6ffa5f25b5f3d154",
      roads: "98e84426e03d6b3d",
      trees: "7c6b9039dc8b7bc1",
    },
    class: {
      buildings: "e5b2c381a8ba4ad6",
      roads: "98e84426e03d6b3d",
      trees: "7c6b9039dc8b7bc1",
    },
  },
  "london-westminster": {
    seeded: {
      buildings: "3c91cb80353e6c43",
      roads: "0efbf9ac737efb98",
      trees: "0334f1a32fa058ec",
    },
    class: {
      buildings: "37790ad8cb5394f8",
      roads: "0efbf9ac737efb98",
      trees: "0334f1a32fa058ec",
    },
  },
  "manhattan-midtown": {
    seeded: {
      buildings: "e55f8c727b52e298",
      roads: "b754933116bc7a3e",
      trees: "14b22c85be5c994f",
    },
    class: {
      buildings: "3ad69f18f13f0ff5",
      roads: "b754933116bc7a3e",
      trees: "14b22c85be5c994f",
    },
  },
  "sylt-westerland": {
    seeded: {
      buildings: "8d1eab536e9d4d59",
      roads: "58bb1ced6e5c77bc",
      trees: "e3b0c44298fc1c14",
    },
    class: {
      buildings: "124ca71ea75ea51d",
      roads: "58bb1ced6e5c77bc",
      trees: "e3b0c44298fc1c14",
    },
  },
  "tokyo-shinjuku": {
    seeded: {
      buildings: "8423a079567a2724",
      roads: "232fd87618d9d169",
      trees: "85d600403415f088",
    },
    class: {
      buildings: "16709dfa82b9cbe7",
      roads: "232fd87618d9d169",
      trees: "85d600403415f088",
    },
  },
  "lucerne-reuss": {
    seeded: {
      buildings: "9b6ec42adbdbfff1",
      roads: "e44fdae2352e6eaf",
      trees: "5f474d2260d18a2f",
    },
    class: {
      buildings: "450dffee795926a6",
      roads: "e44fdae2352e6eaf",
      trees: "5f474d2260d18a2f",
    },
  },
};

describe("city colours without a scheme are byte-identical to before schemes", () => {
  for (const id of SITES) {
    const site = loadSite(id);
    const features = parseOverpassJson(site.payload).features;
    const ground = { frame: enuFrameAt(site.centre) };
    for (const palette of ["seeded", "class"] as const) {
      it(`${id}, ${palette} palette`, () => {
        const city = buildCity(features, ground, {
          window: site.bbox,
          roads: true,
          cosmeticTrees: true,
          inventedRoofs: false,
          palette,
        });
        expect(digestsOf(city)).toEqual(GOLDEN[id][palette]);
      });
      // The default passed explicitly is the same as no scheme at all.
      it(`${id}, ${palette} palette, the default scheme passed explicitly`, () => {
        const city = buildCity(features, ground, {
          window: site.bbox,
          roads: true,
          cosmeticTrees: true,
          inventedRoofs: false,
          palette,
          colours: DEFAULT_CITY_COLOUR_SCHEME,
        });
        expect(digestsOf(city)).toEqual(GOLDEN[id][palette]);
      });
    }
  }
});
