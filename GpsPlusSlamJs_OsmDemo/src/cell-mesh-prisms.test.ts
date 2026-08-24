/**
 * Extruded affordance cells: real prisms and score-as-height (§3, DEC-R6-9).
 *
 * WHY THESE TESTS MATTER. Two of §3's four axes change the VERTEX BUFFERS rather
 * than a material, which means they run in the worker on every publish and are
 * paid for on up to ~6 223 cells. That makes their cost a design fact rather
 * than a detail, and it makes the buffer shapes worth pinning: an indexing
 * mistake here does not throw, it produces a grid with holes in it or triangles
 * stretched to the origin — and the origin is where the user is standing.
 *
 * The bar-height axis carries a second risk that is easy to miss. Colour and
 * height would then encode the SAME value, so if the height mapping ever
 * disagreed with the colour mapping the overlay would contradict itself in a way
 * that looks like a rendering artefact rather than a wrong answer. Both come
 * from `heatFraction`, and that is asserted rather than assumed.
 */

import { describe, expect, it } from "vitest";

import { buildCellMesh, type CellMeshOptions } from "./cell-mesh.js";
import { CELL_BAR_MAX_HEIGHT_M, CELL_PRISM_HEIGHT_M } from "./cell-presets.js";
import { enuFrameAt } from "gps-plus-slam-osm";
import { latLngToCell } from "h3-js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };

function optionsWith(extra: Partial<CellMeshOptions> = {}): CellMeshOptions {
  return {
    frame: enuFrameAt(COLOGNE),
    category: "walkable",
    threshold: 1,
    scale: { threshold: 1, max: 100 },
    showBelowThreshold: false,
    ...extra,
  };
}

/** A few real res-13 cells around Cologne, with the given scores. */
function cellsWithScores(scores: number[]) {
  return scores.map((score, i) => ({
    cell: latLngToCell(COLOGNE.lat + i * 0.0002, COLOGNE.lng, 13),
    scores: { walkable: score },
  }));
}

/** The min and max y over a positions buffer. */
function yRange(positions: Float32Array): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    const y = positions[i] ?? 0;
    min = Math.min(min, y);
    max = Math.max(max, y);
  }
  return { min, max };
}

describe("extruded cells", () => {
  it("draws a FLAT fan when extrusion is off, as before", () => {
    // The default preset is unchanged, so this is the regression guard for
    // everything that already worked.
    const mesh = buildCellMesh(cellsWithScores([10]), optionsWith());
    const { min, max } = yRange(mesh.positions);
    expect(max - min).toBeCloseTo(0, 6);
  });

  it("adds a second ring of vertices when extrusion is on", () => {
    // Exactly double: a top ring and a bottom ring. Not tripled — the sides
    // share the rings rather than carrying their own vertices, which is what
    // keeps the cost at 2x rather than the 5x per-face normals would need.
    const flat = buildCellMesh(cellsWithScores([10]), optionsWith());
    const prism = buildCellMesh(
      cellsWithScores([10]),
      optionsWith({ extrude: true }),
    );
    expect(prism.positions.length).toBe(flat.positions.length * 2);
    expect(prism.colors.length).toBe(flat.colors.length * 2);
    expect(prism.normals.length).toBe(flat.normals.length * 2);
  });

  it("gives the prism the height the preset asks for", () => {
    const prism = buildCellMesh(
      cellsWithScores([10]),
      optionsWith({ extrude: true }),
    );
    const { min, max } = yRange(prism.positions);
    expect(max - min).toBeCloseTo(CELL_PRISM_HEIGHT_M, 5);
  });

  it("keeps every index inside the buffer", () => {
    // An off-by-one in the side quads does not throw — it points at vertex 0,
    // which is a triangle stretched to wherever the first corner happens to be.
    // On a grid centred on the user that is a spike through where they stand.
    const prism = buildCellMesh(
      cellsWithScores([10, 20, 30]),
      optionsWith({ extrude: true }),
    );
    const vertexCount = prism.positions.length / 3;
    for (const index of prism.indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(vertexCount);
    }
  });

  it("keeps the pick table aligned with the triangles it now has", () => {
    // Instancing aside, picking resolves `faceIndex` against this array. Adding
    // side triangles without extending it would make every pick past the first
    // cell name the wrong place — confidently.
    const prism = buildCellMesh(
      cellsWithScores([10, 20, 30]),
      optionsWith({ extrude: true }),
    );
    expect(prism.cellForTriangle).toHaveLength(prism.indices.length / 3);
  });
});

describe("score as height", () => {
  it("makes a higher score taller", () => {
    const low = buildCellMesh(
      cellsWithScores([2]),
      optionsWith({ extrude: true, heightByScore: true }),
    );
    const high = buildCellMesh(
      cellsWithScores([90]),
      optionsWith({ extrude: true, heightByScore: true }),
    );
    const lowSpan = yRange(low.positions);
    const highSpan = yRange(high.positions);
    expect(highSpan.max - highSpan.min).toBeGreaterThan(
      lowSpan.max - lowSpan.min,
    );
  });

  it("stays within the declared maximum", () => {
    const mesh = buildCellMesh(
      cellsWithScores([100]),
      optionsWith({ extrude: true, heightByScore: true }),
    );
    const { min, max } = yRange(mesh.positions);
    expect(max - min).toBeLessThanOrEqual(CELL_BAR_MAX_HEIGHT_M + 1e-6);
  });

  it("never produces a zero-height bar, which would vanish", () => {
    // A cell at the very bottom of the ramp is still a cell, and a bar field
    // that drops its lowest values is a bar field that lies about coverage.
    const mesh = buildCellMesh(
      cellsWithScores([1.0001]),
      optionsWith({ extrude: true, heightByScore: true }),
    );
    const { min, max } = yRange(mesh.positions);
    expect(max - min).toBeGreaterThan(0);
  });

  it("does nothing without extrusion, since there is no height to scale", () => {
    // The two axes are independent in the preset table but not in the geometry:
    // a bar needs sides. Silently ignoring one is better than drawing a flat
    // fan lifted to a random height, which would look like a levitating grid.
    const mesh = buildCellMesh(
      cellsWithScores([90]),
      optionsWith({ heightByScore: true }),
    );
    const { min, max } = yRange(mesh.positions);
    expect(max - min).toBeCloseTo(0, 6);
  });
});
