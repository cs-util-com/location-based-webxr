/**
 * Why these tests matter: the slice IS the run's rule book. A stop that
 * throws away a finished stretch, a "train again" that re-runs the wrong
 * one, or a late event from a stopped run that overwrites the next
 * stretch's progress would each lose an hour of graphics-card time
 * without any error on screen.
 */
import { configureStore } from "@reduxjs/toolkit";
import { describe, expect, it } from "vitest";

import {
  CENSUS,
  finishCurrent,
  judged,
  plan,
  storeAt,
} from "../test-support/splat-trainer-fixtures.js";
import type { WindowJudgement } from "./trainer-adapter.js";
import {
  attemptTimeScale,
  secondsLeftInRun,
  trainerPageActions as A,
  trainerPageReducer,
  type TrainerPageState,
  undecidedWindows,
  windowsInFile,
} from "./trainer-page-slice.js";

const statuses = (s: TrainerPageState) => s.windows.map((w) => w.status);

describe("reading a recording", () => {
  it("ignores the answer of a read that is no longer the current one", () => {
    const store = configureStore({ reducer: trainerPageReducer });
    store.dispatch(A.readingStarted({ id: "r2", name: "b.zip" }));
    store.dispatch(
      A.readFinished({ id: "r1", census: CENSUS, windows: plan(3) }),
    );
    expect(store.getState().phase).toBe("reading");
    store.dispatch(A.readRefused({ id: "r1", reason: "old" }));
    expect(store.getState().phase).toBe("reading");
  });

  it("refuses a recording whose plan has no stretch", () => {
    const store = configureStore({ reducer: trainerPageReducer });
    store.dispatch(A.readingStarted({ id: "r1", name: "a.zip" }));
    store.dispatch(A.readFinished({ id: "r1", census: CENSUS, windows: [] }));
    expect(store.getState().refusal?.kind).toBe("recording");
  });

  it("goes back to the drop area, keeping what the probe found", () => {
    const store = storeAt(3);
    store.dispatch(A.anotherRecordingChosen());
    const s = store.getState();
    expect(s.phase).toBe("start");
    expect(s.windows).toEqual([]);
    expect(s.gpu.status).toBe("ready");
  });
});

describe("starting", () => {
  // Why: the GPU trainer starts exactly as the practice one does.
  it("starts with the GPU trainer", () => {
    const store = storeAt(3, "gpu");
    store.dispatch(A.trainingStarted());
    expect(store.getState().phase).toBe("training");
  });

  it("waits for a yes before training on built-in graphics", () => {
    const store = storeAt(3);
    store.dispatch(A.probeFinished("integrated"));
    store.dispatch(A.trainingStarted());
    expect(store.getState().phase).toBe("census");
    store.dispatch(A.integratedAccepted());
    store.dispatch(A.trainingStarted());
    expect(store.getState().phase).toBe("training");
  });

  it("checks the graphics again without hiding the warning, and says when nothing changed", () => {
    // Why: "Check again" took the warning card away while the probe ran
    // (the status went back to probing), and a probe that found the same
    // built-in graphics gave no sign that it had looked at all.
    const store = storeAt(3);
    store.dispatch(A.probeFinished("integrated"));
    store.dispatch(A.recheckRequested());
    expect(store.getState().gpu).toMatchObject({
      status: "integrated",
      recheck: "checking",
    });
    store.dispatch(A.probeFinished("integrated"));
    expect(store.getState().gpu.recheck).toBe("unchanged");
    store.dispatch(A.recheckRequested());
    store.dispatch(A.probeFinished("ready"));
    expect(store.getState().gpu).toMatchObject({
      status: "ready",
      recheck: "idle",
    });
  });

  it("carries a refusal code from the reader into the state", () => {
    // Why: the page words a "no depth" refusal by this code, never by
    // matching the sentence.
    const store = configureStore({ reducer: trainerPageReducer });
    store.dispatch(A.readingStarted({ id: "r1", name: "a.zip" }));
    store.dispatch(
      A.readRefused({ id: "r1", reason: "No depth.", code: "no-depth" }),
    );
    expect(store.getState().refusal).toEqual({
      kind: "recording",
      reason: "No depth.",
      code: "no-depth",
    });
  });

  it("refuses the page when the probe finds no WebGPU", () => {
    const store = storeAt(3);
    store.dispatch(A.probeFinished("no-webgpu"));
    expect(store.getState().refusal?.kind).toBe("no-webgpu");
  });

  it("trains the stretches in order and ends done", () => {
    const store = storeAt(3);
    store.dispatch(A.trainingStarted());
    expect(statuses(store.getState())).toEqual([
      "training",
      "waiting",
      "waiting",
    ]);
    finishCurrent(store);
    finishCurrent(store);
    finishCurrent(store);
    expect(store.getState().phase).toBe("done");
    expect(statuses(store.getState())).toEqual(["done", "done", "done"]);
  });
});

describe("events from the trainer", () => {
  it("ignores progress of an earlier attempt or another stretch", () => {
    const store = storeAt(3);
    store.dispatch(A.trainingStarted());
    store.dispatch(
      A.progressed({
        id: "w1",
        attempt: 1,
        fraction: 0.5,
        secondsLeft: 9,
        previewEveryS: 1,
        stage: "training",
      }),
    );
    store.dispatch(
      A.progressed({
        id: "w0",
        attempt: 2,
        fraction: 0.5,
        secondsLeft: 9,
        previewEveryS: 1,
        stage: "training",
      }),
    );
    expect(store.getState().windows.map((w) => w.progress)).toEqual([0, 0, 0]);
  });

  it("clamps progress, never moves it back, and drops non-numbers", () => {
    const store = storeAt(2);
    store.dispatch(A.trainingStarted());
    const p = (fraction: number, secondsLeft: number | null) =>
      store.dispatch(
        A.progressed({
          id: "w0",
          attempt: 1,
          fraction,
          secondsLeft,
          previewEveryS: null,
          stage: "training",
        }),
      );
    p(0.4, 30);
    p(0.2, 20);
    expect(store.getState().windows[0]?.progress).toBe(0.4);
    p(Number.NaN, Number.NaN);
    expect(store.getState().windows[0]?.progress).toBe(0.4);
    p(7, Number.POSITIVE_INFINITY);
    expect(store.getState().windows[0]?.progress).toBe(1);
    expect(store.getState().windows[0]?.secondsLeft).toBeNull();
  });

  it("never judges a cancelled run", () => {
    const store = storeAt(2);
    store.dispatch(A.trainingStarted());
    store.dispatch(
      A.windowFinished({
        id: "w0",
        attempt: 1,
        outcome: "cancelled",
        metrics: null,
        judgement: judged("poor"),
        trainingS: 1,
      }),
    );
    expect(store.getState().windows[0]?.status).toBe("training");
  });
});

describe("stopping and continuing", () => {
  it("keeps finished stretches and starts the stopped one over", () => {
    const store = storeAt(4);
    store.dispatch(A.trainingStarted());
    finishCurrent(store);
    store.dispatch(
      A.progressed({
        id: "w1",
        attempt: 1,
        fraction: 0.5,
        secondsLeft: 9,
        previewEveryS: 1,
        stage: "training",
      }),
    );
    store.dispatch(A.stopAsked());
    store.dispatch(A.stopConfirmed({ id: "w1" }));
    let s = store.getState();
    expect(s.phase).toBe("stopped");
    expect(statuses(s)).toEqual(["done", "stopped", "waiting", "waiting"]);
    expect(s.windows[1]?.progress).toBe(0);
    expect(s.queue).toEqual(["w1", "w2", "w3"]);
    store.dispatch(A.continued());
    s = store.getState();
    expect(s.current).toBe("w1");
    expect(s.banner).toBe(
      "Continued at stretch 2. The 1 finished stretch was kept.",
    );
  });

  it("does not stop a stretch the dialog was not opened for", () => {
    const store = storeAt(3);
    store.dispatch(A.trainingStarted());
    store.dispatch(A.stopAsked());
    store.dispatch(A.stopConfirmed({ id: "w2" }));
    expect(store.getState().phase).toBe("training");
    expect(store.getState().stopDialog).toBe("w0");
  });

  it("holds the next stretch while the dialog is open, and Stop then stops nothing else", () => {
    const store = storeAt(3);
    store.dispatch(A.trainingStarted());
    store.dispatch(A.stopAsked());
    finishCurrent(store);
    let s = store.getState();
    expect(s.held).toBe(true);
    expect(s.current).toBeNull();
    expect(statuses(s)).toEqual(["done", "waiting", "waiting"]);
    store.dispatch(A.stopConfirmed({ id: "w0" }));
    s = store.getState();
    expect(s.phase).toBe("stopped");
    expect(statuses(s)).toEqual(["done", "waiting", "waiting"]);
    expect(s.queue).toEqual(["w1", "w2"]);
  });

  it("starts the held stretch on Keep training", () => {
    const store = storeAt(3);
    store.dispatch(A.trainingStarted());
    store.dispatch(A.stopAsked());
    finishCurrent(store);
    store.dispatch(A.stopDismissed());
    expect(store.getState().current).toBe("w1");
    expect(store.getState().held).toBe(false);
  });
});

describe("verdicts and decisions", () => {
  function doneWith(verdicts: WindowJudgement["verdict"][]) {
    const store = storeAt(verdicts.length);
    store.dispatch(A.trainingStarted());
    for (const v of verdicts) finishCurrent(store, v);
    return store;
  }

  it("leaves an undecided poor stretch out of the file", () => {
    const store = doneWith(["good", "poor", "weak"]);
    expect(undecidedWindows(store.getState()).map((w) => w.id)).toEqual(["w1"]);
    expect(windowsInFile(store.getState()).map((w) => w.id)).toEqual([
      "w0",
      "w2",
    ]);
    store.dispatch(A.decided({ id: "w1", decision: "keep" }));
    expect(windowsInFile(store.getState()).map((w) => w.id)).toEqual([
      "w0",
      "w1",
      "w2",
    ]);
    store.dispatch(A.decided({ id: "w1", decision: "discard" }));
    expect(windowsInFile(store.getState()).map((w) => w.id)).toEqual([
      "w0",
      "w2",
    ]);
    store.dispatch(A.decided({ id: "w1", decision: null }));
    expect(undecidedWindows(store.getState())).toHaveLength(1);
  });

  it("only decides about poor stretches", () => {
    const store = doneWith(["good", "weak"]);
    store.dispatch(A.decided({ id: "w0", decision: "discard" }));
    store.dispatch(A.decided({ id: "w1", decision: "discard" }));
    expect(store.getState().windows.map((w) => w.decision)).toEqual([
      null,
      null,
    ]);
  });

  it("trains a poor stretch again right away after the run, with the next attempt", () => {
    const store = doneWith(["good", "poor"]);
    store.dispatch(A.trainAgainAsked({ id: "w1" }));
    const s = store.getState();
    expect(s.phase).toBe("training");
    expect(s.current).toBe("w1");
    expect(s.windows[1]?.attempt).toBe(2);
    expect(s.banner).toBe("Training stretch 2 again, with twice the time.");
  });

  it("queues a retry behind the others during a run", () => {
    const store = storeAt(3);
    store.dispatch(A.trainingStarted());
    finishCurrent(store, "weak");
    store.dispatch(A.trainAgainAsked({ id: "w0" }));
    const s = store.getState();
    expect(s.queue).toEqual(["w2", "w0"]);
    expect(s.windows[0]?.status).toBe("queued");
  });

  it("lets a weak stretch train again once, a poor one any number of times", () => {
    const store = doneWith(["weak"]);
    store.dispatch(A.trainAgainAsked({ id: "w0" }));
    finishCurrent(store, "weak");
    store.dispatch(A.trainAgainAsked({ id: "w0" }));
    expect(store.getState().phase).toBe("done");
    const poor = doneWith(["poor"]);
    poor.dispatch(A.trainAgainAsked({ id: "w0" }));
    finishCurrent(poor, "poor");
    poor.dispatch(A.trainAgainAsked({ id: "w0" }));
    expect(poor.getState().windows[0]?.attempt).toBe(3);
  });

  it("marks a run saved while stopped unsaved again when a stretch finishes", () => {
    // Why: a save while stopped wrote the finished stretches; one that
    // finishes after Continue is not in that file, so "Saved" would hide
    // a stretch that a closed page loses.
    const store = storeAt(3);
    store.dispatch(A.trainingStarted());
    finishCurrent(store);
    store.dispatch(A.stopAsked());
    store.dispatch(A.stopConfirmed({ id: "w1" }));
    store.dispatch(A.saveStarted());
    store.dispatch(A.saveSucceeded({ count: 1 }));
    store.dispatch(A.continued());
    finishCurrent(store);
    expect(store.getState().save.status).toBe("idle");
  });

  it("marks a saved run unsaved again after a change", () => {
    const store = doneWith(["poor"]);
    store.dispatch(A.saveStarted());
    store.dispatch(A.saveSucceeded({ count: 0 }));
    store.dispatch(A.decided({ id: "w0", decision: "keep" }));
    expect(store.getState().save.status).toBe("idle");
    expect(store.getState().save.savedCount).toBe(0);
  });
});

describe("secondsLeftInRun", () => {
  it("is null until the trainer measured, then adds the queue at the average pace", () => {
    const store = storeAt(3);
    store.dispatch(A.trainingStarted());
    expect(secondsLeftInRun(store.getState())).toBeNull();
    finishCurrent(store);
    store.dispatch(
      A.progressed({
        id: "w1",
        attempt: 1,
        fraction: 0.5,
        secondsLeft: 30,
        previewEveryS: 3,
        stage: "training",
      }),
    );
    // 30 s of stretch 2, then stretch 3 at the 60 s stretch 1 took.
    expect(secondsLeftInRun(store.getState())).toBe(90);
  });

  it("scales retries by the same doubling the trainer is given", () => {
    // Why: the trainer runs attempt n with 2^(n-1) times the time; an
    // estimate that scaled by n was wrong from the third attempt on.
    expect([1, 2, 3, 4].map(attemptTimeScale)).toEqual([1, 2, 4, 8]);
    const store = storeAt(3);
    store.dispatch(A.trainingStarted());
    finishCurrent(store);
    store.dispatch(
      A.progressed({
        id: "w1",
        attempt: 1,
        fraction: 0.5,
        secondsLeft: 30,
        previewEveryS: 3,
        stage: "training",
      }),
    );
    const s = store.getState();
    const [w0, w1, w2] = s.windows;
    if (w0 === undefined || w1 === undefined || w2 === undefined)
      throw new Error("three stretches");
    // Stretch 1 took 120 s on its third attempt (30 s per unit of time);
    // stretch 3 waits for its third attempt too: 4 units.
    const at: TrainerPageState = {
      ...s,
      windows: [
        { ...w0, attempt: 3, trainingS: 120 },
        w1,
        { ...w2, attempt: 3 },
      ],
    };
    expect(secondsLeftInRun(at)).toBe(30 + 30 * 4);
  });

  it("is null or a finite number, also at the end of a stretch", () => {
    // Why: progress 1 with no finished stretch divided by zero and the
    // bar read "about Infinity hours".
    const store = storeAt(3);
    store.dispatch(A.trainingStarted());
    store.dispatch(
      A.progressed({
        id: "w0",
        attempt: 1,
        fraction: 1,
        secondsLeft: 5,
        previewEveryS: null,
        stage: "training",
      }),
    );
    expect(secondsLeftInRun(store.getState())).toBeNull();
  });
});

describe("reading progress", () => {
  // Why: a phone or a slow disk takes a long time over a large zip; the
  // page shows how far the read is from its first frame, and a late
  // report of an earlier read never moves the bar of the current one.
  it("counts the read from zero, only forward, only for the current read", () => {
    const store = configureStore({ reducer: trainerPageReducer });
    expect(store.getState().read).toBeNull();
    store.dispatch(A.readingStarted({ id: "r1", name: "a.zip" }));
    expect(store.getState().read).toEqual({ done: 0, total: 0 });
    store.dispatch(A.readProgressed({ id: "r1", done: 3, total: 10 }));
    expect(store.getState().read).toEqual({ done: 3, total: 10 });
    store.dispatch(A.readProgressed({ id: "r1", done: 2, total: 10 }));
    expect(store.getState().read).toEqual({ done: 3, total: 10 });
    store.dispatch(A.readProgressed({ id: "r0", done: 9, total: 10 }));
    expect(store.getState().read).toEqual({ done: 3, total: 10 });
    store.dispatch(A.readProgressed({ id: "r1", done: 40, total: 10 }));
    expect(store.getState().read).toEqual({ done: 10, total: 10 });
    store.dispatch(A.readProgressed({ id: "r1", done: Number.NaN, total: 10 }));
    expect(store.getState().read).toEqual({ done: 10, total: 10 });
  });

  it("ends with the read, finished or refused", () => {
    const store = configureStore({ reducer: trainerPageReducer });
    store.dispatch(A.readingStarted({ id: "r1", name: "a.zip" }));
    store.dispatch(A.readProgressed({ id: "r1", done: 1, total: 2 }));
    store.dispatch(
      A.readFinished({ id: "r1", census: CENSUS, windows: plan(2) }),
    );
    expect(store.getState().read).toBeNull();
    const refused = configureStore({ reducer: trainerPageReducer });
    refused.dispatch(A.readingStarted({ id: "r1", name: "a.zip" }));
    refused.dispatch(A.readRefused({ id: "r1", reason: "no" }));
    expect(refused.getState().read).toBeNull();
    refused.dispatch(A.readProgressed({ id: "r1", done: 1, total: 2 }));
    expect(refused.getState().read).toBeNull();
  });
});

describe("what a stretch is doing", () => {
  // Why: loading the trainer and preparing the graphics card take a while
  // before the first step; the stretch says so from the moment it starts,
  // never an empty "0 %".
  it("starts as loading and follows the trainer's stage", () => {
    const store = storeAt(2);
    store.dispatch(A.trainingStarted());
    const first = () => store.getState().windows[0];
    expect(first()?.stage).toBe("loading");
    expect(store.getState().windows[1]?.stage).toBeNull();
    for (const stage of ["preparing", "training", "checking"] as const) {
      store.dispatch(
        A.progressed({
          id: "w0",
          attempt: 1,
          fraction: 0.5,
          secondsLeft: null,
          previewEveryS: null,
          stage,
        }),
      );
      expect(first()?.stage).toBe(stage);
    }
    finishCurrent(store);
    expect(first()?.stage).toBeNull();
    expect(store.getState().windows[1]?.stage).toBe("loading");
  });

  it("forgets the stage of a stopped stretch and of one queued again", () => {
    const store = storeAt(2);
    store.dispatch(A.trainingStarted());
    store.dispatch(A.stopAsked());
    store.dispatch(A.stopConfirmed({ id: "w0" }));
    expect(store.getState().windows[0]?.stage).toBeNull();
    store.dispatch(A.continued());
    expect(store.getState().windows[0]?.stage).toBe("loading");
  });
});
