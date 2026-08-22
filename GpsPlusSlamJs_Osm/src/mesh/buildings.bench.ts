import { bench, describe } from "vitest";
import { buildBuildings, solidBuildingFootprints } from "./buildings.js";
import { enuFrameAt } from "./enu.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import type { OsmFeature } from "../model/osm-feature.js";

/**
 * Benchmark for `buildBuildings` — the mesh build's largest remaining term.
 *
 * Why this bench matters (2026-08-22 perf loop, OSM iteration 12). Two earlier
 * iterations shrank everything around it, and a stage-by-stage timing of the
 * demo's whole `buildMesh` now puts this builder at **502 ms of a 1 109 ms
 * build — 45 %**, by a wide margin the top line. It had never been benched at
 * all: `plates.bench.ts` records it at "≤1.1 ms", a figure taken over a
 * 242-feature fixture, which is ~1 % of a real working set and says nothing
 * about the shape.
 *
 * **TWO SCALES, because the term this file is about is a CROSS PRODUCT.**
 * `assignPartsToOutlines` gives each `building:part` to the smallest outline
 * containing it, and until 2026-08-22 it found that outline by scanning every
 * outline — so the work is `parts × outlines`, and both grow with the working
 * set exactly as `annotatePoiHosts` did. A single scale cannot tell a large
 * constant from a quadratic, which is the mistake this loop has now made once
 * and is not repeating.
 *
 * `solidBuildingFootprints` is benched alongside it because it runs the SAME
 * assignment rule — deliberately the same code, so that the geometry an agent
 * collides with and the geometry a viewer sees cannot drift — which means it
 * inherits both the cost and the fix.
 *
 * Medians on devbox-win11 (Win 11 Pro, 11th Gen Intel i7-1185G7 @ 3.00 GHz,
 * Node 24.14.1) are in `buildings.ts.md`.
 */

const SITE = "london-westminster";

/** `k × k` copies on a fixed grid, ids offset — the shape the cost tests use. */
function replicate(features: readonly OsmFeature[], k: number): OsmFeature[] {
  const PITCH_DEG = 0.006; // ~450 m at this latitude; captures span ~390 m.
  const out: OsmFeature[] = [];
  for (let row = 0; row < k; row++) {
    for (let col = 0; col < k; col++) {
      const idOffset = (row * k + col + 1) * 1_000_000_000_000;
      for (const feature of features) {
        out.push(shift(feature, row * PITCH_DEG, col * PITCH_DEG, idOffset));
      }
    }
  }
  return out;
}

/**
 * IDS ARE OFFSET PER COPY and relations move through `members`, not `geometry`.
 * `poi-hosts-cost.test.ts` explains why both are load-bearing: copies sharing
 * ids collapse into one another and every measurement over them goes vacuous.
 */
function shift(
  feature: OsmFeature,
  dLat: number,
  dLng: number,
  idOffset: number,
): OsmFeature {
  const id = feature.id + idOffset;
  const move = (p: { lat: number; lng: number }) => ({
    lat: p.lat + dLat,
    lng: p.lng + dLng,
  });
  if (feature.type === "node") {
    return { ...feature, id, position: move(feature.position) };
  }
  if (feature.type === "way") {
    return { ...feature, id, geometry: feature.geometry.map(move) };
  }
  return {
    ...feature,
    id,
    members: feature.members.map((member) => ({
      ...member,
      ...(member.geometry === undefined
        ? {}
        : { geometry: member.geometry.map(move) }),
      ...(member.position === undefined
        ? {}
        : { position: move(member.position) }),
    })),
  };
}

const site = loadSite(SITE);
const base = [...parseOverpassJson(site.payload).features];
const frame = enuFrameAt(site.centre);

describe("buildBuildings — the mesh build's top line", () => {
  for (const k of [2, 4]) {
    const features = replicate(base, k);
    bench(`k=${k} — ${features.length} features`, () => {
      buildBuildings(features, { frame });
    });
  }
});

describe("solidBuildingFootprints — the same assignment rule, for nav", () => {
  // One scale only: this shares `assignPartsToOutlines` with the builder above,
  // so the growth question is already answered there. What this adds is that the
  // nav path is not forgotten when that function changes.
  const features = replicate(base, 4);
  bench(`k=4 — ${features.length} features`, () => {
    solidBuildingFootprints(features);
  });
});
