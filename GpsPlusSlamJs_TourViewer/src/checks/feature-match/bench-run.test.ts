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
    expect(runner.disposed).toBe(true);
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
