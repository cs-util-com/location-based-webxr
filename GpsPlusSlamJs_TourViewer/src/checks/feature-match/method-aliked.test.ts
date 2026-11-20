import { describe, expect, it } from "vitest";

import { makeFrame } from "./bench-image";
import type { LoadDeps } from "./bench-net";
import {
  ALIKED_EXTRACTOR_URL,
  LIGHTGLUE_URL,
  ORT_URL,
  ORT_WASM_DIR,
  alikedMethod,
  ortApi,
  type OrtTensor,
} from "./method-aliked";

const K = 2;

class FakeTensor implements OrtTensor {
  constructor(
    readonly type: string,
    readonly data: Float32Array,
    readonly dims: readonly number[],
  ) {}
}

function fakeOrt() {
  const runs: Record<string, OrtTensor>[] = [];
  const released: string[] = [];
  const created: string[][] = [];
  const session = (kind: "extractor" | "matcher") => ({
    inputNames:
      kind === "extractor"
        ? ["images"]
        : ["normalized_keypoints", "descriptors"],
    // Renamed outputs on the extractor: the adapter must fall back to order.
    outputNames:
      kind === "extractor" ? ["kp", "nkp", "desc"] : ["matches0", "mscores0"],
    run(feeds: Record<string, OrtTensor>) {
      runs.push(feeds);
      if (kind === "extractor") {
        const img = feeds.images!;
        const [, , h, w] = img.dims as number[];
        return Promise.resolve({
          // Keypoints at the model input's (0, 0) and its far corner.
          kp: new FakeTensor(
            "float32",
            new Float32Array([0, 0, w! - 1, h! - 1]),
            [1, K, 2],
          ),
          nkp: new FakeTensor("float32", new Float32Array(K * 2), [1, K, 2]),
          desc: new FakeTensor("float32", new Float32Array(K * 8), [1, K, 8]),
        });
      }
      return Promise.resolve({
        matches0: { data: new BigInt64Array([1n, -1n]), dims: [1, K] },
        mscores0: { data: new Float32Array(K), dims: [1, K] },
      });
    },
    release() {
      released.push(kind);
      return Promise.resolve();
    },
  });
  let n = 0;
  const api = {
    env: { wasm: {} as { wasmPaths?: unknown; numThreads?: number } },
    InferenceSession: {
      create: (_b: Uint8Array, o: { executionProviders: string[] }) => {
        created.push(o.executionProviders);
        return Promise.resolve(session(n++ === 0 ? "extractor" : "matcher"));
      },
    },
    Tensor: FakeTensor,
  };
  return { api, runs, released, created };
}

function deps(mod: unknown, fetched: string[]): LoadDeps {
  return {
    importModule: (url) =>
      url === ORT_URL ? Promise.resolve(mod) : Promise.reject(new Error(url)),
    fetch: (url) => {
      fetched.push(url);
      return Promise.resolve(new Response(new Uint8Array(4)));
    },
    now: () => 0,
    resources: () => [],
  };
}

// Why these tests matter: both models and the runtime arrive at run time,
// so the adapter is where shapes are checked; a frame not cut to multiples
// of 32, keypoints left in model pixels, or a -1 read as a match would all
// give plausible but wrong numbers.
describe("ortApi", () => {
  it("refuses a module without sessions", () => {
    expect(() => ortApi({ Tensor: () => 0 })).toThrow(
      "onnxruntime-web: no InferenceSession.create",
    );
  });
});

describe("alikedMethod", () => {
  it("loads both pinned models, cuts the frame to multiples of 32 and maps keypoints back", async () => {
    const ort = fakeOrt();
    const fetched: string[] = [];
    const runner = await alikedMethod("wasm", deps(ort.api, fetched)).init();
    expect(fetched).toEqual([ALIKED_EXTRACTOR_URL, LIGHTGLUE_URL]);
    expect(ort.created).toEqual([["wasm"], ["wasm"]]);
    expect(ort.api.env.wasm.wasmPaths).toBe(ORT_WASM_DIR);
    expect(runner.downloads.map((d) => d.label)).toEqual([
      "ALIKED extractor",
      "LightGlue matcher",
    ]);

    const f = await runner.extract(
      makeFrame(100, 50, new Uint8ClampedArray(100 * 50 * 4)),
    );
    expect(ort.runs[0]!.images!.dims).toEqual([1, 3, 64, 96]);
    expect(f.count).toBe(K);
    expect(f.descriptorBytes).toBe(K * 8 * 4);
    // The model input's far corner pixel centre is the frame's far corner.
    expect(f.x[1]).toBeCloseTo(99 - (100 / 96 - 1) / 2, 4);
    expect(f.y[1]).toBeCloseTo(49 - (50 / 64 - 1) / 2, 4);

    const pairs = await runner.match(f, f);
    expect(Array.from(pairs)).toEqual([0, 1]);
    expect(ort.runs[1]!.normalized_keypoints!.dims).toEqual([2, 1, K, 2]);
    expect(ort.runs[1]!.descriptors!.dims).toEqual([2, 1, K, 8]);

    runner.dispose();
    expect(ort.released).toEqual(["extractor", "matcher"]);
  });
});
