import { describe, expect, it, vi } from "vitest";

import type { MethodResult } from "./bench-run";
import { WorkerCrashed } from "./measure-client";
import type * as SliceModule from "./feature-match-slice";
import {
  featureMatchActions as A,
  initialFeatureMatchState,
  nextMeasureKey,
} from "./feature-match-slice";
import { planShots } from "./run-plan";

// The queue's choice of the next pair, counted: it rebuilds the plan's
// pairs, so it must not run on a notification that changed nothing.
vi.mock("./feature-match-slice", async (original) => {
  const m = await original<typeof SliceModule>();
  return { ...m, nextMeasureKey: vi.fn(m.nextMeasureKey) };
});
import {
  doneOf,
  flush as settle,
  harness,
  result,
  shot,
} from "../../test-support/measure-queue-harness";

const restore = A.restoreFinished({ stored: [], results: {}, log: [] });
const L1 = "light-s1/L1";
const L2 = "light-s1/L2";
const L3 = "light-s1/L3";
const k12 = "light-s1/L1-L2@p1+p2";
const k13 = "light-s1/L1-L3@p1+p3";
/** The restore and every shot of the plan: many pairs for the queue. */
const everyShot = [
  restore,
  ...planShots(initialFeatureMatchState({ session: "s1" }).plan).map((s, i) =>
    shot(s.id, `p${String(i)}`),
  ),
];
/** ALIKED on WebGPU: one size per entry (its error), or a failed load. */
const gpu = (
  sizes: (string | null)[],
  error: string | null = null,
): MethodResult =>
  ({
    ...result("aliked-lightglue-webgpu", error),
    label: "ALIKED",
    backend: error === null ? "webgpu (execution provider)" : "webgpu",
    sizes: sizes.map((e) => ({ error: e })),
  }) as unknown as MethodResult;

// Why these tests matter: the queue is the only thing that measures on the
// phone now; it must send each ready pair once with the right photos and
// methods, keep its result and matches, say what ran beside it, and never
// stall on a photo it cannot read or a worker that crashed.
describe("startMeasureQueue", () => {
  it("measures each ready pair once, in run order, after the restore", async () => {
    const h = harness();
    for (const a of [
      A.cameraChanged(true),
      shot(L1, "p1"),
      shot(L2, "p2"),
      shot(L3, "p3"),
    ]) {
      h.store.dispatch(a);
    }
    await settle();
    expect(h.calls).toHaveLength(0);
    h.store.dispatch(restore);
    await settle();
    expect(h.calls.map((c) => c.key)).toEqual([k12]);
    const job = h.calls[0]!.job;
    expect(await job.a.text()).toBe("p1");
    expect(await job.b.text()).toBe("p2");
    expect(job).toMatchObject({
      turn: null,
      methods: { sift: true, aliked: true, siftLightGlue: false },
      pair: "1a",
    });
    expect(job.sizes.length).toBeGreaterThan(0);
    h.calls[0]!.resolve(doneOf([result("sift")], 40));
    await settle();
    expect(h.state().results[k12]).toEqual({
      status: "done",
      text: "done in 40 ms (1 method)",
      persisted: true,
      measureMs: 40,
      context: "beside-camera",
    });
    const saved = JSON.parse(h.matches.get(k12)!) as {
      frames: { A: { file: string }; B: { file: string } };
      measured: { context: string; hidden: boolean };
    };
    expect(saved.frames.A.file).toBe("shots/light-s1/L1-t1.png");
    expect(saved.frames.B.file).toBe("shots/light-s1/L2-t1.png");
    expect(saved.measured).toMatchObject({
      context: "beside-camera",
      hidden: false,
    });
    expect(h.calls.map((c) => c.key)).toEqual([k12, k13]);
    expect(h.lines).toContain("light-s1/L1-L2: SIFT: loading");
    // The outcome goes into the log too, so the run zip's log says what
    // the phone measured, and a browser test can wait for it.
    expect(h.lines).toContain("light-s1/L1-L2: done in 40 ms (1 method)");
    expect(h.ended()).toBe(1);
  });

  it("flags a pair measured with the camera off as idle, and a hidden page", async () => {
    const h = harness({ hidden: true });
    for (const a of [restore, shot(L1, "p1"), shot(L2, "p2")]) {
      h.store.dispatch(a);
    }
    await settle();
    h.calls[0]!.resolve(doneOf([result("sift")]));
    await settle();
    expect(h.state().results[k12]).toMatchObject({
      context: "idle",
      hidden: true,
    });
  });

  it("fails a pair whose photo cannot be read, for this load only, and goes on", async () => {
    const h = harness({ unreadable: new Set(["p2"]) });
    for (const a of [restore, shot(L1, "p1"), shot(L2, "p2"), shot(L3, "p3")]) {
      h.store.dispatch(a);
    }
    await settle();
    expect(h.state().results[k12]).toEqual({
      status: "failed",
      text: "not measured: a photo could not be read (Error: the photo p2 is not stored)",
      persisted: false,
    });
    expect(h.lines).toContain(
      "light-s1/L1-L2: not measured: a photo could not be read (Error: the photo p2 is not stored)",
    );
    expect(h.calls.map((c) => c.key)).toEqual([k13]);
  });

  it("keeps a pair whose methods could not all load for this load only", async () => {
    const h = harness();
    for (const a of [restore, shot(L1, "p1"), shot(L2, "p2"), shot(L3, "p3")]) {
      h.store.dispatch(a);
    }
    await settle();
    h.calls[0]!.resolve(
      doneOf([result("sift"), result("aliked", "init: offline")]),
    );
    await settle();
    expect(h.state().results[k12]).toMatchObject({
      status: "done",
      text: "done in 40 ms (2 methods, 1 could not load)",
      persisted: false,
    });
    h.calls[1]!.resolve(doneOf([result("aliked", "init: offline")]));
    await settle();
    expect(h.state().results[k13]).toEqual({
      status: "failed",
      text: "not measured: init: offline",
      persisted: false,
    });
  });

  it("counts a worker crash and stops after two in a row", async () => {
    const h = harness();
    for (const a of [
      restore,
      shot(L1, "p1"),
      shot(L2, "p2"),
      shot(L3, "p3"),
      shot("light-s2/L1", "q1"),
      shot("light-s2/L2", "q2"),
    ]) {
      h.store.dispatch(a);
    }
    await settle();
    h.calls[0]!.reject(new WorkerCrashed("the measuring worker stopped"));
    await settle();
    expect(h.state().results[k12]).toMatchObject({
      status: "failed",
      persisted: false,
    });
    h.calls[1]!.reject(new WorkerCrashed("the measuring worker stopped"));
    await settle();
    expect(h.state().queue.crashes).toBe(2);
    expect(h.calls).toHaveLength(2);
  });

  // Why: a pair retaken while it was measured has its result dropped by
  // the store; the log must say so instead of "done", or the run zip's
  // log claims a measurement the zip does not hold.
  it("logs a result as discarded when its pair was retaken meanwhile", async () => {
    const h = harness();
    for (const a of [restore, shot(L1, "p1"), shot(L2, "p2")]) {
      h.store.dispatch(a);
    }
    await settle();
    h.store.dispatch(shot(L2, "p9"));
    h.calls[0]!.resolve(doneOf([result("sift")]));
    await settle();
    expect(h.state().results[k12]).toBeUndefined();
    expect(h.lines).toContain(
      "light-s1/L1-L2: discarded, the pair is no longer in the plan",
    );
    expect(h.lines.filter((l) => l.includes(": done in"))).toEqual([]);
  });

  // Why: a WebGPU error (a lost device, or a deterministic one at one
  // size) must neither throw away the methods that did answer nor stop
  // the queue: the pair is kept for this load, and the worker restarts so
  // the next pair gets a fresh device. A failed size on WASM is ordinary.
  it("keeps a pair whose WebGPU method failed a size and restarts the worker", async () => {
    const h = harness();
    for (const a of [restore, shot(L1, "p1"), shot(L2, "p2"), shot(L3, "p3")]) {
      h.store.dispatch(a);
    }
    await settle();
    h.calls[0]!.resolve(
      doneOf([result("sift"), gpu([null, null, "extract: device lost"])]),
    );
    await settle();
    expect(h.state().results[k12]).toEqual(
      expect.objectContaining({
        status: "done",
        text: "done in 40 ms (2 methods); the worker restarts after ALIKED failed on WebGPU (extract: device lost)",
        persisted: false,
      }),
    );
    expect(h.matches.get(k12)).toContain('"sift"');
    expect(h.state().queue.crashes).toBe(0);
    expect(h.closed()).toBe(1);
    h.calls[1]!.resolve(
      doneOf([{ ...result("sift"), sizes: [{ error: "x" }] } as never]),
    );
    await settle();
    expect(h.state().results[k13]).toMatchObject({ status: "done" });
    expect(h.closed()).toBe(1);
  });

  // Why: a device lost between pairs shows up as a failed load of a
  // method this worker had loaded before; that is the restart case too.
  // A first load failing (a download) is not: a new worker cannot help.
  it("restarts the worker when a WebGPU method this worker loaded fails to load", async () => {
    const h = harness();
    for (const a of everyShot) {
      h.store.dispatch(a);
    }
    await settle();
    h.calls[0]!.resolve(doneOf([gpu([], "init: offline")]));
    await settle();
    expect(h.closed()).toBe(0);
    h.calls[1]!.resolve(doneOf([gpu([null])]));
    await settle();
    h.calls[2]!.resolve(doneOf([result("sift"), gpu([], "init: device lost")]));
    await settle();
    expect(h.closed()).toBe(1);
    expect(h.state().results[h.calls[2]!.key!]).toMatchObject({
      status: "done",
      persisted: false,
    });
  });

  // Why: a WebGPU error that a fresh worker does not cure would restart
  // the worker on every pair; after one failed retry the method is off
  // for this run, marked failed in every later pair, and the rest goes on.
  it("turns a method off for the run when it fails again right after a restart", async () => {
    const h = harness();
    for (const a of everyShot) {
      h.store.dispatch(a);
    }
    await settle();
    h.calls[0]!.resolve(doneOf([result("sift"), gpu([null, "extract: oom"])]));
    await settle();
    expect(h.closed()).toBe(1);
    h.calls[1]!.resolve(doneOf([result("sift"), gpu([], "init: oom")]));
    await settle();
    expect(h.closed()).toBe(1);
    expect(h.lines).toContain(
      "ALIKED is off for this run: it failed on WebGPU again after the worker restarted",
    );
    expect(h.calls[2]!.job.methods).toMatchObject({
      sift: true,
      aliked: false,
    });
    h.calls[2]!.resolve(doneOf([result("sift")]));
    await settle();
    const k = h.calls[2]!.key!;
    expect(h.state().results[k]).toMatchObject({
      status: "done",
      text: "done in 40 ms (2 methods, 1 could not load)",
      persisted: false,
    });
    expect(h.matches.get(k)).toContain(
      "off for this run: it failed on WebGPU again after the worker restarted",
    );
    expect(h.state().queue.crashes).toBe(0);
    expect(h.calls).toHaveLength(4);
  });

  // Why: only a failure on the very next pair turns a method off; a good
  // pair in between shows the restart helped, so a later error restarts.
  it("restarts again after a good pair in between", async () => {
    const h = harness();
    for (const a of everyShot) {
      h.store.dispatch(a);
    }
    await settle();
    h.calls[0]!.resolve(doneOf([gpu(["extract: device lost"])]));
    await settle();
    h.calls[1]!.resolve(doneOf([gpu([null])]));
    await settle();
    h.calls[2]!.resolve(doneOf([gpu(["extract: device lost"])]));
    await settle();
    expect(h.closed()).toBe(2);
    expect(h.calls[3]!.job.methods).toMatchObject({ aliked: true });
  });

  it("starts nothing more once stopped", async () => {
    const h = harness();
    h.stop();
    for (const a of [restore, shot(L1, "p1"), shot(L2, "p2")]) {
      h.store.dispatch(a);
    }
    await settle();
    expect(h.calls).toHaveLength(0);
  });
});

describe("the queue's work per store notification", () => {
  // Why this test matters: every devicemotion reading dispatches, and a
  // refused or unchanged dispatch still notifies; choosing the next pair
  // on each rebuilt the derived pairs, the photos and a Map 60 times a
  // second for nothing.
  it("skips a notification whose state did not change", async () => {
    const h = harness();
    h.store.dispatch(restore);
    await settle();
    const count = vi.mocked(nextMeasureKey);
    const before = count.mock.calls.length;
    for (let i = 0; i < 5; i++) {
      h.store.dispatch(A.planMoved(h.state().plan.current));
    }
    expect(count.mock.calls.length).toBe(before);
    h.store.dispatch(shot(L1, "p1"));
    expect(count.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("a rotation pair's matches", () => {
  // Why this test matters: a rotation pair is measured on the centre
  // squares, B turned; its keypoints are in square pixels, so the matches
  // JSON must say which square of which shot file, and the turn, or the
  // PC reads them against the full photo.
  it("carries the crop of both squares and the turn in measured", async () => {
    const h = harness();
    for (const a of [
      restore,
      shot("flat-s1/F1", "f1"),
      shot("flat-s1/F2", "f2"),
    ]) {
      h.store.dispatch(a);
    }
    for (let i = 0; i < 6; i++) {
      await settle();
      const open = h.calls[i];
      if (!open) break;
      open.resolve(doneOf([result("sift")]));
    }
    await settle();
    const key = [...h.matches.keys()].find((k) =>
      k.startsWith("flat-s1/F1-T90@"),
    );
    const real = [...h.matches.keys()].find((k) =>
      k.startsWith("flat-s1/F1-F2@"),
    );
    expect(key).toBeDefined();
    const saved = JSON.parse(h.matches.get(key!)!) as {
      measured: Record<string, unknown>;
    };
    // The harness photos are 640 x 480: the square is 480 wide, 80 in.
    expect(saved.measured["square"]).toEqual({
      a: { x: 80, y: 0, side: 480 },
      b: { x: 80, y: 0, side: 480 },
      turn: { degrees: 90, direction: "cw" },
    });
    const plain = JSON.parse(h.matches.get(real!)!) as {
      measured: Record<string, unknown>;
    };
    expect(plain.measured).not.toHaveProperty("square");
  });
});
