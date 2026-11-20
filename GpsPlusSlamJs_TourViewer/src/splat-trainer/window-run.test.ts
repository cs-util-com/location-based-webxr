import { describe, expect, it, vi } from "vitest";

import { readPly } from "./ply-crop.js";
import type {
  SplatEvent,
  SplatJsModule,
  SplatMetrics,
  SplatSessionLike,
} from "./splat-js.js";
import {
  runWindow,
  type RunClock,
  type RunInput,
  type RunProgress,
} from "./window-run.js";

/** A splat file with one vertex per position (x, y, z, opacity). */
function ply(points: readonly [number, number, number][]): Blob {
  const header =
    "ply\nformat binary_little_endian 1.0\n" +
    `element vertex ${String(points.length)}\n` +
    "property float x\nproperty float y\nproperty float z\nproperty float opacity\nend_header\n";
  const head = new TextEncoder().encode(header);
  const out = new Uint8Array(head.length + points.length * 16);
  out.set(head);
  const dv = new DataView(out.buffer);
  points.forEach((p, i) =>
    p.forEach((v, k) => dv.setFloat32(head.length + i * 16 + k * 4, v, true)),
  );
  return new Blob([out]);
}

/** A promise the test settles by hand. */
function gate<T = void>(): {
  promise: Promise<T>;
  open: (v: T) => void;
  fail: (e: Error) => void;
} {
  let open!: (v: T) => void;
  let fail!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    open = res;
    fail = rej;
  });
  return { promise, open, fail };
}

type Stage = "load" | "seed" | "score" | "export";

/** A scripted Splat.js: each stage waits for its gate when one is set,
 *  `start` runs `onStart`, and the test fires events through `emit`. */
function scripted(opts: {
  hold?: Partial<Record<Stage, Promise<void>>>;
  onStart?: (emit: (e: SplatEvent) => void) => void;
  loadError?: Error;
  splat?: [number, number, number][];
  /** The session's test cameras (held out of training). */
  testCams?: number[];
}) {
  const calls: string[] = [];
  const events: ((e: SplatEvent) => void)[] = [];
  const metrics: ((m: SplatMetrics) => void)[] = [];
  const emit = (e: SplatEvent): void => events.forEach((f) => f(e));
  const report = (m: SplatMetrics): void => metrics.forEach((f) => f(m));
  const wait = async (stage: Stage): Promise<void> => {
    calls.push(stage);
    await opts.hold?.[stage];
  };
  const session: SplatSessionLike = {
    on: (type: string, fn: (x: never) => void) => {
      if (type === "event") events.push(fn as (e: SplatEvent) => void);
      if (type === "metrics") metrics.push(fn as (m: SplatMetrics) => void);
    },
    load: async () => {
      await wait("load");
      if (opts.loadError) throw opts.loadError;
    },
    useKnownCameras: (cams, o) =>
      calls.push(`cameras ${String(o.points.length)}`),
    seed: async (extra) => {
      await wait("seed");
      calls.push(`eval ${extra.evalFrames.join(",")}`);
    },
    start: () => {
      calls.push("start");
      opts.onStart?.(emit);
    },
    pause: () => calls.push("pause"),
    evalFramePsnr: async (ci) => {
      await wait("score");
      return 30 + ci;
    },
    evalTestPsnr: () => Promise.resolve({ psnr: 21 }),
    exportPlyBlob: async () => {
      await wait("export");
      return ply(opts.splat ?? [[0, 0, 0]]);
    },
    dispose: () => calls.push("dispose"),
    trainer: { iter: 0, camMeta: [{}, {}, {}], excluded: new Set([1]) },
    ...(opts.testCams === undefined ? {} : { testCams: opts.testCams }),
  };
  const mod: SplatJsModule = {
    createSession: (o) => {
      calls.push(`session ${String(o.maxIters)}`);
      return session;
    },
    parseCameras: (json) => json.cameras,
    TRAIN_MAX_DIM: 1600,
  };
  return { mod, calls, emit, report, session };
}

/** A clock whose timers fire only when the test says. */
function manualClock(): RunClock & { t: number; fire(): void } {
  let pending: (() => void) | null = null;
  return {
    t: 0,
    now() {
      return this.t;
    },
    setTimeout(fn) {
      pending = fn;
      return 1;
    },
    clearTimeout() {
      pending = null;
    },
    fire() {
      pending?.();
    },
  };
}

const input: RunInput = {
  photos: [
    { name: "a.jpg", blob: new Blob() },
    { name: "b.jpg", blob: new Blob() },
    { name: "c.jpg", blob: new Blob() },
  ],
  cameras: [],
  seeds: [{ X: [0, 0, 0], rgb: [1, 1, 1] }],
  evalFrames: ["b.jpg"],
  maxIters: 4000,
  deadlineMs: 60_000,
  keepM: 10,
  trainPositions: [[0, 0, 0]],
  etaMinIterations: 200,
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("runWindow", () => {
  // Why: the ordinary path - load, cameras, seed with the test set, train
  // to the end, score the training cameras only (the held-out one is
  // excluded), export and crop - in that order, then dispose.
  it("trains, scores, exports and crops a finished window", async () => {
    const s = scripted({
      onStart: (emit) => queueMicrotask(() => emit({ kind: "train-complete" })),
      splat: [
        [1, 0, 0],
        [50, 0, 0],
      ],
    });
    const r = await runWindow(
      s.mod,
      input,
      () => {},
      new AbortController().signal,
      manualClock(),
    );
    expect(r.outcome).toBe("finished");
    expect(r.metrics).toEqual({ atCameraDb: 31, heldOutDb: 21, photosUsed: 2 });
    expect(s.calls).toEqual([
      "session 4000",
      "load",
      "cameras 1",
      "seed",
      "eval b.jpg",
      "start",
      "pause",
      "score",
      "score",
      "export",
      "pause",
      "dispose",
    ]);
    // The splat 50 m away is beyond the 10 m reach: the crop drops it.
    const kept = readPly(await (r.ply as Blob).arrayBuffer());
    expect(kept.positions).toEqual([[1, 0, 0]]);
  });

  // Why: a cancel must end the run in every state, with no splat, and
  // free the session; the page then never judges it.
  it.each(["load", "seed", "train", "score", "export"] as const)(
    "ends as cancelled when aborted during %s",
    async (state) => {
      const hold = gate();
      const s = scripted({
        hold: state === "train" ? {} : { [state]: hold.promise },
      });
      const ctrl = new AbortController();
      const clock = manualClock();
      const run = runWindow(s.mod, input, () => {}, ctrl.signal, clock);
      if (state === "score" || state === "export") {
        await tick();
        clock.fire(); // the deadline, to reach scoring
      }
      await tick();
      ctrl.abort();
      const r = await run;
      expect(r).toMatchObject({
        outcome: "cancelled",
        ply: null,
        metrics: null,
      });
      expect(s.calls.at(-1)).toBe("dispose");
      expect(s.calls).toContain(state === "train" ? "start" : state);
      hold.open();
    },
  );

  // Why: a cancel before anything ran must not even create a session.
  it("does not start when already aborted", async () => {
    const s = scripted({});
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await runWindow(
      s.mod,
      input,
      () => {},
      ctrl.signal,
      manualClock(),
    );
    expect(r.outcome).toBe("cancelled");
    expect(s.calls).toEqual([]);
  });

  // Why: a lost device takes the splats with it; the run ends as
  // gpu-lost without scoring or exporting, during training or before it.
  it.each(["load", "train"] as const)(
    "ends as gpu-lost when the device is lost during %s",
    async (state) => {
      const hold = gate();
      const s = scripted({
        hold: state === "load" ? { load: hold.promise } : {},
        onStart: (emit) => queueMicrotask(() => emit({ kind: "device-lost" })),
      });
      const run = runWindow(
        s.mod,
        input,
        () => {},
        new AbortController().signal,
        manualClock(),
      );
      if (state === "load") {
        await tick();
        s.emit({ kind: "device-lost" });
      }
      const r = await run;
      expect(r).toMatchObject({
        outcome: "gpu-lost",
        ply: null,
        metrics: null,
      });
      expect(s.calls).not.toContain("export");
      expect(s.calls.at(-1)).toBe("dispose");
    },
  );

  // Why: the deadline bounds a run on a slow card; the model as it stands
  // is paused, scored and kept, and the outcome says it ran out of time.
  it("pauses, scores and exports at the deadline", async () => {
    const s = scripted({});
    const clock = manualClock();
    const run = runWindow(
      s.mod,
      input,
      () => {},
      new AbortController().signal,
      clock,
    );
    await tick();
    clock.t = 60_000;
    clock.fire();
    const r = await run;
    expect(r.outcome).toBe("deadline");
    expect(r.metrics?.atCameraDb).toBe(31);
    expect(r.ply).not.toBeNull();
    expect(r.trainingS).toBe(60);
  });

  // Why: a library that refuses (no adapter, a photo it cannot decode)
  // must end as failed with its reason, never reject into the page.
  it("ends as failed with the reason when the library throws", async () => {
    const s = scripted({ loadError: new Error("no graphics adapter") });
    const r = await runWindow(
      s.mod,
      input,
      () => {},
      new AbortController().signal,
      manualClock(),
    );
    expect(r).toMatchObject({
      outcome: "failed",
      detail: "no graphics adapter",
    });
    expect(s.calls.at(-1)).toBe("dispose");
    const throwing = {
      ...s.mod,
      createSession: () => {
        throw new Error("no WebGPU");
      },
    };
    const r2 = await runWindow(
      throwing,
      input,
      () => {},
      new AbortController().signal,
      manualClock(),
    );
    expect(r2).toMatchObject({ outcome: "failed", detail: "no WebGPU" });
  });

  // Why: the page's bar and time estimate come from these reports; the
  // rate is measured from the first report, so warm-up does not count.
  it("reports the fraction done and, once measured, the time left", async () => {
    const seen: unknown[] = [];
    const clock = manualClock();
    const s = scripted({});
    const run = runWindow(
      s.mod,
      input,
      (p) => seen.push(p),
      new AbortController().signal,
      clock,
    );
    await tick();
    clock.t = 5000;
    s.report({ iter: 100 });
    clock.t = 6000;
    s.report({ iter: 200 });
    clock.t = 7000;
    s.report({ iter: 300 });
    s.report({ iter: Number.NaN });
    clock.fire();
    await run;
    const at = (
      stage: RunProgress["stage"],
      fraction: number,
      secondsLeft: number | null,
    ): RunProgress => ({ stage, fraction, secondsLeft, nextPreviewInS: null });
    expect(seen).toEqual([
      at("preparing", 0, null),
      at("training", 0.025, null),
      at("training", 0.05, null),
      // 200 steps in 2 s since the first report: 3700 left take 37 s.
      at("training", 0.075, 37),
      at("checking", 0.075, null),
    ]);
  });

  // Why: a stray abort listener would keep the run's closure alive after
  // it ended and fire into a finished run.
  it("removes its abort listener when it ends", async () => {
    const ctrl = new AbortController();
    const remove = vi.spyOn(ctrl.signal, "removeEventListener");
    const s = scripted({
      onStart: (emit) => queueMicrotask(() => emit({ kind: "train-complete" })),
    });
    await runWindow(s.mod, input, () => {}, ctrl.signal, manualClock());
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  // Why: the page shows what the run is doing before its first step
  // (uploading photos and seeds to the card can take a while) and while
  // it scores and exports, never a stuck "0 %".
  it("says it prepares before training and checks after it", async () => {
    const stages: RunProgress["stage"][] = [];
    const hold = gate();
    const s = scripted({ hold: { load: hold.promise } });
    const clock = manualClock();
    const run = runWindow(
      s.mod,
      input,
      (p) => stages.push(p.stage),
      new AbortController().signal,
      clock,
    );
    await tick();
    expect(stages).toEqual(["preparing"]);
    hold.open();
    await tick();
    s.report({ iter: 100 });
    clock.fire();
    await run;
    expect(stages).toEqual(["preparing", "training", "checking"]);
  });

  // Why: the person watches the splat develop. The first look comes with
  // the first report, then one per interval, drawn from a held-out camera
  // (a view the run did not train on), and a last one once it is scored,
  // so a finished print shows the finished splat. The looks are taken in
  // the library's own report, between training steps.
  it("shows a look at the first report, then every interval, then the last", async () => {
    const s = scripted({ testCams: [1] });
    const clock = manualClock();
    const seen: RunProgress[] = [];
    const taken: number[] = [];
    const posted: unknown[] = [];
    const run = runWindow(
      s.mod,
      input,
      (p) => seen.push(p),
      new AbortController().signal,
      clock,
      {
        everyMs: 15_000,
        take: (trainer, ci) => {
          expect(trainer).toBe(s.session.trainer);
          taken.push(ci);
          return { look: taken.length };
        },
        post: (p) => posted.push(p),
      },
    );
    await tick();
    clock.t = 1000;
    s.report({ iter: 100 });
    clock.t = 5000;
    s.report({ iter: 200 });
    clock.t = 16_000;
    s.report({ iter: 300 });
    clock.fire();
    const r = await run;
    expect(r.outcome).toBe("deadline");
    expect(posted).toEqual([{ look: 1 }, { look: 2 }, { look: 3 }]);
    expect(taken).toEqual([1, 1, 1]);
    expect(
      seen.filter((p) => p.stage === "training").map((p) => p.nextPreviewInS),
    ).toEqual([15, 11, 15]);
  });

  // Why: without a test set the look comes from the middle training
  // camera, never from one the run left out of its photos.
  it("looks through the middle training camera without a test set", async () => {
    const s = scripted({});
    const clock = manualClock();
    const taken: number[] = [];
    const run = runWindow(
      s.mod,
      input,
      () => {},
      new AbortController().signal,
      clock,
      {
        everyMs: 15_000,
        take: (_t, ci) => {
          taken.push(ci);
          return null;
        },
        post: () => {
          throw new Error("nothing to post");
        },
      },
    );
    await tick();
    s.report({ iter: 100 });
    clock.fire();
    await run;
    // Camera 1 is excluded; of 0 and 2, the middle is 2.
    expect(taken).toEqual([2, 2]);
  });

  // Why: a look is a courtesy; one that cannot be drawn must never stop
  // an hour of training.
  it("trains on when a look cannot be drawn", async () => {
    const s = scripted({
      onStart: (emit) =>
        queueMicrotask(() => {
          s.report({ iter: 100 });
          emit({ kind: "train-complete" });
        }),
    });
    const r = await runWindow(
      s.mod,
      input,
      () => {},
      new AbortController().signal,
      manualClock(),
      {
        everyMs: 15_000,
        take: () => {
          throw new Error("no canvas");
        },
        post: () => {},
      },
    );
    expect(r.outcome).toBe("finished");
    expect(r.ply).not.toBeNull();
  });
});
