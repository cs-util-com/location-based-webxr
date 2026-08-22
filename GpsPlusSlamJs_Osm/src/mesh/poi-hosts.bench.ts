import { bench, describe } from "vitest";
import { annotatePoiHosts } from "./poi-hosts.js";
import { buildBuildings } from "./buildings.js";
import { buildAreaPlates } from "./plates.js";
import { buildPoiMarkers } from "./poi.js";
import { enuFrameAt } from "./enu.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import type { HostCandidate } from "./poi-hosts.js";
import type { OsmFeature } from "../model/osm-feature.js";

/**
 * Benchmark for the POI host join — the one QUADRATIC term left in the mesh
 * build, and therefore the one whose verdict depends entirely on scale.
 *
 * Why this bench matters (2026-08-22 perf loop, OSM iteration 11). `poi-hosts-
 * cost.test.ts` already pins the growth SHAPE with counters, and deliberately
 * treats its wall clock as a smoke alarm rather than a budget — so nothing here
 * measured the cost itself. The 2026-08-21 mesh investigation timed the call
 * across scales by hand and found ~7 ns per pair; a stage-by-stage timing of the
 * whole `buildMesh` on 2026-08-22 then put it at **205 ms of a 1 185 ms build
 * (17.3 %)**, second only to `buildBuildings`.
 *
 * **THE CONSTANT IS TINY AND THE EXPONENT IS TWO, WHICH IS WHY THIS NEEDS A
 * BENCH AT MORE THAN ONE SCALE.** The 2026-08-21 investigation killed a
 * prediction that this explained a 9.5 s click precisely because it reasoned
 * from the exponent and got the constant wrong by ~20×. A single-scale number
 * would repeat that mistake from the other side: at k=1 this call is 5 ms and
 * looks free. Its cost is `markers × candidates`, and BOTH grow with the working
 * set, so four times the data is sixteen times the work.
 *
 * CANDIDATES ARE BUILDINGS **AND** PLATES, in that order, because that is how
 * `demo-worker.ts` assembles them and the order is load-bearing (the first
 * enabled host wins, and a building is the more specific claim). `poi-hosts-
 * cost.test.ts` uses buildings only, on the stated grounds that plates do not
 * grow with the working set the way buildings do — correct for measuring
 * GROWTH, wrong for measuring the cost production actually pays.
 *
 * THE PLATE CLIP IS APPROXIMATED, as it is in `plates-clip.test.ts`:
 * production's `clipBoxAround` lives in the demo and cannot be imported here, so
 * this is a box of the right ORDER rather than a claim of fidelity. Plates are
 * 1 520 candidates against 17 552 buildings at k=4, so the approximation moves
 * the total by single-digit percent.
 *
 * Medians on devbox-win11 (Win 11 Pro, 11th Gen Intel i7-1185G7 @ 3.00 GHz,
 * Node 24.14.1) are in `poi-hosts.ts.md`, with what changed and why.
 */

const SITE = "london-westminster";

/** `k × k` copies on a fixed grid, ids offset — the same shape as the cost test. */
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
 * Both are load-bearing — see `poi-hosts-cost.test.ts`, which explains why
 * shared ids would collapse the copies and make every measurement vacuous.
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

/** The markers and candidates `buildMesh` would hand this call at `k × k` copies. */
function subject(k: number): {
  markers: ReturnType<typeof buildPoiMarkers>;
  candidates: HostCandidate[];
} {
  const site = loadSite(SITE);
  const features = replicate([...parseOverpassJson(site.payload).features], k);
  const options = { frame: enuFrameAt(site.centre) };

  // Roughly the production clip; see the file docstring.
  const HALF_DEG = 0.0216;
  const volumes = buildBuildings(features, options);
  const plates = buildAreaPlates(features, {
    ...options,
    clipTo: {
      south: site.centre.lat - HALF_DEG,
      north: site.centre.lat + HALF_DEG,
      west: site.centre.lng - HALF_DEG,
      east: site.centre.lng + HALF_DEG,
    },
  });

  // BUILDINGS FIRST, as `demo-worker.ts` orders them.
  const candidates: HostCandidate[] = [
    ...volumes.map((volume) => ({
      layer: "buildings" as const,
      feature: volume.feature,
      footprint: volume.footprint,
      topM: volume.topHeightM,
    })),
    ...plates.map((plate) => ({
      layer: "plates" as const,
      feature: plate.feature,
      footprint: plate.footprint,
      topM: 0,
    })),
  ];
  return { markers: buildPoiMarkers(features, options), candidates };
}

describe("annotatePoiHosts — the quadratic, at two scales", () => {
  // k=2 and k=4 rather than one point: the ratio between them is the number
  // that says whether the join is still quadratic, and one scale cannot.
  for (const k of [2, 4]) {
    const { markers, candidates } = subject(k);
    const pairs = markers.length * candidates.length;
    bench(
      `k=${k} — ${markers.length} markers x ${candidates.length} candidates (${pairs} pairs)`,
      () => {
        annotatePoiHosts(markers, candidates);
      },
    );
  }
});
