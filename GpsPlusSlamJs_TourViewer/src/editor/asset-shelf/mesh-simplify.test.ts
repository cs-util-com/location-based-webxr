/**
 * Why these tests matter: the simplifier decides which triangles a model
 * keeps at every level of detail, and every saved level is read straight
 * off its collapse order. A level that points past the vertex buffer
 * crashes the renderer; one that tears a border or flips a face shows a
 * hole or a dark patch on the model; a weld that merges too much welds a
 * hard edge smooth. These pin those failure modes on meshes small enough
 * to reason about.
 */
import { describe, expect, it } from "vitest";

import { surfaceDistance } from "./mesh-distance.js";
import {
  buildProgressive,
  levelIndices,
  levelTriangles,
  remapAttribute,
  stepsFor,
  weldVertices,
} from "./mesh-simplify.js";
import { heightField, sphere, type TestMesh } from "./test-support/meshes.js";

function progressive(mesh: TestMesh) {
  return buildProgressive(
    {
      positions: mesh.positions,
      indices: mesh.indices,
      attributes: [{ data: mesh.uvs, size: 2, weight: 1 }],
    },
    { normals: mesh.normals },
  );
}

/** The four corner positions of a square's index list, as strings. */
function usedPositions(mesh: TestMesh, indices: Uint32Array): Set<string> {
  return new Set(
    [...indices].map((i) =>
      [...mesh.positions.subarray(3 * i, 3 * i + 3)].join(","),
    ),
  );
}

describe("weldVertices", () => {
  // Why: exporters split a vertex into copies whose normals differ by
  // float noise; left split, every such vertex reads as a seam and locks.
  // A real hard edge (normals 90 degrees apart) must stay split.
  it("merges copies equal in position and texture coordinate whose normals nearly agree, and keeps a hard edge", () => {
    const position = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]);
    const uv = new Float32Array([0, 0, 0, 0, 0, 0, 1, 0]);
    const tilt = Math.sin((1 * Math.PI) / 180);
    const normal = new Float32Array([
      0,
      1,
      0,
      tilt,
      Math.cos((1 * Math.PI) / 180),
      0,
      1,
      0,
      0,
      0,
      1,
      0,
    ]);
    const weld = weldVertices(
      { position, uv, normal },
      new Uint32Array([0, 1, 2, 3, 3, 3]),
    );
    expect([...weld.remap]).toEqual([0, 0, 1, 2]);
    expect(weld.count).toBe(3);
    expect([...weld.first]).toEqual([0, 2, 3]);
    expect([...weld.indices]).toEqual([0, 0, 1, 2, 2, 2]);
    expect([...remapAttribute(position, 3, weld)]).toEqual([
      0, 0, 0, 0, 0, 0, 1, 0, 0,
    ]);
  });

  it("keeps copies apart whose texture coordinates or exact attributes differ", () => {
    const position = new Float32Array(9);
    const uv = new Float32Array([0, 0, 0, 0, 0.5, 0]);
    const colour = new Float32Array([1, 1, 1, 0, 1, 1, 1, 1, 1]);
    const weld = weldVertices(
      { position, uv, exact: [colour] },
      new Uint32Array([0, 1, 2]),
    );
    expect(weld.count).toBe(3);
  });
});

describe("buildProgressive", () => {
  // Why: a flat square can lose almost every triangle without changing
  // shape, but its border must not move inwards and its corners must not
  // move for free, or a terrain patch shrinks and opens gaps to its
  // neighbours. The free moves alone must remove nine tenths of the triangles.
  it("simplifies a flat square to a tenth of its triangles at no cost, and keeps its corners and outline", () => {
    const mesh = heightField(12, () => 0);
    const prog = progressive(mesh);
    expect(prog.triangleCount).toBe(288);
    let free = 0;
    while (
      free + 1 < prog.stepError.length &&
      prog.stepError[free + 1]! < 1e-9
    ) {
      free++;
    }
    // measured 26: the turn limit and the link condition stop the rest
    expect(prog.stepAlive[free]).toBeLessThanOrEqual(32);
    const coarse = levelIndices(prog, free);
    const used = usedPositions(mesh, coarse);
    for (const corner of ["0,0,0", "1,0,0", "0,0,1", "1,0,1"]) {
      expect(used.has(corner)).toBe(true);
    }
    const area = surfaceDistance(
      mesh.positions,
      mesh.indices,
      mesh.positions,
      coarse,
      4000,
    );
    expect(area.max).toBeLessThan(1e-6);
  });

  // Why: a closed rock must stay closed and keep its shape at a moderate
  // level: the deviation the shelf shows comes from exactly this.
  it("keeps a bumpy closed sphere within a small deviation at a quarter of its triangles", () => {
    const mesh = sphere(4, 1, (x, y, z) => 0.05 * Math.sin(5 * x + 3 * y * z));
    const prog = progressive(mesh);
    const steps = stepsFor(prog, prog.triangleCount / 4);
    const level = levelIndices(prog, steps);
    expect(level.length / 3).toBeLessThanOrEqual(prog.triangleCount / 4);
    const d = surfaceDistance(
      mesh.positions,
      mesh.indices,
      mesh.positions,
      level,
      4000,
    );
    // the bounding box diagonal is about 2 * sqrt(3)
    expect(d.max / prog.diag).toBeLessThan(0.01);
    expect(d.mean).toBeLessThan(d.max);
  });

  // Why: a level's triangles must face the way the model's shading says;
  // a flipped face shows as a dark patch in the lighting.
  it("never leaves a triangle facing away from its corners' normals", () => {
    const mesh = sphere(3, 1, (x) => 0.2 * Math.sin(7 * x));
    const prog = progressive(mesh);
    for (const share of [0.5, 0.2, 0.08]) {
      const level = levelIndices(
        prog,
        stepsFor(prog, prog.triangleCount * share),
      );
      for (let t = 0; t < level.length / 3; t++) {
        const [a, b, c] = [0, 1, 2].map((k) => level[3 * t + k]!);
        const p = (i: number) => [...mesh.positions.subarray(3 * i, 3 * i + 3)];
        const [pa, pb, pc] = [p(a!), p(b!), p(c!)];
        const u = pb.map((x, k) => x - pa[k]!);
        const v = pc.map((x, k) => x - pa[k]!);
        const n = [
          u[1]! * v[2]! - u[2]! * v[1]!,
          u[2]! * v[0]! - u[0]! * v[2]!,
          u[0]! * v[1]! - u[1]! * v[0]!,
        ];
        const s = [0, 1, 2].map(
          (k) =>
            mesh.normals[3 * a! + k]! +
            mesh.normals[3 * b! + k]! +
            mesh.normals[3 * c! + k]!,
        );
        expect(n[0]! * s[0]! + n[1]! * s[1]! + n[2]! * s[2]!).toBeGreaterThan(
          0,
        );
      }
    }
  });

  // Why: the turn limit is what keeps a coarse level from folding a
  // curved surface flat in one move; a tighter limit must allow fewer
  // collapses on a curved mesh.
  it("collapses less under a tighter turn limit", () => {
    const mesh = sphere(3);
    const at = (maxTurnDeg: number) =>
      buildProgressive(
        { positions: mesh.positions, indices: mesh.indices },
        { maxTurnDeg },
      ).minTriangles;
    expect(at(5)).toBeGreaterThan(at(45));
  });

  // Why: collapsing any edge of a closed tetrahedron (or a thin closed
  // pocket on a scan) would glue two faces back to back; the link
  // condition must refuse it so a closed mesh never turns into a sheet.
  it("never collapses a closed tetrahedron", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]);
    const prog = buildProgressive({ positions, indices });
    expect(prog.minTriangles).toBe(4);
  });

  it("counts a level's triangles as the collapse sequence says", () => {
    const prog = progressive(sphere(2));
    for (const steps of [0, 3, prog.stepAlive.length - 1]) {
      expect(levelTriangles(prog, steps)).toBe(prog.stepAlive[steps]);
    }
    expect(stepsFor(prog, prog.triangleCount)).toBe(0);
    expect(stepsFor(prog, 0)).toBe(prog.stepAlive.length - 1);
  });

  it("drops triangles that are degenerate from the start", () => {
    const mesh = heightField(2, () => 0);
    const indices = Uint32Array.from([...mesh.indices, 0, 0, 1]);
    const prog = buildProgressive({ positions: mesh.positions, indices });
    expect(prog.triangleCount).toBe(8);
    expect(prog.triDeath[8]).toBe(-1);
    expect(levelIndices(prog, 0).length).toBe(24);
  });
});
