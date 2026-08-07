/**
 * Geometry-clipping tests.
 *
 * Why these tests matter:
 * This module exists because of a real hang, not a review comment. Indexing the
 * `beach` fixture — one element containing the entire North Sea — attempted a
 * res-13 cover on the order of 10^10 cells and never finished. Clipping to the
 * area of interest first is what makes coverage cost proportional to the working
 * set instead of to the feature.
 *
 * So the assertions below are less about geometric elegance than about two
 * operational guarantees: **nothing inside the box is ever lost**, and
 * **something enormous outside it is cheap**.
 *
 * @see clip.ts.md
 */

import { describe, it, expect } from "vitest";
import {
  clipToBbox,
  boundsOf,
  positionsOf,
  padBbox,
  metresToDegrees,
  bboxesIntersect,
} from "./clip.js";
import { coverCells } from "./cell-coverage.js";
import type { OsmGeometry } from "../model/osm-geometry.js";
import type { LatLng } from "../model/osm-feature.js";
import type { Bbox } from "./clip.js";

const BOX = { south: 50.0, west: 6.0, north: 51.0, east: 7.0 };

describe("points", () => {
  it("keeps a point inside the box", () => {
    const g: OsmGeometry = { kind: "point", position: { lat: 50.5, lng: 6.5 } };
    expect(clipToBbox(g, BOX)).toBe(g);
  });

  it("drops a point outside, returning undefined rather than an empty shape", () => {
    // `undefined` so the caller's `continue` is unambiguous — an empty geometry
    // would have to be re-checked downstream and one caller would forget.
    expect(
      clipToBbox({ kind: "point", position: { lat: 10, lng: 10 } }, BOX),
    ).toBeUndefined();
  });

  it("keeps a point exactly on the boundary", () => {
    // Inclusive bounds: excluding them would drop features on a tile edge, and
    // tile edges are where the border problem already lives.
    expect(
      clipToBbox({ kind: "point", position: { lat: 50.0, lng: 6.0 } }, BOX),
    ).toBeDefined();
  });
});

describe("polygons", () => {
  it("returns a polygon entirely inside unchanged in extent", () => {
    const g: OsmGeometry = {
      kind: "polygon",
      rings: [
        [
          { lat: 50.4, lng: 6.4 },
          { lat: 50.4, lng: 6.6 },
          { lat: 50.6, lng: 6.6 },
          { lat: 50.4, lng: 6.4 },
        ],
      ],
    };
    const clipped = clipToBbox(g, BOX);
    expect(clipped?.kind).toBe("polygon");
    expect(boundsOf(positionsOf(clipped!))).toEqual(boundsOf(positionsOf(g)));
  });

  it("CLIPS a polygon far larger than the box down to the box", () => {
    // The North Sea case, in miniature. The output must be bounded by the box
    // (plus nothing), which is the property that makes covering it affordable.
    const continental: OsmGeometry = {
      kind: "polygon",
      rings: [
        [
          { lat: 0, lng: -30 },
          { lat: 0, lng: 30 },
          { lat: 70, lng: 30 },
          { lat: 70, lng: -30 },
          { lat: 0, lng: -30 },
        ],
      ],
    };

    const clipped = clipToBbox(continental, BOX);
    expect(clipped).toBeDefined();

    const bounds = boundsOf(positionsOf(clipped!))!;
    expect(bounds.south).toBeGreaterThanOrEqual(BOX.south - 1e-9);
    expect(bounds.north).toBeLessThanOrEqual(BOX.north + 1e-9);
    expect(bounds.west).toBeGreaterThanOrEqual(BOX.west - 1e-9);
    expect(bounds.east).toBeLessThanOrEqual(BOX.east + 1e-9);
  });

  it("makes covering a continental feature affordable", () => {
    // The operational point, asserted as a cell count rather than a timing so it
    // cannot flake. Unclipped this is ~10^10 cells; clipped to a small box it is
    // a number a test can hold.
    const continental: OsmGeometry = {
      kind: "polygon",
      rings: [
        [
          { lat: 0, lng: -30 },
          { lat: 0, lng: 30 },
          { lat: 70, lng: 30 },
          { lat: 70, lng: -30 },
          { lat: 0, lng: -30 },
        ],
      ],
    };
    const small = { south: 50.5, west: 6.5, north: 50.502, east: 6.502 };
    const clipped = clipToBbox(continental, small)!;

    const cells = coverCells(clipped, 11);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(5_000);
  });

  it("drops a polygon entirely outside", () => {
    expect(
      clipToBbox(
        {
          kind: "polygon",
          rings: [
            [
              { lat: 10, lng: 10 },
              { lat: 10, lng: 11 },
              { lat: 11, lng: 11 },
              { lat: 10, lng: 10 },
            ],
          ],
        },
        BOX,
      ),
    ).toBeUndefined();
  });

  it("keeps holes that survive, and drops those that do not", () => {
    const outer = [
      { lat: 50.2, lng: 6.2 },
      { lat: 50.2, lng: 6.8 },
      { lat: 50.8, lng: 6.8 },
      { lat: 50.8, lng: 6.2 },
      { lat: 50.2, lng: 6.2 },
    ];
    const insideHole = [
      { lat: 50.4, lng: 6.4 },
      { lat: 50.4, lng: 6.5 },
      { lat: 50.5, lng: 6.5 },
      { lat: 50.4, lng: 6.4 },
    ];
    const clipped = clipToBbox(
      { kind: "polygon", rings: [outer, insideHole] },
      BOX,
    );
    expect(clipped?.kind).toBe("polygon");
    if (clipped?.kind !== "polygon") throw new Error("expected a polygon");
    expect(clipped.rings).toHaveLength(2);
  });

  it("drops a ring that clips to fewer than three points", () => {
    // A degenerate remainder is not a polygon and must not be handed to h3.
    expect(
      clipToBbox(
        {
          kind: "polygon",
          rings: [
            [
              { lat: 50.5, lng: 6.5 },
              { lat: 50.5, lng: 6.6 },
            ],
          ],
        },
        BOX,
      ),
    ).toBeUndefined();
  });
});

describe("linestrings", () => {
  it("keeps the crossing segment, not just the inside vertices", () => {
    // Deliberately coarse: one vertex either side of the boundary is kept, so
    // the supercover rasteriser still fills the crossing. Under-keeping would
    // lose road; over-keeping costs a few cells that are then filtered.
    const clipped = clipToBbox(
      {
        kind: "linestring",
        positions: [
          { lat: 49.0, lng: 6.5 }, // outside
          { lat: 50.5, lng: 6.5 }, // inside
          { lat: 52.0, lng: 6.5 }, // outside
        ],
      },
      BOX,
    );
    expect(clipped?.kind).toBe("linestring");
    if (clipped?.kind !== "linestring") throw new Error("expected a line");
    expect(clipped.positions).toHaveLength(3);
  });

  it("KEEPS a segment that crosses the box with no vertex anywhere near it", () => {
    // The bug this test was written against: `clipLine` kept a vertex only if
    // it, its predecessor or its successor was INSIDE the box. For a two-node
    // segment straddling the box, none of those three tests passes, so the
    // whole way was dropped — `clipToBbox` returned undefined and
    // `buildFeatureIndex` skipped the feature entirely.
    //
    // That is the exact case `cell-coverage.ts` calls out as ordinary in OSM:
    // long straight ways mapped as two distant nodes. A motorway, railway,
    // river or power line crossing the user's working set contributed NO cells
    // and scored the multiplicative identity — a silent scoring hole, and the
    // one failure mode this package works hardest to avoid.
    const clipped = clipToBbox(
      {
        kind: "linestring",
        positions: [
          { lat: 50.5, lng: 5.0 }, // well west of the box
          { lat: 50.5, lng: 8.0 }, // well east of it
        ],
      },
      BOX,
    );

    expect(clipped).toBeDefined();
    expect(clipped?.kind).toBe("linestring");
    if (clipped?.kind !== "linestring") throw new Error("expected a line");
    expect(clipped.positions.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps a crossing segment for every axis, not just longitude", () => {
    // Guards a fix that only handled one pair of edges.
    const cases: [string, { lat: number; lng: number }[]][] = [
      [
        "north-south",
        [
          { lat: 48.0, lng: 6.5 },
          { lat: 53.0, lng: 6.5 },
        ],
      ],
      [
        "diagonal",
        [
          { lat: 48.0, lng: 4.0 },
          { lat: 53.0, lng: 9.0 },
        ],
      ],
    ];
    for (const [label, positions] of cases) {
      const clipped = clipToBbox({ kind: "linestring", positions }, BOX);
      expect(clipped, `${label} crossing was dropped`).toBeDefined();
    }
  });

  it("a crossing way still produces cells all the way through the box", () => {
    // The consequence-level assertion: not merely "kept", but actually covering
    // the ground it crosses, which is what scoring depends on.
    const clipped = clipToBbox(
      {
        kind: "linestring",
        positions: [
          { lat: 50.5, lng: 5.0 },
          { lat: 50.5, lng: 8.0 },
        ],
      },
      { south: 50.49, west: 6.5, north: 50.51, east: 6.52 },
    )!;
    const cells = coverCells(clipped, 11);
    expect(cells.length).toBeGreaterThan(1);
  });

  it("drops a line entirely outside", () => {
    expect(
      clipToBbox(
        {
          kind: "linestring",
          positions: [
            { lat: 10, lng: 10 },
            { lat: 11, lng: 11 },
          ],
        },
        BOX,
      ),
    ).toBeUndefined();
  });
});

describe("multipolygons", () => {
  it("keeps only the parts that survive", () => {
    const inside = [
      [
        { lat: 50.4, lng: 6.4 },
        { lat: 50.4, lng: 6.6 },
        { lat: 50.6, lng: 6.6 },
        { lat: 50.4, lng: 6.4 },
      ],
    ];
    const outside = [
      [
        { lat: 10, lng: 10 },
        { lat: 10, lng: 11 },
        { lat: 11, lng: 11 },
        { lat: 10, lng: 10 },
      ],
    ];

    const clipped = clipToBbox(
      { kind: "multipolygon", polygons: [inside, outside] },
      BOX,
    );
    expect(clipped?.kind).toBe("multipolygon");
    if (clipped?.kind !== "multipolygon") throw new Error("expected a multi");
    expect(clipped.polygons).toHaveLength(1);
  });

  it("drops a multipolygon with nothing left", () => {
    expect(
      clipToBbox(
        {
          kind: "multipolygon",
          polygons: [
            [
              [
                { lat: 10, lng: 10 },
                { lat: 10, lng: 11 },
                { lat: 11, lng: 11 },
                { lat: 10, lng: 10 },
              ],
            ],
          ],
        },
        BOX,
      ),
    ).toBeUndefined();
  });
});

describe("bbox helpers", () => {
  it("boundsOf ignores non-finite coordinates", () => {
    expect(
      boundsOf([
        { lat: 50, lng: 6 },
        { lat: Number.NaN, lng: 6 },
        { lat: 51, lng: 7 },
      ]),
    ).toEqual({ south: 50, west: 6, north: 51, east: 7 });
  });

  it("boundsOf returns undefined when nothing is usable", () => {
    expect(boundsOf([])).toBeUndefined();
    expect(boundsOf([{ lat: Number.NaN, lng: Number.NaN }])).toBeUndefined();
  });

  it("padBbox grows on every side", () => {
    expect(padBbox({ south: 0, west: 0, north: 1, east: 1 }, 0.5)).toEqual({
      south: -0.5,
      west: -0.5,
      north: 1.5,
      east: 1.5,
    });
  });

  it("bboxesIntersect is true for touching boxes and false for disjoint ones", () => {
    const a = { south: 0, west: 0, north: 1, east: 1 };
    expect(bboxesIntersect(a, { south: 1, west: 1, north: 2, east: 2 })).toBe(
      true,
    );
    expect(bboxesIntersect(a, { south: 2, west: 2, north: 3, east: 3 })).toBe(
      false,
    );
  });

  it("positionsOf visits every kind of geometry", () => {
    expect([
      ...positionsOf({ kind: "point", position: { lat: 1, lng: 2 } }),
    ]).toHaveLength(1);
    expect([
      ...positionsOf({
        kind: "linestring",
        positions: [
          { lat: 1, lng: 2 },
          { lat: 3, lng: 4 },
        ],
      }),
    ]).toHaveLength(2);
    expect([
      ...positionsOf({
        kind: "multipolygon",
        polygons: [[[{ lat: 1, lng: 2 }]], [[{ lat: 3, lng: 4 }]]],
      }),
    ]).toHaveLength(2);
  });
});

describe("a way that leaves the box and comes back", () => {
  /**
   * WHY THIS TEST MATTERS — it pins the difference between "coarse" and
   * "fabricated".
   *
   * `clipLine` keeps whole segments, which deliberately over-keeps a little:
   * the extra vertices produce cells just outside the working set, and those
   * are filtered downstream. That is the documented, safe kind of imprecision.
   *
   * Flattening the kept vertices into ONE linestring is a different thing
   * entirely. A ring road that exits the box east, loops away north, and
   * re-enters west keeps indices {0,1,3,4}; joined into one line that is
   * `[p0,p1,p3,p4]`, containing the chord `p1→p3` — a segment the way never
   * had, running straight across the middle of the box. `addLineString`
   * supercovers every consecutive pair, so that chord becomes cells INSIDE the
   * working set, where nothing filters them. The feature then vetoes ground it
   * never crossed, which is indistinguishable from real data.
   */
  const box: Bbox = { south: 50.0, west: 6.0, north: 51.0, east: 7.0 };

  /**
   * Crosses the box, loops away north where NO segment touches it, and comes
   * back in. Every intermediate segment is trivially rejected by
   * Cohen-Sutherland (both endpoints share an outside region), so the kept
   * index set has a hole in it: {0,1,2, 5,6}.
   *
   * Getting this fixture right is the whole test. A first attempt ended outside
   * the box, so the last segment was rejected too, the kept set stayed
   * contiguous at {0,1,2}, and the assertion passed against the bug.
   */
  const detour: LatLng[] = [
    { lat: 50.5, lng: 5.5 }, // 0 outside, west
    { lat: 50.5, lng: 6.5 }, // 1 INSIDE
    { lat: 50.5, lng: 7.5 }, // 2 outside, east
    { lat: 52.0, lng: 7.5 }, // 3 north-east, seg 2-3 shares EAST
    { lat: 52.0, lng: 5.5 }, // 4 north-west, seg 3-4 shares NORTH
    { lat: 50.5, lng: 5.5 }, // 5 outside west, seg 4-5 shares WEST
    { lat: 50.5, lng: 6.5 }, // 6 INSIDE again — seg 5-6 touches
  ];

  it("does not invent a segment between the parts it kept", () => {
    const clipped = clipToBbox({ kind: "linestring", positions: detour }, box);
    expect(clipped).toBeDefined();

    // Whatever shape the result takes, no PART of it may contain two positions
    // that were not adjacent in the original way.
    const parts =
      clipped?.kind === "linestring"
        ? [clipped.positions]
        : clipped?.kind === "multilinestring"
          ? clipped.lines
          : [];
    expect(parts.length).toBeGreaterThan(0);

    const indexOf = (p: LatLng) =>
      detour.findIndex((q) => q.lat === p.lat && q.lng === p.lng);
    for (const part of parts) {
      for (let i = 0; i + 1 < part.length; i++) {
        const a = indexOf(part[i]!);
        const b = indexOf(part[i + 1]!);
        // Consecutive in the clipped part must mean consecutive in the way.
        expect(Math.abs(b - a)).toBe(1);
      }
    }
  });

  it("keeps both crossings rather than dropping one", () => {
    // The over-keeping contract still holds: both real traversals survive.
    const clipped = clipToBbox({ kind: "linestring", positions: detour }, box);
    const parts =
      clipped?.kind === "linestring"
        ? [clipped.positions]
        : clipped?.kind === "multilinestring"
          ? clipped.lines
          : [];
    const kept = parts.flat();
    expect(kept).toContainEqual({ lat: 50.5, lng: 6.5 });
    expect(kept.length).toBeGreaterThanOrEqual(3);
  });
});

describe("metresToDegrees (PR #236 — one definition, not two)", () => {
  /**
   * Why these tests matter: this arithmetic existed twice — once in
   * `cellPaddingDegrees` and once in the demo worker's plate-clip box, each with
   * its own `111_320`. Both now call this, so it needs its own gate rather than
   * being covered incidentally through two callers.
   */
  it("converts latitude by the metres-per-degree constant", () => {
    expect(metresToDegrees(0, 111_320).lat).toBeCloseTo(1, 9);
    expect(metresToDegrees(50, 1_113.2).lat).toBeCloseTo(0.01, 9);
  });

  it("makes longitude degrees GROW away from the equator, for the same distance", () => {
    // The whole reason the two axes cannot share one number: 1 km is more
    // degrees of longitude at 60N than at the equator, by exactly 1/cos.
    const atEquator = metresToDegrees(0, 1000);
    const atSixty = metresToDegrees(60, 1000);

    expect(atEquator.lng).toBeCloseTo(atEquator.lat, 9);
    expect(atSixty.lng).toBeCloseTo(atSixty.lat / Math.cos(Math.PI / 3), 9);
    expect(atSixty.lng).toBeGreaterThan(atEquator.lng * 1.9);
  });

  it("is sign-independent in latitude — the southern hemisphere is not narrower", () => {
    expect(metresToDegrees(-60, 1000).lng).toBeCloseTo(
      metresToDegrees(60, 1000).lng,
      9,
    );
  });

  it("degrades to a HUGE box at the pole rather than dividing by zero", () => {
    // cos(90 deg) is ~6.1e-17 in floating point rather than 0, so this stays
    // finite. Over-keeping is the safe direction: a box that keeps everything
    // costs time, while a box that collapsed would silently drop geometry.
    const atPole = metresToDegrees(90, 1000);
    expect(Number.isFinite(atPole.lng)).toBe(true);
    expect(atPole.lng).toBeGreaterThan(1e12);
  });

  it("never returns a NEGATIVE longitude margin, however far past the pole it is asked (PR #237)", () => {
    // WHY THIS TEST MATTERS. Callers pass the POLEWARD EDGE of a box, not its
    // centre — the docstring above asks them to — and that edge is computed as
    // `|centre| + halfWidth`, which sails past 90 for a box near the pole.
    // Beyond 90 `cos` turns NEGATIVE, so the margin inverts: `west` ends up east
    // of `east` and the clip keeps nothing. That is precisely the silent
    // geometry loss this function's "degrades safely, over-keeps" contract
    // exists to rule out, and it is invisible everywhere else — an empty result
    // reads as "no OSM data here", which near the poles is entirely plausible.
    for (const latitude of [90.0001, 91, 120, 180, 270, -95]) {
      const margin = metresToDegrees(latitude, 1000);
      expect(margin.lng).toBeGreaterThan(0);
      expect(Number.isFinite(margin.lng)).toBe(true);
    }
    // And clamping, not wrapping: past the pole it is at least as generous as AT
    // the pole, so the safe direction stays the safe direction.
    expect(metresToDegrees(95, 1000).lng).toBeGreaterThanOrEqual(
      metresToDegrees(90, 1000).lng,
    );
  });
});
