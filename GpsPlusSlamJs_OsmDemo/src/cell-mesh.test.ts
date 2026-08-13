/**
 * Affordance cells as 3D geometry.
 *
 * Why these tests matter:
 * The 3D view showed buildings and nothing else, so the two panes disagreed
 * about what the app was even displaying (finding M3). Putting the grid in the
 * scene is only useful if it is the SAME grid: same cells, same colours, same
 * band rules as the map. A second colour path would let the two views disagree
 * about a cell's score, which is worse than the 3D view not showing it at all.
 *
 * The picking index is the other half. Without a triangle → cell mapping a
 * click in 3D can raycast a hexagon and still not know which cell it hit, and
 * the details panel would open on the wrong one — a confident wrong answer.
 *
 * @see cell-mesh.ts.md
 */

import { describe, it, expect } from "vitest";
import { enuFrameAt } from "gps-plus-slam-osm";
import type { CellScore } from "gps-plus-slam-osm";
import { cellToBoundary, latLngToCell } from "h3-js";

import { buildCellMesh } from "./cell-mesh.js";
import { fixedScale, HEAT_CAP } from "./heat-colours.js";
import { bandTreatment } from "./legend-model.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const FRAME = enuFrameAt(COLOGNE);
// FIXED (DEC-H5), as the app now is. The mesh derives prism height from the
// same fraction the colour uses, so a bench or a test on a different scale is
// measuring geometry the app never builds.
const SCALE = fixedScale(1);

const cellAt = (lat: number, lng: number, score: number): CellScore => ({
  cell: latLngToCell(lat, lng, 13),
  scores: { walkable: score },
  contributors: { walkable: {} },
});

const build = (cells: CellScore[], showBelow = false) =>
  buildCellMesh(cells, {
    frame: FRAME,
    category: "walkable",
    threshold: 1,
    scale: SCALE,
    showBelowThreshold: showBelow,
  });

describe("buildCellMesh", () => {
  it("emits one hexagon per drawn cell, as triangles", () => {
    const mesh = build([
      cellAt(50.9413, 6.9583, 4),
      cellAt(50.9414, 6.9584, 6),
    ]);
    // An H3 boundary is 6 corners, fanned into 4 triangles.
    expect(mesh.cells).toHaveLength(2);
    expect(mesh.indices.length / 3).toBe(2 * 4);
    expect(mesh.positions.length / 3).toBe(2 * 6);
  });

  it("indexes every triangle back to its cell, so a pick cannot land on the wrong one", () => {
    const cells = [cellAt(50.9413, 6.9583, 4), cellAt(50.9414, 6.9584, 6)];
    const mesh = build(cells);
    expect(mesh.cellForTriangle).toHaveLength(mesh.indices.length / 3);
    // The first four triangles belong to the first cell, the next four to the
    // second — the property a raycast's `faceIndex` is looked up against.
    expect(mesh.cellForTriangle[0]).toBe(cells[0]?.cell);
    expect(mesh.cellForTriangle[3]).toBe(cells[0]?.cell);
    expect(mesh.cellForTriangle[4]).toBe(cells[1]?.cell);
  });

  it("applies the SAME band rules as the map", () => {
    // Sub-threshold cells are hidden unless asked for, exactly as in 2D. Two
    // views disagreeing about which cells exist is the disagreement the shared
    // store was introduced to prevent.
    const cells = [cellAt(50.9413, 6.9583, 4), cellAt(50.9414, 6.9584, 0)];
    expect(build(cells).cells).toHaveLength(1);
    expect(build(cells, true).cells).toHaveLength(2);
  });

  it("colours a cell exactly as the 2D map does", () => {
    // Shared through `heatColour`, never a second ramp: a 3D cell that is a
    // different colour from its 2D twin makes the reader trust neither.
    //
    // THE SCORE HAD TO RISE FROM 8 TO THE CAP when the ramp was fixed (DEC-H5),
    // and that is the change showing through rather than a test being bent to
    // fit. Under the old derived scale this fixture's own maximum WAS 8, so 8
    // was the top of the ramp by construction; under a ramp that runs to 1e4
    // for everyone, 8 sits a quarter of the way up and is properly dark. To
    // assert "the top of the ramp is yellow" the cell now has to actually be at
    // the top.
    const mesh = build([cellAt(50.9413, 6.9583, HEAT_CAP)]);
    const [r, g, b] = [mesh.colors[0], mesh.colors[1], mesh.colors[2]];
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    // The top of the ramp is yellow: high red and green, low blue.
    expect(g ?? 0).toBeGreaterThan(b ?? 1);
  });

  it("gives every vertex of a hexagon the same colour", () => {
    // Per-vertex interpolation across one cell would imply a gradient inside a
    // cell, which is a claim about sub-cell variation the data does not make.
    // FOUR components per vertex since W13 — the alpha channel is how an
    // outline-treated cell keeps a face that is present for picking and
    // invisible on screen.
    const mesh = build([cellAt(50.9413, 6.9583, 4)]);
    const first = mesh.colors.slice(0, 4);
    for (let i = 1; i < 6; i++) {
      expect([...mesh.colors.slice(i * 4, i * 4 + 4)]).toEqual([...first]);
    }
  });

  it("returns empty geometry rather than throwing when nothing is drawn", () => {
    const mesh = build([]);
    expect(mesh.cells).toEqual([]);
    expect(mesh.indices).toHaveLength(0);
    expect(mesh.cellForTriangle).toHaveLength(0);
  });

  it("lays the grid just above the ground so it does not z-fight with it", () => {
    const mesh = build([cellAt(50.9413, 6.9583, 4)]);
    for (let i = 1; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i]).toBeGreaterThan(0);
      expect(mesh.positions[i]).toBeLessThan(1);
    }
  });
});

describe("cells whose H3 boundary is not six corners", () => {
  /**
   * WHY THIS MATTERS. `cellToBoundary` is documented in this file as "usually 6
   * corners but can be 5 at a pentagon", and the buffer stride was built on
   * that. It is only half the story: a cell straddling an icosahedron EDGE gets
   * extra vertices where the distortion is resolved — 7 is ordinary within a
   * ring or two of the 12 pentagons, and a pentagon itself comes back with 10.
   *
   * Under a fixed 6-corner stride those cells were silently truncated to their
   * first six corners, so the hexagon drawn was not the cell's footprint and
   * the pick region was wrong along the clipped edge. Nothing threw and nothing
   * looked broken — the cells are still cells, just the wrong shape, in a view
   * whose entire job is to be checked against the real world by eye.
   */
  const distorted = (id: string, score: number): CellScore => ({
    cell: id,
    scores: { walkable: score },
    contributors: { walkable: {} },
  });

  /** A res-13 cell one ring from a pentagon: `cellToBoundary` returns 7. */
  const SEVEN_CORNER = "8d080000000017f";
  /** A res-13 pentagon itself: `cellToBoundary` returns 10. */
  const TEN_CORNER = "8d080000000003f";

  it("draws EVERY corner of a 7-corner cell, not the first six", () => {
    const boundary = cellToBoundary(SEVEN_CORNER);
    expect(boundary).toHaveLength(7);

    const mesh = buildCellMesh([distorted(SEVEN_CORNER, 4)], {
      frame: enuFrameAt({
        lat: boundary[0]?.[0] ?? 0,
        lng: boundary[0]?.[1] ?? 0,
      }),
      category: "walkable",
      threshold: 1,
      scale: SCALE,
      showBelowThreshold: false,
    });

    // One vertex per real corner, and a fan of `n - 2` triangles over them.
    expect(mesh.positions.length / 3).toBe(7);
    expect(mesh.indices.length / 3).toBe(5);
    expect(mesh.cellForTriangle).toHaveLength(5);
  });

  it("draws a pentagon's 10-corner boundary in full", () => {
    const boundary = cellToBoundary(TEN_CORNER);
    expect(boundary).toHaveLength(10);

    const mesh = buildCellMesh([distorted(TEN_CORNER, 4)], {
      frame: enuFrameAt({
        lat: boundary[0]?.[0] ?? 0,
        lng: boundary[0]?.[1] ?? 0,
      }),
      category: "walkable",
      threshold: 1,
      scale: SCALE,
      showBelowThreshold: false,
    });

    expect(mesh.positions.length / 3).toBe(10);
    expect(mesh.indices.length / 3).toBe(8);
  });

  it("keeps the triangle index aligned across a MIX of corner counts", () => {
    // The reason a fixed stride was tempting: `cellForTriangle` and the vertex
    // offsets both derive from it. With ragged cells the offsets have to be
    // accumulated, and getting that wrong sends a raycast to the wrong cell —
    // a confidently wrong details panel, which is worse than no panel.
    const ordinary = latLngToCell(50.9413, 6.9583, 13);
    const mesh = buildCellMesh(
      [distorted(SEVEN_CORNER, 4), distorted(ordinary, 6)],
      {
        frame: FRAME,
        category: "walkable",
        threshold: 1,
        scale: SCALE,
        showBelowThreshold: false,
      },
    );

    expect(mesh.positions.length / 3).toBe(7 + 6);
    expect(mesh.cellForTriangle).toHaveLength(5 + 4);
    expect(mesh.cellForTriangle.slice(0, 5)).toEqual(
      Array(5).fill(SEVEN_CORNER),
    );
    expect(mesh.cellForTriangle.slice(5)).toEqual(Array(4).fill(ordinary));

    // Every index must address a vertex that exists — the arithmetic a fixed
    // stride made trivial and an accumulated offset does not.
    for (const index of mesh.indices) {
      expect(index).toBeLessThan(mesh.positions.length / 3);
    }
  });
});

describe("the bands mean the same thing in both views (W13, finding R3-8)", () => {
  /**
   * Why these tests matter:
   * The reported symptom was that "show cells below the threshold" does nothing.
   * The switch was wired correctly the whole time; what it revealed was
   * invisible. In 3D every sub-threshold cell was painted through `heatColour`,
   * which returns the ramp's DARKEST stop for anything at or below the
   * threshold — so a veto, an identity and a below-bar cell were one near-black
   * colour over dark ground, while the map drew them red, dashed-outline and
   * dim. This file's own comment claimed both views applied the same rule; that
   * was true of which cells are drawn and false of what they look like.
   */
  const AT = { lat: 50.9413, lng: 6.9583 };

  /** A cell scoring exactly `score` for the drawn category. */
  const scored = (score: number) => cellAt(AT.lat, AT.lng, score);

  it("paints a veto in the map's veto colour, not at the ramp's floor", () => {
    const mesh = build([scored(0)], true);
    const treatment = bandTreatment("veto", 0, { threshold: 1, max: 8 });
    const expected = Number.parseInt(treatment.colour.slice(1), 16);

    expect(Math.round((mesh.colors[0] ?? 0) * 255)).toBe(
      (expected >> 16) & 0xff,
    );
    expect(Math.round((mesh.colors[1] ?? 0) * 255)).toBe(
      (expected >> 8) & 0xff,
    );
    expect(Math.round((mesh.colors[2] ?? 0) * 255)).toBe(expected & 0xff);
  });

  it("draws an identity cell as an OUTLINE, with no visible face", () => {
    // DEC-R3-16: the unfilledness IS the statement, and a solid hexagon cannot
    // make it. The face survives at alpha 0 — see the next test for why.
    const mesh = build([scored(1)], true);

    expect(mesh.linePositions.length).toBeGreaterThan(0);
    for (let i = 3; i < mesh.colors.length; i += 4) {
      expect(mesh.colors[i]).toBe(0);
    }
  });

  it("keeps the identity cell PICKABLE, which DEC-7 requires", () => {
    // DEC-R3-21. Picking resolves `faceIndex` against these triangles, so an
    // outline with no face would make identity the one band that cannot be
    // clicked — while `veto`, a fill, still could. DEC-7's stated reason for
    // revealing sub-threshold cells at all is that a hidden cell is the one cell
    // you cannot click to ask why, so losing it for one band is this round's own
    // finding in a new place.
    const mesh = build([scored(1)], true);

    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.cellForTriangle.length).toBeGreaterThan(0);
    expect(new Set(mesh.cellForTriangle).size).toBe(1);
  });

  it("gives a mixed snapshot more than one colour", () => {
    // The assertion that would have caught the defect. A "cells were added" test
    // passes with every one of them painted the same near-black.
    const mesh = build(
      [
        cellAt(AT.lat, AT.lng, 0),
        cellAt(AT.lat + 0.0004, AT.lng, 1),
        cellAt(AT.lat + 0.0008, AT.lng, 8),
      ],
      true,
    );

    const distinct = new Set<string>();
    for (let i = 0; i < mesh.colors.length; i += 4) {
      distinct.add(
        [mesh.colors[i], mesh.colors[i + 1], mesh.colors[i + 2]].join(","),
      );
    }
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("draws no outlines at all when nothing is outline-treated", () => {
    // The common case: above-threshold cells are fills, so the line buffers stay
    // empty and the view adds no second object.
    const mesh = build([scored(8)]);
    expect(mesh.linePositions).toHaveLength(0);
  });
});
