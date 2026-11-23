import { describe, expect, it } from "vitest";

import { WorkerCrashed } from "./measure-client";
import { featureMatchActions as A } from "./feature-match-slice";
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
