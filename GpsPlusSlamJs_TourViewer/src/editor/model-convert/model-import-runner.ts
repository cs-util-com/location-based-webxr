/**
 * The page side of the model import: takes the models of a drop (planned
 * by `import-plan.ts`), shows each as an import row on the shelf
 * (`asset-shelf-slice.ts`), converts them one at a time in the
 * converter's own Worker (`model-import.worker.ts`, over the optimizer's
 * client), and hands each converted model to the delivery its drop named
 * (the shelf, an item's file field). Blobs are never state: the runner
 * keeps each import's files until it leaves.
 *
 * - One conversion at a time, first in first out, and none while the
 *   optimizer works on a model (a phone holds one large model at a time).
 * - The converter's Worker goes after every conversion (`host.close()`),
 *   so a model's memory is given back at once.
 * - A refusal fails the row with its words and no Retry; a crash or a
 *   failure fails it with Retry; nothing is retried by itself.
 * - The pictures a drop held back for its models (`ImportPlan.held`) go
 *   to the drop's `release` once each of its models was added or removed,
 *   less those a model carries.
 *
 * @see model-import-runner.ts.md
 */
import type { UnknownAction } from "@reduxjs/toolkit";

import {
  OptimizerCrashed,
  type OptimizerHost,
} from "../asset-shelf/asset-optimizers.js";
import {
  assetShelfActions as act,
  type AssetShelfState,
} from "../asset-shelf/asset-shelf-slice.js";
import {
  createOptimizerHost,
  type OptimizerWorker,
} from "../asset-shelf/optimizer-client.js";
import {
  OPTIMIZER_SETTINGS,
  type OptimizerSettings,
} from "../asset-shelf/optimizer-settings.js";
import type { ImportPlan, PlannedImport } from "./import-plan.js";
import type { ImportPayload } from "./import-step.js";
import { failure } from "./model-import-words.js";

/** What a delivery made of a converted model. */
type DeliveryResult =
  | { readonly kind: "added"; readonly id: string }
  | { readonly kind: "refused"; readonly reason: string }
  /** Nothing to deliver to any more (the editor closed). */
  | { readonly kind: "stopped" };

/** Adds a converted model `file` where its drop asked; `about` names what
 *  it was made from and what the conversion left out. */
export type ImportDelivery = (
  file: File,
  about: { readonly from: string; readonly notes: readonly string[] },
) => Promise<DeliveryResult>;

/** One drop's models, with where they go. */
interface ImportGroup {
  readonly files: readonly File[];
  readonly plan: Pick<ImportPlan, "imports" | "held">;
  readonly deliver: ImportDelivery;
  /** The held pictures no model of the drop carries, once its models
   *  are done: they go on as files of their own. */
  readonly release: (pictures: readonly File[]) => void;
}

export interface ModelImportRunner {
  /** Queues the group's models; their import ids (none once closed). */
  start(group: ImportGroup): string[];
  /** Converts a failed import again. */
  retry(id: string): void;
  /** Stops and drops an import: true when it was one that is not added,
   *  false for an id it does not hold or one already being added. */
  remove(id: string): boolean;
  /** Stops everything; starts nothing afterwards. */
  close(): void;
}

export interface ModelImportDeps {
  readonly store: {
    dispatch(action: UnknownAction): unknown;
    getState(): { readonly assetShelf: AssetShelfState };
    subscribe(listener: () => void): () => void;
  };
  readonly host: OptimizerHost;
  readonly settings?: OptimizerSettings;
}

interface Group {
  readonly held: readonly File[];
  readonly release: (pictures: readonly File[]) => void;
  /** Its imports not yet added or removed. */
  readonly open: Set<string>;
  /** The file names its added models carry. */
  readonly used: Set<string>;
}

interface Job {
  readonly id: string;
  readonly name: string;
  readonly payload: ImportPayload;
  readonly deliver: ImportDelivery;
  readonly group: Group;
}

/** The name a converted model's file gets: the import's, as `.glb`. */
function glbName(name: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.glb`;
}

function payloadOf(
  files: readonly File[],
  planned: PlannedImport,
): ImportPayload {
  const primary = files[planned.primary]!;
  if (planned.format === "zip") {
    return { format: "zip", name: primary.name, zip: primary };
  }
  return {
    format: "gltf",
    name: primary.name,
    files: [primary, ...planned.parts.map((i) => files[i]!)].map((f) => ({
      path: f.name,
      blob: f,
    })),
  };
}

const bytesOf = (payload: ImportPayload): number =>
  payload.format === "zip"
    ? payload.zip.size
    : payload.files.reduce((sum, f) => sum + f.blob.size, 0);

const isAbort = (err: unknown) =>
  err instanceof DOMException && err.name === "AbortError";

export function createModelImportRunner(
  deps: ModelImportDeps,
): ModelImportRunner {
  const { store, host } = deps;
  const settings = deps.settings ?? OPTIMIZER_SETTINGS;
  const jobs = new Map<string, Job>();
  let seq = 0;
  let closed = false;
  /** The import being converted, and how to stop it. */
  let current: { readonly id: string; readonly stop: AbortController } | null =
    null;
  /** The import whose model is being added: it can no longer be stopped. */
  let delivering: string | null = null;

  const imports = () => store.getState().assetShelf.imports;

  /** Whether the optimizer works on a model now. */
  function optimizerOnModel(): boolean {
    return Object.values(store.getState().assetShelf.entries).some(
      (e) =>
        e.kind === "model" && (e.phase === "running" || e.detailBusy === true),
    );
  }

  function pump(): void {
    if (closed || current !== null || delivering !== null) return;
    if (optimizerOnModel()) return;
    const next = Object.values(imports())
      .filter((i) => i.status === "queued" && jobs.has(i.id))
      .sort((a, b) => a.seq - b.seq)[0];
    if (next !== undefined) void convert(jobs.get(next.id)!);
  }

  const unsubscribe = store.subscribe(pump);

  /** Leaves the group; once it holds no open import, its pictures go. */
  function leave(job: Job): void {
    jobs.delete(job.id);
    const { group } = job;
    group.open.delete(job.id);
    if (group.open.size > 0 || closed) return;
    const pictures = group.held.filter((f) => !group.used.has(f.name));
    if (pictures.length > 0) group.release(pictures);
  }

  const owns = (job: Job, stop: AbortController) =>
    !closed && !stop.signal.aborted && jobs.get(job.id) === job;

  async function convert(job: Job): Promise<void> {
    const stop = new AbortController();
    let workerGone = false;
    current = { id: job.id, stop };
    store.dispatch(act.importStarted({ id: job.id }));
    try {
      const outcome = await host.run("model", job.payload, settings, {
        signal: stop.signal,
        progress: (fraction) => {
          if (owns(job, stop)) {
            store.dispatch(act.importProgress({ id: job.id, fraction }));
          }
        },
      });
      if (!owns(job, stop)) return;
      if (outcome.kind === "kept") {
        store.dispatch(
          act.importFailed({
            id: job.id,
            reason: outcome.reason,
            retryable: false,
          }),
        );
        return;
      }
      current = null;
      delivering = job.id;
      const notes = outcome.conversion?.notes ?? [];
      const made = new File([outcome.blob], glbName(job.name), {
        type: "model/gltf-binary",
      });
      // The model leaves the converter here: its Worker goes before the
      // model is added, which may optimize it at once.
      host.close();
      workerGone = true;
      const result = await job.deliver(made, { from: job.name, notes });
      delivering = null;
      if (closed) return;
      if (result.kind === "added") {
        for (const name of outcome.conversion?.used ?? []) {
          job.group.used.add(name);
        }
        store.dispatch(act.importRemoved({ id: job.id }));
        store.dispatch(
          act.madeFromSet({ id: result.id, from: job.name, notes }),
        );
        leave(job);
      } else if (result.kind === "refused") {
        store.dispatch(
          act.importFailed({
            id: job.id,
            reason: result.reason,
            retryable: false,
          }),
        );
      } else {
        store.dispatch(act.importRemoved({ id: job.id }));
        leave(job);
      }
    } catch (err) {
      delivering = null;
      if (!owns(job, stop) || isAbort(err)) return;
      const why = err instanceof Error ? err.message : String(err);
      const crashed = err instanceof OptimizerCrashed;
      store.dispatch(
        act.importFailed({
          id: job.id,
          reason: crashed
            ? failure.crashed(job.name, why)
            : failure.broken(job.name, why),
          retryable: true,
        }),
      );
    } finally {
      if (current?.id === job.id) current = null;
      // Every settle lets the converter's Worker go.
      if (!workerGone) host.close();
      pump();
    }
  }

  return {
    start(input) {
      if (closed) return [];
      const group: Group = {
        held: input.plan.held.map((i) => input.files[i]!),
        release: input.release,
        open: new Set(),
        used: new Set(),
      };
      const ids: string[] = [];
      for (const planned of input.plan.imports) {
        const payload = payloadOf(input.files, planned);
        const id = `import:${++seq}`;
        jobs.set(id, {
          id,
          name: payload.name,
          payload,
          deliver: input.deliver,
          group,
        });
        group.open.add(id);
        ids.push(id);
        store.dispatch(
          act.importQueued({
            id,
            name: payload.name,
            format: payload.format,
            bytes: bytesOf(payload),
          }),
        );
      }
      if (ids.length === 0 && group.held.length > 0) group.release(group.held);
      pump();
      return ids;
    },
    retry(id) {
      if (closed || !jobs.has(id)) return;
      store.dispatch(act.importRetried({ id }));
      pump();
    },
    remove(id) {
      const job = jobs.get(id);
      if (job === undefined || delivering === id) return false;
      if (current?.id === id) {
        current.stop.abort();
        current = null;
      }
      store.dispatch(act.importRemoved({ id }));
      leave(job);
      pump();
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      current?.stop.abort();
      current = null;
      for (const id of jobs.keys()) store.dispatch(act.importRemoved({ id }));
      jobs.clear();
      host.close();
    },
  };
}

/** The device seam: the converter's own module Worker, behind the
 *  optimizer's client (not unit-tested). */
export function createModelImportHost(): OptimizerHost {
  return createOptimizerHost(
    () =>
      new Worker(new URL("./model-import.worker.ts", import.meta.url), {
        type: "module",
      }) as unknown as OptimizerWorker,
    globalThis.document ?? null,
    "converter",
  );
}
