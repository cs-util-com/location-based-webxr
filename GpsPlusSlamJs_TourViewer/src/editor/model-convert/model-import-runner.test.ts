/**
 * Why these tests matter: the runner is what turns a dropped model into a
 * file of the tour. It converts one model at a time and never while the
 * optimizer works on another one (a phone holds one large model at a
 * time), shows every step on the model's row, adds the model only through
 * the delivery it was given (the shelf, an item's file field), says in
 * words why a model was not added, never retries a crash by itself, lets
 * the converter's Worker go after every model, and gives the drop's
 * pictures to the shelf once no model of the drop used them, so no file
 * of a drop vanishes without a word.
 */
import { configureStore } from "@reduxjs/toolkit";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  OptimizerCrashed,
  type OptimizeOutcome,
  type OptimizerHost,
} from "../asset-shelf/asset-optimizers.js";
import {
  assetShelfActions as shelfAct,
  assetShelfReducer,
  selectShelfRows,
} from "../asset-shelf/asset-shelf-slice.js";
import { tourOf } from "../../test-support/tour-of.js";
import {
  tourDocumentActions as doc,
  tourDocumentReducer,
} from "../../tour-document.js";
import { planImport } from "./import-plan.js";
import {
  createModelImportRunner,
  type ImportDelivery,
} from "./model-import-runner.js";
import { failure } from "./model-import-words.js";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

interface HeldRun {
  readonly payload: unknown;
  readonly resolve: (outcome: OptimizeOutcome) => void;
  readonly reject: (error: unknown) => void;
  readonly signal: AbortSignal;
  readonly progress: (fraction: number) => void;
}

/** A host whose runs the test answers by hand. */
function fakeHost() {
  const runs: HeldRun[] = [];
  const host: OptimizerHost & { closes: number } = {
    closes: 0,
    run: (_kind, payload, _settings, control) =>
      new Promise<OptimizeOutcome>((resolve, reject) => {
        control.signal.addEventListener("abort", () =>
          reject(new DOMException("stopped", "AbortError")),
        );
        runs.push({
          payload,
          resolve,
          reject,
          signal: control.signal,
          progress: control.progress,
        });
      }),
    close() {
      host.closes++;
    },
  };
  return { host, runs };
}

const made = (notes: string[] = [], used: string[] = []): OptimizeOutcome => ({
  kind: "optimized",
  blob: new Blob(["glb"]),
  extension: "glb",
  conversion: { notes, used },
});

const file = (name: string, size = 4) => new File([new Uint8Array(size)], name);

function setup() {
  const store = configureStore({
    reducer: {
      assetShelf: assetShelfReducer,
      tourDocument: tourDocumentReducer,
    },
  });
  store.dispatch(doc.opened({ manifest: tourOf([]) }));
  const { host, runs } = fakeHost();
  let added = 0;
  const delivered: { file: File; from: string; notes: readonly string[] }[] =
    [];
  const deliver = vi.fn<ImportDelivery>((f, about) => {
    delivered.push({ file: f, ...about });
    const id = `${++added}`.padStart(64, "0");
    store.dispatch(
      shelfAct.entryAdded({
        id,
        kind: "model",
        name: f.name,
        origin: "added",
        originalBytes: f.size,
        queued: false,
      }),
    );
    return Promise.resolve({ kind: "added" as const, id });
  });
  const released: File[][] = [];
  const runner = createModelImportRunner({ store, host });
  /** Drops `files` as one group. */
  const drop = (files: File[], to: ImportDelivery = deliver) => {
    const plan = planImport(files.map((f) => f.name));
    return runner.start({
      files,
      plan,
      deliver: to,
      release: (pictures) => released.push([...pictures]),
    });
  };
  const rows = () => selectShelfRows(store.getState());
  /** Lets the runner's promise chain run out: microtasks only, since a
   *  timer per step made the property take seconds. */
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    store,
    host,
    runs,
    runner,
    drop,
    rows,
    settle,
    delivered,
    released,
    deliver,
  };
}

describe("the model import runner", () => {
  it("converts a dropped model and adds it through its delivery, with what was left out", async () => {
    const t = setup();
    const ids = t.drop([file("bust.gltf"), file("bust.bin", 8)]);
    expect(ids).toHaveLength(1);
    expect(t.rows()).toMatchObject([
      { id: ids[0], status: "running", name: "bust.gltf", originalBytes: 12 },
    ]);
    expect(t.runs[0]!.payload).toMatchObject({
      format: "gltf",
      name: "bust.gltf",
      files: [{ path: "bust.gltf" }, { path: "bust.bin" }],
    });
    t.runs[0]!.progress(0.5);
    expect(t.rows()[0]).toMatchObject({ progress: 0.5 });
    t.runs[0]!.resolve(made(["Made without x."], ["bust.bin"]));
    await t.settle();
    expect(t.delivered.map((d) => [d.file.name, d.from, d.notes])).toEqual([
      ["bust.glb", "bust.gltf", ["Made without x."]],
    ]);
    expect(t.rows()).toMatchObject([
      { kind: "model", name: "bust.glb", madeFrom: { from: "bust.gltf" } },
    ]);
    expect(t.rows()[0]).not.toHaveProperty("import");
    expect(t.host.closes).toBe(1);
  });

  it("converts one model at a time, in arrival order", async () => {
    const t = setup();
    t.drop([file("a.gltf")]);
    t.drop([file("b.zip")]);
    expect(t.runs).toHaveLength(1);
    expect(t.rows().map((r) => r.status)).toEqual(["running", "queued"]);
    t.runs[0]!.resolve(made());
    await t.settle();
    expect(t.runs).toHaveLength(2);
    expect(t.runs[1]!.payload).toMatchObject({ format: "zip", name: "b.zip" });
  });

  it("waits while the optimizer works on a model, and starts once it is done", () => {
    const t = setup();
    const busy = "f".repeat(64);
    t.store.dispatch(
      shelfAct.entryAdded({
        id: busy,
        kind: "model",
        name: "rock.glb",
        origin: "added",
        originalBytes: 9,
        queued: true,
      }),
    );
    t.store.dispatch(shelfAct.jobStarted({ id: busy }));
    t.drop([file("a.gltf")]);
    expect(t.runs).toHaveLength(0);
    t.store.dispatch(
      shelfAct.jobOptimized({
        id: busy,
        optimizedBytes: 5,
        originalHeld: false,
      }),
    );
    expect(t.runs).toHaveLength(1);
  });

  it("refuses a model it cannot make in words, with no Retry, and adds nothing", async () => {
    const t = setup();
    const [id] = t.drop([file("a.gltf")]);
    t.runs[0]!.resolve({ kind: "kept", reason: "no .bin" });
    await t.settle();
    expect(t.rows()).toMatchObject([
      { id, status: "failed", reason: "no .bin", retryable: false },
    ]);
    expect(t.delivered).toEqual([]);
    expect(t.store.getState().assetShelf.entries).toEqual({});
  });

  it("fails a crash in words with Retry, never retrying by itself, and Retry converts again", async () => {
    const t = setup();
    const [id] = t.drop([file("a.gltf")]);
    t.runs[0]!.reject(
      new OptimizerCrashed("the converter stopped unexpectedly"),
    );
    await t.settle();
    expect(t.rows()).toMatchObject([
      {
        id,
        status: "failed",
        retryable: true,
        reason: failure.crashed("a.gltf", "the converter stopped unexpectedly"),
      },
    ]);
    expect(t.runs).toHaveLength(1);
    expect(t.host.closes).toBe(1);
    t.runner.retry(id!);
    expect(t.runs).toHaveLength(2);
    t.runs[1]!.resolve(made());
    await t.settle();
    expect(t.delivered).toHaveLength(1);
  });

  it("removing a converting model stops it, lets the Worker go and adds nothing", async () => {
    const t = setup();
    const [id] = t.drop([file("a.gltf")]);
    t.drop([file("b.gltf")]);
    expect(t.runner.remove(id!)).toBe(true);
    expect(t.runs[0]!.signal.aborted).toBe(true);
    await t.settle();
    expect(t.host.closes).toBe(1);
    expect(t.rows().map((r) => r.name)).toEqual(["b.gltf"]);
    expect(t.runs).toHaveLength(2);
    expect(t.delivered).toEqual([]);
    expect(t.runner.remove("import:nope")).toBe(false);
  });

  it("says when its delivery refused the model, and adds nothing", async () => {
    const t = setup();
    const refuse = vi.fn<ImportDelivery>(() =>
      Promise.resolve({ kind: "refused" as const, reason: "too large" }),
    );
    const [id] = t.drop([file("a.gltf")], refuse);
    t.runs[0]!.resolve(made());
    await t.settle();
    expect(t.rows()).toMatchObject([
      { id, status: "failed", reason: "too large", retryable: false },
    ]);
  });

  it("gives the drop's pictures no model used to the shelf, once every model is done", async () => {
    const t = setup();
    t.drop([
      file("a.gltf"),
      file("wood.png"),
      file("b.gltf"),
      file("photo.jpg"),
    ]);
    t.runs[0]!.resolve(made([], ["wood.png"]));
    await t.settle();
    expect(t.released).toEqual([]);
    t.runs[1]!.resolve(made());
    await t.settle();
    expect(t.released.map((p) => p.map((f) => f.name))).toEqual([
      ["photo.jpg"],
    ]);
  });

  it("holds a failed model's pictures until it is removed", async () => {
    const t = setup();
    const [id] = t.drop([file("a.gltf"), file("wood.png")]);
    t.runs[0]!.resolve({ kind: "kept", reason: "no" });
    await t.settle();
    expect(t.released).toEqual([]);
    t.runner.remove(id!);
    expect(t.released.map((p) => p.map((f) => f.name))).toEqual([["wood.png"]]);
  });

  it("close stops the conversion and every waiting one, and starts no other", async () => {
    const t = setup();
    t.drop([file("a.gltf")]);
    t.drop([file("b.gltf")]);
    t.runner.close();
    expect(t.runs[0]!.signal.aborted).toBe(true);
    await t.settle();
    expect(t.runs).toHaveLength(1);
    expect(t.delivered).toEqual([]);
    expect(t.host.closes).toBeGreaterThanOrEqual(1);
    expect(t.drop([file("c.gltf")])).toEqual([]);
  });
});

describe("the model import runner, properties", () => {
  type Step = "made" | "kept" | "crash" | "remove" | "retry";
  it("never runs two conversions at once, and adds only what it made", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.array(
          fc.constantFrom<Step>("made", "kept", "crash", "remove", "retry"),
          {
            maxLength: 12,
          },
        ),
        async (count, steps) => {
          const t = setup();
          const ids: string[] = [];
          for (let i = 0; i < count; i++)
            ids.push(...t.drop([file(`m${i}.gltf`)]));
          let madeCount = 0;
          for (const step of steps) {
            const open = t.runs.filter((r) => !r.signal.aborted);
            const live = open.at(-1);
            if (step === "retry") {
              const failed = t.rows().find((r) => r.status === "failed");
              if (failed !== undefined) t.runner.retry(failed.id);
            } else if (step === "remove") {
              const first = t.rows().find((r) => r.import !== undefined);
              if (first !== undefined) t.runner.remove(first.id);
            } else if (live !== undefined) {
              if (step === "made") {
                madeCount++;
                live.resolve(made());
              } else if (step === "kept") {
                live.resolve({ kind: "kept", reason: "r" });
              } else {
                live.reject(new OptimizerCrashed("gone"));
              }
            }
            await t.settle();
            const running = t
              .rows()
              .filter((r) => r.import !== undefined && r.status === "running");
            expect(running.length).toBeLessThanOrEqual(1);
          }
          expect(t.delivered.length).toBeLessThanOrEqual(madeCount);
          expect(
            Object.keys(t.store.getState().assetShelf.entries).length,
          ).toBe(t.delivered.length);
          t.runner.close();
        },
      ),
      { numRuns: 60 },
    );
  });
});
