/**
 * Why this property matters: the hand-picked cases cannot cover every
 * box shape and node transform. For any point cloud under any node
 * transform, the quantized model must draw every vertex within the
 * reported error (stretched at most by the node's largest scale), that
 * error must stay within the 16-bit bound sqrt(3) / (4 * 32767) of the
 * box's diagonal, and the file must stay valid glTF. A wrong centre, a
 * per-axis scale or a lost carrier transform breaks the first claim at
 * once.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { readGlb, writeGlb } from "./glb-file.js";
import { quantizeModel } from "./model-quantize.js";
import {
  buildModel,
  largestShift,
  validatorErrors,
  worldPositions,
} from "./test-support/glb-fixtures.js";

const BOUND_16 = Math.sqrt(3) / (4 * 32767);

const coordinate = fc.double({ min: -1e4, max: 1e4, noNaN: true });
const point = fc.tuple(coordinate, coordinate, coordinate);
const unitQuaternion = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: 0.1, max: 1, noNaN: true }),
  )
  .map(([x, y, z, w]) => {
    const length = Math.hypot(x, y, z, w);
    return [x / length, y / length, z / length, w / length] as [
      number,
      number,
      number,
      number,
    ];
  });
const scale = fc.double({ min: 0.01, max: 100, noNaN: true });

describe("quantizeModel (property)", () => {
  it("draws every vertex within the reported error, which stays within the 16-bit bound", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(point, { minLength: 3, maxLength: 40 }),
        point,
        unitQuaternion,
        fc.tuple(scale, scale, scale),
        async (points, translation, rotation, scales) => {
          const positions = Float32Array.from(points.flat());
          const before = await buildModel({
            meshes: [{ name: "cloud", positions }],
            transform: { translation, rotation, scale: scales },
          });
          const read = readGlb(before);
          if (!read.ok) throw new Error(read.reason);
          const report = quantizeModel(read.parts, {
            positionBits: 16,
            normalBits: 8,
            texcoordBits: 16,
            maxPositionError: 0.01,
          });
          const out = writeGlb(read.parts);
          const original = await worldPositions(before);
          const { shift } = largestShift(original, await worldPositions(out));
          // The box diagonal in the mesh's own frame, from the float32
          // positions the file holds.
          const lo = [0, 1, 2].map((c) =>
            Math.min(...points.map((p) => Math.fround(p[c]!))),
          );
          const hi = [0, 1, 2].map((c) =>
            Math.max(...points.map((p) => Math.fround(p[c]!))),
          );
          const diagonal = Math.hypot(
            hi[0]! - lo[0]!,
            hi[1]! - lo[1]!,
            hi[2]! - lo[2]!,
          );
          // A cloud of one point has no box and keeps its floats.
          expect(report.positions).toBe(diagonal === 0 ? 0 : 1);
          if (diagonal === 0) return;
          expect(report.positionError).toBeLessThanOrEqual(BOUND_16 * 1.0001);
          const stretch = Math.max(...scales);
          expect(shift).toBeLessThanOrEqual(
            report.positionError * diagonal * stretch * 1.001 +
              1e-9 * (1 + Math.hypot(...translation)),
          );
          expect(await validatorErrors(out)).toEqual([]);
        },
      ),
      { numRuns: 40 },
    );
  }, 60_000);
});
