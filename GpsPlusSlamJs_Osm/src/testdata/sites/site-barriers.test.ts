import { describe, expect, it } from "vitest";

import { CORPUS_SITES, type CorpusSite } from "../../places/sites.js";
import { loadSite } from "../../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../../model/overpass-parser.js";
import { enuFrameAt } from "../../mesh/enu.js";
import {
  buildBarriers,
  type BarrierVolume,
} from "../../mesh/barrier-volumes.js";
import { barrierCentrelines, isSolidBarrier } from "../../mesh/barriers.js";
import { NO_GATES, gateOpenings } from "../../mesh/barrier-gates.js";
import type { LatLng } from "../../model/osm-feature.js";
import { buildObstacleIndex } from "../../nav/obstacles.js";
import { featureKey } from "../../model/osm-feature.js";
import type { OsmFeature } from "../../model/osm-feature.js";

/**
 * WHY THESE TESTS MATTER. The navigation design's sharpest finding is that
 * **nothing in the pipeline represented a curtain wall**, so pass B could not
 * see the Tower's wall any more than pass A could. DEC-R7b-14 and DEC-R11-2
 * answered that with a barrier builder whose output is DRAWN — and the whole
 * claim is about real OSM tagging, not about hand-built fixtures. Synthetic
 * ways prove the extrusion arithmetic; only the corpus proves the SELECTOR
 * matches what mappers actually write.
 *
 * That distinction earned its keep immediately. The first implementation keyed
 * the solid set on `barrier=*` alone, which is what the owner decision named
 * (DEC-R11-2/R11-4) — and every one of the four `historic=citywalls` ways in
 * the Cologne extract carries **no `barrier` tag at all**. The single most
 * on-point piece of geometry in the corpus was invisible to a feature built to
 * see it, and no unit test over invented ways could have noticed.
 *
 * These are coarse PROPERTIES for the same reason `site-geometry.test.ts` gives:
 * a property survives a fixture refresh and a palette change, a pixel does not.
 *
 * @see ../../mesh/barrier-volumes.ts.md
 */

/**
 * Everything one site needs, built once.
 *
 * **AT MODULE LEVEL, INCLUDING THE OBSTACLE INDEX.** `buildObstacleIndex` runs
 * `coverCells` at res-13 (~8 m) for every quad of every barrier in a whole
 * city extract, which is seconds of work — building it inside an `it` put two
 * sites past vitest's 5 s per-test timeout when the suite ran in parallel,
 * while passing comfortably when the file ran alone. That is the same reason
 * `site-geometry.test.ts` hoists its volumes, and the failure mode it avoids is
 * the nastier one: a timeout that only appears under load reads as flake.
 */
function barriersFor(site: CorpusSite): {
  features: OsmFeature[];
  volumes: BarrierVolume[];
  indexed: Set<string>;
} {
  const extract = loadSite(site.id);
  const parsed = parseOverpassJson(extract.payload);
  const features = [...parsed.features];
  const index = buildObstacleIndex(features);
  // SCOPED TO BARRIERS. The index holds buildings too since they became
  // obstacles, and this file is about the barrier half — comparing the whole
  // index against the barrier volumes would fail for a reason that is not a
  // defect. `site-building-obstacles.test.ts` covers the other half.
  const barrierKeys = new Set(
    features.filter((f) => isSolidBarrier(f)).map((f) => featureKey(f)),
  );
  const indexed = new Set<string>();
  for (const cell of index.cells) {
    for (const obstacle of index.obstaclesIn(cell)) {
      if (barrierKeys.has(obstacle.feature)) indexed.add(obstacle.feature);
    }
  }
  return {
    features,
    volumes: buildBarriers(features, { frame: enuFrameAt(site.position) }),
    indexed,
  };
}

/** One barrier's lines as a comparable string — "did the geometry move at all". */
function geometryOf(lines: readonly (readonly LatLng[])[]): string {
  return JSON.stringify(lines);
}

const built = new Map(CORPUS_SITES.map((site) => [site.id, barriersFor(site)]));

const cases = CORPUS_SITES.map((site) => [site.id, site] as const);

describe("site barriers", () => {
  it.each(cases)("%s draws at least one solid barrier", (id) => {
    // The vacuous-green guard, and not a weak one: every site in this corpus
    // carries solid barriers (walls, fences, retaining walls), so a zero here
    // means the selector or the geometry path broke rather than that the city
    // has no walls.
    expect(built.get(id)?.volumes.length ?? 0).toBeGreaterThan(0);
  });

  it.each(cases)("%s produces no NaN vertex", (id) => {
    for (const volume of built.get(id)?.volumes ?? []) {
      for (const value of volume.mesh.positions) {
        // NaN removes the object from the three.js scene with nothing reported
        // — a wall that silently does not exist, which reads as sparse OSM data
        // rather than as a bug.
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it.each(cases)("%s draws every barrier it also indexes", (id) => {
    // The cross-module invariant on REAL data. A wall indexed but not drawn is
    // a detour around thin air; a wall drawn but not indexed is an agent
    // walking through visible geometry. Both are diagnosed in the wrong file.
    const entry = built.get(id);
    if (entry === undefined) throw new Error(`no build for ${id}`);

    const drawn = new Set(entry.volumes.map((volume) => volume.feature));

    expect([...entry.indexed].sort()).toEqual([...drawn].sort());
  });

  it("sees Cologne's city walls, which carry no barrier tag", () => {
    // THE REGRESSION THIS FILE WAS WRITTEN FOR, pinned as a literal count.
    // Four `historic=citywalls` ways, none of them tagged `barrier=*`. Keying
    // the solid set on `barrier` alone dropped all four — and a city wall is
    // the design's motivating example, so the feature could not see the one
    // thing it exists for.
    const entry = built.get("cologne-cathedral");
    if (entry === undefined) throw new Error("no build for cologne-cathedral");

    const cityWalls = entry.features.filter(
      (feature) => feature.tags["historic"] === "citywalls",
    );
    expect(cityWalls.length).toBe(4);
    for (const wall of cityWalls) {
      expect(wall.tags["barrier"]).toBeUndefined();
      expect(isSolidBarrier(wall)).toBe(true);
    }
  });

  it("opens a gap at exactly the mapped gates each site has (DEC-R12-1)", () => {
    // WHY THIS TEST MATTERS, AND WHY IT IS LITERAL COUNTS. The rule cuts a
    // barrier only where OSM maps a gate or entrance node ON the barrier's own
    // way, which is a narrow rule by decision — narrow enough that it does
    // NOTHING at two of the eight sites. A rule that is silently a no-op
    // everywhere looks exactly like a rule that works, so the reach is pinned
    // per site: a re-capture that changes these numbers is OSM re-tagging and
    // should be read, not re-baselined.
    //
    // The counts are barriers whose geometry the gate rule CHANGED — a split in
    // the middle, or a shortening at the end, both count.
    const opened: Record<string, number> = {};
    for (const [id] of cases) {
      const entry = built.get(id);
      if (entry === undefined) throw new Error(`no build for ${id}`);
      const gates = gateOpenings(entry.features);

      opened[id] = entry.features.filter((feature) => {
        if (!isSolidBarrier(feature)) return false;
        // COMPARED AS GEOMETRY, not as a line or vertex COUNT. A gate at the
        // first vertex of a way shortens it without splitting it and without
        // changing how many points it has — the interpolated start simply
        // replaces the old one — so a count-based comparison silently missed a
        // third of the real openings at Sylt.
        return (
          geometryOf(barrierCentrelines(feature, gates)) !==
          geometryOf(barrierCentrelines(feature, NO_GATES))
        );
      }).length;
    }

    // DEC-A2 ADDED EXACTLY ONE OPENING ACROSS ALL EIGHT SITES — Sylt's
    // `way/740958910` (`barrier=wall`, stone). That the reach is this small is
    // the evidence the rule is narrow enough to adopt: it opens a barrier only
    // where a gate NODE sits within a metre of it AND a way through that node
    // crosses it, and either signal alone is a rule this package already
    // measured and rejected.
    //
    // AND THE MEASUREMENT EARNED ITS KEEP. Before the below-surface exclusion it
    // added a SECOND opening, Cologne's `way/160630326` (`barrier=retaining_wall`
    // — the very kind DEC-R12-1 named when it rejected a bare crossing rule).
    // The cause was node 1591065517, `entrance=yes` **`layer=-1`**, "Zugang
    // Südturm": an underground access sitting on a retaining wall. A person at
    // ground level cannot walk through it, so that was an invented opening of
    // exactly the sort this module exists to prevent. It was visible only
    // because the counts are pinned per site.
    expect(opened).toEqual({
      "cologne-cathedral": 12,
      "heidelberg-altstadt": 8,
      "berlin-alexanderplatz": 0,
      "sylt-westerland": 13,
      "manhattan-midtown": 1,
      "tokyo-shinjuku": 0,
      // Unchanged, and NOT because the rule failed: the Tower of London is
      // outside this extract (bbox north 51.50668 / west -0.07616; the gate is
      // at 51.50737 / -0.07638). `agent-route.tower-gate.test.ts` in the demo
      // covers that case on inlined real geometry.
      "london-tower-bridge": 2,
      "london-westminster": 10,
    });
  });

  it("leaves gates and kerbs passable across the whole corpus", () => {
    // The other direction, and the louder failure: a sealed gate closes the
    // very route the demo exists to show an agent taking, and a solid kerb
    // would fence off every pavement. Checked corpus-wide because these are the
    // two values that actually appear in bulk — 206 kerbs and 50 gates.
    for (const [id] of cases) {
      const entry = built.get(id);
      if (entry === undefined) throw new Error(`no build for ${id}`);
      const drawn = new Set(entry.volumes.map((volume) => volume.feature));

      for (const feature of entry.features) {
        const barrier = feature.tags["barrier"];
        if (barrier !== "gate" && barrier !== "kerb") continue;
        // Not just "isSolidBarrier says no" — that would restate the selector.
        // Nothing must have been DRAWN for it.
        expect(drawn.has(`${feature.type}/${feature.id}`)).toBe(false);
      }
    }
  });
});
