import { describe, test } from "vitest";

import { parseOverpassJson } from "../model/overpass-parser.js";
import type { OsmFeature } from "../model/osm-feature.js";
import type { Bbox } from "../spatial/clip.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import { groundTintTexture } from "../three/ground-tint.js";
import { buildCity } from "./city.js";
import { DEFAULT_CITY_COLOUR_SCHEME } from "./colour-scheme.js";
import { enuFrameAt, type EnuFrame } from "./enu.js";
import { buildGroundTint, type GroundTint } from "./ground-tint.js";

/**
 * What the land-use tint costs a full build, so a caller can decide where to
 * skip it (the OSM demo's AR passes draw no ground plane and skip it).
 *
 * Why this bench matters: the tint was built on every full pass, including
 * passes where nothing draws it. Four terms make up its cost, and only the
 * first runs in the worker: the rasterise (`buildGroundTint`), the class bytes
 * copied across the worker boundary (`width * height`, logged below), the
 * main-thread expansion to RGBA (`groundTintTexture`), and the texture's GPU
 * bytes (`width * height * 4`, plus a third for the mip chain, logged).
 *
 * TWO WINDOW SIZES per site, because the cost is per texel and the demo's
 * window is larger than any fixture: the fixture's own bbox, and the demo's
 * largest window (`clipBoxAround(centre, 2400)` in its worker, a 4.8 km
 * square; the 2048-texel cap then coarsens the texel). Two sites: Heidelberg
 * (dense old town, many small land-use areas) and Meggen (a suburb with large
 * meadows and woods). Means are in `ground-tint.ts.md`; run with
 * `pnpm run bench src/mesh/ground-tint.bench.ts --reporter=verbose` to see
 * the tables and the size lines (the default reporter hides both).
 */

/** A fixed budget so the medians recorded in the sidecar stay comparable. */
const BUDGET = { iterations: 10, warmupIterations: 3 } as const;

const SITES = ["heidelberg-altstadt", "lucerne-meggen"] as const;
const DEMO_REACH_M = 2400;
const METRES_PER_DEG_LAT = 111_320;

function demoWindow(centre: { lat: number; lng: number }): Bbox {
  const dLat = DEMO_REACH_M / METRES_PER_DEG_LAT;
  const dLng =
    DEMO_REACH_M /
    (METRES_PER_DEG_LAT * Math.cos((centre.lat * Math.PI) / 180));
  return {
    south: centre.lat - dLat,
    north: centre.lat + dLat,
    west: centre.lng - dLng,
    east: centre.lng + dLng,
  };
}

interface Case {
  readonly label: string;
  readonly features: readonly OsmFeature[];
  readonly frame: EnuFrame;
  readonly window: Bbox;
  readonly tint: GroundTint;
}

const CASES: Case[] = SITES.flatMap((id) => {
  const site = loadSite(id);
  const features = parseOverpassJson(site.payload).features;
  const frame = enuFrameAt(site.centre);
  return (
    [
      ["fixture bbox", site.bbox],
      ["demo 4.8 km", demoWindow(site.centre)],
    ] as const
  ).map(([size, window]) => {
    const tint = buildGroundTint(features, {
      frame,
      window,
      ground: DEFAULT_CITY_COLOUR_SCHEME.ground,
      landUse: DEFAULT_CITY_COLOUR_SCHEME.landUse,
    });
    const texels = tint.width * tint.height;
    console.info(
      `${id} ${size}: ${tint.width}x${tint.height} texels at ${tint.texelM.toFixed(2)} m, class bytes ${texels}, texture bytes ${texels * 4} (+mips ${Math.round((texels * 4) / 3)})`,
    );
    return { label: `${id} ${size}`, features, frame, window, tint };
  });
});

describe("buildGroundTint (worker)", () => {
  for (const c of CASES) {
    test(c.label, async ({ bench }) => {
      await bench(c.label, () => {
        buildGroundTint(c.features, {
          frame: c.frame,
          window: c.window,
          ground: DEFAULT_CITY_COLOUR_SCHEME.ground,
          landUse: DEFAULT_CITY_COLOUR_SCHEME.landUse,
        });
      }).run(BUDGET);
    });
  }
});

describe("groundTintTexture (main thread)", () => {
  for (const c of CASES) {
    test(c.label, async ({ bench }) => {
      await bench(c.label, () => {
        groundTintTexture(c.tint).dispose();
      }).run(BUDGET);
    });
  }
});

describe("buildCity with and without the tint (fixture bbox)", () => {
  for (const c of CASES.filter((x) => x.label.endsWith("fixture bbox"))) {
    for (const groundTint of [false, true]) {
      const label = `${c.label} tint ${String(groundTint)}`;
      test(label, async ({ bench }) => {
        await bench(label, () => {
          buildCity(
            c.features,
            { frame: c.frame },
            { window: c.window, roads: true, cosmeticTrees: true, groundTint },
          );
        }).run({ iterations: 5, warmupIterations: 1 });
      });
    }
  }
});
