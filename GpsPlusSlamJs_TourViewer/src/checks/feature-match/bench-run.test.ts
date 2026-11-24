import { describe, expect, it } from "vitest";

import { makeFrame } from "./bench-image";
import {
  runBenchmark,
  type BenchHooks,
  type BenchMethod,
  type Features,
  type MethodRunner,
} from "./bench-run";
import { DEFAULT_WARP, warpPoint } from "./bench-synthetic";

const frame = (w: number, h: number) =>
  makeFrame(w, h, new Uint8ClampedArray(w * h * 4));

function hooks(): BenchHooks & { lines: string[]; clock: { t: number } } {
  const lines: string[] = [];
  const clock = { t: 0 };
  return {
    lines,
    clock,
    now: () => clock.t,
    yieldToUi: () => Promise.resolve(),
    log: (l) => lines.push(l),
  };
}

/** A fake method: extraction costs 10 ms, matching 3 ms, 2 keypoints. */
function fakeRunner(
  clock: { t: number },
  over: Partial<MethodRunner> = {},
): MethodRunner & { disposed: boolean; frames: string[] } {
  const r = {
    disposed: false,
    frames: [] as string[],
    backend: "fake-gpu",
    downloads: [],
    initMs: 42,
    notes: ["a note"],
    extract(f: Parameters<MethodRunner["extract"]>[0]): Promise<Features> {
      clock.t += 10;
      r.frames.push(`${String(f.width)}x${String(f.height)}`);
      return Promise.resolve({
        count: 2,
        descriptorBytes: 512,
        x: new Float32Array([1, 2]),
        y: new Float32Array([1, 2]),
        payload: null,
      });
    },
    match(): Promise<Int32Array> {
      clock.t += 3;
      return Promise.resolve(new Int32Array([0, 0]));
    },
    dispose() {
      r.disposed = true;
    },
    ...over,
  };
  return r;
}

const method = (
  id: string,
  init: () => Promise<MethodRunner>,
): BenchMethod => ({
  id,
  label: id,
  init,
});

// Why these tests matter: the loop is where a timing could include the
// warm-up, a failing method could stop every later one, or a loaded model
// could stay in memory; these pin each against a fake method with a fake
// clock.
describe("runBenchmark", () => {
  it("times extraction per frame and matching per pair after one warm-up", async () => {
    const h = hooks();
    const runner = fakeRunner(h.clock);
    const [res] = await runBenchmark(
      [method("fake", () => Promise.resolve(runner))],
      { a: frame(64, 48), b: frame(64, 48), warp: null },
      { sizes: [32, 16], runs: 3 },
      h,
    );
    expect(res!.error).toBeNull();
    expect(res!.backend).toBe("fake-gpu");
    expect(res!.sizes.map((s) => [s.longEdge, s.width, s.height])).toEqual([
      [32, 32, 24],
      [16, 16, 12],
    ]);
    const s = res!.sizes[0]!;
    expect(s.extract).toMatchObject({ n: 6, median: 10, p90: 10 });
    expect(s.match).toMatchObject({ n: 3, median: 3 });
    expect(s.keypoints).toBe(2);
    expect(s.descriptorBytes).toBe(512);
    expect(s.matches).toBe(1);
    expect(s.correct).toBeNull();
    // 2 warm-up + 2 x 3 timed extractions per size.
    expect(runner.frames.filter((f) => f === "32x24")).toHaveLength(8);
    expect(runner.disposed).toBe(true);
  });

  // Why this test matters: the photo tests run once with no warm-up (they
  // count matches, the timing is not their question); without the switch
  // every size would cost a hidden extra round on the phone.
  it("skips the warm-up when asked", async () => {
    const h = hooks();
    const runner = fakeRunner(h.clock);
    await runBenchmark(
      [method("fake", () => Promise.resolve(runner))],
      { a: frame(64, 48), b: frame(64, 48), warp: null },
      { sizes: [32], runs: 1, warmup: false },
      h,
    );
    expect(runner.frames.filter((f) => f === "32x24")).toHaveLength(2);
  });

  // Why this test matters: the page draws each method and size as soon as
  // it is done and saves its keypoints and matches; the sample must be the
  // features of one timed round in the pixels of that size, and arrive
  // through the hook before the whole run ends.
  it("hands each finished size to the hook with one round's keypoints and matches", async () => {
    const h = hooks();
    const seen: string[] = [];
    let call = 0;
    const runner = fakeRunner(h.clock, {
      extract: () => {
        const isB = call++ % 2 === 1;
        return Promise.resolve({
          count: 2,
          descriptorBytes: 0,
          x: new Float32Array(isB ? [5, 6] : [1, 2]),
          y: new Float32Array(isB ? [7, 8] : [3, 4]),
          payload: null,
        });
      },
      match: () => Promise.resolve(new Int32Array([1, 0])),
    });
    const [res] = await runBenchmark(
      [method("m", () => Promise.resolve(runner))],
      { a: frame(64, 48), b: frame(64, 48), warp: null },
      { sizes: [32, 16], runs: 2 },
      {
        ...h,
        onSize: (m, s) => seen.push(`${m.label} ${String(s.longEdge)}`),
      },
    );
    expect(seen).toEqual(["m 32", "m 16"]);
    const sample = res!.sizes[0]!.sample!;
    expect(Array.from(sample.a.x)).toEqual([1, 2]);
    expect(Array.from(sample.b.y)).toEqual([7, 8]);
    expect(Array.from(sample.pairs)).toEqual([1, 0]);
  });

  // Why this test matters: a method may hand back the same pairs buffer on
  // every call; a sample kept by reference would then show the next size's
  // matches under the earlier size, in the pictures and the saved file.
  it("keeps each size's pairs even when the method reuses its buffer", async () => {
    const h = hooks();
    const shared = new Int32Array(2);
    let longEdge = 0;
    const runner = fakeRunner(h.clock, {
      extract: (f) => {
        longEdge = Math.max(f.width, f.height);
        return Promise.resolve({
          count: 1,
          descriptorBytes: 0,
          x: new Float32Array([0]),
          y: new Float32Array([0]),
          payload: null,
        });
      },
      match: () => {
        shared.fill(longEdge);
        return Promise.resolve(shared);
      },
    });
    const [res] = await runBenchmark(
      [method("m", () => Promise.resolve(runner))],
      { a: frame(64, 48), b: frame(64, 48), warp: null },
      { sizes: [32, 16], runs: 1 },
      h,
    );
    expect(Array.from(res!.sizes[0]!.sample!.pairs)).toEqual([32, 32]);
    expect(Array.from(res!.sizes[1]!.sample!.pairs)).toEqual([16, 16]);
  });

  it("keeps a method that fails to load as an error and runs the next", async () => {
    const h = hooks();
    const ok = fakeRunner(h.clock);
    const res = await runBenchmark(
      [
        method("broken", () => Promise.reject(new Error("HTTP 404 for model"))),
        method("ok", () => Promise.resolve(ok)),
      ],
      { a: frame(8, 8), b: frame(8, 8), warp: null },
      { sizes: [8], runs: 1 },
      h,
    );
    expect(res[0]!.error).toBe("init: Error: HTTP 404 for model");
    expect(res[0]!.sizes).toEqual([]);
    expect(res[1]!.error).toBeNull();
    expect(h.lines).toContain("ERROR broken: init: Error: HTTP 404 for model");
  });

  it("keeps a size that fails (out of memory) and disposes the method", async () => {
    const h = hooks();
    const runner = fakeRunner(h.clock, {
      extract: () =>
        Promise.reject(new RangeError("Array buffer allocation failed")),
    });
    const [res] = await runBenchmark(
      [method("oom", () => Promise.resolve(runner))],
      { a: frame(8, 8), b: frame(8, 8), warp: null },
      { sizes: [8, 4], runs: 2 },
      h,
    );
    expect(res!.sizes.map((s) => s.error)).toEqual([
      "RangeError: Array buffer allocation failed",
      "RangeError: Array buffer allocation failed",
    ]);
    expect(res!.sizes[0]!.extract.median).toBeNaN();
    expect(res!.sizes[0]!.sample).toBeNull();
    expect(runner.disposed).toBe(true);
  });

  // Why this test matters: a size the frame cannot be resized to must be
  // one failed row, not an exception that ends the whole run.
  it("keeps a size that cannot be computed as an error", async () => {
    const h = hooks();
    const method: BenchMethod = {
      id: "m",
      label: "M",
      init: () => Promise.resolve(fakeRunner(h.clock)),
    };
    const [r] = await runBenchmark(
      [method],
      { a: frame(40, 30), b: frame(40, 30), warp: null },
      { sizes: [0, 20], runs: 1 },
      h,
    );
    expect(r!.sizes[0]!.error).toMatch(/RangeError/);
    expect(r!.sizes[1]!.error).toBeNull();
  });

  it("counts correct matches against the known warp of a synthetic pair", async () => {
    const h = hooks();
    const [bx, by] = warpPoint(DEFAULT_WARP, 10, 12, 64, 48);
    let call = 0;
    const runner = fakeRunner(h.clock, {
      extract: () => {
        const isB = call++ % 2 === 1;
        return Promise.resolve({
          count: 2,
          descriptorBytes: 0,
          x: new Float32Array(isB ? [bx, 0] : [10, 30]),
          y: new Float32Array(isB ? [by, 0] : [12, 30]),
          payload: null,
        });
      },
      match: () => Promise.resolve(new Int32Array([0, 0, 1, 1])),
    });
    const [res] = await runBenchmark(
      [method("gt", () => Promise.resolve(runner))],
      { a: frame(64, 48), b: frame(64, 48), warp: DEFAULT_WARP },
      { sizes: [64], runs: 2 },
      h,
    );
    expect(res!.sizes[0]!.matches).toBe(2);
    expect(res!.sizes[0]!.correct).toBe(1);
  });
});

// Why: a method that fails to load has no runner to report its backend;
// the queue must still tell a WebGPU load failure (a lost device) from a
// WASM one, so the result carries the backend the method asked for.
describe("runBenchmark, a method that fails to load", () => {
  it("records the backend it asked for, or - when it has no choice", async () => {
    const failing = (backend?: "webgpu" | "wasm"): BenchMethod => ({
      id: "m",
      label: "M",
      ...(backend === undefined ? {} : { backend }),
      init: () => Promise.reject(new Error("device lost")),
    });
    const input = { a: frame(8, 8), b: frame(8, 8), warp: null };
    const [gpu, plain] = await runBenchmark(
      [failing("webgpu"), failing()],
      input,
      { sizes: [8], runs: 1 },
      hooks(),
    );
    expect(gpu!.backend).toBe("webgpu");
    expect(gpu!.error).toBe("init: Error: device lost");
    expect(plain!.backend).toBe("-");
  });
});
