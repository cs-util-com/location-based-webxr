import { describe, expect, it } from "vitest";

import { makeFrame } from "./bench-image";
import type { LoadDeps } from "./bench-net";
import { ORT_URL, type OrtTensor } from "./method-aliked";
import { SIFT_URL } from "./method-sift";
import {
  SIFT_LIGHTGLUE_PATH,
  SIFT_LIGHTGLUE_SHA256,
  sha256Hex,
  siftLightGlueMethod,
} from "./method-sift-lightglue";
import { LIGHTGLUE_SIFT_INPUTS } from "./sift-lightglue-io";

const MODEL = new Uint8Array([1, 2, 3, 4]);

class FakeTensor implements OrtTensor {
  constructor(
    readonly type: string,
    readonly data: Float32Array,
    readonly dims: readonly number[],
  ) {}
}

/** sift.js stand-in: `n` keypoints with scales, angles in [0, 2 pi) and bytes. */
function detectSift(_g: Float32Array, _w: number, _h: number, max: number) {
  const n = Math.min(3, max);
  const desc = new Uint8Array(n * 128).fill(7);
  return {
    n,
    x: Float32Array.from({ length: n }, (_, i) => 10 + i),
    y: Float32Array.from({ length: n }, (_, i) => 20 + i),
    scale: Float32Array.from({ length: n }, () => 2),
    angle: Float32Array.from({ length: n }, () => 1.5 * Math.PI),
    desc,
  };
}

function fakeOrt() {
  const runs: Record<string, OrtTensor>[] = [];
  const created: string[][] = [];
  let released = 0;
  const api = {
    env: { wasm: {} as { wasmPaths?: unknown; numThreads?: number } },
    InferenceSession: {
      create: (_b: Uint8Array, o: { executionProviders: string[] }) => {
        created.push(o.executionProviders);
        return Promise.resolve({
          inputNames: [...LIGHTGLUE_SIFT_INPUTS],
          outputNames: ["matches0", "mscores0"],
          run(feeds: Record<string, OrtTensor>) {
            runs.push(feeds);
            const n = feeds.kpts0!.dims[1]!;
            return Promise.resolve({
              matches0: {
                data: BigInt64Array.from({ length: n }, (_, i) =>
                  i === 1 ? -1n : BigInt(i),
                ),
                dims: [n],
              },
              mscores0: { data: new Float32Array(n), dims: [n] },
            });
          },
          release() {
            released++;
            return Promise.resolve();
          },
        });
      },
    },
    Tensor: FakeTensor,
  };
  return { api, runs, created, released: () => released };
}

function deps(ortMod: unknown, fetched: string[]): LoadDeps {
  return {
    importModule: (url) =>
      url === ORT_URL
        ? Promise.resolve(ortMod)
        : url === SIFT_URL
          ? Promise.resolve({ detectSift })
          : Promise.reject(new Error(url)),
    fetch: (url) => {
      fetched.push(url);
      return Promise.resolve(new Response(MODEL));
    },
    now: () => 0,
    resources: () => [],
  };
}

const frame = () => makeFrame(40, 30, new Uint8ClampedArray(40 * 30 * 4));

// Why these tests matter: the model arrives through a mirror at run time,
// so a wrong file must stop at the hash check rather than time something
// else; and the ten inputs must carry the RootSIFT, scale and orientation
// layout the export reads, or it runs and matches nothing.
describe("siftLightGlueMethod", () => {
  it("checks the hash, feeds the ten inputs and keeps LightGlue's matches", async () => {
    const ort = fakeOrt();
    const fetched: string[] = [];
    const runner = await siftLightGlueMethod("webgpu", deps(ort.api, fetched), {
      modelUrl: "https://example.test/m.onnx",
      sha256: await sha256Hex(MODEL),
      maxFeatures: 2,
    }).init();
    expect(fetched).toEqual(["https://example.test/m.onnx"]);
    expect(ort.created).toEqual([["webgpu"]]);
    expect(runner.downloads.map((d) => d.label)).toEqual([
      "SIFT LightGlue matcher",
    ]);

    const f = await runner.extract(frame());
    expect(f.count).toBe(2);
    expect(Array.from(f.x)).toEqual([10, 11]);
    const pairs = await runner.match(f, f);
    expect(Array.from(pairs)).toEqual([0, 0]);

    const feeds = ort.runs[0]!;
    expect(Object.keys(feeds)).toEqual([...LIGHTGLUE_SIFT_INPUTS]);
    expect(feeds.desc0!.dims).toEqual([1, 2, 128]);
    // 7s in every byte: a unit row of 1/sqrt(128).
    expect((feeds.desc0!.data as Float32Array)[0]).toBeCloseTo(
      1 / Math.sqrt(128),
      6,
    );
    expect((feeds.oris1!.data as Float32Array)[0]).toBeCloseTo(
      -0.5 * Math.PI,
      6,
    );
    expect(Array.from(feeds.image_size0!.data as Float32Array)).toEqual([
      40, 30,
    ]);
    runner.dispose();
    expect(ort.released()).toBe(1);
  });

  it("refuses a model whose sha256 is not the pinned one, before any session", async () => {
    const ort = fakeOrt();
    const fetched: string[] = [];
    await expect(
      siftLightGlueMethod("wasm", deps(ort.api, fetched)).init(),
    ).rejects.toThrow(/sha256 .* is not the pinned model's e0500228472b/);
    expect(fetched[0]).toContain(SIFT_LIGHTGLUE_PATH);
    expect(SIFT_LIGHTGLUE_PATH).toBe("/api/model/sift-lightglue-3.13.0.onnx");
    expect(ort.created).toEqual([]);
    expect(SIFT_LIGHTGLUE_SHA256).toHaveLength(64);
  });

  it("does not run the model when a frame has no keypoints", async () => {
    const ort = fakeOrt();
    const runner = await siftLightGlueMethod("wasm", deps(ort.api, []), {
      sha256: await sha256Hex(MODEL),
    }).init();
    const empty = {
      count: 0,
      descriptorBytes: 0,
      x: new Float32Array(),
      y: new Float32Array(),
      payload: null,
    };
    expect((await runner.match(empty, empty)).length).toBe(0);
    expect(ort.runs).toEqual([]);
  });
});

// Why: a release that fails after the run must not become an unhandled
// rejection (the page logs those as errors of the run).
describe("siftLightGlueMethod dispose", () => {
  it("swallows a failing session release", async () => {
    const ort = fakeOrt();
    const create = ort.api.InferenceSession.create;
    ort.api.InferenceSession.create = async (b, o) => ({
      ...(await create(b, o)),
      release: () => Promise.reject(new Error("gone")),
    });
    const runner = await siftLightGlueMethod("wasm", deps(ort.api, []), {
      sha256: await sha256Hex(MODEL),
    }).init();
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    runner.dispose();
    await new Promise((r) => setTimeout(r, 10));
    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
  });
});

describe("sha256Hex", () => {
  it("gives the known digest of an empty input", async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

// Why: SIFT's keypoints run on whatever thread built the method; the note
// must say which, or a worker result reads as a main-thread one.
describe("siftLightGlueMethod context", () => {
  it("names the thread SIFT runs on in its note", async () => {
    const notes = async (context?: "main thread" | "worker") =>
      (
        await siftLightGlueMethod("wasm", deps(fakeOrt().api, []), {
          sha256: await sha256Hex(MODEL),
          context,
        }).init()
      ).notes[0];
    expect(await notes()).toContain("(sift.js, main thread)");
    expect(await notes("worker")).toContain("(sift.js, worker)");
  });
});
