import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { LoadDeps } from "./bench-net";
import { syntheticPair } from "./bench-synthetic";
import type { Frame } from "./bench-image";
import {
  speedFrames,
  speedTestArms,
  speedTestInput,
  speedTestSettings,
  type SpeedTestChoice,
} from "./speed-test";

const deps: LoadDeps = {
  importModule: () => Promise.reject(new Error("not loaded in this test")),
  fetch: () => Promise.reject(new Error("not fetched in this test")),
  now: () => 0,
  resources: () => [],
};

const pair = () => {
  const p = syntheticPair(640, 480, 1);
  return { a: p.a, b: p.b, warp: p.warp };
};

const all: SpeedTestChoice = {
  xfeat: true,
  siftLightGlue: true,
  dino: ["int8", "q4f16"],
  backends: ["webgpu", "wasm"],
  longEdge: 480,
  siftCap: 512,
};

// Why these tests matter: a ratio is only meaningful against the reference
// on the same backend, so each backend's arms form one group with one
// XFeat reference; and the settings line is what the pasted numbers rest on.
describe("speedTestArms", () => {
  it("gives per backend the XFeat reference, both DINOv2 variants and SIFT + LightGlue", () => {
    const arms = speedTestArms(all, pair(), deps);
    expect(arms.map((a) => [a.id, a.group, a.reference])).toEqual([
      ["xfeat-webgpu-fp16", "webgpu", true],
      ["dinov2-int8-webgpu", "webgpu", false],
      ["dinov2-q4f16-webgpu", "webgpu", false],
      ["sift-lightglue-webgpu", "webgpu", false],
      ["xfeat-wasm-fp16", "wasm", true],
      ["dinov2-int8-wasm", "wasm", false],
      ["dinov2-q4f16-wasm", "wasm", false],
      ["sift-lightglue-wasm", "wasm", false],
    ]);
  });

  it("property: one reference at most per group, and nothing unticked", () => {
    // A small pair: the property is about the list, not the resize.
    const p = syntheticPair(64, 48, 1);
    const small = { a: p.a, b: p.b, warp: p.warp };
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.subarray(["int8", "q4f16"] as const),
        fc.subarray(["webgpu", "wasm"] as const),
        (xfeat, siftLightGlue, dino, backends) => {
          const arms = speedTestArms(
            { ...all, xfeat, siftLightGlue, dino, backends, longEdge: 32 },
            small,
            deps,
          );
          for (const b of backends) {
            const g = arms.filter((a) => a.group === b);
            expect(g.filter((a) => a.reference).length).toBe(xfeat ? 1 : 0);
            expect(g.length).toBe(
              Number(xfeat) + Number(siftLightGlue) + dino.length,
            );
          }
          expect(arms.length).toBe(
            backends.length *
              (Number(xfeat) + Number(siftLightGlue) + dino.length),
          );
        },
      ),
    );
  });
});

describe("speedTestInput and speedTestSettings", () => {
  it("resizes both frames once and keeps the known warp", () => {
    const p = pair();
    const s = speedTestInput(p, 480);
    expect([s.a.width, s.a.height, s.b.width]).toEqual([480, 360, 480]);
    expect(s.warp).toBe(p.warp);
  });

  it("names long edge, real size, SIFT cap, reference and backends", () => {
    expect(
      speedTestSettings(
        { ...all, backends: ["wasm"] },
        pair(),
        "no WebGPU on this device: WASM instead",
        1,
      ),
    ).toBe(
      "long edge 480 (480x360) for the keypoint arms, DINOv2 input 224x224, SIFT cap 512 per frame, XFeat fp16 as the reference, backends wasm (no WebGPU on this device: WASM instead), ort wasm threads 1",
    );
  });
});

// Why this test matters: the speed test falls back to the synthetic pair
// when the flat scene's photos cannot be had; a photo that storage lost or
// never took (its read rejects) must take that fallback too, not end the
// test with an error.
describe("speedFrames", () => {
  const frame = (w: number): Frame => ({
    width: w,
    height: 1,
    rgba: new Uint8ClampedArray(4 * w),
  });

  it("reads both photos when both are taken", async () => {
    const got = await speedFrames({ a: "p1", b: "p2" }, (id) =>
      Promise.resolve(frame(id === "p1" ? 1 : 2)),
    );
    expect("a" in got && [got.a.width, got.b.width]).toEqual([1, 2]);
  });

  it("falls back when a photo is not taken", async () => {
    const got = await speedFrames({ a: "p1", b: undefined }, () =>
      Promise.resolve(frame(1)),
    );
    expect(got).toEqual({ fallback: "F1 and F2 not both taken" });
  });

  it("falls back, naming why, when a photo cannot be read", async () => {
    const got = await speedFrames({ a: "p1", b: "p2" }, (id) =>
      id === "p2"
        ? Promise.reject(new Error("the photo p2 is not stored"))
        : Promise.resolve(frame(1)),
    );
    expect(got).toEqual({
      fallback: "a photo could not be read: Error: the photo p2 is not stored",
    });
  });
});
