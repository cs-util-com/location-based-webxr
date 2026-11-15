/**
 * Why these tests matter: the level-of-detail pass trusts these poses to
 * judge a skinned model's levels. A pose sampled at the wrong time, a
 * joint matrix missing its inverse bind matrix, or a skinning that drops
 * a weight would let a level pass that tears in the clip, or refuse every
 * level. The poses are compared with a skinning written independently in
 * the fixtures (`bendTube`), and a file that does not read must give
 * null, never a guessed pose.
 */
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

/** The tube of `parts` skinned in pose `k`, as the pass would pose it. */
function posedTube(parts: GlbParts, k: number): Float32Array {
  const prim = (
    (parts.json["meshes"] as GltfObject[])[0]!["primitives"] as GltfObject[]
  )[0]!;
  const attributes = prim["attributes"] as Record<string, number>;
  const poses = posesOf(parts)!;
  const matrices = jointMatrices(parts, 0, poses.worlds[k]!)!;
  return skinPositions(
    Float32Array.from(readAccessor(parts, attributes["POSITION"]!)!.values),
    [readAccessor(parts, attributes["JOINTS_0"]!)!.values],
    [readAccessor(parts, attributes["WEIGHTS_0"]!)!.values],
    matrices,
  )!;
}

function largestGap(a: Float32Array, b: Float32Array): number {
  let gap = 0;
  for (let i = 0; i < a.length; i += 3) {
    gap = Math.max(
      gap,
      Math.hypot(a[i]! - b[i]!, a[i + 1]! - b[i + 1]!, a[i + 2]! - b[i + 2]!),
    );
  }
  return gap;
}

describe("posesOf", () => {
  // Why: the poses the pass measures in are the rest and a third, two
  // thirds and the end of the clip; each must be the shape the clip shows
  // then (30, 60 and 90 degrees of a linear 0-45-90 clip).
  it("samples the rest and a clip at a third, two thirds and its end", async () => {
    const parts = partsOf(await bendingTube({ clip: true }));
    const poses = posesOf(parts)!;
    expect(poses.fromClips).toBe(true);
    expect(poses.worlds).toHaveLength(4);
    const tube = tubeSpec().positions;
    [0, 30, 60, 90].forEach((degrees, k) => {
      expect(
        largestGap(posedTube(parts, k), bendTube(tube, degrees)),
      ).toBeLessThan(1e-5);
    });
  });

  // Why: without a clip there is only the rest pose to measure in.
  it("has the rest pose alone when the model has no clip", async () => {
    const poses = posesOf(partsOf(await bendingTube({ clip: false })))!;
    expect(poses.fromClips).toBe(false);
    expect(poses.worlds).toHaveLength(1);
  });

  // Why: a step clip holds each key until the next; a cubic spline keeps
  // three values a key (in-tangent, value, out-tangent), and only the
  // middle one is a pose.
  it.each([
    ["STEP", [0, 40, 80], [0, 0, 40, 80]],
    // sampled linearly between its key values, as the sidecar states
    ["CUBICSPLINE", [0, 40, 80], [0, 80 / 3, 160 / 3, 80]],
  ] as const)("reads a %s clip", async (interpolation, degrees, expected) => {
    const parts = partsOf(
      await bendingTube({ clip: true, degrees, interpolation }),
    );
    const tube = tubeSpec().positions;
    expected.forEach((d, k) => {
      expect(largestGap(posedTube(parts, k), bendTube(tube, d))).toBeLessThan(
        1e-5,
      );
    });
  });

  // Why: the file is untrusted; a node graph that is no tree, a clip whose
  // keys do not read, or an animated node given by a matrix cannot be
  // posed, and a guessed pose would judge levels wrongly.
  it.each([
    [
      "a cycle in the nodes",
      (json: GltfObject) => {
        const nodes = json["nodes"] as GltfObject[];
        const child = (nodes[0]!["children"] as number[])[0]!;
        nodes[child]!["children"] = [0];
      },
    ],
    [
      "a clip with fewer values than keys",
      (json: GltfObject) => {
        const animation = (json["animations"] as GltfObject[])[0]!;
        const sampler = (animation["samplers"] as GltfObject[])[0]!;
        sampler["output"] = sampler["input"];
      },
    ],
    [
      "an unknown interpolation",
      (json: GltfObject) => {
        const animation = (json["animations"] as GltfObject[])[0]!;
        (animation["samplers"] as GltfObject[])[0]!["interpolation"] = "SMOOTH";
      },
    ],
    [
      "an animated node given by a matrix",
      (json: GltfObject) => {
        const animation = (json["animations"] as GltfObject[])[0]!;
        const target = (animation["channels"] as GltfObject[])[0]![
          "target"
        ] as GltfObject;
        const node = (json["nodes"] as GltfObject[])[target["node"] as number]!;
        delete node["translation"];
        node["matrix"] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1];
      },
    ],
    [
      "a non-finite rotation",
      (json: GltfObject) => {
        (json["nodes"] as GltfObject[])[0]!["rotation"] = [0, 0, 0, "x"];
      },
    ],
  ])("gives null for %s", async (_, damage) => {
    const parts = partsOf(await bendingTube({ clip: true }));
    damage(parts.json);
    expect(posesOf(parts)).toBeNull();
  });
});

describe("jointMatrices and skinPositions", () => {
  // Why: a joint the skin names must exist, and the inverse bind matrices
  // must match the joints one to one.
  it("gives null for a joint past the nodes or inverse bind matrices that do not match", async () => {
    const parts = partsOf(await bendingTube({ clip: false }));
    const worlds = posesOf(parts)!.worlds[0]!;
    expect(jointMatrices(parts, 0, worlds)).toHaveLength(2);
    expect(jointMatrices(parts, 1, worlds)).toBeNull();
    const skin = (parts.json["skins"] as GltfObject[])[0]!;
    skin["joints"] = [0, 1, 2];
    expect(jointMatrices(parts, 0, worlds)).toBeNull();
    skin["joints"] = [0, worlds.length];
    expect(jointMatrices(parts, 0, worlds)).toBeNull();
  });

  // Why: a vertex bound to a joint the skin does not have, or with no
  // weight at all, cannot be posed.
  it("gives null for a joint index past the matrices, a negative weight or no weight", () => {
    const identity = Float64Array.of(
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
    );
    const p = Float32Array.of(1, 2, 3);
    const ok = skinPositions(
      p,
      [Float64Array.of(0, 0, 0, 0)],
      [Float64Array.of(1, 0, 0, 0)],
      [identity],
    );
    expect(Array.from(ok!)).toEqual([1, 2, 3]);
    expect(
      skinPositions(
        p,
        [Float64Array.of(1, 0, 0, 0)],
        [Float64Array.of(1, 0, 0, 0)],
        [identity],
      ),
    ).toBeNull();
    expect(
      skinPositions(
        p,
        [Float64Array.of(0, 0, 0, 0)],
        [Float64Array.of(-1, 0, 0, 0)],
        [identity],
      ),
    ).toBeNull();
    expect(
      skinPositions(
        p,
        [Float64Array.of(0, 0, 0, 0)],
        [Float64Array.of(0, 0, 0, 0)],
        [identity],
      ),
    ).toBeNull();
    expect(skinPositions(p, [], [], [identity])).toBeNull();
  });
});
