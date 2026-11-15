/**
 * Why these properties matter: the saved level chain is read by the
 * renderer as index ranges of one list, so for ANY mesh the simplifier is
 * given, every level must index only vertices that exist, must form no
 * degenerate triangle, and the triangle counts must fall monotonically
 * with the collapse steps (the runtime picks a coarser level by moving
 * one way along the chain). Random bumpy height fields and spheres reach
 * shapes, borders and orders the hand-picked cases do not.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  buildProgressive,
  levelIndices,
  levelTriangles,
  stepsFor,
} from "./mesh-simplify.js";
import { heightField, sphere, type TestMesh } from "./test-support/meshes.js";

const wave = fc.record({
  a: fc.double({ min: -0.3, max: 0.3, noNaN: true }),
  fx: fc.double({ min: 0, max: 9, noNaN: true }),
  fy: fc.double({ min: 0, max: 9, noNaN: true }),
  phase: fc.double({ min: 0, max: 6.3, noNaN: true }),
});

/** How many triangles use each undirected edge of `level`. */
function edgeUses(level: Uint32Array, positions: Float32Array): number[] {
  // corners by position, so a weld seam reads as one edge
  const key = (i: number) => positions.subarray(3 * i, 3 * i + 3).join(",");
  const uses = new Map<string, number>();
  for (let t = 0; t < level.length / 3; t++) {
    for (let c = 0; c < 3; c++) {
      const a = key(level[3 * t + c]!);
      const b = key(level[3 * t + ((c + 1) % 3)]!);
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      uses.set(e, (uses.get(e) ?? 0) + 1);
    }
  }
  return [...uses.values()];
}

const meshes: fc.Arbitrary<TestMesh & { closed: boolean }> = fc.oneof(
  fc
    .tuple(fc.integer({ min: 2, max: 10 }), fc.array(wave, { maxLength: 3 }))
    .map(([n, waves]) => ({
      ...heightField(n, (u, v) =>
        waves.reduce(
          (h, w) => h + w.a * Math.sin(w.fx * u + w.fy * v + w.phase),
          0,
        ),
      ),
      closed: false,
    })),
  fc
    .tuple(fc.integer({ min: 1, max: 3 }), fc.array(wave, { maxLength: 2 }))
    .map(([depth, waves]) => ({
      ...sphere(depth, 1, (x, y, z) =>
        waves.reduce(
          (h, w) => h + w.a * 0.3 * Math.sin(w.fx * x + w.fy * y + w.phase * z),
          0,
        ),
      ),
      closed: true,
    })),
);

describe("the simplifier's levels (property)", () => {
  it("index existing vertices, form no degenerate triangle, stay manifold, and fall monotonically", () => {
    fc.assert(
      fc.property(
        meshes,
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
          minLength: 2,
          maxLength: 6,
        }),
        (mesh, shares) => {
          const vertices = mesh.positions.length / 3;
          const prog = buildProgressive(
            {
              positions: mesh.positions,
              indices: mesh.indices,
              attributes: [{ data: mesh.uvs, size: 2, weight: 1 }],
            },
            { normals: mesh.normals },
          );
          const steps = shares
            .map((s) => stepsFor(prog, Math.round(s * prog.triangleCount)))
            .sort((a, b) => a - b);
          let previous = Infinity;
          for (const step of steps) {
            const level = levelIndices(prog, step);
            const triangles = level.length / 3;
            expect(triangles).toBe(levelTriangles(prog, step));
            expect(triangles).toBe(prog.stepAlive[step]);
            expect(triangles).toBeLessThanOrEqual(previous);
            previous = triangles;
            for (let t = 0; t < triangles; t++) {
              const [a, b, c] = [
                level[3 * t]!,
                level[3 * t + 1]!,
                level[3 * t + 2]!,
              ];
              expect(Math.max(a, b, c)).toBeLessThan(vertices);
              expect(a !== b && b !== c && a !== c).toBe(true);
            }
            // the link condition: no edge gains a third triangle, and a
            // closed mesh stays closed (every edge used exactly twice)
            const uses = edgeUses(level, mesh.positions);
            expect(Math.max(0, ...uses)).toBeLessThanOrEqual(2);
            expect(mesh.closed && uses.some((n) => n !== 2)).toBe(false);
          }
          for (let s = 1; s < prog.stepAlive.length; s++) {
            expect(prog.stepAlive[s]!).toBeLessThanOrEqual(
              prog.stepAlive[s - 1]!,
            );
            expect(prog.stepError[s]!).toBeGreaterThanOrEqual(
              prog.stepError[s - 1]!,
            );
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
