import { describe, expect, it, vi } from "vitest";

import type { MethodResult, SizeResult } from "./bench-run";
import {
  cameraVerdict,
  DEFAULT_PLAN,
  gapStats,
  methodTimes,
  plainError,
  REASON_MAX,
  shortReason,
  spikePlanFrom,
  spikeProgress,
  spikeSummary,
  verdictSweep,
  xfeatOutcome,
  xfeatTimedOut,
  XFEAT_LIMIT_MS,
  type GapStats,
} from "./worker-spike-model";

const summary = (median: number) => ({
  median,
  p90: median,
  min: median,
  max: median,
  n: 1,
});

const size = (
  longEdge: number,
  extract: number,
  match: number,
  error: string | null = null,
): SizeResult => ({
  longEdge,
  width: longEdge,
  height: longEdge,
  extract: summary(extract),
  match: summary(match),
  keypoints: 10,
  descriptorBytes: 10,
  matches: 5,
  correct: null,
  sample: null,
  error,
});

const method = (
  id: string,
  sizes: SizeResult[],
  error: string | null = null,
  initMs = 300,
): MethodResult => ({
  id,
  label: `${id} label`,
  backend: "webgpu",
  downloads: [],
  initMs,
  notes: [],
  sizes,
  error,
});

const stats = (
  p95: number,
  p99: number,
  max: number,
  count = 100,
): GapStats => ({
  count,
  p95,
  p99,
  max,
});

describe("gapStats", () => {
  // Why: the verdict reads these three numbers; a wrong percentile would
  // pass or fail the camera on the wrong frame.
  it("gives nearest-rank p95, p99 and the largest gap", () => {
    const gaps = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(gapStats(gaps)).toEqual({ count: 100, p95: 95, p99: 99, max: 100 });
  });

  // Why: a broken clock must not turn into a NaN verdict or a negative gap.
  it("drops non-finite and negative gaps", () => {
    expect(gapStats([33, Number.NaN, -5, Infinity, 40])).toEqual({
      count: 2,
      p95: 40,
      p99: 40,
      max: 40,
    });
  });

  it("is empty for no gaps", () => {
    expect(gapStats([]).count).toBe(0);
  });
});

describe("cameraVerdict", () => {
  const base = stats(40, 50, 70);

  // Why: the stop rule - p95 and p99 within 1.25x the camera at rest and
  // no gap over 250 ms - is what the whole page is for.
  it("is smooth within 1.25x the baseline and under the cap", () => {
    expect(cameraVerdict(stats(50, 62.5, 250), base)).toBe("smooth");
  });

  it("stutters when p95 grows past 1.25x the baseline", () => {
    expect(cameraVerdict(stats(50.1, 50, 100), base)).toBe("stutter");
  });

  it("stutters when p99 grows past 1.25x the baseline", () => {
    expect(cameraVerdict(stats(40, 62.6, 100), base)).toBe("stutter");
  });

  // Why: a single long freeze is what a person sees, even when the
  // percentiles hide it.
  it("stutters on a single gap over 250 ms", () => {
    expect(cameraVerdict(stats(40, 50, 251), base)).toBe("stutter");
  });

  // Why: no frames at all is not "smooth"; it must not read as a pass.
  it("is unknown without frames on either side", () => {
    expect(cameraVerdict(stats(0, 0, 0, 0), base)).toBe("unknown");
    expect(cameraVerdict(base, stats(0, 0, 0, 0))).toBe("unknown");
  });

  // Why: the rule's parameters are choices; the log must show which
  // values would reverse the verdict.
  it("sweeps the factor and the cap for the log", () => {
    expect(verdictSweep(stats(55, 60, 300), base)).toBe(
      "factor 1.1: nnn, 1.25: nnn, 1.5: nnY (caps 150/250/400 ms)",
    );
  });
});

describe("spikePlanFrom", () => {
  // Why: the phone run uses the defaults; only a short test run sets them.
  it("uses the defaults without parameters", () => {
    expect(spikePlanFrom("")).toEqual(DEFAULT_PLAN);
    expect(DEFAULT_PLAN.baselineMs).toBe(10_000);
    expect(DEFAULT_PLAN.pairs).toBe(6);
  });

  it("reads a short baseline and fewer pairs", () => {
    const p = spikePlanFrom("?spike=worker&baseline=2&pairs=2");
    expect(p.baselineMs).toBe(2000);
    expect(p.pairs).toBe(2);
  });

  // Why: a typo in the URL must not give a run of 0 pairs or of hours.
  it("ignores values out of range", () => {
    expect(spikePlanFrom("?baseline=0&pairs=99")).toEqual(DEFAULT_PLAN);
    expect(spikePlanFrom("?baseline=abc&pairs=1.5")).toEqual(DEFAULT_PLAN);
  });
});

describe("spikeProgress", () => {
  const plan = { ...DEFAULT_PLAN, pairs: 2 };
  const at = (
    step: Parameters<typeof spikeProgress>[0]["step"],
    elapsed: number,
    pairMs: number[] = [],
    live: "smooth" | "stutter" | "unknown" = "unknown",
  ) =>
    spikeProgress({
      plan,
      step,
      stepStartedAt: 1000,
      pairMs,
      live,
      now: 1000 + elapsed,
    });

  // Why: a person must see which step of how many is running.
  it("counts the steps: baseline, photos, each pair, XFeat", () => {
    expect(at({ kind: "baseline" }, 0).step).toBe(1);
    expect(at({ kind: "baseline" }, 0).of).toBe(5);
    expect(at({ kind: "photos", taken: 0 }, 0).step).toBe(2);
    expect(at({ kind: "pairs", done: 1 }, 0, [5000]).step).toBe(4);
    expect(at({ kind: "xfeat" }, 0).step).toBe(5);
  });

  it("says what runs in plain words", () => {
    expect(at({ kind: "baseline" }, 0).status).toBe(
      "Measuring the camera at rest - hold the phone still",
    );
    expect(at({ kind: "photos", taken: 2 }, 0).status).toBe(
      "Taking photo 3 of 4",
    );
    expect(at({ kind: "pairs", done: 0 }, 0).status).toBe(
      "Loading the models, then measuring pair 1 of 2 in the background",
    );
    expect(at({ kind: "pairs", done: 1 }, 0, [5000], "smooth").status).toBe(
      "Measuring pair 2 of 2 in the background - camera smooth",
    );
    expect(at({ kind: "pairs", done: 1 }, 0, [5000], "stutter").status).toBe(
      "Measuring pair 2 of 2 in the background - camera stuttering",
    );
    expect(at({ kind: "xfeat" }, 0).status).toBe(
      "Trying XFeat in a background worker: loading the XFeat model (the first time it downloads, which can take a few minutes)",
    );
  });

  // Why: the remaining time is the measured median pair once one is done
  // (the plan's estimate rule), not the first guess.
  it("estimates from the measured pairs once one is done", () => {
    const first = at({ kind: "pairs", done: 1 }, 0, [60_000]);
    const guess = at({ kind: "pairs", done: 1 }, 0, [1000]);
    expect(first.leftMs).toBeGreaterThan(guess.leftMs);
    expect(first.left).toBe("about 2 min left");
  });

  it("words the time left plainly", () => {
    expect(at({ kind: "baseline" }, 0, [], "unknown").left).toMatch(
      /^about \d+ (s|min) left$/,
    );
  });

  // Why: the XFeat try downloads about 65 MB first and may take up to
  // its limit; a bar saying "almost done" for minutes reads as a hang.
  // Its time left counts down to the probe's limit instead.
  it("never says almost done while XFeat may still be downloading", () => {
    expect(XFEAT_LIMIT_MS).toBe(300_000);
    expect(at({ kind: "xfeat" }, 0).left).toBe("up to 5 min left");
    expect(at({ kind: "xfeat" }, 60_000).left).toBe("up to 4 min left");
    expect(at({ kind: "xfeat" }, 290_000).left).toBe("up to 10 s left");
    for (const t of [20_000, 120_000, 299_000]) {
      expect(at({ kind: "xfeat" }, t).left).not.toBe("almost done");
    }
  });

  it("keeps the bar between 0 and 1", () => {
    expect(at({ kind: "baseline" }, 0).fraction).toBe(0);
    expect(at({ kind: "xfeat" }, 1e9).fraction).toBeLessThanOrEqual(1);
  });
});

describe("shortReason", () => {
  // Why: the result card has room for a few words, not a stack trace.
  it("keeps the first line, without the init prefix, cut short", () => {
    expect(shortReason("init: importScripts is not defined\n  at x.js:1")).toBe(
      "importScripts is not defined",
    );
    const long = shortReason(`init: ${"a".repeat(200)}`);
    expect(long.length).toBeLessThanOrEqual(REASON_MAX);
    expect(long.endsWith("...")).toBe(true);
  });

  // Why: the XFeat answer is this browser refusal; cut short it lost the
  // words that say why (module workers have no importScripts).
  it("keeps a module worker's importScripts refusal whole", () => {
    const why =
      "TypeError: Failed to execute 'importScripts' on 'WorkerGlobalScope': Module scripts don't support importScripts().";
    expect(shortReason(`init: ${why}\n  at lib.js:1`)).toBe(why);
  });

  it("says something for an empty reason", () => {
    expect(shortReason("   ")).toBe("no reason given");
  });
});

describe("methodTimes", () => {
  // Why: the card's "times per method" is the median pair time per method,
  // load time apart, over every pair the worker measured.
  it("gives the median pair time and the first load per method", () => {
    const pairs = [
      [
        method("sift", [size(320, 100, 50)]),
        method("aliked", [size(320, 1000, 500)], null, 4000),
      ],
      [
        method("sift", [size(320, 200, 50)]),
        method("aliked", [size(320, 1000, 500)], null, 900),
      ],
      [
        method("sift", [size(320, 300, 50)]),
        method("aliked", [size(320, 1000, 500)], null, 900),
      ],
    ];
    expect(methodTimes(pairs)).toEqual([
      {
        id: "sift",
        label: "sift label",
        backend: "webgpu",
        failed: false,
        text: "0.45 s per pair, first load 0.30 s (3 pairs)",
      },
      {
        id: "aliked",
        label: "aliked label",
        backend: "webgpu",
        failed: false,
        text: "2.5 s per pair, first load 4.0 s (3 pairs)",
      },
    ]);
  });

  // Why: a method that never loaded is a finding; the card says why. It
  // never ran on a backend, so the card names none (the worker reports a
  // placeholder there, which read as "(-)" on the card).
  it("names why a method never ran, without a backend", () => {
    const pairs = [[method("aliked", [], "init: fetch failed for model.onnx")]];
    expect(methodTimes(pairs)).toEqual([
      {
        id: "aliked",
        label: "aliked label",
        backend: "",
        failed: true,
        text: "could not run: fetch failed for model.onnx",
      },
    ]);
  });
});

describe("xfeatOutcome", () => {
  // Why: the second question of the page - can XFeat start in a module
  // worker - is answered from its result or its error.
  it("is started when XFeat loaded and ran", () => {
    expect(
      xfeatOutcome([method("xfeat-fp16-webgpu", [size(320, 20, 10)])], null),
    ).toEqual({
      started: true,
      text: "Started: 0.05 s per pair on webgpu.",
    });
  });

  it("names the reason when it could not start", () => {
    expect(
      xfeatOutcome(
        [method("xfeat", [], "init: importScripts is not a function")],
        null,
      ),
    ).toEqual({
      started: false,
      text: "Could not start: importScripts is not a function",
    });
    expect(xfeatOutcome(null, "the worker did not answer in 90 s")).toEqual({
      started: false,
      text: "Could not start: the worker did not answer in 90 s",
    });
    expect(xfeatOutcome([], null).started).toBe(false);
  });

  // Why: a probe that never answered did not fail to start; it may still
  // be downloading. The card must not call that "could not start".
  it("reads a timeout as not known", () => {
    expect(xfeatTimedOut(300)).toEqual({
      started: null,
      text: "Not known: no answer in 300 s.",
    });
  });
});

// Why: a long run has many frame gaps; spreading them into Math.max
// throws a RangeError past the engine's argument limit, so the largest
// gap is found with a loop.
describe("gapStats on a long run", () => {
  it("takes the largest of a million gaps", () => {
    const gaps = Array.from({ length: 1_000_000 }, (_, i) => (i % 97) + 1);
    gaps[123_456] = 999;
    expect(gapStats(gaps).max).toBe(999);
  });

  // Why: a long run holds hundreds of thousands of gaps; each sort of them
  // costs the page a visible pause, so p95, p99 and the max come from one.
  it("sorts the gaps once for all three numbers", () => {
    const arraySort = vi.spyOn(Array.prototype, "sort");
    const typedSort = vi.spyOn(Float64Array.prototype, "sort");
    try {
      gapStats([5, 3, 9, 1, 7]);
      expect(arraySort.mock.calls.length + typedSort.mock.calls.length).toBe(1);
    } finally {
      arraySort.mockRestore();
      typedSort.mockRestore();
    }
  });
});

describe("spikeSummary", () => {
  const base = stats(40, 50, 70);
  const xfeat = { started: false, text: "Could not start: x" } as const;
  const methods = [
    { id: "sift", label: "SIFT", backend: "js", failed: false, text: "1 s" },
  ];

  // Why: the result card answers in plain words, with the worst gap.
  it("says yes with the worst gap when smooth", () => {
    const r = spikeSummary({
      run: stats(41, 51, 120),
      base,
      xfeat,
      methods,
    });
    expect(r.camera).toEqual({
      verdict: "smooth",
      text: "Yes. The worst frame gap was 120 ms (at rest 70 ms).",
    });
    expect(r.notice).toBeNull();
  });

  it("says no with the worst gap when it stuttered", () => {
    const r = spikeSummary({
      run: stats(41, 51, 900),
      base,
      xfeat,
      methods,
    });
    expect(r.camera.verdict).toBe("stutter");
    expect(r.camera.text).toBe(
      "No. The worst frame gap was 900 ms (at rest 70 ms; the limit is 250 ms).",
    );
  });

  // Why: a run can fail on the 1.25x rule with every gap far under 250 ms;
  // naming the 250 ms limit there read as a contradiction on the card.
  it("names the slower typical gap when that, not one long gap, failed it", () => {
    const r = spikeSummary({
      run: stats(60, 67, 67),
      base,
      xfeat,
      methods,
    });
    expect(r.camera.verdict).toBe("stutter");
    expect(r.camera.text).toBe(
      "No. Frames came late more often: 95% of gaps within 60 ms, at rest 40 ms (the limit is 1.25x).",
    );
  });

  // Why: an empty window on either side (at rest or while measuring)
  // leaves nothing to compare; the text must not blame one of them.
  it("says it is not known without frames on either side", () => {
    for (const [run, at] of [
      [stats(0, 0, 0, 0), base],
      [stats(41, 51, 120), stats(0, 0, 0, 0)],
    ] as const) {
      const r = spikeSummary({ run, base: at, xfeat, methods });
      expect(r.camera).toEqual({
        verdict: "unknown",
        text: "Not known: there were no camera frames to compare.",
      });
    }
  });

  // Why: with no pair measured the worker put no load on the phone, so
  // smooth frames say nothing; a "Yes" there was a false answer.
  it("says it is not known when no pair was measured", () => {
    const failed = [{ ...methods[0]!, backend: "", failed: true }];
    for (const m of [[], failed]) {
      const r = spikeSummary({
        run: stats(41, 51, 120),
        base,
        xfeat,
        methods: m,
      });
      expect(r.camera).toEqual({
        verdict: "unknown",
        text: "Not known: no pair was measured.",
      });
    }
  });

  // Why: when only the p99 rule broke, quoting the p95 (which passed)
  // read as a "No" with numbers that agree with each other.
  it("quotes the p99 when only the p99 rule broke", () => {
    const r = spikeSummary({
      run: stats(41, 80, 120),
      base,
      xfeat,
      methods,
    });
    expect(r.camera.verdict).toBe("stutter");
    expect(r.camera.text).toBe(
      "No. Frames came late more often: 99% of gaps within 80 ms, at rest 50 ms (the limit is 1.25x).",
    );
  });

  // Why: when no method could load, the numbers are empty and the person
  // must be told what to do, not left with a blank card.
  it("adds a notice when no method could run", () => {
    const methods = [
      {
        id: "sift",
        label: "SIFT",
        backend: "",
        failed: true,
        text: "could not run: x",
      },
    ];
    const r = spikeSummary({ run: stats(41, 51, 120), base, xfeat, methods });
    expect(r.notice).toEqual(plainError("models", new Error("x")));
  });
});

describe("spikeSummary notices", () => {
  const base = stats(40, 50, 70);
  const xfeat = { started: true, text: "Started" } as const;
  const ok = [
    { id: "sift", label: "SIFT", backend: "js", failed: false, text: "1 s" },
  ];
  const run = stats(41, 51, 120);

  // Why: a hidden page is throttled, so its numbers are not the phone's;
  // that outranks every other note on the card.
  it("puts a hidden page first, then a crashed worker", () => {
    expect(
      spikeSummary({
        run,
        base,
        xfeat,
        methods: ok,
        hidden: true,
        workerCrashed: true,
      }).notice,
    ).toEqual(plainError("hidden", null));
    expect(
      spikeSummary({ run, base, xfeat, methods: ok, workerCrashed: true })
        .notice,
    ).toEqual(plainError("worker", null));
    expect(spikeSummary({ run, base, xfeat, methods: ok }).notice).toBeNull();
  });
});

// Why: a run where every pair answered failed has no method line at all;
// the card must still say what happened and offer Try again (the notice
// shows it), unless a crash or a hidden page explains it first.
describe("spikeSummary with no pair measured", () => {
  const base = stats(40, 50, 70);
  const xfeat = { started: false, text: "Could not start: x" } as const;
  const run = stats(41, 51, 120);
  it("adds a notice when no pair answered", () => {
    expect(spikeSummary({ run, base, xfeat, methods: [] }).notice).toEqual(
      plainError("pairs", null),
    );
    expect(
      spikeSummary({ run, base, xfeat, methods: [], workerCrashed: true })
        .notice,
    ).toEqual(plainError("worker", null));
    expect(plainError("pairs", null).todo).toMatch(/Try again/);
  });
});

describe("plainError", () => {
  // Why: errors on screen are one plain sentence and what to do, never a
  // stack trace.
  it("tells a blocked camera how to allow it", () => {
    const e = plainError(
      "camera",
      new DOMException("denied", "NotAllowedError"),
    );
    expect(e.message).toBe("The camera was blocked.");
    expect(e.todo).toMatch(/Allow the camera/);
  });

  it("covers the other camera failures", () => {
    expect(
      plainError("camera", new DOMException("x", "NotFoundError")).message,
    ).toBe("No camera was found.");
    expect(
      plainError("camera", new DOMException("x", "NotReadableError")).message,
    ).toBe("The camera is busy in another app.");
    expect(plainError("camera", new Error("odd")).message).toBe(
      "The camera could not start.",
    );
  });

  it("never puts the error text itself on screen", () => {
    const e = plainError("page", new Error("TypeError at foo.ts:12"));
    expect(`${e.message} ${e.todo}`).not.toMatch(/foo\.ts/);
  });
});
