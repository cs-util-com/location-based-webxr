/**
 * Why these tests matter: the listeners are where the page meets the real
 * recording reader, the trainer and the disk. These run a synthetic
 * recording through the real reader and the practice trainer on a manual
 * clock, so they catch a stopped stretch whose trainer keeps running, a
 * trainer error that would leave the page stuck at "Training", and a save
 * that reports success when nothing was written.
 */
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import { describe, expect, it, vi } from "vitest";

import { manualTimer } from "../test-support/manual-timer.js";
import { settle } from "../test-support/settle.js";
import { buildSyntheticRecording } from "../test-support/synthetic-recording.js";
import { createPracticeTrainer, PRACTICE_STRETCH_MS } from "./fake-trainer.js";
import { readSplatInputs } from "./recording-reader.js";
import type { TrainerAdapter } from "./trainer-adapter.js";
import {
  createTrainerPageStore,
  type TrainerPageDeps,
} from "./trainer-page-store.js";
import { trainerPageActions as A } from "./trainer-page-slice.js";
import { windowPlanner } from "./window-plan.js";

/** Windows the real planner makes of the 60-photo, 71 m test walk. */
const WINDOWS = 2;

function setup(over: Partial<TrainerPageDeps> = {}, adapter?: TrainerAdapter) {
  const timer = manualTimer();
  const deps: TrainerPageDeps = {
    adapter: adapter ?? createPracticeTrainer({ timer }),
    read: (file) => readSplatInputs(file),
    plan: windowPlanner(),
    write: vi.fn(() => Promise.resolve()),
    download: vi.fn(() => Promise.resolve(true)),
    ...over,
  };
  const c = createTrainerPageStore(deps);
  const settled = () => settle(() => [c.store.getState()]);
  return { c, deps, timer, settled };
}

async function atCensus(frames = 60, over: Partial<TrainerPageDeps> = {}) {
  const h = setup(over);
  await h.c.probe();
  const { file } = await buildSyntheticRecording({ frames, spacingM: 1.2 });
  h.c.chooseRecording(file);
  await h.settled();
  return h;
}

describe("reading", () => {
  it("reads a recording through the real reader and plans its stretches", async () => {
    const { c } = await atCensus(60);
    const s = c.store.getState();
    expect(s.phase).toBe("census");
    expect(s.recording?.census?.frames).toBe(60);
    expect(s.windows.length).toBe(WINDOWS);
    expect(c.sides.plans.get("r1")?.map((p) => p.window.core.length)).toEqual(
      s.windows.map((w) => w.frames),
    );
    expect(c.sides.inputs.size).toBe(1);
  });

  it("refuses a recording from before camera positions were stored", async () => {
    const h = setup();
    await h.c.probe();
    const { file } = await buildSyntheticRecording({ era: 3 });
    h.c.chooseRecording(file);
    await h.settled();
    expect(h.c.store.getState().refusal?.kind).toBe("recording");
    expect(h.c.store.getState().refusal?.reason).toBeTruthy();
  });

  it("refuses when the reader itself throws", async () => {
    const h = setup({ read: () => Promise.reject(new Error("disk gone")) });
    h.c.chooseRecording(new File(["x"], "a.zip"));
    await h.settled();
    expect(h.c.store.getState().refusal).toEqual({
      kind: "recording",
      reason: "disk gone",
    });
  });
});

describe("training", () => {
  it("trains every stretch in turn with the practice trainer", async () => {
    const { c, timer } = await atCensus(60);
    c.store.dispatch(A.trainingStarted());
    for (let i = 0; i < WINDOWS; i++) {
      timer.advance(PRACTICE_STRETCH_MS);
      await settleAll(c);
    }
    const s = c.store.getState();
    expect(s.phase).toBe("done");
    expect(s.windows.every((w) => w.judgement?.verdict === "good")).toBe(true);
  });

  it("aborts the trainer on stop: no progress after it, a fresh run on continue", async () => {
    const { c, timer } = await atCensus(60);
    c.store.dispatch(A.trainingStarted());
    timer.advance(5000);
    await settleAll(c);
    expect(c.store.getState().windows[0]?.progress).toBeGreaterThan(0);
    c.store.dispatch(A.stopAsked());
    c.store.dispatch(A.stopConfirmed({ id: "w0" }));
    await settleAll(c);
    expect(timer.pending()).toBe(0);
    expect(c.sides.previews.has("w0")).toBe(false);
    c.store.dispatch(A.continued());
    timer.advance(PRACTICE_STRETCH_MS);
    await settleAll(c);
    expect(c.store.getState().windows[0]?.status).toBe("done");
  });

  it("judges a trainer that throws as not good enough and goes on", async () => {
    const timer = manualTimer();
    const real = createPracticeTrainer({ timer });
    const broken: TrainerAdapter = {
      ...real,
      trainWindow: () => Promise.reject(new Error("device lost")),
    };
    const h = setup({}, broken);
    await h.c.probe();
    const { file } = await buildSyntheticRecording({
      frames: 60,
      spacingM: 1.2,
    });
    h.c.chooseRecording(file);
    await h.settled();
    h.c.store.dispatch(A.trainingStarted());
    await h.settled();
    const s = h.c.store.getState();
    expect(s.phase).toBe("done");
    expect(s.windows[0]?.judgement?.reasons).toEqual(["the trainer stopped"]);
  });
});

async function settleAll(c: ReturnType<typeof setup>["c"]) {
  await settle(() => [c.store.getState()]);
}

async function doneRun() {
  const h = await atCensus(60);
  h.c.store.dispatch(A.trainingStarted());
  for (let i = 0; i < WINDOWS; i++) {
    h.timer.advance(PRACTICE_STRETCH_MS);
    await h.settled();
  }
  return h;
}

async function manifestOf(blob: Blob): Promise<{ stretches: unknown[] }> {
  const reader = new ZipReader(new BlobReader(blob));
  const entries = await reader.getEntries();
  const entry = entries.find((e) => e.filename === "splat-package.json");
  if (entry === undefined || entry.directory) throw new Error("no manifest");
  const text = await entry.getData(new TextWriter());
  await reader.close();
  return JSON.parse(text) as { stretches: unknown[] };
}

describe("saving", () => {
  it("writes a placeholder package into the picked file", async () => {
    const h = await doneRun();
    const handle = { name: "x.zip" } as FileSystemFileHandle;
    await h.c.save(Promise.resolve({ kind: "picked", handle }));
    expect(h.c.store.getState().save).toMatchObject({
      status: "saved",
      savedCount: WINDOWS,
    });
    const write = h.deps.write as ReturnType<typeof vi.fn>;
    expect(write).toHaveBeenCalledTimes(1);
    const blob = write.mock.calls[0]?.[1] as Blob;
    const manifest = await manifestOf(blob);
    expect(manifest).toMatchObject({ placeholder: true, version: 0 });
    expect(manifest.stretches).toHaveLength(WINDOWS);
  });

  it("ends quietly when the save dialog is cancelled", async () => {
    const h = await doneRun();
    await h.c.save(Promise.resolve({ kind: "cancelled" }));
    expect(h.c.store.getState().save.status).toBe("idle");
    expect(h.deps.write).not.toHaveBeenCalled();
  });

  it("downloads where there is no save dialog, and a cancelled download is no save", async () => {
    const h = await doneRun();
    await h.c.save(Promise.resolve({ kind: "unavailable" }));
    expect(h.deps.download).toHaveBeenCalledWith(
      expect.any(Blob),
      "synthetic-recording-splat.zip",
    );
    expect(h.c.store.getState().save.status).toBe("saved");
    const g = await doneRun();
    (g.deps.download as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await g.c.save(Promise.resolve({ kind: "unavailable" }));
    expect(g.c.store.getState().save.status).toBe("idle");
  });

  it("reports a failed write and stays ready to try again", async () => {
    const h = await doneRun();
    (h.deps.write as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("disk full"),
    );
    await h.c.save(
      Promise.resolve({ kind: "picked", handle: {} as FileSystemFileHandle }),
    );
    expect(h.c.store.getState().save).toMatchObject({
      status: "failed",
      error: "disk full",
    });
    await h.c.save(
      Promise.resolve({ kind: "picked", handle: {} as FileSystemFileHandle }),
    );
    expect(h.c.store.getState().save.status).toBe("saved");
  });
});
