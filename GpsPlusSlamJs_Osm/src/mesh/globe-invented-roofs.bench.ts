import { describe, test } from "vitest";

import { TERRAIN_EXTENT_M } from "../elevation/heightfield.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import { bboxesIntersect, boundsOf, type Bbox } from "../spatial/clip.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import { buildCity } from "./city.js";
import { enuFrameAt, type EnuFrame } from "./enu.js";

/**
 * What invented roofs cost the globe's WARM delivery: the tiles are in the
 * store, the fetch is near zero, so reading the tiles (`JSON.parse` and `parseOverpassJson`
 * stands in for the store's read) and `buildCity` ARE the delivery.
 *
 * Why this bench matters: the globe builds with the library's defaults, so
 * invented roofs are on there unless it says otherwise, and the city plan's
 * rule is mechanical: if the warm delivery more than doubles with roofs on,
 * the globe passes `inventedRoofs: false`. The cold delivery hides the cost
 * behind the network; a revisit (the Tour Editor's normal case) does not.
 *
 * The options are the globe worker's (`globe-city-worker-core.ts`):
 * `withinM` the terrain extent, roads on, no cosmetic woods, no furniture.
 * TWO STAGED SIZES per site: the central half and the whole of the data's
 * 2-98 percentile box, as the globe's first rings and its full delivery.
 * Two sites: Heidelberg (dense old town) and Meggen (a suburb of detached
 * houses, where nearly every roof is invented). Means are in
 * `invented-roofs.ts.md`; run with
 * `pnpm run bench src/mesh/globe-invented-roofs.bench.ts --reporter=verbose`.
 */

/** A fixed budget so the means recorded in the sidecar stay comparable. */
const BUDGET = { iterations: 15, warmupIterations: 3 } as const;

const SITES = ["heidelberg-altstadt", "lucerne-meggen"] as const;
const STAGES = [0.5, 1] as const;

function pointsOf(f: OsmFeature): LatLng[] {
  if (f.type === "node") return [f.position];
  if (f.type === "way") return [...f.geometry];
  return f.members.flatMap((m) => [
    ...(m.geometry ?? []),
    ...(m.position === undefined ? [] : [m.position]),
  ]);
}

function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(q * (sorted.length - 1))] ?? Number.NaN;
}

/** The 2-98 percentile box of the features' centres. */
function dataBox(features: readonly OsmFeature[]): Bbox {
  const lat: number[] = [];
  const lng: number[] = [];
  for (const f of features) {
    const b = boundsOf(pointsOf(f));
    if (b === undefined || !Number.isFinite(b.south)) continue;
    lat.push((b.south + b.north) / 2);
    lng.push((b.west + b.east) / 2);
  }
  return {
    south: quantile(lat, 0.02),
    north: quantile(lat, 0.98),
    west: quantile(lng, 0.02),
    east: quantile(lng, 0.98),
  };
}

function shrink(b: Bbox, f: number): Bbox {
  const cy = (b.south + b.north) / 2;
  const cx = (b.west + b.east) / 2;
  const hy = ((b.north - b.south) / 2) * f;
  const hx = ((b.east - b.west) / 2) * f;
  return { south: cy - hy, north: cy + hy, west: cx - hx, east: cx + hx };
}

interface Case {
  readonly label: string;
  /** The staged tiles' text, as the store holds it. */
  readonly payload: string;
  readonly window: Bbox;
  readonly frame: EnuFrame;
}

const CASES: Case[] = SITES.flatMap((id) => {
  const site = loadSite(id);
  const all = parseOverpassJson(site.payload).features;
  const box = dataBox(all);
  return STAGES.map((stage) => {
    const window = shrink(box, stage);
    const staged = all.filter((f) => {
      const b = boundsOf(pointsOf(f));
      return b !== undefined && bboxesIntersect(b, window);
    });
    // The staged features re-serialised as Overpass JSON, so the parse
    // below costs what reading exactly these tiles back would.
    const payload = JSON.stringify({ elements: staged.map(toElement) });
    const reread = parseOverpassJson(JSON.parse(payload)).features.length;
    if (reread !== staged.length) {
      throw new Error(`${id}: ${reread} of ${staged.length} features re-read`);
    }
    console.info(`${id} stage ${stage}: ${staged.length} features`);
    return {
      label: `${id} stage ${stage}`,
      payload,
      window,
      frame: enuFrameAt({
        lat: (window.south + window.north) / 2,
        lng: (window.west + window.east) / 2,
      }),
    };
  });
});

function toElement(f: OsmFeature): unknown {
  const [type, id] = [f.type, f.id];
  if (f.type === "node") {
    return { type, id, lat: f.position.lat, lon: f.position.lng, tags: f.tags };
  }
  if (f.type === "way") {
    return {
      type,
      id,
      tags: f.tags,
      geometry: f.geometry.map((p) => ({ lat: p.lat, lon: p.lng })),
    };
  }
  return {
    type,
    id,
    tags: f.tags,
    members: f.members.map((m) => ({
      type: m.type,
      ref: m.ref,
      role: m.role,
      ...(m.geometry === undefined
        ? {}
        : { geometry: m.geometry.map((p) => ({ lat: p.lat, lon: p.lng })) }),
      ...(m.position === undefined
        ? {}
        : { lat: m.position.lat, lon: m.position.lng }),
    })),
  };
}

function deliver(c: Case, inventedRoofs: boolean): void {
  const features = parseOverpassJson(JSON.parse(c.payload)).features;
  buildCity(
    features,
    { frame: c.frame },
    {
      withinM: TERRAIN_EXTENT_M,
      roads: true,
      window: c.window,
      cosmeticTrees: false,
      inventedRoofs,
    },
  );
}

describe("globe warm delivery, invented roofs off and on", () => {
  for (const c of CASES) {
    for (const inventedRoofs of [false, true]) {
      const label = `${c.label} roofs ${inventedRoofs ? "on" : "off"}`;
      test(label, async ({ bench }) => {
        await bench(label, () => {
          deliver(c, inventedRoofs);
        }).run(BUDGET);
      });
    }
  }
});
