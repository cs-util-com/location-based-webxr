/**
 * Why these properties matter: the pass judges a skinned model's levels in
 * these poses, so for ANY clip the pose at its end must be the shape the
 * clip shows there (compared with the fixtures' independent skinning), and
 * for ANY weights a vertex whose joints all move alike must move rigidly
 * with them: a skinning that drops or double-counts a weight passes the
 * hand-picked cases and fails here.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  type GlbParts,
  type GltfObject,
  readAccessor,
  readGlb,
} from "./glb-file.js";
import { jointMatrices, posesOf, skinPositions } from "./skin-pose.js";
import {
  bendingTube,
  bendTube,
  tubeSpec,
} from "./test-support/glb-fixtures.js";

function partsOf(bytes: Uint8Array): GlbParts {
  const read = readGlb(bytes);
  if (!read.ok) throw new Error(read.reason);
  return read.parts;
}

const angle = fc.double({ min: -150, max: 150, noNaN: true });

describe("skin poses (property)", () => {
  it("poses the tube at its clip's end as the clip turns it", async () => {
    const tube = tubeSpec().positions;
    await fc.assert(
      fc.asyncProperty(angle, angle, async (middle, end) => {
        const parts = partsOf(
          await bendingTube({ clip: true, degrees: [0, middle, end] }),
        );
        const poses = posesOf(parts)!;
        const prim = (
          (parts.json["meshes"] as GltfObject[])[0]![
            "primitives"
          ] as GltfObject[]
        )[0]!;
        const attributes = prim["attributes"] as Record<string, number>;
        const posed = skinPositions(
          Float32Array.from(
            readAccessor(parts, attributes["POSITION"]!)!.values,
          ),
          [readAccessor(parts, attributes["JOINTS_0"]!)!.values],
          [readAccessor(parts, attributes["WEIGHTS_0"]!)!.values],
          jointMatrices(parts, 0, poses.worlds.at(-1)!)!,
        )!;
        const expected = bendTube(tube, end);
        for (let i = 0; i < posed.length; i++) {
          expect(Math.abs(posed[i]! - expected[i]!)).toBeLessThan(1e-4);
        }
      }),
      { numRuns: 15 },
    );
  }, 60_000);

  it("moves a vertex rigidly when all its joints move alike, whatever its weights", () => {
    fc.assert(
      fc.property(
        fc.tuple(angle, angle, angle),
        fc.tuple(
          fc.double({ min: -5, max: 5, noNaN: true }),
          fc.double({ min: -5, max: 5, noNaN: true }),
          fc.double({ min: -5, max: 5, noNaN: true }),
        ),
        fc.array(fc.double({ min: 0.01, max: 1, noNaN: true }), {
          minLength: 4,
          maxLength: 4,
        }),
        fc.tuple(
          fc.double({ min: -3, max: 3, noNaN: true }),
          fc.double({ min: -3, max: 3, noNaN: true }),
          fc.double({ min: -3, max: 3, noNaN: true }),
        ),
        ([ax, ay, az], [tx, ty, tz], weights, [x, y, z]) => {
          const r = (d: number) => (d * Math.PI) / 180;
          const [cx, sx] = [Math.cos(r(ax)), Math.sin(r(ax))];
          const [cy, sy] = [Math.cos(r(ay)), Math.sin(r(ay))];
          const [cz, sz] = [Math.cos(r(az)), Math.sin(r(az))];
          // Rz * Ry * Rx, column-major, then the translation
          const m = Float64Array.of(
            cz * cy,
            sz * cy,
            -sy,
            0,
            cz * sy * sx - sz * cx,
            sz * sy * sx + cz * cx,
            cy * sx,
            0,
            cz * sy * cx + sz * sx,
            sz * sy * cx - cz * sx,
            cy * cx,
            0,
            tx,
            ty,
            tz,
            1,
          );
          const posed = skinPositions(
            Float32Array.of(x, y, z),
            [Float64Array.of(0, 1, 2, 3)],
            [Float64Array.from(weights)],
            [m, m, m, m],
          )!;
          const expected = [0, 1, 2].map(
            (k) => m[k]! * x + m[4 + k]! * y + m[8 + k]! * z + m[12 + k]!,
          );
          for (let k = 0; k < 3; k++) {
            expect(Math.abs(posed[k]! - expected[k]!)).toBeLessThan(1e-4);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
