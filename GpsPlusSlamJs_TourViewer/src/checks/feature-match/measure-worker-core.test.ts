import { describe, expect, it } from "vitest";

import { makeFrame, type Frame } from "./bench-image";
import type { BenchMethod, MethodResult } from "./bench-run";
import type { MethodSelection } from "./bench-methods";
import type { MeasureAnswer } from "./measure-protocol";
import {
  handleMeasure,
  measureMsOf,
  type MeasureEnv,
} from "./measure-worker-core";

/** A frame whose pixels say which photo it is: R = 10 * index + x. */
function frame(width: number, height: number, tag: number): Frame {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = tag * 10 + (i % width);
    rgba[i * 4 + 3] = 255;
  }
  return makeFrame(width, height, rgba);
}

function fakeMethod(seen: Frame[]): BenchMethod {
  return {
    id: "fake",
    label: "Fake",
    init: () =>
      Promise.resolve({
        backend: "js (worker)",
        downloads: [],
        initMs: 500,
        notes: [],
        extract: (f: Frame) => {
          seen.push(f);
          return Promise.resolve({
            count: 1,
            descriptorBytes: 1,
            x: Float32Array.of(0),
            y: Float32Array.of(0),
            payload: null,
          });
        },
        match: () => Promise.resolve(Int32Array.of(0, 0)),
        dispose: () => undefined,
      }),
  };
}

function env(over: Partial<MeasureEnv> = {}) {
  const seen: Frame[] = [];
  const built: { selection: MethodSelection }[] = [];
  let t = 0;
  const e: MeasureEnv = {
    decode: (blob) =>
      blob.text().then((s) => (s === "A" ? frame(4, 2, 1) : frame(4, 2, 2))),
    webgpu: () => Promise.resolve(false),
    build: (selection) => {
      built.push({ selection });
      return [fakeMethod(seen)];
    },
    now: () => (t += 10),
    kept: new Map(),
    ...over,
  };
  return { e, seen, built };
}

const request = (over: Record<string, unknown> = {}) => ({
  type: "measure",
  job: 4,
  a: new Blob(["A"]),
  b: new Blob(["B"]),
  turn: null,
  methods: { sift: true, aliked: true, siftLightGlue: false },
  sizes: [4],
  pair: "2a",
  ...over,
});

async function run(data: unknown, e: MeasureEnv): Promise<MeasureAnswer[]> {
  const posted: MeasureAnswer[] = [];
  await handleMeasure(data, e, (a) => posted.push(a));
  return posted;
}

// Why these tests matter: the worker is the only place the phone measures
// a pair now; it must measure exactly the frames the zip names (the
// squares and the turn of a rotation pair), with the photo test's
// settings, never XFeat, and answer every job it can read, so the queue
// never waits on a pair the worker dropped.
describe("handleMeasure", () => {
  it("measures the two photos with the photo test settings and posts the result", async () => {
    const { e, seen, built } = env();
    const posted = await run(request(), e);
    expect(built[0]!.selection).toEqual({
      sift: true,
      xfeat: false,
      aliked: true,
      siftLightGlue: false,
      backends: ["wasm"],
      precisions: ["fp16"],
    });
    expect(posted.filter((a) => a.type === "progress").length).toBeGreaterThan(
      0,
    );
    const last = posted.at(-1)!;
    expect(last).toMatchObject({
      type: "done",
      job: 4,
      frames: { a: { width: 4, height: 2 }, b: { width: 4, height: 2 } },
      settings: expect.stringMatching(/^runs: 1, no warm-up, backends wasm/),
    });
    // One timed round, no warm-up: each frame extracted once.
    expect(seen.map((f) => f.rgba[0])).toEqual([10, 20]);
  });

  it("cuts both photos to the centre square and turns B for a rotation pair", async () => {
    const { e, seen } = env();
    // Size 2: the square's own size, so the frames are not resampled.
    const posted = await run(request({ turn: 180, sizes: [2] }), e);
    expect(posted.at(-1)).toMatchObject({
      type: "done",
      frames: { a: { width: 2, height: 2 }, b: { width: 2, height: 2 } },
    });
    const [a, b] = seen;
    // The centre square of a 4x2 frame starts at x = 1; a half turn puts
    // B's last pixel of the square first.
    expect([a!.rgba[0], a!.rgba[4]]).toEqual([11, 12]);
    expect([b!.rgba[0], b!.rgba[4]]).toEqual([22, 21]);
  });

  it("leaves the methods' load time out of the measuring time", async () => {
    const { e } = env();
    const posted = await run(request(), e);
    const last = posted.at(-1)!;
    if (last.type !== "done") {
      throw new Error("not done");
    }
    expect(last.measureMs).toBe(measureMsOf(last.results));
    expect(last.measureMs).toBeGreaterThan(0);
    expect(last.measureMs).toBeLessThan(500);
  });

  it("answers failed when a photo cannot be decoded", async () => {
    const { e } = env({
      decode: () => Promise.reject(new Error("broken PNG")),
    });
    expect(await run(request(), e)).toEqual([
      {
        type: "failed",
        job: 4,
        message: "a photo could not be decoded: Error: broken PNG",
      },
    ]);
  });

  it("answers failed for a malformed request with a job, and drops one without", async () => {
    const { e } = env();
    expect(await run(request({ turn: 45 }), e)).toEqual([
      { type: "failed", job: 4, message: "malformed request" },
    ]);
    expect(await run({ type: "measure" }, e)).toEqual([]);
  });
});

const sizeOf = (
  extract: number,
  match: number,
  error: string | null = null,
) => ({
  longEdge: 4,
  width: 4,
  height: 2,
  extract: { n: 2, median: extract, p90: extract, min: extract, max: extract },
  match: { n: 1, median: match, p90: match, min: match, max: match },
  keypoints: 1,
  descriptorBytes: 1,
  matches: 1,
  correct: null,
  sample: null,
  error,
});

// Why this test matters: the end screen's estimate multiplies this time
// by the pairs left; a load time or a failed size in it would inflate the
// estimate by minutes.
describe("measureMsOf", () => {
  it("sums both extracts and the match of every size that ran", () => {
    const results: MethodResult[] = [
      {
        id: "a",
        label: "A",
        backend: "x",
        downloads: [],
        initMs: 900,
        notes: [],
        sizes: [sizeOf(10, 3), sizeOf(Number.NaN, Number.NaN, "boom")],
        error: null,
      },
      {
        id: "b",
        label: "B",
        backend: "-",
        downloads: [],
        initMs: Number.NaN,
        notes: [],
        sizes: [],
        error: "init: offline",
      },
    ];
    expect(measureMsOf(results)).toBe(23);
  });
});

/** A method that counts its loads and disposals; `fail` breaks extracts. */
function countingMethod(
  fail: { extract: boolean; init: boolean },
  over: { id?: string; backend?: "webgpu" | "wasm"; dispose?: () => void } = {},
) {
  const count = { init: 0, dispose: 0 };
  const method: BenchMethod = {
    id: over.id ?? "counted",
    label: "Counted",
    ...(over.backend === undefined ? {} : { backend: over.backend }),
    init: () => {
      count.init += 1;
      if (fail.init) {
        return Promise.reject(new Error("no session"));
      }
      return Promise.resolve({
        backend: "wasm (execution provider)",
        downloads: [],
        initMs: 1000,
        notes: ["init = both sessions created"],
        extract: () =>
          fail.extract
            ? Promise.reject(new Error("device lost"))
            : Promise.resolve({
                count: 1,
                descriptorBytes: 1,
                x: Float32Array.of(0),
                y: Float32Array.of(0),
                payload: null,
              }),
        match: () => Promise.resolve(Int32Array.of(0, 0)),
        dispose: () => {
          count.dispose += 1;
          over.dispose?.();
        },
      });
    },
  };
  return { method, count };
}

const resultsOf = (
  posted: readonly MeasureAnswer[],
): readonly MethodResult[] => {
  const last = posted.at(-1);
  if (last?.type !== "done") {
    throw new Error("not done");
  }
  return last.results;
};

// Why these tests matter: phone logs showed ALIKED + LightGlue spending
// about a second on "ready" for every pair, because each pair built its
// ONNX sessions again. The worker keeps a method's loaded runner for the
// next pair; a worker started again (after a crash) starts empty, and a
// runner that failed is dropped so a broken session is not kept forever.
describe("handleMeasure keeps loaded methods across pairs", () => {
  // The kept map is the worker's: `serveMeasureWorker` makes one per
  // worker (not unit-tested, the browser test runs it), so an empty map
  // stands for a worker started again.
  it("loads a method once for two pairs, and again with an empty kept map", async () => {
    const fail = { extract: false, init: false };
    const { method, count } = countingMethod(fail);
    const { e } = env({ build: () => [method] });
    const first = resultsOf(await run(request({ job: 1 }), e));
    const second = resultsOf(await run(request({ job: 2 }), e));
    expect(count).toEqual({ init: 1, dispose: 0 });
    expect(first[0]!.initMs).toBe(1000);
    // The second pair paid no load: its init time says so, and a note
    // tells the reader of the zip why.
    expect(second[0]!.initMs).toBe(0);
    expect(second[0]!.notes).toContain("loaded for an earlier pair");
    // An empty kept map, as a worker started again has.
    const { e: restarted } = env({ build: () => [method] });
    await run(request({ job: 3 }), restarted);
    expect(count.init).toBe(2);
  });

  it("drops a runner whose pair failed, so the next pair loads it again", async () => {
    const fail = { extract: true, init: false };
    const { method, count } = countingMethod(fail);
    const { e } = env({ build: () => [method] });
    const broken = resultsOf(await run(request({ job: 1 }), e));
    expect(broken[0]!.sizes[0]!.error).not.toBeNull();
    expect(count).toEqual({ init: 1, dispose: 1 });
    fail.extract = false;
    const next = resultsOf(await run(request({ job: 2 }), e));
    expect(count.init).toBe(2);
    expect(next[0]!.initMs).toBe(1000);
  });

  // Why: a method unticked between pairs is not built again; its kept
  // runner (an ONNX session, GPU memory) must be freed, not held forever.
  it("disposes the kept runner of a method no longer built", async () => {
    const fail = { extract: false, init: false };
    const { method, count } = countingMethod(fail);
    let methods: BenchMethod[] = [method];
    const { e } = env({ build: () => methods });
    await run(request({ job: 1 }), e);
    methods = [];
    await run(request({ job: 2 }), e);
    await Promise.resolve();
    expect(count).toEqual({ init: 1, dispose: 1 });
    expect(e.kept.size).toBe(0);
  });

  it("forgets a load that failed, so the next pair tries again", async () => {
    const fail = { extract: false, init: true };
    const { method, count } = countingMethod(fail);
    const { e } = env({ build: () => [method] });
    const broken = resultsOf(await run(request({ job: 1 }), e));
    expect(broken[0]!.error).toBe("init: Error: no session");
    fail.init = false;
    resultsOf(await run(request({ job: 2 }), e));
    expect(count).toEqual({ init: 2, dispose: 0 });
  });
});

// Why: every kept model method holds its sessions (and their memory), so
// keeping all ticked ones makes the peak the sum of them; a low-memory
// phone runs out, the worker restarts and runs out again. The worker keeps
// at most one model method loaded, the last one used; sift.js stays.
describe("handleMeasure keeps one model method at a time", () => {
  it("disposes the other model method before loading the next, and keeps SIFT", async () => {
    const ok = { extract: false, init: false };
    const sift = countingMethod(ok, { id: "sift" });
    const a = countingMethod(ok, { id: "a-webgpu", backend: "webgpu" });
    const b = countingMethod(ok, { id: "b-webgpu", backend: "webgpu" });
    const { e } = env({ build: () => [sift.method, a.method, b.method] });
    await run(request({ job: 1 }), e);
    await Promise.resolve();
    expect([...e.kept.keys()]).toEqual(["sift", "b-webgpu"]);
    expect(a.count).toEqual({ init: 1, dispose: 1 });
    await run(request({ job: 2 }), e);
    await Promise.resolve();
    expect(sift.count).toEqual({ init: 1, dispose: 0 });
    expect(a.count).toEqual({ init: 2, dispose: 2 });
    expect(b.count).toEqual({ init: 2, dispose: 1 });
    expect([...e.kept.keys()]).toEqual(["sift", "b-webgpu"]);
  });
});

// Why: the page waits for every job's answer (ten minutes before its
// timeout); a throw outside the measuring (a post that cannot be sent, a
// dispose that throws) must still answer the job, never reject or leave
// an unhandled rejection behind.
describe("handleMeasure never rejects", () => {
  it("answers failed when posting the result throws", async () => {
    const { e } = env();
    const posted: MeasureAnswer[] = [];
    await expect(
      handleMeasure(request({ job: 7 }), e, (a) => {
        if (a.type === "done") {
          throw new Error("could not be cloned");
        }
        posted.push(a);
      }),
    ).resolves.toBeUndefined();
    expect(posted.at(-1)).toEqual({
      type: "failed",
      job: 7,
      message: "Error: could not be cloned",
    });
  });

  it("resolves even when every post throws", async () => {
    const { e } = env();
    const decodeFails = env({
      decode: () => Promise.reject(new Error("not a PNG")),
    }).e;
    const post = () => {
      throw new Error("the port is closed");
    };
    await expect(handleMeasure(request({ job: 8 }), e, post)).resolves.toBe(
      undefined,
    );
    await expect(
      handleMeasure(request({ job: 9 }), decodeFails, post),
    ).resolves.toBe(undefined);
    await expect(handleMeasure({ job: 10 }, e, post)).resolves.toBe(undefined);
  });

  it("swallows a dispose that throws", async () => {
    const ok = { extract: false, init: false };
    const { method } = countingMethod(ok, {
      dispose: () => {
        throw new Error("session gone");
      },
    });
    let methods: BenchMethod[] = [method];
    const { e } = env({ build: () => methods });
    await run(request({ job: 1 }), e);
    methods = [];
    const posted = await run(request({ job: 2 }), e);
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
    expect(posted.at(-1)?.type).toBe("done");
    expect(e.kept.size).toBe(0);
  });
});
