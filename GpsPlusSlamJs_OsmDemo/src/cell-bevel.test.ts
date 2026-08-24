import { describe, expect, it } from "vitest";

import { bevelNormals, BEVEL_STRENGTH } from "./cell-bevel.js";

/**
 * The faked bevel on affordance cells (DEC-S2).
 *
 * WHY THESE TESTS MATTER. The cells are flat hexagons and are going to stay flat
 * — real extrusion would be ~3x the vertices on up to 6223 cells, rebuilt on
 * every publish. DEC-S2 buys the edge highlight instead by LYING about the
 * normals: each corner's normal leans outward, so the tile shades as though its
 * rim were bevelled and a specular highlight sweeps across it as the camera
 * orbits.
 *
 * A lie needs a bound, and that bound is what these tests are. The failure mode
 * is not "it looks wrong" — it is that a cell picks up a NET tilt and reads as a
 * sloped tile, which in a view whose whole job is showing ground-level scores
 * would be a picture that lies about the terrain. The symmetry assertion below
 * is the one that stops that, and it is the reason the tilt is applied around
 * the centroid rather than per-corner in isolation.
 */

/** A regular hexagon of radius `r` in the XZ plane, at height `y`. */
function hexagon(r: number, y = 0): { x: number; y: number; z: number }[] {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (i / 6) * Math.PI * 2;
    return { x: Math.cos(angle) * r, y, z: Math.sin(angle) * r };
  });
}

const lengthOf = (n: number[], i: number): number =>
  Math.hypot(n[i * 3] ?? 0, n[i * 3 + 1] ?? 0, n[i * 3 + 2] ?? 0);

describe("bevelNormals", () => {
  it("returns one unit normal per corner", () => {
    const normals = bevelNormals(hexagon(4));
    expect(normals).toHaveLength(18);
    for (let i = 0; i < 6; i += 1) {
      expect(lengthOf(normals, i)).toBeCloseTo(1, 6);
    }
  });

  it("leans every corner AWAY from the cell centre", () => {
    // The bevel reads as a rim only if the lean is outward. Leaning inward would
    // make each tile a shallow bowl, which catches the light in the opposite
    // place and reads as a dent rather than an edge.
    const corners = hexagon(4);
    const normals = bevelNormals(corners);
    corners.forEach((corner, i) => {
      const outward = Math.hypot(corner.x, corner.z);
      const nx = normals[i * 3] ?? 0;
      const nz = normals[i * 3 + 2] ?? 0;
      // Dot of the horizontal normal with the outward direction, both non-zero.
      const dot = (nx * corner.x + nz * corner.z) / outward;
      expect(dot).toBeGreaterThan(0);
    });
  });

  it("keeps every normal pointing UP overall", () => {
    // A rim normal that tipped past horizontal would light the tile from
    // underneath and read as a hole. The lean is a shoulder, not a wall.
    const normals = bevelNormals(hexagon(4));
    for (let i = 0; i < 6; i += 1) {
      expect(normals[i * 3 + 1] ?? 0).toBeGreaterThan(0.5);
    }
  });

  it("gives the cell NO NET TILT — the lean cancels around the ring", () => {
    // THE ASSERTION THAT MATTERS. Every vertex of a cell is a rim corner (the
    // fan pivots on corner 0; there is no centre vertex), so if the outward
    // leans did not cancel, the whole hexagon would shade as a sloped tile —
    // a picture that lies about the ground it is drawn on.
    const normals = bevelNormals(hexagon(4));
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < 6; i += 1) {
      sx += normals[i * 3] ?? 0;
      sz += normals[i * 3 + 2] ?? 0;
    }
    expect(sx).toBeCloseTo(0, 6);
    expect(sz).toBeCloseTo(0, 6);
  });

  it("is flat when the strength is zero", () => {
    // The escape hatch, and the thing that makes the bevel reviewable: setting
    // the strength to 0 must give back exactly the old flat surface, so the
    // before/after is one number rather than a revert.
    const normals = bevelNormals(hexagon(4), 0);
    for (let i = 0; i < 6; i += 1) {
      expect(normals[i * 3] ?? 0).toBeCloseTo(0, 6);
      expect(normals[i * 3 + 1] ?? 0).toBeCloseTo(1, 6);
      expect(normals[i * 3 + 2] ?? 0).toBeCloseTo(0, 6);
    }
  });

  it("leans further as the strength rises", () => {
    const gentle = bevelNormals(hexagon(4), 0.2);
    const strong = bevelNormals(hexagon(4), 0.6);
    expect(strong[1] ?? 0).toBeLessThan(gentle[1] ?? 0);
  });

  it("keeps the default strength a shoulder rather than a wall", () => {
    // Pinned so a later "make it pop" cannot quietly turn the tiles into cones.
    expect(BEVEL_STRENGTH).toBeGreaterThan(0);
    expect(BEVEL_STRENGTH).toBeLessThan(1);
  });

  it("handles a degenerate cell without producing NaN", () => {
    // Cells straddling the drawn extent are clipped and can arrive with very few
    // corners; a NaN normal silently drops the triangle rather than reporting.
    for (const corners of [
      [],
      hexagon(4).slice(0, 1),
      hexagon(4).slice(0, 2),
    ]) {
      const normals = bevelNormals(corners);
      expect(normals).toHaveLength(corners.length * 3);
      for (const value of normals) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("survives a corner sitting exactly on the centroid", () => {
    // Zero-length outward vector: the lean is undefined and must fall back to
    // up rather than dividing by zero.
    const normals = bevelNormals([
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 0, y: 0, z: 4 },
    ]);
    for (const value of normals) expect(Number.isFinite(value)).toBe(true);
    expect(lengthOf(normals, 0)).toBeCloseTo(1, 6);
  });

  it("ignores height differences across a cell", () => {
    // Cells sit on terrain, so their corners are not coplanar. The bevel is a
    // decoration on the rim and must not turn real relief into extra tilt —
    // that would be terrain shading applied twice.
    const flat = bevelNormals(hexagon(4, 0));
    const sloped = bevelNormals(
      hexagon(4, 0).map((c, i) => ({ ...c, y: i * 0.3 })),
    );
    expect(sloped).toEqual(flat);
  });
});
