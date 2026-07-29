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
import { heatScale } from "./heat-colours.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const FRAME = enuFrameAt(COLOGNE);
const SCALE = heatScale([1, 8], 1);

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
    const mesh = build([cellAt(50.9413, 6.9583, 8)]);
    const [r, g, b] = [mesh.colors[0], mesh.colors[1], mesh.colors[2]];
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    // The top of the ramp is yellow: high red and green, low blue.
    expect(g ?? 0).toBeGreaterThan(b ?? 1);
  });

  it("gives every vertex of a hexagon the same colour", () => {
    // Per-vertex interpolation across one cell would imply a gradient inside a
    // cell, which is a claim about sub-cell variation the data does not make.
    const mesh = build([cellAt(50.9413, 6.9583, 4)]);
    const first = mesh.colors.slice(0, 3);
    for (let i = 1; i < 6; i++) {
      expect([...mesh.colors.slice(i * 3, i * 3 + 3)]).toEqual([...first]);
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
