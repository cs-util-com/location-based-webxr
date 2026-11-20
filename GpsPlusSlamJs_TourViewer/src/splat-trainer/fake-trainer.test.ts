/**
 * Why these tests matter: the practice trainer stands in for the real one
 * until it lands, so it must keep the adapter's promises exactly: an abort
 * resolves `cancelled` and stops all timers (a leaked timer would keep
 * "training" a stopped stretch), progress only grows, a retry takes the
 * longer time it was given, and a query value that is not a number never
 * turns into NaN timings.
 */
import { describe, expect, it } from "vitest";

import { manualTimer } from "../test-support/manual-timer.js";
import {
  createPracticeTrainer,
  DEFAULT_PRACTICE_SCRIPT,
  parsePace,
  PRACTICE_STRETCH_MS,
  sharpnessAt,
} from "./fake-trainer.js";
import type { TrainProgress, TrainRequest } from "./trainer-adapter.js";

const request = (index: number, attempt = 1, timeScale = 1): TrainRequest => ({
  window: {
    id: `w${index}`,
    index,
    fromM: 0,
    toM: 30,
    frames: 5,
    window: {
      segment: 0,
      core: [0, 1, 2, 3, 4],
      train: [0, 1, 2, 3],
      holdouts: [4],
      tooFewHoldouts: true,
      tooFewFrames: true,
    },
  },
  attempt,
  timeScale,
  inputs: {} as TrainRequest["inputs"],
});

function harness(pace = 1) {
  const timer = manualTimer();
  const pictures: number[] = [];
  const trainer = createPracticeTrainer({
    timer,
    pace,
    picture: (_i, sharpness) => {
      pictures.push(sharpness);
      return {} as CanvasImageSource;
    },
  });
  const progress: TrainProgress[] = [];
  const events = {
    onProgress: (p: TrainProgress) => progress.push(p),
    onPreview: () => {},
  };
  return { timer, trainer, pictures, progress, events };
}

describe("createPracticeTrainer", () => {
  it("trains a stretch for its scripted time and ends with the script's numbers", async () => {
    const h = harness();
    const done = h.trainer.trainWindow(
      request(0),
      h.events,
      new AbortController().signal,
    );
    h.timer.advance(PRACTICE_STRETCH_MS);
    const result = await done;
    expect(result.outcome).toBe("finished");
    expect(result.metrics?.photosUsed).toBe(5);
    expect(result.trainingS).toBeCloseTo(PRACTICE_STRETCH_MS / 1000);
    const fractions = h.progress.map((p) => p.fraction);
    expect(fractions.at(-1)).toBe(1);
    expect([...fractions].sort((a, b) => a - b)).toEqual(fractions);
    expect(h.pictures.length).toBeGreaterThan(2);
    expect(h.timer.pending()).toBe(0);
  });

  it("reports no time estimate before it has measured", () => {
    const h = harness();
    void h.trainer.trainWindow(
      request(0),
      h.events,
      new AbortController().signal,
    );
    h.timer.advance(1000);
    expect(h.progress.every((p) => p.secondsLeft === null)).toBe(true);
    h.timer.advance(4000);
    expect(h.progress.at(-1)?.secondsLeft).toBeCloseTo(15);
  });

  it("resolves cancelled on abort and leaves no timer behind", async () => {
    const h = harness();
    const ctrl = new AbortController();
    const done = h.trainer.trainWindow(request(0), h.events, ctrl.signal);
    h.timer.advance(5000);
    ctrl.abort();
    expect((await done).outcome).toBe("cancelled");
    expect(h.timer.pending()).toBe(0);
    const before = h.progress.length;
    h.timer.advance(PRACTICE_STRETCH_MS);
    expect(h.progress.length).toBe(before);
  });

  it("resolves cancelled at once for an already aborted signal", async () => {
    const h = harness();
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await h.trainer.trainWindow(
      request(0),
      h.events,
      ctrl.signal,
    );
    expect(result.outcome).toBe("cancelled");
    expect(h.timer.pending()).toBe(0);
  });

  it("gives a retry its longer time", async () => {
    const h = harness();
    const done = h.trainer.trainWindow(
      request(4, 2, 2),
      h.events,
      new AbortController().signal,
    );
    h.timer.advance(PRACTICE_STRETCH_MS);
    expect(h.timer.pending()).toBe(1);
    h.timer.advance(PRACTICE_STRETCH_MS);
    expect((await done).outcome).toBe("finished");
  });

  it("runs faster at a higher pace", async () => {
    const h = harness(10);
    const done = h.trainer.trainWindow(
      request(0),
      h.events,
      new AbortController().signal,
    );
    h.timer.advance(PRACTICE_STRETCH_MS / 10);
    expect((await done).outcome).toBe("finished");
  });

  it("judges by the script, and a lost graphics card as not good enough", () => {
    const h = harness();
    const r = request(4);
    const result = {
      outcome: "finished" as const,
      metrics: null,
      trainingS: 1,
      ply: null,
    };
    expect(h.trainer.judge(r, result).verdict).toBe("poor");
    expect(h.trainer.judge(request(4, 2), result).verdict).toBe("weak");
    expect(
      h.trainer.judge(request(0), { ...result, outcome: "gpu-lost" }).verdict,
    ).toBe("poor");
  });

  it("probes as told", async () => {
    const timer = manualTimer();
    expect(
      (await createPracticeTrainer({ timer, gpu: "integrated" }).probe()).kind,
    ).toBe("integrated");
    expect((await createPracticeTrainer({ timer }).probe()).kind).toBe("ready");
  });
});

describe("the default script", () => {
  it("makes stretch 3 weak, 5 poor and 8 run out of time, each better again", () => {
    expect(DEFAULT_PRACTICE_SCRIPT(2, 1).verdict).toBe("weak");
    expect(DEFAULT_PRACTICE_SCRIPT(4, 1).verdict).toBe("poor");
    expect(DEFAULT_PRACTICE_SCRIPT(7, 1).outcome).toBe("deadline");
    expect(DEFAULT_PRACTICE_SCRIPT(2, 2).verdict).toBe("good");
    expect(DEFAULT_PRACTICE_SCRIPT(4, 2).verdict).toBe("weak");
    expect(DEFAULT_PRACTICE_SCRIPT(4, 3).verdict).toBe("good");
    expect(DEFAULT_PRACTICE_SCRIPT(0, 1).verdict).toBe("good");
  });
});

describe("parsePace", () => {
  it("keeps a positive number and turns everything else into 1", () => {
    expect(parsePace("4")).toBe(4);
    for (const bad of [
      null,
      undefined,
      "",
      " ",
      "fast",
      "NaN",
      "-2",
      "0",
      "Infinity",
    ]) {
      expect(parsePace(bad)).toBe(1);
    }
    expect(parsePace("1e9")).toBe(1000);
  });
});

describe("sharpnessAt", () => {
  it("starts blank, ends at the ending's sharpness, and survives non-numbers", () => {
    expect(sharpnessAt(0.9, 0)).toBe(0);
    expect(sharpnessAt(0.9, 1)).toBeCloseTo(0.9);
    expect(Number.isFinite(sharpnessAt(Number.NaN, Number.NaN))).toBe(true);
  });
});
