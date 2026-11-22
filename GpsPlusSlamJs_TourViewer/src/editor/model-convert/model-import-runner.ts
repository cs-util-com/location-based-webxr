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
 * - A zip holding several models is one import per model: before the
 *   first conversion of a zip its models are listed (`listZipModels`), it
 *   makes the first, and each other is queued as an import of its own.
 * - The pictures a drop held back for its models (`ImportPlan.held`) go
 *   to the drop's `release` once each of its models was added or removed,
 *   less those a model carries. A loose part (a `.bin`, a picture kind a
 *   tour does not show) no model of the drop used is named then, once, in
 *   a note on the drop's last added model: each loose model is handed all
 *   the drop's parts, so only the whole drop can tell.
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
import { importRoleOf } from "./import-formats.js";
import { failure, note } from "./model-import-words.js";
import { listZipModels } from "./zip-bundle.js";

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
  /** The models of a zip by path (default `listZipModels`, which reads
   *  only the zip's directory, on the page). */
  readonly listModels?: (zip: Blob) => Promise<readonly string[]>;
}

interface Group {
  readonly held: readonly File[];
  readonly release: (pictures: readonly File[]) => void;
  /** Its imports not yet added or removed. */
  readonly open: Set<string>;
  /** The file names its added models carry. */
  readonly used: Set<string>;
  /** Its loose parts that are no picture: named once its models are
   *  done, when none used them. */
  readonly parts: readonly File[];
  /** Its last added model, which carries that note. */
  lastAdded: {
    readonly id: string;
    readonly from: string;
    notes: readonly string[];
  } | null;
}

interface Job {
  readonly id: string;
  /** What the row shows (a zip's model's name once the zip is listed). */
  name: string;
  /** The file the model came in (a zip's name for each of its models). */
  readonly from: string;
  /** Set once a zip's models are listed: the model it makes. */
  payload: ImportPayload;
  readonly deliver: ImportDelivery;
  readonly group: Group;
}

const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The name a converted model's file gets: its model's, as `.glb`. */
function glbName(payload: ImportPayload): string {
  const name =
    payload.format === "zip" && payload.model !== undefined
      ? baseOf(payload.model)
      : payload.name;
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
  const listModels = deps.listModels ?? listZipModels;
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
    const unused = group.parts.filter((f) => !group.used.has(f.name));
    if (unused.length > 0 && group.lastAdded !== null) {
      const { id, from, notes } = group.lastAdded;
      store.dispatch(
        act.madeFromSet({
          id,
          from,
          notes: [...notes, note.unusedFiles(unused.map((f) => f.name))],
        }),
      );
    }
    const pictures = group.held.filter((f) => !group.used.has(f.name));
    if (pictures.length > 0) group.release(pictures);
  }

  const owns = (job: Job, stop: AbortController) =>
    !closed && !stop.signal.aborted && jobs.get(job.id) === job;

  /** Queues one import of `group`, shown as `name`; a later model of a
   *  zip of several shows no bytes of its own (`partOf` the zip). */
  function queue(
    group: Group,
    deliver: ImportDelivery,
    payload: ImportPayload,
    name: string,
    partOf?: string,
  ): string {
    const id = `import:${++seq}`;
    jobs.set(id, { id, name, from: payload.name, payload, deliver, group });
    group.open.add(id);
    store.dispatch(
      act.importQueued({
        id,
        name,
        format: payload.format,
        bytes: partOf === undefined ? bytesOf(payload) : 0,
        ...(partOf === undefined ? {} : { partOf }),
      }),
    );
    return id;
  }

  /** A zip not yet listed: it makes its first model, and each other is
   *  queued as an import of its own, in the same group. A zip that lists
   *  none is handed on as it is, for the converter to say why. */
  async function splitZip(job: Job, stop: AbortController): Promise<void> {
    const { payload } = job;
    if (payload.format !== "zip") return;
    const [first, ...others] = await listModels(payload.zip);
    if (!owns(job, stop) || first === undefined) return;
    job.payload = { ...payload, model: first };
    if (others.length === 0) return;
    job.name = baseOf(first);
    store.dispatch(
      act.importSplit({ id: job.id, name: job.name, partOf: payload.name }),
    );
    for (const model of others) {
      queue(
        job.group,
        job.deliver,
        { ...payload, model },
        baseOf(model),
        payload.name,
      );
    }
  }

  async function convert(job: Job): Promise<void> {
    const stop = new AbortController();
    let workerGone = false;
    current = { id: job.id, stop };
    store.dispatch(act.importStarted({ id: job.id }));
    try {
      if (job.payload.format === "zip" && job.payload.model === undefined) {
        await splitZip(job, stop);
        if (!owns(job, stop)) return;
      }
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
      const made = new File([outcome.blob], glbName(job.payload), {
        type: "model/gltf-binary",
      });
      // The model leaves the converter here: its Worker goes before the
      // model is added, so its memory is given back first. The shelf
      // optimizes the added model only once this import's row leaves
      // below (it makes no model while an import row is converting).
      host.close();
      workerGone = true;
      const result = await job.deliver(made, { from: job.from, notes });
      delivering = null;
      if (closed) return;
      if (result.kind === "added") {
        for (const name of outcome.conversion?.used ?? []) {
          job.group.used.add(name);
        }
        store.dispatch(act.importRemoved({ id: job.id }));
        store.dispatch(
          act.madeFromSet({ id: result.id, from: job.from, notes }),
        );
        job.group.lastAdded = { id: result.id, from: job.from, notes };
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
      // Every settle lets the converter's Worker go - only while this job
      // still holds it: a job stopped by remove() or close() let it go
      // then, and the Worker may by now be the next job's.
      if (current?.id === job.id) {
        current = null;
        if (!workerGone) host.close();
      }
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
        parts: [
          ...new Set(
            input.plan.imports.flatMap((p) =>
              p.format === "gltf" ? p.parts : [],
            ),
          ),
        ]
          .map((i) => input.files[i]!)
          .filter((f) => importRoleOf(f.name) === "companion"),
        lastAdded: null,
      };
      const ids = input.plan.imports.map((planned) => {
        const payload = payloadOf(input.files, planned);
        return queue(group, input.deliver, payload, payload.name);
      });
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
        // Its Worker goes now, before the next conversion can start in it.
        host.close();
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
