import { describe, expect, it } from "vitest";

import { DEFAULT_PLAN, type SpikeResult } from "./worker-spike-model";
import {
  createWorkerSpikeStore,
  workerSpikeActions as A,
} from "./worker-spike-slice";

const plan = { ...DEFAULT_PLAN, pairs: 2 };
const result: SpikeResult = {
  camera: { verdict: "smooth", text: "Yes." },
  xfeat: { started: false, text: "Could not start: x" },
  methods: [],
  notice: null,
};
const blocked = { message: "The camera was blocked.", todo: "Allow it." };

/** A store that has the camera on and the run started at t=100. */
function running() {
  const store = createWorkerSpikeStore(plan);
  store.dispatch(A.cameraOn());
  store.dispatch(A.runStarted(100));
  return store;
}

describe("worker spike slice", () => {
  // Why: Start must not be possible before the camera shows a picture.
  it("waits for the camera before it can start", () => {
    const store = createWorkerSpikeStore(plan);
    expect(store.getState().phase).toBe("starting");
    store.dispatch(A.runStarted(1));
    expect(store.getState().phase).toBe("starting");
    store.dispatch(A.cameraOn());
    expect(store.getState().phase).toBe("ready");
  });

  // Why: the run begins with the baseline, so the bar has a step at once
  // and the page never looks idle after the tap.
  it("starts at the baseline step", () => {
    const s = running().getState();
    expect(s.phase).toBe("running");
    expect(s.step).toEqual({ kind: "baseline" });
    expect(s.stepStartedAt).toBe(100);
  });

  // Why: a second tap on Start must not restart a running test.
  it("ignores a second start", () => {
    const store = running();
    store.dispatch(A.stepBegan({ step: { kind: "xfeat" }, now: 200 }));
    store.dispatch(A.runStarted(300));
    expect(store.getState().step).toEqual({ kind: "xfeat" });
  });

  it("counts photos and pairs only in their own step", () => {
    const store = running();
    store.dispatch(A.photoTaken());
    store.dispatch(A.pairMeasured({ ms: 5, now: 1 }));
    expect(store.getState().step).toEqual({ kind: "baseline" });
    store.dispatch(
      A.stepBegan({ step: { kind: "photos", taken: 0 }, now: 200 }),
    );
    store.dispatch(A.photoTaken());
    expect(store.getState().step).toEqual({ kind: "photos", taken: 1 });
    store.dispatch(A.stepBegan({ step: { kind: "pairs", done: 0 }, now: 300 }));
    store.dispatch(A.pairMeasured({ ms: 4000, now: 4300 }));
    const s = store.getState();
    expect(s.step).toEqual({ kind: "pairs", done: 1 });
    expect(s.pairMs).toEqual([4000]);
    expect(s.stepStartedAt).toBe(4300);
  });

  // Why: the plan's pair count is the cap; a stray answer cannot push the
  // step text past "pair 2 of 2".
  it("never counts more pairs than planned", () => {
    const store = running();
    store.dispatch(A.stepBegan({ step: { kind: "pairs", done: 0 }, now: 0 }));
    for (let i = 0; i < 4; i++) {
      store.dispatch(A.pairMeasured({ ms: 1, now: i }));
    }
    expect(store.getState().step).toEqual({ kind: "pairs", done: 2 });
  });

  // Why: the end state carries the card, and a failure carries the plain
  // sentence; neither can be overwritten by a late step.
  it("ends with the result card", () => {
    const store = running();
    store.dispatch(A.finished(result));
    store.dispatch(A.stepBegan({ step: { kind: "baseline" }, now: 1 }));
    const s = store.getState();
    expect(s.phase).toBe("done");
    expect(s.result).toEqual(result);
  });

  it("fails with a plain error from the camera or the run", () => {
    const store = createWorkerSpikeStore(plan);
    store.dispatch(A.cameraFailed(blocked));
    expect(store.getState().phase).toBe("failed");
    expect(store.getState().error).toEqual(blocked);
    const other = running();
    other.dispatch(A.runFailed(blocked));
    expect(other.getState().phase).toBe("failed");
    other.dispatch(A.finished(result));
    expect(other.getState().phase).toBe("failed");
  });

  // Why: the copied log is the run's evidence; every line is kept in order.
  it("keeps the log in order", () => {
    const store = running();
    store.dispatch(A.logged("a"));
    store.dispatch(A.logged("b"));
    expect(store.getState().log).toEqual(["a", "b"]);
  });

  it("keeps the live camera verdict", () => {
    const store = running();
    store.dispatch(A.liveVerdict("stutter"));
    expect(store.getState().live).toBe("stutter");
  });
});
