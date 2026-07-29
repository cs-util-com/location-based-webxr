/**
 * Feature-index tests.
 *
 * Why these tests matter:
 * Two behaviours here decide whether the package survives real data. A feature
 * whose geometry cannot be built must be RECORDED rather than thrown — the C#
 * reference throws, and the planet contains relations that cannot be closed, so
 * one of them would blank an entire working set. And the `restrictTo` bound is
 * what keeps the index cheap: a res-7 tile holds ~117k affordance cells against
 * a ~931-cell working set, so indexing everything would do 126× the necessary
 * work.
 *
 * @see h3-feature-index.ts.md
 */

import { describe, it, expect } from "vitest";
import { latLngToCell } from "h3-js";
import {
  buildFeatureIndex,
  featuresAt,
  indexEntryCount,
} from "./h3-feature-index.js";
import { coverCells } from "./cell-coverage.js";
import {
  AFFORDANCE_RES,
  SCORE_CHUNK_RES,
  scoreWorkingSet,
} from "./resolutions.js";
import type { OsmFeature } from "../model/osm-feature.js";
import { toGeometry } from "../model/osm-geometry.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const HERE = latLngToCell(COLOGNE.lat, COLOGNE.lng, AFFORDANCE_RES);

const node = (id: number, at = COLOGNE): OsmFeature => ({
  type: "node",
  id,
  position: at,
  tags: { amenity: "bench" },
});

const way = (id: number, offset = 0): OsmFeature => ({
  type: "way",
  id,
  geometry: [
    { lat: COLOGNE.lat + offset, lng: COLOGNE.lng },
    { lat: COLOGNE.lat + offset, lng: COLOGNE.lng + 0.0004 },
  ],
  tags: { highway: "footway" },
});

describe("the forward and reverse views agree", () => {
  const index = buildFeatureIndex([node(1), way(2)]);

  it("indexes every feature under every cell it touches", () => {
    for (const [key, cells] of index.byFeature) {
      for (const cell of cells) {
        expect(featuresAt(index, cell).some((f) => f.feature === key)).toBe(
          true,
        );
      }
    }
  });

  it("every cell entry has a matching reverse entry", () => {
    for (const [cell, entries] of index.byCell) {
      for (const entry of entries) {
        expect(index.byFeature.get(entry.feature)).toContain(cell);
      }
    }
  });

  it("keeps the features themselves, so one object is enough to score from", () => {
    expect(index.features.get("node/1")).toBeDefined();
    expect(index.features.get("way/2")).toBeDefined();
  });

  it("reports the resolution it was built at", () => {
    expect(index.resolution).toBe(AFFORDANCE_RES);
  });
});

describe("several features on one cell", () => {
  it("stacks them rather than overwriting", () => {
    // The multiplicative kernel needs EVERY feature on a cell — a lawn under a
    // path under a wheelchair-accessible marker is three factors. Overwriting
    // would silently drop all but one and produce a plausible wrong score.
    const index = buildFeatureIndex([node(1), node(2), node(3)]);
    expect(featuresAt(index, HERE)).toHaveLength(3);
  });

  it("counts (cell, feature) pairs, not cells", () => {
    // byCell.size undercounts badly wherever features overlap, which in a city
    // is everywhere — and it is the pair count that predicts scoring cost.
    const index = buildFeatureIndex([node(1), node(2)]);
    expect(indexEntryCount(index)).toBeGreaterThan(index.byCell.size);
  });
});

describe("a broken feature costs itself and nothing else", () => {
  // The C# reference throws here. A library shipping to phones must survive
  // whatever the real planet contains.
  const unclosable: OsmFeature = {
    type: "relation",
    id: 99,
    members: [
      {
        type: "way",
        ref: 1,
        role: "outer",
        geometry: [
          { lat: 50.9, lng: 6.9 },
          { lat: 50.91, lng: 6.91 },
        ],
      },
    ],
    tags: { type: "multipolygon", landuse: "grass" },
  };

  it("records the failure instead of throwing", () => {
    expect(() => buildFeatureIndex([unclosable])).not.toThrow();
    expect(buildFeatureIndex([unclosable]).failed).toHaveLength(1);
  });

  it("still indexes the good features around it", () => {
    const index = buildFeatureIndex([node(1), unclosable, node(2)]);
    expect(index.features.size).toBe(2);
    expect(index.failed).toHaveLength(1);
  });

  it("names the offending element, so a human can go look at it", () => {
    const index = buildFeatureIndex([unclosable]);
    expect(index.failed[0]!.featureKey).toBe("relation/99");
  });
});

describe("restrictTo — what keeps the index cheap", () => {
  it("indexes only features touching the restricted set", () => {
    const near = node(1);
    const far = node(2, { lat: 51.5, lng: 7.5 });
    const index = buildFeatureIndex([near, far], { restrictTo: [HERE] });

    expect(index.features.has("node/1")).toBe(true);
    expect(index.features.has("node/2")).toBe(false);
  });

  it("stores no cell outside the restriction", () => {
    const index = buildFeatureIndex([way(1)], { restrictTo: [HERE] });
    for (const cell of index.byCell.keys()) expect(cell).toBe(HERE);
  });

  it("drops a feature that touches nothing in range entirely", () => {
    // Not merely absent from byCell: keeping it in `features` would grow memory
    // with something no lookup can ever reach.
    const index = buildFeatureIndex([node(1, { lat: 51.5, lng: 7.5 })], {
      restrictTo: [HERE],
    });
    expect(index.features.size).toBe(0);
    expect(index.byFeature.size).toBe(0);
  });

  it("works with a real working set", () => {
    const chunks = scoreWorkingSet(
      latLngToCell(COLOGNE.lat, COLOGNE.lng, SCORE_CHUNK_RES),
    );
    expect(chunks.length).toBe(19);

    const geometry = toGeometry(way(1));
    expect(geometry.ok).toBe(true);
    if (!geometry.ok) return;
    const cells = coverCells(geometry.geometry);
    const index = buildFeatureIndex([way(1)], {
      restrictTo: cells.map((c) => c.cell),
    });
    expect(index.features.size).toBe(1);
  });
});

describe("edge cases", () => {
  it("handles an EMPTY restriction without crashing", () => {
    // `boundsOf([])` is undefined, and the padded-bbox path dereferenced it —
    // so `restrictTo: []` threw a TypeError deep inside padBbox rather than
    // answering the question. An empty restriction is a legitimate input
    // ("score nothing here"), and it arises naturally: a working set that has
    // been fully filtered, or a caller passing a computed set that came back
    // empty. The right answer is an empty index, not a crash in a helper.
    expect(() =>
      buildFeatureIndex([node(1)], { restrictTo: [] }),
    ).not.toThrow();

    const index = buildFeatureIndex([node(1)], { restrictTo: [] });
    expect(index.byCell.size).toBe(0);
    expect(index.features.size).toBe(0);
    expect(index.failed).toEqual([]);
  });

  it("handles a restriction from an iterable that yields nothing", () => {
    // Same case reached a different way — `restrictTo` is an Iterable, so a
    // generator or a filtered Set is as likely as a literal array.
    const empty = new Set<string>();
    expect(() =>
      buildFeatureIndex([node(1)], { restrictTo: empty }),
    ).not.toThrow();
  });

  it("returns an empty index for no features", () => {
    const index = buildFeatureIndex([]);
    expect(index.byCell.size).toBe(0);
    expect(index.failed).toEqual([]);
  });

  it("returns an empty array for an unknown cell rather than undefined", () => {
    // Callers iterate this in the hot loop; an undefined would need a guard at
    // every call site and one of them would be forgotten.
    expect(featuresAt(buildFeatureIndex([]), HERE)).toEqual([]);
  });

  it("can be built at a coarser resolution", () => {
    const index = buildFeatureIndex([node(1)], { resolution: SCORE_CHUNK_RES });
    expect(index.resolution).toBe(SCORE_CHUNK_RES);
    expect([...index.byCell.keys()][0]).toBe(
      latLngToCell(COLOGNE.lat, COLOGNE.lng, SCORE_CHUNK_RES),
    );
  });
});

describe("a feature too large to cover does not hang the index", () => {
  /**
   * Why this test matters: without `restrictTo`, `buildFeatureIndex` covers
   * each feature over its OWN extent, and OSM contains features of continental
   * extent — the `beach` fixture is a single element holding the entire North
   * Sea, whose res-13 coverage is on the order of 10^10 cells. Measured
   * 2026-07-29, the unrestricted call over the building-block fixture did not
   * finish in TEN MINUTES, against 113 ms for the same call with `restrictTo`.
   *
   * A hang is the worst failure mode available: it is indistinguishable from a
   * wedged app, so it gets debugged as one. This turns it into an ordinary
   * skipped feature, recorded in `failed` like every other geometry problem, so
   * the caller can see exactly which element was too big and why.
   */
  const continental: OsmFeature = {
    type: "way",
    id: 9_000_001,
    // ~10 degrees square: far beyond any working set, and about the size of the
    // real North Sea element that made this necessary.
    geometry: [
      { lat: 50, lng: 0 },
      { lat: 50, lng: 10 },
      { lat: 60, lng: 10 },
      { lat: 60, lng: 0 },
      { lat: 50, lng: 0 },
    ],
    tags: { natural: "water" },
  };

  it("skips it and says so, rather than covering 10^10 cells", () => {
    const index = buildFeatureIndex([continental]);

    expect(index.features.size).toBe(0);
    expect(index.byCell.size).toBe(0);
    expect(index.failed).toHaveLength(1);
    expect(index.failed[0]?.reason).toBe("coverage-too-large");
    expect(index.failed[0]?.featureKey).toBe("way/9000001");
    // The message has to name the way out, or the caller only learns that
    // something was too big.
    expect(index.failed[0]?.message).toMatch(/restrictTo/);
  });

  it("still indexes it when a restriction bounds the work", () => {
    // The same feature is perfectly indexable once clipped — the budget is
    // about the area actually being covered, not about the feature being
    // blacklisted.
    const cell = latLngToCell(55, 5, AFFORDANCE_RES);
    const index = buildFeatureIndex([continental], { restrictTo: [cell] });

    expect(index.failed).toEqual([]);
    expect(index.features.size).toBe(1);
    expect(index.byCell.has(cell)).toBe(true);
  });

  it("leaves ordinary features alone", () => {
    // The guard must not fire on anything real. A city block is ~10^-4 of the
    // budget, so there is no plausible legitimate feature near it.
    const index = buildFeatureIndex([node(1), way(2)]);
    expect(index.failed).toEqual([]);
    expect(index.features.size).toBe(2);
  });
});
