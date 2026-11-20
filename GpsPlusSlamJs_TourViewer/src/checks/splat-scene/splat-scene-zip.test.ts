import { describe, expect, it } from "vitest";

import { readSplatInputs } from "../../splat-trainer/recording-reader.js";
import {
  sceneDepthSample,
  sceneProjection,
  sceneWalk,
  type WalkKind,
} from "./splat-scene.js";
import { zipSceneWalk, type SceneFrame } from "./splat-scene-zip.js";

/** A JPEG's start and end markers: the reader never decodes a photo. */
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function framesOf(kind: WalkKind, count: number): SceneFrame[] {
  const projection = sceneProjection(160, 120);
  return sceneWalk(kind, count).map((pose, i) => ({
    jpeg: PHOTO,
    depth: sceneDepthSample(pose, projection, 4, 1_700_000_000_000 + i * 500),
  }));
}

describe("zipSceneWalk", () => {
  // Why: the zip is only useful if the splat trainer's reader takes it as
  // a recording, with every frame, its pose and its lens.
  it.each(["straight", "loop"] as const)(
    "writes a %s walk the splat trainer's reader accepts whole",
    async (kind) => {
      const frames = framesOf(kind, 7);
      const read = await readSplatInputs(await zipSceneWalk(frames, 160, 120));
      if (read.kind !== "read") throw new Error(read.reason);
      const { inputs } = read;
      expect(inputs.census.frames).toBe(7);
      expect(inputs.census.skippedFrames).toBe(0);
      expect(inputs.census.frameWidth).toBe(160);
      expect(inputs.census.frameHeight).toBe(120);
      expect(inputs.census.depthSamples).toBe(7);
      expect(inputs.census.projectionSpread).toBe(0);
      expect(inputs.census.medianSpacingS).toBeCloseTo(0.5, 9);
      expect(inputs.captures.map((c) => c.position)).toEqual(
        frames.map((f) => f.depth.cameraPos),
      );
      expect(inputs.captures.map((c) => c.rotation)).toEqual(
        frames.map((f) => f.depth.cameraRot),
      );
      // Square pixels at the photos' size: fx equals fy.
      expect(inputs.intrinsics.fx).toBeCloseTo(inputs.intrinsics.fy, 3);
      // Depths survive the packing to within float32.
      inputs.depthSamples.forEach((s, i) =>
        s.points.forEach((p, j) =>
          expect(p.depthM).toBeCloseTo(frames[i]!.depth.points[j]!.depthM, 5),
        ),
      );
    },
  );

  it("refuses an empty walk or a bad photo size", async () => {
    await expect(zipSceneWalk([], 160, 120)).rejects.toThrow(RangeError);
    const frames = framesOf("straight", 2);
    for (const [w, h] of [
      [0, 120],
      [160, 1.5],
      [Number.NaN, 120],
    ]) {
      await expect(zipSceneWalk(frames, w!, h!)).rejects.toThrow(RangeError);
    }
  });
});
