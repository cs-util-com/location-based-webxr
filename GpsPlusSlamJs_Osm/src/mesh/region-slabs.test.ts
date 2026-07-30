/**
 * Merged-region slabs (W14, DEC-R2-11).
 *
 * WHY A HOLE IS THE TEST THAT MATTERS. A region is a flood fill over affordance
 * cells, and a building standing inside a park is a hole in it — that is not an
 * edge case, it is the ordinary shape of the data. A slab that fills its holes
 * covers the very buildings the view exists to show, and it does so in a way that
 * looks deliberate: a solid coloured surface reads as "this whole area scores",
 * which is a confidently wrong claim rather than a visible glitch.
 *
 * WHY THE WALL EXISTS. DEC-R2-11 asked for a slab rather than a flat overlay so a
 * region reads as a body at a shallow camera angle. A surface with no thickness
 * disappears edge-on, which is exactly the angle this demo is usually viewed at.
 *
 * The colour is deliberately NOT this module's business — see the sidecar.
 */

import { describe, expect, it } from "vitest";

import { enuFrameAt } from "./enu.js";
import type { MeshData } from "./mesh-data.js";
import { buildRegionSlabs, type SlabRegion } from "./region-slabs.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const FRAME = enuFrameAt(COLOGNE);

/** ENU metres as a lat/lng the builder will re-project. */
const at = (east: number, north: number): { lat: number; lng: number } =>
  FRAME.toLatLng({ x: east, y: north });

/** A square ring, counter-clockwise, `size` metres on a side. */
function square(size: number, offset = 0): { lat: number; lng: number }[] {
  const lo = offset;
  const hi = offset + size;
  return [at(lo, lo), at(hi, lo), at(hi, hi), at(lo, hi), at(lo, lo)];
}

function region(outline: SlabRegion["outline"], medianScore = 3): SlabRegion {
  return { outline, medianScore };
}

/** Highest and lowest `y` in the mesh. */
function heightRange(mesh: MeshData): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    const y = mesh.positions[i] ?? 0;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return { min, max };
}

/**
 * The `y` of `(b - a) x (c - a)` for triangle `i`. Positive means it faces up.
 *
 * The same quantity three.js computes for itself when `flatShading` is on, which
 * is why it — and not the stored normals — is what the orientation test asserts.
 */
function faceUpness(mesh: MeshData, i: number): number {
  const xz = (offset: number): [number, number] => {
    const base = (mesh.indices[i + offset] ?? 0) * 3;
    return [mesh.positions[base] ?? 0, mesh.positions[base + 2] ?? 0];
  };
  const [ax, az] = xz(0);
  const [bx, bz] = xz(1);
  const [cx, cz] = xz(2);
  return (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
}

/** Whether every vertex of triangle `i` sits at height `y`. */
function isAtHeight(mesh: MeshData, i: number, y: number): boolean {
  return [0, 1, 2].every((k) => {
    const base = (mesh.indices[i + k] ?? 0) * 3;
    return Math.abs((mesh.positions[base + 1] ?? 0) - y) < 1e-6;
  });
}

/** Whether `(east, north)` is inside any triangle, in plan view. */
function coversPoint(mesh: MeshData, east: number, north: number): boolean {
  const z = -north;
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const p = [0, 1, 2].map((k) => {
      const base = (mesh.indices[i + k] ?? 0) * 3;
      return [mesh.positions[base] ?? 0, mesh.positions[base + 2] ?? 0];
    });
    const [a, b, c] = p as [number[], number[], number[]];
    const side = (u: number[], v: number[]): number =>
      ((u[0] ?? 0) - east) * ((v[1] ?? 0) - z) -
      ((v[0] ?? 0) - east) * ((u[1] ?? 0) - z);
    const d = [side(a, b), side(b, c), side(c, a)];
    const negative = d.some((value) => value < -1e-9);
    const positive = d.some((value) => value > 1e-9);
    if (!negative && !positive) continue;
    if (!(negative && positive)) return true;
  }
  return false;
}

describe("buildRegionSlabs", () => {
  const options = { frame: FRAME };

  it("builds one slab per region, carrying the score the caller must colour by", () => {
    // The score rides along rather than being turned into a colour here, because
    // the 2D map and the 3D view MUST use the same scale — see the sidecar.
    const slabs = buildRegionSlabs(
      [region([[square(100)]], 7), region([[square(50, 300)]], 2)],
      options,
    );
    expect(slabs).toHaveLength(2);
    expect(slabs.map((slab) => slab.medianScore)).toEqual([7, 2]);
  });

  it("leaves a HOLE where the region has one", () => {
    // THE TEST THIS FILE EXISTS FOR. A building inside a park is a hole in the
    // region, and filling it covers the building the view is there to show —
    // while looking entirely deliberate.
    const withHole = buildRegionSlabs(
      [region([[square(100), square(20, 40).slice().reverse()]])],
      options,
    );
    const mesh = withHole[0]?.mesh as MeshData;

    // Inside the outer ring but outside the hole: covered.
    expect(coversPoint(mesh, 10, 10)).toBe(true);
    // Dead centre of the hole: NOT covered.
    expect(coversPoint(mesh, 50, 50)).toBe(false);
  });

  it("stands the slab up, so it does not vanish edge-on", () => {
    // DEC-R2-11 asked for a body rather than an overlay. A zero-thickness
    // surface disappears at a shallow angle, which is the angle this demo is
    // usually viewed at.
    const slabs = buildRegionSlabs([region([[square(100)]])], {
      ...options,
      wallHeightM: 0.5,
    });
    const { min, max } = heightRange(slabs[0]?.mesh as MeshData);
    expect(max - min).toBeCloseTo(0.5, 6);
  });

  it("drapes the top on the terrain, per vertex", () => {
    // Per-vertex like the plates and the roads: a region can be hundreds of
    // metres across, and one sample would cut into the hill at one end.
    const slabs = buildRegionSlabs([region([[square(400)]])], {
      frame: FRAME,
      groundHeightM: (p) => (p.lat > COLOGNE.lat + 0.001 ? 60 : 50),
    });
    const heights = new Set<number>();
    const mesh = slabs[0]?.mesh as MeshData;
    for (let i = 1; i < mesh.positions.length; i += 3) {
      heights.add(Math.round(mesh.positions[i] ?? 0));
    }
    expect(heights.size).toBeGreaterThan(1);
  });

  it("handles a MULTI-polygon region, which a flood fill can produce", () => {
    // Two cells that score but do not touch are one region with two polygons.
    // Dropping all but the first would silently shrink it.
    const slabs = buildRegionSlabs(
      [region([[square(50)], [square(50, 200)]])],
      options,
    );
    const mesh = slabs[0]?.mesh as MeshData;
    expect(coversPoint(mesh, 25, 25)).toBe(true);
    expect(coversPoint(mesh, 225, 225)).toBe(true);
    // And nothing in the gap between them.
    expect(coversPoint(mesh, 125, 125)).toBe(false);
  });

  it("skips a degenerate outline instead of emitting NaN", () => {
    // A two-point ring cannot be triangulated. One NaN removes the whole draw
    // call in three.js with no error, which is the failure this round keeps
    // meeting.
    const slabs = buildRegionSlabs(
      [region([[[at(0, 0), at(10, 0)]]]), region([[]])],
      options,
    );
    for (const slab of slabs) {
      for (const value of slab.mesh.positions) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("winds every TOP triangle so its face normal points up", () => {
    // Same trap W13's ribbons fell into: `flatShading` recomputes the normal
    // from the winding and ignores the supplied ones, so an inverted top is lit
    // from beneath and culled while every counter still reports it.
    const slabs = buildRegionSlabs([region([[square(100)]])], options);
    const mesh = slabs[0]?.mesh as MeshData;
    const { max } = heightRange(mesh);

    let tops = 0;
    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
      // Only the top surface; the wall's own winding is a different question.
      if (!isAtHeight(mesh, i, max)) continue;
      tops += 1;
      expect(faceUpness(mesh, i)).toBeGreaterThan(0);
    }
    expect(tops).toBeGreaterThan(0);
  });
});
