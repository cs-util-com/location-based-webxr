import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { UNKNOWN_DEVICE } from "./bench-report";
import {
  formatTimingReport,
  parseTimingRuns,
  referenceRatio,
  roundOrder,
  runTiming,
  runTimingByGroup,
  timingBackends,
  type ArmTiming,
  type TimingArm,
  type TimingStep,
} from "./bench-timing";

/** A clock that advances only when an arm's step says so. */
function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const hooks = (now: () => number, lines: string[] = []) => ({
  now,
  yieldToUi: () => Promise.resolve(),
  log: (l: string) => lines.push(l),
});

/** An arm whose runs take the given times in turn, and that records its calls. */
function arm(
  id: string,
  times: number[],
  c: ReturnType<typeof clock>,
  calls: string[],
  opts: { reference?: boolean; group?: string; loadFails?: boolean } = {},
): TimingArm & { disposed: () => boolean } {
  let disposed = false;
  let k = 0;
  return {
    id,
    label: id,
    group: opts.group ?? "wasm",
    reference: opts.reference ?? false,
    disposed: () => disposed,
    async load() {
      await Promise.resolve();
      c.advance(100);
      if (opts.loadFails) {
        throw new Error("no model");
      }
      return {
        backend: "wasm",
        downloads: [],
        startupMs: 40,
        notes: [],
        async step(): Promise<TimingStep> {
          await Promise.resolve();
          calls.push(id);
          const ms = times[Math.min(k, times.length - 1)]!;
          k++;
          if (Number.isNaN(ms)) {
            throw new Error("boom");
          }
          c.advance(ms);
          return { phases: [{ name: "run", ms }], note: `step ${String(k)}` };
        },
        dispose() {
          disposed = true;
        },
      };
    },
  };
}

// Why these tests matter: the steady numbers are only comparable between
// arms when the first run is kept out and every round gives each arm one
// run, in an order that moves, so no arm always follows the heaviest one.
// A plain rotation keeps each arm's successor fixed in all but one
// position per round; a balanced (Williams) order lets every arm follow
// every other equally often over a cycle.
describe("roundOrder", () => {
  it("follows a balanced (Williams) design", () => {
    expect(roundOrder(4, 0)).toEqual([0, 1, 3, 2]);
    expect(roundOrder(4, 1)).toEqual([1, 2, 0, 3]);
    expect(roundOrder(3, 0)).toEqual([0, 1, 2]);
    expect(roundOrder(3, 3)).toEqual([2, 1, 0]);
    expect(roundOrder(3, 6)).toEqual([0, 1, 2]);
    expect(roundOrder(0, 3)).toEqual([]);
  });

  it("property: over a whole cycle every arm follows every other equally often", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 9 }), (count) => {
        const cycle = count % 2 === 0 ? count : 2 * count;
        const follows = new Map<string, number>();
        for (let r = 0; r < cycle; r++) {
          const o = roundOrder(count, r);
          for (let i = 1; i < o.length; i++) {
            const k = `${String(o[i - 1])}>${String(o[i])}`;
            follows.set(k, (follows.get(k) ?? 0) + 1);
          }
        }
        expect(follows.size).toBe(count * (count - 1));
        expect(new Set(follows.values()).size).toBe(1);
      }),
    );
  });

  it("property: every round is a permutation, and over `count` rounds each arm leads once", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (count) => {
        const leads = new Set<number>();
        for (let r = 0; r < count; r++) {
          const o = roundOrder(count, r);
          expect([...o].sort((a, b) => a - b)).toEqual(
            Array.from({ length: count }, (_, i) => i),
          );
          leads.add(o[0]!);
        }
        expect(leads.size).toBe(count);
      }),
    );
  });

  it("refuses a count that is not a whole number", () => {
    expect(() => roundOrder(1.5, 0)).toThrow(RangeError);
  });
});

describe("runTiming", () => {
  it("keeps the first run out of the steady stats and interleaves the rounds", async () => {
    const c = clock();
    const calls: string[] = [];
    const a = arm("A", [500, 10, 20, 30], c, calls, { reference: true });
    const b = arm("B", [900, 40, 40, 40], c, calls);
    const [ra, rb] = await runTiming([a, b], { runs: 3 }, hooks(c.now));
    expect(calls).toEqual(["A", "B", "A", "B", "B", "A", "A", "B"]);
    expect(ra!.total.first).toBe(500);
    expect(ra!.total.steady.n).toBe(3);
    expect(ra!.total.steady.median).toBe(20);
    expect(ra!.loadMs).toBe(100);
    expect(ra!.startupMs).toBe(40);
    expect(rb!.phases[0]!.steady.median).toBe(40);
    expect(referenceRatio(rb!, [ra!, rb!])?.ratio).toBe(2);
    expect(ra!.note).toBe("step 4");
    expect(a.disposed() && b.disposed()).toBe(true);
  });

  it("keeps a failed load or run as that arm's error; the others go on", async () => {
    const c = clock();
    const calls: string[] = [];
    const lines: string[] = [];
    const bad = arm("bad", [], c, calls, { loadFails: true });
    const flaky = arm("flaky", [5, 5, NaN], c, calls);
    const ok = arm("ok", [7], c, calls);
    const r = await runTiming(
      [bad, flaky, ok],
      { runs: 3 },
      hooks(c.now, lines),
    );
    expect(r[0]!.error).toBe("load: Error: no model");
    expect(r[0]!.backend).toBe("-");
    expect(r[1]!.error).toBe("run 2: Error: boom");
    expect(r[1]!.total.steady.n).toBe(1);
    expect(r[2]!.error).toBeNull();
    expect(r[2]!.total.steady.n).toBe(3);
    expect(lines.some((l) => l.startsWith("ERROR bad"))).toBe(true);
    expect(flaky.disposed() && ok.disposed()).toBe(true);
  });

  it("disposes every loaded arm when a hook throws", async () => {
    const c = clock();
    const a = arm("A", [1], c, []);
    let n = 0;
    await expect(
      runTiming(
        [a],
        { runs: 2 },
        {
          ...hooks(c.now),
          yieldToUi: () =>
            ++n === 2
              ? Promise.reject(new Error("tab closed"))
              : Promise.resolve(),
        },
      ),
    ).rejects.toThrow("tab closed");
    expect(a.disposed()).toBe(true);
  });

  it("property: each healthy arm gets exactly one first run and `runs` steady runs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 6 }),
        async (arms, runs) => {
          const c = clock();
          const calls: string[] = [];
          const list = Array.from({ length: arms }, (_, i) =>
            arm(`a${String(i)}`, [3], c, calls),
          );
          const r = await runTiming(list, { runs }, hooks(c.now));
          expect(calls.length).toBe(arms * (runs + 1));
          for (const x of r) {
            expect(x.total.steady.n).toBe(runs);
            expect(x.total.first).toBe(3);
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});

// Why: two backends loaded at once compete for memory and the GPU, and a
// loaded WebGPU session can slow the WASM arms; each group runs alone,
// its sessions released before the next group loads.
describe("runTimingByGroup", () => {
  it("runs each backend group alone, in first-seen order, and keeps the arm order", async () => {
    const c = clock();
    const calls: string[] = [];
    const lines: string[] = [];
    const arms = [
      arm("g1", [10], c, calls, { group: "webgpu" }),
      arm("w1", [20], c, calls, { group: "wasm" }),
      arm("g2", [30], c, calls, { group: "webgpu" }),
    ];
    const loads: string[] = [];
    for (const a of arms) {
      const load = a.load.bind(a);
      a.load = () => {
        const gone = arms.filter((x) => x.disposed()).map((x) => x.id);
        loads.push(`${a.id} (${gone.join(",")})`);
        return load();
      };
    }
    const results = await runTimingByGroup(
      arms,
      { runs: 1 },
      hooks(c.now, lines),
    );
    expect(results.map((r) => r.id)).toEqual(["g1", "g2", "w1"]);
    expect(loads).toEqual(["g1 ()", "g2 ()", "w1 (g1,g2)"]);
    expect(calls).toEqual(["g1", "g2", "g1", "g2", "w1", "w1"]);
    expect(lines.filter((l) => l.startsWith("backend "))).toEqual([
      "backend webgpu: 2 arms",
      "backend wasm: 1 arm",
    ]);
    expect(arms.every((a) => a.disposed())).toBe(true);
  });
});

describe("referenceRatio", () => {
  const timing = (over: Partial<ArmTiming>): ArmTiming => ({
    id: "x",
    label: "x",
    group: "wasm",
    reference: false,
    backend: "wasm",
    downloads: [],
    loadMs: 1,
    startupMs: 1,
    notes: [],
    phases: [],
    total: {
      name: "total",
      first: 1,
      steady: { n: 1, median: 10, p90: 10, min: 10, max: 10 },
    },
    note: "",
    error: null,
    ...over,
  });

  it("compares only within a group, and never against a failed reference", () => {
    const ref = timing({ label: "R", reference: true, group: "webgpu" });
    const arm = timing({ group: "wasm" });
    expect(referenceRatio(arm, [ref, arm])).toBeNull();
    const failed = timing({ reference: true, error: "load: x" });
    expect(referenceRatio(arm, [failed, arm])).toBeNull();
    expect(referenceRatio(failed, [failed, arm])).toBeNull();
  });
});

// Why these tests matter: the phone result reaches us only as this pasted
// text, so it must carry what every number rests on and stay readable.
describe("formatTimingReport", () => {
  it("states settings, runs, backend, downloads, first and steady times, and the ratio", async () => {
    const c = clock();
    const ref = arm("XFeat", [8, 10], c, [], { reference: true });
    const other = arm("Other", [30, 25], c, []);
    const results = await runTiming([ref, other], { runs: 2 }, hooks(c.now));
    const text = formatTimingReport({
      startedAt: "2026-01-01T00:00:00.000Z",
      device: UNKNOWN_DEVICE,
      input: "synthetic pair 640x480",
      settings: "long edge 640, SIFT cap 512, backends wasm",
      runs: 2,
      results: [
        {
          ...results[0]!,
          downloads: [
            { label: "model", bytes: 2048, ms: 12, cached: false, files: 1 },
          ],
        },
        results[1]!,
      ],
      errors: ["camera: denied"],
    });
    expect(text).toContain("settings: long edge 640, SIFT cap 512");
    expect(text).toContain("then 2 interleaved rounds");
    expect(text).toContain("## XFeat (reference)");
    expect(text).toContain("backend: wasm | load 100");
    expect(text).toContain("download model: ");
    expect(text).toContain("(network)");
    expect(text).toContain("first run ms: run 30");
    expect(text).toContain("steady ms (median / p90, n=2): run 25");
    expect(text).toMatch(/ratio to XFeat \(median total\): 2\.50x/);
    expect(text).toContain("ERROR camera: denied");
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("parseTimingRuns and timingBackends", () => {
  it("accepts a whole number 1 to 50, else 10", () => {
    expect(parseTimingRuns("3")).toBe(3);
    expect(parseTimingRuns("50")).toBe(50);
    for (const v of ["0", "51", "2.5", "", "abc"]) {
      expect(parseTimingRuns(v)).toBe(10);
    }
  });

  it("falls back to WASM, with a note, when WebGPU is ticked but missing", () => {
    expect(timingBackends(["webgpu"], false)).toEqual({
      backends: ["wasm"],
      note: "no WebGPU on this device: WASM instead",
    });
    expect(timingBackends(["webgpu", "wasm"], false).backends).toEqual([
      "wasm",
    ]);
    expect(timingBackends(["wasm", "webgpu"], true)).toEqual({
      backends: ["webgpu", "wasm"],
      note: null,
    });
  });
});
