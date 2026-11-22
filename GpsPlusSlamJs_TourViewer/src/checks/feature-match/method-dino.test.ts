import { describe, expect, it } from "vitest";

import { makeFrame } from "./bench-image";
import type { LoadDeps } from "./bench-net";
import { ORT_URL, type OrtTensor } from "./method-aliked";
import { DINO_MODELS, dinoTimingArm } from "./method-dino";

class FakeTensor implements OrtTensor {
  constructor(
    readonly type: string,
    readonly data: Float32Array,
    readonly dims: readonly number[],
  ) {}
}

/** A session whose CLS token is the input's first two values. */
function fakeOrt() {
  const runs: Record<string, OrtTensor>[] = [];
  const created: string[][] = [];
  const api = {
    env: { wasm: {} as { wasmPaths?: unknown; numThreads?: number } },
    InferenceSession: {
      create: (_b: Uint8Array, o: { executionProviders: string[] }) => {
        created.push(o.executionProviders);
        return Promise.resolve({
          inputNames: ["pixel_values"],
          outputNames: ["last_hidden_state", "pooler_output"],
          run(feeds: Record<string, OrtTensor>) {
            runs.push(feeds);
            const x = feeds.pixel_values!.data as Float32Array;
            const out = new Float32Array(3 * 2);
            out.set([x[0]!, 1]);
            return Promise.resolve({
              last_hidden_state: { data: out, dims: [1, 3, 2] },
            });
          },
          release: () => Promise.resolve(),
        });
      },
    },
    Tensor: FakeTensor,
  };
  return { api, runs, created };
}

function deps(mod: unknown, fetched: string[]): LoadDeps {
  let t = 0;
  return {
    importModule: (url) =>
      url === ORT_URL ? Promise.resolve(mod) : Promise.reject(new Error(url)),
    fetch: (url) => {
      fetched.push(url);
      return Promise.resolve(new Response(new Uint8Array(8)));
    },
    now: () => (t += 5),
    resources: () => [],
  };
}

const grey = (v: number) =>
  makeFrame(64, 48, new Uint8ClampedArray(64 * 48 * 4).fill(v));

// Why these tests matter: this arm's number is the forward pass on the
// phone, and its only sanity value is the CLS cosine; the input must have
// the model's fixed shape and the cosine must come from token 0.
describe("dinoTimingArm", () => {
  it("fetches the pinned variant, times both forward passes and reports the CLS cosine", async () => {
    const ort = fakeOrt();
    const fetched: string[] = [];
    const arm = dinoTimingArm(
      "q4f16",
      "wasm",
      deps(ort.api, fetched),
      { a: grey(255), b: grey(255) },
      { bytes: 8 },
    );
    expect(arm.group).toBe("wasm");
    expect(arm.reference).toBe(false);
    const loaded = await arm.load();
    expect(fetched).toEqual([DINO_MODELS.q4f16.url]);
    expect(DINO_MODELS.q4f16.url).toContain("/resolve/8b1f705a");
    expect(ort.created).toEqual([["wasm"]]);
    expect(loaded.startupMs).toBe(5);
    expect(loaded.downloads[0]!.label).toBe("DINOv2 q4f16");

    const step = await loaded.step();
    expect(ort.runs).toHaveLength(2);
    expect(ort.runs[0]!.pixel_values!.dims).toEqual([1, 3, 224, 224]);
    expect(step.phases.map((p) => p.name)).toEqual([
      "preprocess",
      "forward A",
      "forward B",
    ]);
    expect(step.note).toMatch(/^cosine A-B 1\.0000/);
    loaded.dispose();
  });

  it("says which output is missing instead of reading garbage", async () => {
    const ort = fakeOrt();
    // The fake runtime's session type fixes its output; this one has none.
    (ort.api.InferenceSession as { create: () => Promise<unknown> }).create =
      () =>
        Promise.resolve({
          inputNames: ["pixel_values"],
          outputNames: ["last_hidden_state"],
          run: () => Promise.resolve({}),
          release: () => Promise.resolve(),
        });
    const loaded = await dinoTimingArm(
      "int8",
      "wasm",
      deps(ort.api, []),
      { a: grey(1), b: grey(2) },
      { bytes: 8 },
    ).load();
    await expect(loaded.step()).rejects.toThrow(
      "DINOv2: no last_hidden_state output",
    );
  });

  // Why: a file of another size is another model (or an error page); its
  // timings would be reported as the pinned variant's.
  it("refuses a file that is not the pinned size, before any session", async () => {
    const ort = fakeOrt();
    await expect(
      dinoTimingArm("int8", "wasm", deps(ort.api, []), {
        a: grey(1),
        b: grey(2),
      }).load(),
    ).rejects.toThrow(/DINOv2 int8: 8 bytes, not the pinned 24446700/);
    expect(ort.created).toEqual([]);
  });

  // Why: a release that fails after the run must not become an unhandled
  // rejection (the page logs those as errors of the run).
  it("swallows a failing session release", async () => {
    const ort = fakeOrt();
    const create = ort.api.InferenceSession.create;
    ort.api.InferenceSession.create = async (b, o) => ({
      ...(await create(b, o)),
      release: () => Promise.reject(new Error("gone")),
    });
    const loaded = await dinoTimingArm(
      "int8",
      "wasm",
      deps(ort.api, []),
      { a: grey(1), b: grey(2) },
      { bytes: 8 },
    ).load();
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    loaded.dispose();
    await new Promise((r) => setTimeout(r, 10));
    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
  });
});
