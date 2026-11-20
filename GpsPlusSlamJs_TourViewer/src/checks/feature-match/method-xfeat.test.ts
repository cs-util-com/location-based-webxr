import { describe, expect, it } from "vitest";

import { makeFrame } from "./bench-image";
import type { LoadDeps } from "./bench-net";
import {
  LITERT_URL,
  liteRtApi,
  toFloat32,
  xfeatMaps,
  xfeatMethod,
  xfeatModelUrl,
  type LrtTensor,
} from "./method-xfeat";

const IN_SHAPE = [1, 16, 16, 1];

/** A fake tensor that records moves and deletes. */
class FakeTensor implements LrtTensor {
  static log: string[] = [];
  readonly dtype = "float32";
  constructor(
    readonly data: Float32Array,
    readonly shape: number[] = [data.length],
    readonly where = "wasm",
  ) {}
  toTypedArray(): Float32Array {
    if (this.where !== "wasm") {
      throw new Error("read of a gpu tensor");
    }
    return this.data;
  }
  moveTo(destination: string): Promise<LrtTensor> {
    FakeTensor.log.push(`move ${destination}`);
    return Promise.resolve(new FakeTensor(this.data, this.shape, destination));
  }
  delete(): void {
    FakeTensor.log.push("delete");
  }
}

/** Dense outputs for a 16 x 16 input: one sure keypoint at pixel (9, 9). */
function outputs(where: string): FakeTensor[] {
  const cells = 2 * 2;
  const logits = new Float32Array(cells * 65);
  // Cell (1, 1), sub-position dy = 1, dx = 1 -> channel 9, pixel (9, 9).
  logits[3 * 65 + 9] = 12;
  const feats = new Float32Array(cells * 64).fill(1);
  const rel = new Float32Array(cells).fill(1);
  // Out of order on purpose: the adapter must find them by channel count.
  return [
    new FakeTensor(rel, [1, 2, 2, 1], where),
    new FakeTensor(feats, [1, 2, 2, 64], where),
    new FakeTensor(logits, [1, 2, 2, 65], where),
  ];
}

function fakeDeps(): LoadDeps & { compiled: string[] } {
  const compiled: string[] = [];
  let t = 0;
  const api = {
    loadLiteRt: () => Promise.resolve({}),
    loadAndCompile: (_m: Uint8Array, o: { accelerator: string }) => {
      compiled.push(o.accelerator);
      t += 40;
      return Promise.resolve({
        getInputDetails: () => [
          { name: "image", dtype: "float32", shape: IN_SHAPE },
        ],
        run: (inp: LrtTensor[]) =>
          Promise.resolve(outputs((inp[0] as FakeTensor).where)),
        delete: () => FakeTensor.log.push("model delete"),
      });
    },
    Tensor: FakeTensor,
  };
  return {
    compiled,
    importModule: (url) =>
      url === LITERT_URL
        ? Promise.resolve(api)
        : Promise.reject(new Error(url)),
    fetch: () => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))),
    now: () => t,
    resources: () => [],
  };
}

// Why these tests matter: the LiteRT runtime and the model come from the
// network at run time, so the adapter is the only place that checks their
// shape; outputs out of order, float16 data, or a tensor left on the GPU
// would each give wrong numbers or leak memory without an error.
describe("XFeat helpers", () => {
  it("refuses a module that is not LiteRT.js", () => {
    expect(() => liteRtApi({ loadLiteRt: () => 0 })).toThrow(
      "LiteRT.js: no loadAndCompile export",
    );
  });

  it("reads float16 words as numbers", () => {
    expect(
      Array.from(toFloat32(new Uint16Array([0x3c00, 0xc000]), "float16")),
    ).toEqual([1, -2]);
    const f = new Float32Array([0.5]);
    expect(toFloat32(f, "float32")).toBe(f);
  });

  it("names the shapes when a map is missing", () => {
    expect(() =>
      xfeatMaps([{ data: new Float32Array(4), shape: [1, 2, 2, 1] }]),
    ).toThrow("XFeat: no output with 64 channels ([1, 2, 2, 1])");
  });

  it("pins both model files to one revision", () => {
    expect(xfeatModelUrl("fp16")).toMatch(
      /\/resolve\/[0-9a-f]{40}\/xfeat_fp16\.tflite$/,
    );
    expect(xfeatModelUrl("fp32")).toMatch(
      /\/resolve\/[0-9a-f]{40}\/xfeat\.tflite$/,
    );
  });
});

describe("xfeatMethod", () => {
  it("compiles for the backend, finds the keypoint and frees every tensor", async () => {
    FakeTensor.log = [];
    const deps = fakeDeps();
    const runner = await xfeatMethod("webgpu", "fp16", deps).init();
    expect(deps.compiled).toEqual(["webgpu"]);
    expect(runner.initMs).toBe(40);
    expect(runner.downloads[0]).toMatchObject({
      label: "xfeat_fp16.tflite",
      bytes: 3,
    });
    const f = await runner.extract(
      makeFrame(16, 16, new Uint8ClampedArray(16 * 16 * 4).fill(90)),
    );
    expect(f.count).toBe(1);
    expect([f.x[0], f.y[0]]).toEqual([9, 9]);
    expect(f.descriptorBytes).toBe(64 * 4);
    // Input moved to the GPU, three outputs moved back, all released.
    expect(FakeTensor.log.filter((l) => l === "move webgpu")).toHaveLength(1);
    expect(FakeTensor.log.filter((l) => l === "move wasm")).toHaveLength(3);
    expect(FakeTensor.log.filter((l) => l === "delete")).toHaveLength(8);
    expect(Array.from(await runner.match(f, f))).toEqual([0, 0]);
    runner.dispose();
    expect(FakeTensor.log).toContain("model delete");
  });

  it("stays on the host for wasm", async () => {
    FakeTensor.log = [];
    const runner = await xfeatMethod("wasm", "fp32", fakeDeps()).init();
    await runner.extract(makeFrame(16, 16, new Uint8ClampedArray(1024)));
    expect(FakeTensor.log.some((l) => l.startsWith("move"))).toBe(false);
  });
});
