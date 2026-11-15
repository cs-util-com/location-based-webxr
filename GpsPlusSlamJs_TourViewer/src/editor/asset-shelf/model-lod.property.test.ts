/**
 * Why these properties matter: the renderer trusts a saved chain without
 * checking it (it sets the index list and a draw range per frame), so for
 * ANY mesh and any budget or author's share the pass is given, every
 * level must index only vertices the compacted buffer has, the levels
 * must lie end to end with falling triangle counts and non-falling
 * errors, and an automatic level must keep its deviation within the
 * budget, measured again from the written file. Random bumpy height
 * fields (open borders) and spheres (closed) at random budgets reach
 * shapes and orders the hand-picked cases do not.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  type GlbParts,
  type GltfObject,
  readAccessor,
  readGlb,
  writeGlb,
} from "./glb-file.js";
import { surfaceDistance } from "./mesh-distance.js";
import { simplifyModel } from "./model-lod.js";
import { buildModel } from "./test-support/glb-fixtures.js";
import { heightField, sphere, type TestMesh } from "./test-support/meshes.js";

const wave = fc.record({
  a: fc.double({ min: -0.25, max: 0.25, noNaN: true }),
  fx: fc.double({ min: 0, max: 8, noNaN: true }),
  fy: fc.double({ min: 0, max: 8, noNaN: true }),
});

const meshes: fc.Arbitrary<TestMesh> = fc.oneof(
  fc
    .tuple(fc.integer({ min: 6, max: 20 }), fc.array(wave, { maxLength: 3 }))
    .map(([n, waves]) =>
      heightField(n, (u, v) =>
        waves.reduce((h, w) => h + w.a * Math.sin(w.fx * u + w.fy * v), 0),
      ),
    ),
  fc
    .tuple(fc.integer({ min: 2, max: 4 }), fc.array(wave, { maxLength: 2 }))
    .map(([depth, waves]) =>
      sphere(depth, 1, (x, y, z) =>
        waves.reduce(
          (h, w) => h + w.a * 0.3 * Math.sin(w.fx * x + w.fy * y * z),
          0,
        ),
      ),
    ),
);

function partsOf(bytes: Uint8Array): GlbParts {
  const read = readGlb(bytes);
  if (!read.ok) throw new Error(read.reason);
  return read.parts;
}

const floats = (parts: GlbParts, index: number) =>
  Float32Array.from(readAccessor(parts, index)!.values);
const ints = (parts: GlbParts, index: number) =>
  Uint32Array.from(readAccessor(parts, index)!.values);

function diagonalOf(p: Float32Array): number {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3]!, p[i]!);
    hi[i % 3] = Math.max(hi[i % 3]!, p[i]!);
  }
  return Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
}

describe("simplifyModel (property)", () => {
  it("saves a chain the renderer can trust, and an automatic level within its budget", async () => {
    await fc.assert(
      fc.asyncProperty(
        meshes,
        fc.double({ min: 0.001, max: 0.01, noNaN: true }),
        fc.option(fc.double({ min: 0, max: 1, noNaN: true }), {
          nil: undefined,
        }),
        async (mesh, lodBudget, detailShare) => {
          const parts = partsOf(
            await buildModel({
              meshes: [
                {
                  name: "m",
                  positions: mesh.positions as Float32Array<ArrayBuffer>,
                  normals: mesh.normals as Float32Array<ArrayBuffer>,
                  texcoords: mesh.uvs as Float32Array<ArrayBuffer>,
                  indices: mesh.indices as Uint32Array<ArrayBuffer>,
                },
              ],
            }),
          );
          const report = simplifyModel(parts, {
            lodBudget,
            lodMinTriangles: 50,
            ...(detailShare === undefined ? {} : { detailShare }),
          });
          expect(report.primitives).toBe(1);
          const saved = partsOf(writeGlb(parts));
          const prim = (
            (saved.json["meshes"] as GltfObject[])[0]![
              "primitives"
            ] as GltfObject[]
          )[0]!;
          const attributes = prim["attributes"] as Record<string, number>;
          const positions = floats(saved, attributes["POSITION"]!);
          const lod = (prim["extras"] as GltfObject)["lod"] as {
            indices: number;
            levels: { start: number; count: number; error: number }[];
          };
          const chain = ints(saved, lod.indices);
          expect(Math.max(...chain)).toBeLessThan(positions.length / 3);
          let at = 0;
          let previous = { count: Infinity, error: 0 };
          for (const level of lod.levels) {
            expect(level.start).toBe(at);
            expect(level.count % 3).toBe(0);
            expect(level.count).toBeLessThan(previous.count);
            expect(level.error).toBeGreaterThanOrEqual(previous.error);
            at += level.count;
            previous = level;
          }
          expect(at).toBe(chain.length);
          // no degenerate triangle in any level
          for (let t = 0; t < chain.length; t += 3) {
            const [a, b, c] = [chain[t]!, chain[t + 1]!, chain[t + 2]!];
            expect(a !== b && b !== c && a !== c).toBe(true);
          }
          const author = ints(saved, prim["indices"] as number);
          expect(author.length).toBe(lod.levels[0]!.count);
          // an author's share may deviate as far as it likes
          const bound = detailShare === undefined ? lodBudget : Infinity;
          expect(lod.levels[0]!.error).toBeLessThanOrEqual(bound);
          const d = surfaceDistance(
            mesh.positions,
            mesh.indices,
            positions,
            author,
          );
          expect(d.max / diagonalOf(mesh.positions)).toBeLessThanOrEqual(
            bound * 1.25 + 1e-9,
          );
        },
      ),
      { numRuns: 25 },
    );
  }, 120_000);
});
