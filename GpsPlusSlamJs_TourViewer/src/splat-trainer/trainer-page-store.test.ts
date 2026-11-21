/**
 * Why these tests matter: the listeners are where the page meets the real
 * recording reader, the trainer and the disk. These run a synthetic
 * recording through the real reader and the practice trainer on a manual
 * clock, so they catch a stopped stretch whose trainer keeps running, a
 * trainer error that would leave the page stuck at "Training", and a save
 * that reports success when nothing was written.
 */
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import { beforeAll, describe, expect, it, vi } from "vitest";

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
  /**
   * Chooses `file` and waits for its read to end, read or refused. The
   * read inflates the zip and hashes on the thread pool, steps the
   * settle's fingerprint cannot see and its quiet window covers only
   * while the machine is idle, so the read is awaited by its result.
   */
  const read = async (file: File): Promise<void> => {
    c.chooseRecording(file);
    await new Promise<void>((resolve) => {
      const ended = () => c.store.getState().phase !== "reading";
      if (ended()) {
        resolve();
        return;
      }
      const unsubscribe = c.store.subscribe(() => {
        if (!ended()) return;
        unsubscribe();
        resolve();
      });
    });
    await settled();
  };
  return { c, deps, timer, settled, read };
}

/** The 60-photo, 71 m test walk, built once for the file: a read never
 *  changes a File, and building it is most of a test's setup. */
let walk: File;
beforeAll(async () => {
  ({ file: walk } = await buildSyntheticRecording({
    frames: 60,
    spacingM: 1.2,
  }));
});

async function atCensus(
  over: Partial<TrainerPageDeps> = {},
  adapter?: TrainerAdapter,
) {
  const h = setup(over, adapter);
  await h.c.probe();
  await h.read(walk);
  return h;
}

describe("reading", () => {
  it("reads a recording through the real reader and plans its stretches", async () => {
    const { c } = await atCensus();
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
    await h.read(file);
    expect(h.c.store.getState().refusal?.kind).toBe("recording");
    expect(h.c.store.getState().refusal?.reason).toBeTruthy();
  });

  it("refuses when the reader itself throws", async () => {
    const h = setup({ read: () => Promise.reject(new Error("disk gone")) });
    await h.read(new File(["x"], "a.zip"));
    expect(h.c.store.getState().refusal).toEqual({
      kind: "recording",
      reason: "disk gone",
    });
  });

  it("refuses with the planner's own words when planning throws", async () => {
    // Why: a throwing planner was swallowed into an empty plan, and the
    // page said the recording had no camera positions, which was untrue.
    const h = setup({
      plan: () => {
        throw new Error("The walk cannot be split into stretches.");
      },
    });
    await h.c.probe();
    const { file } = await buildSyntheticRecording({ frames: 60 });
    await h.read(file);
    expect(h.c.store.getState().refusal?.reason).toBe(
      "The walk cannot be split into stretches.",
    );
    expect(h.c.sides.inputs.size).toBe(0);
  });

  it("passes the reader's refusal code on", async () => {
    const h = setup();
    await h.c.probe();
    const { file } = await buildSyntheticRecording({ depth: false });
    await h.read(file);
    expect(h.c.store.getState().refusal?.code).toBe("no-depth");
  });
});

describe("training", () => {
  it("trains every stretch in turn with the practice trainer", async () => {
    const { c, timer } = await atCensus();
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
    const { c, timer } = await atCensus();
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
    const h = await atCensus({}, broken);
    h.c.store.dispatch(A.trainingStarted());
    await h.settled();
    const s = h.c.store.getState();
    expect(s.phase).toBe("done");
    expect(s.windows[0]?.judgement?.reasons).toEqual(["the trainer stopped"]);
  });
});

describe("a run that ends on its own", () => {
  it("counts a cancel nobody asked for as a failure and goes on", async () => {
    // Why: a trainer that reports "cancelled" without an abort (a worker
    // that died) was ignored like a real cancel, and the page stayed at
    // "Training" with no job running.
    const timer = manualTimer();
    const real = createPracticeTrainer({ timer });
    const quits: TrainerAdapter = {
      ...real,
      trainWindow: (request, events, signal) =>
        request.window.index === 0
          ? Promise.resolve({
              outcome: "cancelled",
              metrics: null,
              trainingS: 1,
              ply: null,
            })
          : real.trainWindow(request, events, signal),
    };
    const h = await atCensus({}, quits);
    h.c.store.dispatch(A.trainingStarted());
    await h.settled();
    expect(h.c.store.getState().windows[0]?.judgement?.reasons).toEqual([
      "the trainer stopped",
    ]);
    expect(h.c.store.getState().current).toBe("w1");
    timer.advance(PRACTICE_STRETCH_MS);
    await h.settled();
    expect(h.c.store.getState().phase).toBe("done");
  });

  it("closes a preview picture when a newer one replaces it or it is dropped", async () => {
    // Why: an ImageBitmap holds decoded pixels until it is closed; a run
    // of hundreds of previews would keep every one of them.
    const timer = manualTimer();
    const pictures: { close: ReturnType<typeof vi.fn> }[] = [];
    const real = createPracticeTrainer({
      timer,
      picture: () => {
        const p = { close: vi.fn() };
        pictures.push(p);
        return p as unknown as CanvasImageSource;
      },
    });
    const h = await atCensus({}, real);
    h.c.store.dispatch(A.trainingStarted());
    timer.advance(9000);
    await h.settled();
    expect(pictures.length).toBeGreaterThan(1);
    const shown = pictures.at(-1);
    for (const p of pictures) {
      expect(p.close).toHaveBeenCalledTimes(p === shown ? 0 : 1);
    }
    h.c.store.dispatch(A.stopAsked());
    h.c.store.dispatch(A.stopConfirmed({ id: "w0" }));
    await h.settled();
    expect(shown?.close).toHaveBeenCalledTimes(1);
  });
});

describe("what a finished stretch keeps", () => {
  /** A trainer that shows one look of each stretch and then ends it. */
  function onePicture(
    result: Partial<Awaited<ReturnType<TrainerAdapter["trainWindow"]>>>,
    pictures: { close: ReturnType<typeof vi.fn> }[],
  ): TrainerAdapter {
    const real = createPracticeTrainer({ timer: manualTimer() });
    return {
      ...real,
      trainWindow: (_request, events) => {
        const p = { close: vi.fn() };
        pictures.push(p);
        events.onPreview(p as unknown as CanvasImageSource);
        return Promise.resolve({
          outcome: "finished",
          metrics: { atCameraDb: 30, heldOutDb: 22, photosUsed: 4 },
          trainingS: 1,
          ply: null,
          ...result,
        });
      },
    };
  }

  async function run(adapter: TrainerAdapter, over: Partial<TrainerPageDeps>) {
    const h = await atCensus(over, adapter);
    h.c.store.dispatch(A.trainingStarted());
    await h.settled();
    return h;
  }

  // Why: a finished stretch kept its full-size look (about 7.7 MB at the
  // trainer's photo size) for the whole session, half a gigabyte for a
  // long walk. It keeps a small copy and lets go of the big one.
  it("keeps a small copy of a finished stretch's look", async () => {
    const pictures: { close: ReturnType<typeof vi.fn> }[] = [];
    const small = { close: vi.fn() };
    const thumbnail = vi.fn(() =>
      Promise.resolve(small as unknown as CanvasImageSource),
    );
    const h = await run(onePicture({}, pictures), { thumbnail });
    expect(h.c.store.getState().phase).toBe("done");
    expect(thumbnail).toHaveBeenCalledWith(pictures[0]);
    for (const p of pictures) expect(p.close).toHaveBeenCalledTimes(1);
    expect(h.c.sides.previews.get("w0")).toBe(small);
    expect(small.close).not.toHaveBeenCalled();
  });

  // Why: a copy that cannot be made must not keep the big picture either.
  it("lets go of the look when no small copy can be made", async () => {
    const pictures: { close: ReturnType<typeof vi.fn> }[] = [];
    const h = await run(onePicture({}, pictures), {
      thumbnail: () => Promise.reject(new Error("no canvas")),
    });
    for (const p of pictures) expect(p.close).toHaveBeenCalledTimes(1);
    expect(h.c.sides.previews.has("w0")).toBe(false);
  });

  // Why: a failed stretch said only "Training stopped with an error";
  // it now says why, and a cause training again cannot fix does not
  // offer it.
  it("says why a stretch failed and whether training again can help", async () => {
    const detail =
      "The splat trainer library could not be downloaded (blocked).";
    const h = await run(
      onePicture(
        { outcome: "failed", metrics: null, detail, retryHelps: false },
        [],
      ),
      {},
    );
    const w = h.c.store.getState().windows[0];
    expect(w?.judgement?.say).toContain(detail);
    expect(w?.judgement?.retryHelps).toBe(false);
    h.c.store.dispatch(A.trainAgainAsked({ id: "w0" }));
    expect(h.c.store.getState().windows[0]?.attempt).toBe(1);
  });
});

async function settleAll(c: ReturnType<typeof setup>["c"]) {
  await settle(() => [c.store.getState()]);
}

async function doneRun() {
  const h = await atCensus();
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
    expect(manifest).toMatchObject({
      placeholder: true,
      version: 0,
      trainer: "practice",
    });
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
    // The same run saved again, its download cancelled this time.
    (h.deps.download as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await h.c.save(Promise.resolve({ kind: "unavailable" }));
    expect(h.c.store.getState().save.status).toBe("idle");
  });

  it("names what became of a picked file that a failed save did not write", async () => {
    // Why: the browser empties a chosen file as the dialog returns, so
    // "nothing was lost" was untrue when the person picked an existing
    // file to replace.
    const h = await doneRun();
    (h.deps.write as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("disk full"),
    );
    await h.c.save(
      Promise.resolve({
        kind: "picked",
        handle: { name: "walk-splat.zip" } as FileSystemFileHandle,
      }),
    );
    expect(h.c.store.getState().save.left).toBe(
      'The file "walk-splat.zip" you picked was not written, and may now be empty.',
    );
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

describe("reading progress", () => {
  // Why: the reader reports every entry it reads, and a recording has
  // thousands; the state moves only when the shown whole percent does, so
  // the page re-renders a hundred times at most while the read runs.
  it("passes the reader's progress on, a step per whole percent", async () => {
    let report!: (done: number, total: number) => void;
    const h = setup({
      read: (_file, onProgress) => {
        report = onProgress;
        return new Promise(() => {});
      },
    });
    h.c.chooseRecording(new File(["x"], "a.zip"));
    await h.settled();
    expect(h.c.store.getState().read).toEqual({ done: 0, total: 0 });
    const seen: unknown[] = [];
    h.c.store.subscribe(() => seen.push(h.c.store.getState().read));
    report(1, 1000);
    report(5, 1000);
    report(10, 1000);
    report(1000, 1000);
    expect(seen).toEqual([
      { done: 1, total: 1000 },
      { done: 10, total: 1000 },
      { done: 1000, total: 1000 },
    ]);
  });
});
