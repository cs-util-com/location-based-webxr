/**
 * Cell-coverage tests.
 *
 * Why these tests matter:
 * This is the hot path and the most-likely-wrong geometry in the plan. Two
 * decisions here are load-bearing and both are easy to get subtly wrong:
 *
 *  1. **Touched, not contained.** A cell a building merely clips is exactly the
 *     case that must be vetoed. Plain `polygonToCells` is centre-containment
 *     only and would silently drop it, reporting the ground under a building's
 *     edge as walkable.
 *  2. **Supercover lines.** OSM ways are frequently long straight segments
 *     between distant nodes, so rasterising only the vertices leaves gaps
 *     wherever spacing exceeds the cell size — which is most of the time.
 *
 * @see cell-coverage.ts.md
 */

import { describe, it, expect } from "vitest";
import {
  latLngToCell,
  cellToLatLng,
  gridDistance,
  polygonToCellsExperimental,
  POLYGON_TO_CELLS_FLAGS,
} from "h3-js";
import { coverCells, dilate, cellCentre } from "./cell-coverage.js";
import { AFFORDANCE_RES } from "./resolutions.js";
import type { PolygonGeometry } from "../model/osm-geometry.js";
import type { LatLng } from "../model/osm-feature.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };

/** A square of `metres` side, centred on COLOGNE. Typed as a polygon so tests
 * can read `.rings` without casting. */
function square(metres: number): PolygonGeometry {
  const dLat = metres / 2 / 111_320;
  const dLng = dLat / Math.cos((COLOGNE.lat * Math.PI) / 180);
  const ring = [
    { lat: COLOGNE.lat - dLat, lng: COLOGNE.lng - dLng },
    { lat: COLOGNE.lat - dLat, lng: COLOGNE.lng + dLng },
    { lat: COLOGNE.lat + dLat, lng: COLOGNE.lng + dLng },
    { lat: COLOGNE.lat + dLat, lng: COLOGNE.lng - dLng },
    { lat: COLOGNE.lat - dLat, lng: COLOGNE.lng - dLng },
  ];
  return { kind: "polygon", rings: [ring] };
}

describe("points", () => {
  it("covers exactly the cell it stands in", () => {
    const covered = coverCells({ kind: "point", position: COLOGNE });
    expect(covered).toHaveLength(1);
    expect(covered[0]!.cell).toBe(
      latLngToCell(COLOGNE.lat, COLOGNE.lng, AFFORDANCE_RES),
    );
  });

  it("ignores a non-finite coordinate rather than producing a bogus cell", () => {
    expect(
      coverCells({ kind: "point", position: { lat: Number.NaN, lng: 0 } }),
    ).toEqual([]);
  });
});

describe("polygons — TOUCHED, not contained", () => {
  it("covers every cell an area overlaps, including partial ones", () => {
    const covered = coverCells(square(40));
    expect(covered.length).toBeGreaterThan(1);
  });

  it("returns a SUPERSET of what centre-containment would return", () => {
    // The concrete statement of decision 1. `containmentCenter` is what plain
    // `polygonToCells` does; every cell it finds must also be found, plus the
    // clipped ones it misses.
    const ring = square(60).rings[0]!;
    const polygon = [ring.map((p) => [p.lat, p.lng] as [number, number])];

    const centres = new Set(
      polygonToCellsExperimental(
        polygon,
        AFFORDANCE_RES,
        POLYGON_TO_CELLS_FLAGS.containmentCenter,
      ),
    );
    const touched = new Set(coverCells(square(60)).map((c) => c.cell));

    for (const cell of centres) expect(touched.has(cell)).toBe(true);
    expect(touched.size).toBeGreaterThan(centres.size);
  });

  it("does NOT assert that every covered cell's centre is inside the polygon", () => {
    // Documented as a NON-property. It holds for containmentCenter and is false
    // by construction for the mode we want — the whole point is to keep cells a
    // feature merely clips. Asserting it would either fail immediately or, worse,
    // push the implementation back to the wrong mode to make the test pass.
    const ring = square(60).rings[0]!;
    const bbox = {
      south: Math.min(...ring.map((p) => p.lat)),
      north: Math.max(...ring.map((p) => p.lat)),
      west: Math.min(...ring.map((p) => p.lng)),
      east: Math.max(...ring.map((p) => p.lng)),
    };

    const outside = coverCells(square(60))
      .map((c) => cellToLatLng(c.cell))
      .filter(
        ([lat, lng]) =>
          lat < bbox.south ||
          lat > bbox.north ||
          lng < bbox.west ||
          lng > bbox.east,
      );

    // At least one covered cell has its centre outside the polygon's bbox.
    // That is CORRECT, and this assertion exists so nobody "fixes" it.
    expect(outside.length).toBeGreaterThan(0);
  });

  it("subtracts holes — a courtyard is not covered by its building", () => {
    const outerRing = square(120).rings[0]!;
    const innerRing = square(60).rings[0]!;

    const solid = new Set(
      coverCells({ kind: "polygon", rings: [outerRing] }).map((c) => c.cell),
    );
    const withHole = new Set(
      coverCells({ kind: "polygon", rings: [outerRing, innerRing] }).map(
        (c) => c.cell,
      ),
    );

    expect(withHole.size).toBeLessThan(solid.size);
    for (const cell of withHole) expect(solid.has(cell)).toBe(true);
  });

  it("never loses a feature smaller than one cell", () => {
    // A 2 m kiosk is smaller than a res-13 cell (4 m edge) and can fall entirely
    // inside one. It must still veto that cell — a building the index cannot see
    // is a building someone walks into.
    const covered = coverCells(square(1));
    expect(covered.length).toBeGreaterThanOrEqual(1);
  });

  it("pins the assumption the sub-cell fallback rests on: h3 never returns zero cells", () => {
    // Measured, not assumed: `containmentOverlapping` yields at least one cell
    // for any valid ring, down to a 1 mm square — so the vertex fallback in
    // `addPolygon` is unreachable for real input.
    //
    // It is kept anyway because `polygonToCellsExperimental` is EXPERIMENTAL
    // upstream. This test is the tripwire: if a future h3 starts returning zero
    // for small polygons, this fails and tells the next reader that the
    // fallback has stopped being decorative.
    for (const metres of [10, 1, 0.1, 0.001]) {
      const d = metres / 2 / 111_320;
      const ring = [
        [51.5 - d, 7.5 - d],
        [51.5 - d, 7.5 + d],
        [51.5 + d, 7.5 + d],
        [51.5 - d, 7.5 - d],
      ] as [number, number][];
      const cells = polygonToCellsExperimental(
        [ring],
        AFFORDANCE_RES,
        POLYGON_TO_CELLS_FLAGS.containmentOverlapping,
      );
      expect(
        cells.length,
        `${metres} m square yielded no cells`,
      ).toBeGreaterThan(0);
    }
  });

  it("applies the sub-cell fallback to EVERY part of a multipolygon", () => {
    // The bug this was written against: the fallback tested the shared
    // accumulator (`cells.size === 0`), which is only ever empty while the
    // FIRST polygon is being processed. A multipolygon whose second part is
    // smaller than a cell — a courtyard outbuilding, a detached kiosk in a
    // mapped complex — got no cells and no fallback, which is precisely the
    // silent drop the guard exists to prevent.
    const bigRings = square(120).rings;
    const tinyFarAway: readonly (readonly { lat: number; lng: number }[])[] = [
      [
        { lat: 51.5, lng: 7.5 },
        { lat: 51.5, lng: 7.500004 },
        { lat: 51.500004, lng: 7.500004 },
        { lat: 51.5, lng: 7.5 },
      ],
    ];

    const covered = coverCells({
      kind: "multipolygon",
      polygons: [bigRings, tinyFarAway],
    });

    // The tiny second part must contribute its own cell, far from the first.
    const tinyCell = latLngToCell(51.5, 7.5, AFFORDANCE_RES);
    expect(covered.map((c) => c.cell)).toContain(tinyCell);
  });

  it("ignores a degenerate ring rather than throwing", () => {
    expect(
      coverCells({ kind: "polygon", rings: [[COLOGNE, COLOGNE]] }),
    ).toEqual([]);
  });
});

describe("linestrings — supercover, not vertex sampling", () => {
  it("covers a CONTIGUOUS run of cells between two distant nodes", () => {
    // The failure this prevents: OSM maps long straight roads as two nodes far
    // apart. Sampling vertices would register 2 cells for a 200 m road and leave
    // ~47 cells of road unscored — silently, and looking like unmapped ground.
    const start = COLOGNE;
    const end = { lat: COLOGNE.lat + 200 / 111_320, lng: COLOGNE.lng };

    const covered = coverCells({
      kind: "linestring",
      positions: [start, end],
    });

    expect(covered.length).toBeGreaterThan(20);
  });

  it("is contiguous: each cell is adjacent to another in the set", () => {
    const covered = coverCells({
      kind: "linestring",
      positions: [
        COLOGNE,
        { lat: COLOGNE.lat + 0.001, lng: COLOGNE.lng + 0.001 },
      ],
    });
    const cells = covered.map((c) => c.cell);
    expect(cells.length).toBeGreaterThan(2);

    for (const cell of cells) {
      const hasNeighbour = cells.some(
        (other) => other !== cell && gridDistance(cell, other) === 1,
      );
      expect(hasNeighbour).toBe(true);
    }
  });

  it("covers exactly one cell for a zero-length line", () => {
    expect(
      coverCells({ kind: "linestring", positions: [COLOGNE, COLOGNE] }),
    ).toHaveLength(1);
  });

  it("skips non-finite vertices without dropping the rest of the way", () => {
    const covered = coverCells({
      kind: "linestring",
      positions: [
        COLOGNE,
        { lat: Number.NaN, lng: Number.NaN },
        { lat: COLOGNE.lat + 0.0005, lng: COLOGNE.lng },
      ],
    });
    expect(covered.length).toBeGreaterThan(1);
  });
});

describe("multipolygons", () => {
  it("covers the union of its parts", () => {
    const a = square(40).rings;
    const far = {
      kind: "polygon" as const,
      rings: [
        [
          { lat: 51.0, lng: 7.0 },
          { lat: 51.0, lng: 7.001 },
          { lat: 51.001, lng: 7.001 },
          { lat: 51.0, lng: 7.0 },
        ],
      ],
    };

    const union = new Set(
      coverCells({ kind: "multipolygon", polygons: [a, far.rings] }).map(
        (c) => c.cell,
      ),
    );
    const partA = coverCells({ kind: "polygon", rings: a });
    const partB = coverCells(far);

    for (const c of [...partA, ...partB]) expect(union.has(c.cell)).toBe(true);
  });
});

describe("the coverage fraction is a placeholder, and says so", () => {
  it("is always exactly 1 in v1", () => {
    // NOT a computed value. The C# reference's overlap is binary — a 4 m cell
    // grazed by a 1 cm corner is vetoed exactly as hard as one entirely inside —
    // and carrying that flaw forward is what keeps its oracle values usable.
    // Asserted so that a future coverage-weighted mode has to change this test
    // deliberately rather than drift into existence.
    for (const c of coverCells(square(80))) expect(c.fraction).toBe(1);
    for (const c of coverCells({ kind: "point", position: COLOGNE })) {
      expect(c.fraction).toBe(1);
    }
  });
});

describe("results are duplicate-free", () => {
  it("returns each cell once even when parts overlap", () => {
    const rings = square(40).rings;
    const covered = coverCells({
      kind: "multipolygon",
      polygons: [rings, rings], // the same polygon twice
    });
    expect(new Set(covered.map((c) => c.cell)).size).toBe(covered.length);
  });
});

describe("helpers", () => {
  it("dilate grows a set by whole rings and stays duplicate-free", () => {
    const cell = latLngToCell(COLOGNE.lat, COLOGNE.lng, AFFORDANCE_RES);
    const grown = dilate([cell], 1);
    expect(grown).toHaveLength(7);
    expect(new Set(grown).size).toBe(7);
  });

  it("dilate by 0 is a deduplicating identity", () => {
    const cell = latLngToCell(COLOGNE.lat, COLOGNE.lng, AFFORDANCE_RES);
    expect(dilate([cell, cell], 0)).toEqual([cell]);
  });

  it("cellCentre round-trips back to the same cell", () => {
    const cell = latLngToCell(COLOGNE.lat, COLOGNE.lng, AFFORDANCE_RES);
    const centre = cellCentre(cell);
    expect(latLngToCell(centre.lat, centre.lng, AFFORDANCE_RES)).toBe(cell);
  });
});

describe("multilinestring coverage", () => {
  /**
   * WHY THIS TEST MATTERS. `coverCells`'s switch has no `default` and no
   * exhaustiveness assertion, so adding a geometry kind and forgetting a case
   * here does not fail to compile — it silently covers NOTHING, which is the
   * exact silent-drop failure the clipping work exists to prevent. Adding
   * `multilinestring` produced precisely that hazard, so it gets a test.
   */
  it("covers every run, and unions them", () => {
    const a: LatLng[] = [
      { lat: 50.94, lng: 6.95 },
      { lat: 50.9405, lng: 6.95 },
    ];
    const b: LatLng[] = [
      { lat: 50.95, lng: 6.96 },
      { lat: 50.9505, lng: 6.96 },
    ];

    const both = new Set(
      coverCells({ kind: "multilinestring", lines: [a, b] }).map((c) => c.cell),
    );
    const first = new Set(
      coverCells({ kind: "linestring", positions: a }).map((c) => c.cell),
    );
    const second = new Set(
      coverCells({ kind: "linestring", positions: b }).map((c) => c.cell),
    );

    expect(both.size).toBeGreaterThan(0);
    for (const cell of first) expect(both.has(cell)).toBe(true);
    for (const cell of second) expect(both.has(cell)).toBe(true);
  });

  it("does NOT cover the gap between two distant runs", () => {
    // The whole point of splitting runs: covering them as one sequence would
    // supercover the ~1 km gap, putting cells on ground the feature never
    // touched — which is the bug moved one module downstream.
    const near: LatLng[] = [
      { lat: 50.94, lng: 6.95 },
      { lat: 50.9401, lng: 6.95 },
    ];
    const far: LatLng[] = [
      { lat: 50.95, lng: 6.96 },
      { lat: 50.9501, lng: 6.96 },
    ];

    const split = coverCells({
      kind: "multilinestring",
      lines: [near, far],
    }).length;
    const joined = coverCells({
      kind: "linestring",
      positions: [...near, ...far],
    }).length;

    expect(split).toBeLessThan(joined);
  });
});
