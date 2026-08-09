import { describe, expect, it } from "vitest";

import { CORPUS_SITES, type CorpusSite } from "../../places/sites.js";
import { loadSite } from "../../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../../model/overpass-parser.js";
import { isRoad } from "../../mesh/roads.js";
import { isSolidBarrier, barrierCentrelines } from "../../mesh/barriers.js";
import { NO_GATES } from "../../mesh/barrier-gates.js";
import { solidBuildingFootprints } from "../../mesh/buildings.js";
import { segmentsIntersect } from "../../spatial/segment-crossing.js";
import type { PlanarPoint } from "../../spatial/point-in-ring.js";
import type { LatLng, OsmFeature } from "../../model/osm-feature.js";

/**
 * WHY THIS TEST MATTERS. The bridge-deck follow-up
 * (`GpsPlusSlamJs_Docs/docs/2026-08-08-2344-osm-bridge-deck-drawn-at-ground-level-followup.md`)
 * measured how many `layer > 0` roads the demo draws flat on the ground, and how
 * many of them cross something — then used those numbers to size three design
 * options for the owner.
 *
 * That measurement had two problems, both raised in review on PR #592, and this
 * file exists to fix them:
 *
 * 1. **It counted crossings against BARRIERS ONLY**, while the option it was
 *    sizing ("lift to clear whatever it crosses") is defined over *"every road
 *    against every barrier **and building**"*. The doc then leaned on the
 *    barrier-only figure to conclude that option "leaves the general defect
 *    untouched" — a conclusion that flips if decks cross buildings in bulk, and
 *    Tokyo's elevated walkways are exactly where one would expect that.
 * 2. **It had no reproduction path** — no test, script, or definition of
 *    "crosses in plan". A measurement steering a design decision should be
 *    re-runnable, and a fixture refresh should be able to falsify it.
 *
 * The counts are therefore PINNED here rather than written in prose. They are
 * expected to move when fixtures are re-captured; when they do, read the change
 * and update the doc, do not silently re-baseline.
 *
 * "Crosses in plan" = the deck's polyline intersects a barrier centreline or a
 * building footprint ring, using the same `segmentsIntersect` the gate rule and
 * the navigation obstacle index use. Touching counts, consistent with that
 * helper's documented bias.
 */

/** `x = lng, y = lat` — the convention `solidBuildingFootprints` returns. */
function toPlanar(p: LatLng): PlanarPoint {
  return { x: p.lng, y: p.lat };
}

/** Does polyline `a` cross polyline/ring `b` anywhere? */
function polylinesCross(
  a: readonly PlanarPoint[],
  b: readonly PlanarPoint[],
): boolean {
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      if (segmentsIntersect(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) return true;
    }
  }
  return false;
}

function layerOf(feature: OsmFeature): number {
  const raw = feature.tags["layer"];
  if (raw === undefined) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

interface DeckCounts {
  /** Roads the demo DRAWS (`isRoad`) that carry `layer > 0`. */
  readonly decks: number;
  /** Of those, how many cross a solid barrier in plan. */
  readonly crossBarrier: number;
  /** Of those, how many cross a solid building footprint in plan. */
  readonly crossBuilding: number;
  /** Of those, how many cross EITHER — the true scope of "lift to clear". */
  readonly crossEither: number;
}

/**
 * Barrier centrelines with NO gate cutting: this asks "does the deck cross the
 * wall as mapped", which is independent of whether a gate opens it.
 */
function barrierLinesOf(features: readonly OsmFeature[]): PlanarPoint[][] {
  const lines: PlanarPoint[][] = [];
  for (const feature of features) {
    if (!isSolidBarrier(feature)) continue;
    for (const line of barrierCentrelines(feature, NO_GATES)) {
      lines.push(line.map(toPlanar));
    }
  }
  return lines;
}

/** Every solid building's rings, outer and holes alike. */
function buildingRingsOf(features: readonly OsmFeature[]): PlanarPoint[][] {
  const rings: PlanarPoint[][] = [];
  for (const footprint of solidBuildingFootprints(features)) {
    for (const ring of footprint.rings) {
      rings.push(ring.map((p) => ({ x: p.x, y: p.y })));
    }
  }
  return rings;
}

function countFor(site: CorpusSite): DeckCounts {
  const parsed = parseOverpassJson(loadSite(site.id).payload);
  const features = [...parsed.features];

  const decks = features.filter(
    (f): f is OsmFeature & { type: "way" } =>
      f.type === "way" && isRoad(f) && layerOf(f) > 0,
  );

  const barrierLines = barrierLinesOf(features);
  const buildingRings = buildingRingsOf(features);

  let crossBarrier = 0;
  let crossBuilding = 0;
  let crossEither = 0;
  for (const deck of decks) {
    const line = deck.geometry.map(toPlanar);
    const b = barrierLines.some((other) => polylinesCross(line, other));
    const g = buildingRings.some((other) => polylinesCross(line, other));
    if (b) crossBarrier++;
    if (g) crossBuilding++;
    if (b || g) crossEither++;
  }

  return {
    decks: decks.length,
    crossBarrier,
    crossBuilding,
    crossEither,
  };
}

// Built once — `solidBuildingFootprints` over a whole city extract is real work,
// and the same reason `site-barriers.test.ts` hoists its volumes applies here.
const counts = new Map(
  CORPUS_SITES.map((site) => [site.id, countFor(site)] as const),
);

describe("elevated decks drawn at ground level", () => {
  it("pins how many drawn decks cross a barrier, a building, or either", () => {
    // THE NUMBER THE FOLLOW-UP DOC WAS MISSING is `crossBuilding`. The doc sized
    // "lift to clear whatever it crosses" at FOUR features from the barrier
    // column alone; the `crossEither` column is that option's real scope.
    const table: Record<string, DeckCounts> = {};
    for (const site of CORPUS_SITES) {
      const c = counts.get(site.id);
      if (c === undefined) throw new Error(`no counts for ${site.id}`);
      table[site.id] = c;
    }

    expect(table).toEqual({
      "cologne-cathedral": {
        decks: 15,
        crossBarrier: 1,
        crossBuilding: 10,
        crossEither: 11,
      },
      "heidelberg-altstadt": {
        decks: 1,
        crossBarrier: 0,
        crossBuilding: 1,
        crossEither: 1,
      },
      "berlin-alexanderplatz": {
        decks: 0,
        crossBarrier: 0,
        crossBuilding: 0,
        crossEither: 0,
      },
      "sylt-westerland": {
        decks: 0,
        crossBarrier: 0,
        crossBuilding: 0,
        crossEither: 0,
      },
      "manhattan-midtown": {
        decks: 0,
        crossBarrier: 0,
        crossBuilding: 0,
        crossEither: 0,
      },
      "tokyo-shinjuku": {
        decks: 143,
        crossBarrier: 1,
        crossBuilding: 21,
        crossEither: 22,
      },
      "london-tower-bridge": {
        decks: 17,
        crossBarrier: 2,
        crossBuilding: 5,
        crossEither: 7,
      },
      "london-westminster": {
        decks: 11,
        crossBarrier: 0,
        crossBuilding: 1,
        crossEither: 1,
      },
    });
  });

  it("reproduces the follow-up doc's deck and barrier-crossing totals", () => {
    // The doc's headline is "187 decks drawn flat across the corpus; four of
    // them cross a wall". Pinned so the doc and the corpus cannot drift apart
    // silently — this is the reproduction path the measurement lacked.
    let decks = 0;
    let crossBarrier = 0;
    for (const c of counts.values()) {
      decks += c.decks;
      crossBarrier += c.crossBarrier;
    }
    expect(decks).toBe(187);
    expect(crossBarrier).toBe(4);
  });
});
